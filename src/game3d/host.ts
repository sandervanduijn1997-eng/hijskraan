import * as THREE from 'three';
import type { SceneHooks, SessionConfig } from './world3d';
import { World3D } from './world3d';

/**
 * Beheert de WebGL-renderer, het canvas, de frame-lus en de actieve 3D-sessie.
 * Kwaliteit "low" (?quality=low) schakelt schaduwen uit en rendert op lagere resolutie.
 */
export class Host3D {
  readonly renderer: THREE.WebGLRenderer;
  current: World3D | null = null;
  private last = performance.now();
  private labels: HTMLElement;
  readonly quality: 'high' | 'low';
  /** Testmodus (?render=off): simulatie, invoer en UI lopen door, er wordt niet getekend. */
  readonly renderOff: boolean;

  constructor(container: HTMLElement) {
    const q = new URLSearchParams(location.search).get('quality');
    this.quality = q === 'low' ? 'low' : 'high';
    this.renderOff = new URLSearchParams(location.search).get('render') === 'off';
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality === 'high', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.quality === 'low' ? 0.6 : Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = this.quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
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
        if (!this.renderOff) this.renderer.render(this.current.scene, this.current.rig.camera);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.current?.rig.setAspect(w, h);
  }

  start(cfg: SessionConfig, hooks: SceneHooks): World3D {
    this.current?.dispose();
    const w = new World3D(cfg, hooks, this.renderer.domElement, this.labels);
    w.rig.setAspect(window.innerWidth, window.innerHeight);
    this.current = w;
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
