import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { setRealism } from './realism';
import type { SceneHooks, SessionConfig } from './world3d';
import { World3D } from './world3d';

export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra';

/** Wat elk kwaliteitsniveau aanzet. De resolutie past zich daarbinnen aan om 60 fps te halen. */
export const QUALITY: Record<GraphicsQuality, { shadows: boolean; shadowMap: number; ao: boolean; textures: boolean; minRes: number; maxRes: number; label: string }> = {
  low: { shadows: false, shadowMap: 1024, ao: false, textures: false, minRes: 0.5, maxRes: 0.75, label: 'Laag' },
  medium: { shadows: true, shadowMap: 1024, ao: false, textures: true, minRes: 0.6, maxRes: 1, label: 'Middel' },
  high: { shadows: true, shadowMap: 2048, ao: true, textures: true, minRes: 0.65, maxRes: 1.5, label: 'Hoog' },
  ultra: { shadows: true, shadowMap: 4096, ao: true, textures: true, minRes: 1, maxRes: 2, label: 'Ultra' },
};

/** Doelframetijd (ms) en marges voor de automatische resolutie. */
const TARGET_MS = 1000 / 60;

/**
 * Beheert de WebGL-renderer, nabewerking (ambient occlusion, tonemapping), de frame-lus,
 * dynamische resolutie en de actieve 3D-sessie.
 * `?quality=low|medium|high|ultra` overschrijft de instelling; `?render=off` tekent niets (tests).
 */
export class Host3D {
  readonly renderer: THREE.WebGLRenderer;
  current: World3D | null = null;
  private last = performance.now();
  private labels: HTMLElement;
  quality: GraphicsQuality;
  /** Testmodus (?render=off): simulatie, invoer en UI lopen door, er wordt niet getekend. */
  readonly renderOff: boolean;
  private composer: EffectComposer | null = null;
  /** Huidige renderresolutie (fractie van de schermresolutie in CSS-pixels × pixelratio). */
  res = 1;
  private frameMs = TARGET_MS;
  private sinceAdjust = 0;
  /** Gemeten beelden per seconde (voor de debug-API en het kwaliteitsmenu). */
  fps = 60;
  private readonly forced: boolean;

  constructor(container: HTMLElement, quality: GraphicsQuality = 'high') {
    const q = new URLSearchParams(location.search).get('quality') as GraphicsQuality | null;
    this.forced = !!q && q in QUALITY;
    this.quality = this.forced ? q! : quality;
    this.renderOff = new URLSearchParams(location.search).get('render') === 'off';
    setRealism(QUALITY[this.quality].textures && !this.renderOff);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.applyQuality();
    container.append(this.renderer.domElement);
    this.labels = document.createElement('div');
    this.labels.className = 'labels';
    container.append(this.labels);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    const loop = (t: number) => {
      const dt = t - this.last;
      this.last = t;
      if (this.current) {
        this.current.frame(dt, t);
        if (!this.renderOff) {
          if (this.composer) this.composer.render();
          else this.renderer.render(this.current.scene, this.current.rig.camera);
          this.adapt(dt);
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** Kwaliteit wijzigen (instellingen). Texturen gelden vanaf de volgende missie. */
  setQuality(q: GraphicsQuality): void {
    if (this.forced) return;
    this.quality = q;
    setRealism(QUALITY[q].textures && !this.renderOff);
    this.applyQuality();
    if (this.current) this.buildComposer(this.current);
    this.resize();
  }

  private applyQuality(): void {
    const Q = QUALITY[this.quality];
    this.renderer.shadowMap.enabled = Q.shadows;
    this.res = Math.min(Q.maxRes, Math.max(Q.minRes, Math.min(window.devicePixelRatio, 1.25)));
  }

  /** Dynamische resolutie: zakt de framerate onder 60, dan rendert de game iets scherper of minder scherp. */
  private adapt(dt: number): void {
    if (dt <= 0 || dt > 250) return;
    this.frameMs += (dt - this.frameMs) * 0.05;
    this.fps = 1000 / this.frameMs;
    this.sinceAdjust += dt;
    if (this.sinceAdjust < 800) return;
    const Q = QUALITY[this.quality];
    let next = this.res;
    if (this.frameMs > TARGET_MS * 1.12) next = Math.max(Q.minRes, this.res * 0.88);
    else if (this.frameMs < TARGET_MS * 0.8) next = Math.min(Q.maxRes, this.res * 1.06);
    if (Math.abs(next - this.res) > 0.01) {
      this.res = next;
      this.resize();
    }
    this.sinceAdjust = 0;
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.res);
    this.renderer.setSize(w, h);
    this.composer?.setPixelRatio(this.res);
    this.composer?.setSize(w, h);
    this.current?.rig.setAspect(w, h);
  }

  private buildComposer(w: World3D): void {
    this.composer?.dispose();
    this.composer = null;
    if (this.renderOff) return;
    const Q = QUALITY[this.quality];
    w.setShadowMapSize(Q.shadowMap);
    const c = new EffectComposer(this.renderer);
    c.setPixelRatio(this.res);
    c.setSize(window.innerWidth, window.innerHeight);
    c.addPass(new RenderPass(w.scene, w.rig.camera));
    if (Q.ao) {
      const ao = new GTAOPass(w.scene, w.rig.camera, window.innerWidth, window.innerHeight);
      // kieren en contactschaduw op meterschaal (kraandelen, lasten op de grond, gevels)
      ao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.4, thickness: 1.5, scale: 1.15, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      ao.blendIntensity = 0.9;
      c.addPass(ao);
    }
    c.addPass(new OutputPass());
    this.composer = c;
  }

  start(cfg: SessionConfig, hooks: SceneHooks): World3D {
    this.current?.dispose();
    const w = new World3D(cfg, hooks, this.renderer, this.labels);
    w.rig.setAspect(window.innerWidth, window.innerHeight);
    this.current = w;
    this.buildComposer(w);
    return w;
  }
}

/** Controleer of WebGL beschikbaar is. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
