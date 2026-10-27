import * as THREE from 'three';
import type { MissionDef } from '../missions/data/types';
import type { Simulation } from '../sim/simulation';

/**
 * Weer en nacht in beeld: regendruppels rond de camera (schuin met de wind), een nat en glanzend
 * terrein, een windzak op de giekkop die met de wind meedraait en opbolt, en 's nachts werklampen
 * op de kraan en lichtmasten op de bouwplaats.
 */
const DROPS = 3500;
const RADIUS = 22;

export class Weather3D {
  readonly root = new THREE.Group();
  private rain: THREE.LineSegments | null = null;
  private drops: Float32Array | null = null;
  private sock: THREE.Group;
  private sockCone: THREE.Mesh;
  private boomLight: THREE.SpotLight | null = null;
  wetCount = 0;

  constructor(m: MissionDef, scene: THREE.Scene, indoor: boolean) {
    const night = m.timeOfDay === 'night' || m.timeOfDay === 'dusk';
    if (m.weather === 'rain' && !indoor) {
      // druppels als korte lijntjes; elke druppel heeft een positie, de lengte volgt de valsnelheid
      this.drops = new Float32Array(DROPS * 3);
      for (let i = 0; i < DROPS; i++) {
        this.drops[i * 3] = (Math.random() - 0.5) * 2 * RADIUS;
        this.drops[i * 3 + 1] = Math.random() * 30;
        this.drops[i * 3 + 2] = (Math.random() - 0.5) * 2 * RADIUS;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 6), 3));
      this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xdfe8ef, transparent: true, opacity: night ? 0.22 : 0.32 }));
      this.rain.frustumCulled = false;
      this.root.add(this.rain);
      // nat terrein: minder ruw en iets donkerder, zodat de lucht en de lampen erin spiegelen
      // (materialen worden gedeeld tussen missies: per mesh een natte kopie, het origineel blijft droog)
      const wet = new Map<THREE.Material, THREE.Material>();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.receiveShadow || mesh.castShadow || Array.isArray(mesh.material)) return;
        const s0 = mesh.material as THREE.MeshStandardMaterial;
        if (!s0.isMeshStandardMaterial) return;
        let w = wet.get(s0);
        if (!w) {
          const c = s0.clone();
          c.roughness = Math.max(0.08, s0.roughness * 0.18);
          c.color.multiplyScalar(0.45);
          c.envMapIntensity = 2.2;
          // world-UV-shader van het origineel overnemen
          c.onBeforeCompile = s0.onBeforeCompile;
          c.customProgramCacheKey = s0.customProgramCacheKey;
          wet.set(s0, c);
          w = c;
        }
        mesh.material = w;
        this.wetCount++;
      });
    }
    // windzak: kegel van rood-wit doek aan een staander
    this.sock = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 }));
    pole.position.y = 0.35;
    const cone = new THREE.ConeGeometry(0.18, 1.1, 12, 1, true);
    cone.rotateZ(Math.PI / 2);
    cone.translate(-0.55, 0, 0);
    this.sockCone = new THREE.Mesh(cone, sockMaterial());
    this.sockCone.position.y = 0.68;
    this.sock.add(pole, this.sockCone);
    this.root.add(this.sock);
    if (night && !indoor) {
      // werklamp onder de giekkop, op de haak gericht
      this.boomLight = new THREE.SpotLight(0xfff1d6, 60, 70, 0.42, 0.5, 1.6);
      this.root.add(this.boomLight, this.boomLight.target);
      // lichtmasten op de bouwplaats (twee, schuin op het werkterrein)
      const cx = m.crane.x;
      for (const [x, z] of [[cx - 18, -16], [cx + 24, 18]]) {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 9, 8), new THREE.MeshStandardMaterial({ color: 0x8d949b, metalness: 0.5, roughness: 0.5 }));
        mast.position.set(x, 4.5, z);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.5), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 4 }));
        lamp.position.set(x, 9.1, z);
        const spot = new THREE.SpotLight(0xfff4d6, 120, 80, 0.8, 0.6, 1.5);
        spot.position.set(x, 9, z);
        spot.target.position.set(cx + 6, 0, 0);
        this.root.add(mast, lamp, spot, spot.target);
      }
    }
  }

  /** Per frame: regen rond de camera laten vallen, windzak en werklamp bijwerken. */
  update(sim: Simulation, camera: THREE.Camera, dt: number, focus?: THREE.Vector3): void {
    const w = sim.wind;
    const tip = sim.geom.tip;
    // windzak op de giekkop: wijst met de wind mee, bolt op naarmate het harder waait
    this.sock.position.set(tip.x, tip.y + 0.6, tip.z);
    const speed = Math.hypot(w.x, w.z);
    this.sockCone.rotation.y = speed > 0.2 ? Math.atan2(w.z, -w.x) : this.sockCone.rotation.y;
    // windstil: hangt slap omlaag; vanaf ca. 12 m/s staat hij horizontaal
    this.sockCone.rotation.z = (1 - Math.min(1, speed / 12)) * 1.25;
    if (this.boomLight) {
      this.boomLight.position.set(tip.x, tip.y - 0.2, tip.z);
      const hp = sim.hookPoint();
      this.boomLight.target.position.set(hp.x, Math.max(0, hp.y - 4), hp.z);
    }
    if (this.rain && this.drops) {
      const pos = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      // regenvolume tussen camera en brandpunt: daar kijk je doorheen
      const c = focus ? camera.position.clone().lerp(focus, 0.45) : camera.position;
      const vy = 9;
      for (let i = 0; i < DROPS; i++) {
        const d = this.drops;
        d[i * 3] += w.x * dt;
        d[i * 3 + 1] -= vy * dt;
        d[i * 3 + 2] += w.z * dt;
        if (d[i * 3 + 1] < c.y - 12) {
          d[i * 3] = (Math.random() - 0.5) * 2 * RADIUS;
          d[i * 3 + 1] = c.y + 14 + Math.random() * 6 - (c.y - 12);
          d[i * 3 + 2] = (Math.random() - 0.5) * 2 * RADIUS;
        }
        // wikkel rond de camera
        const x = c.x + ((((d[i * 3] % (2 * RADIUS)) + 3 * RADIUS) % (2 * RADIUS)) - RADIUS);
        const y = c.y - 12 + d[i * 3 + 1];
        const z = c.z + ((((d[i * 3 + 2] % (2 * RADIUS)) + 3 * RADIUS) % (2 * RADIUS)) - RADIUS);
        const k = 0.09;
        a[i * 6] = x;
        a[i * 6 + 1] = y;
        a[i * 6 + 2] = z;
        a[i * 6 + 3] = x - w.x * k;
        a[i * 6 + 4] = y + vy * k;
        a[i * 6 + 5] = z - w.z * k;
      }
      pos.needsUpdate = true;
    }
  }
}

let sockMat: THREE.MeshStandardMaterial | null = null;
function sockMaterial(): THREE.MeshStandardMaterial {
  if (sockMat) return sockMat;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 5; i++) {
    g.fillStyle = i % 2 ? '#ffffff' : '#e8401c';
    g.fillRect(i * 12.8, 0, 12.8, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  sockMat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 });
  return sockMat;
}
