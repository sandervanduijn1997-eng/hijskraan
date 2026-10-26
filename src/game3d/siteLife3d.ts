import * as THREE from 'three';
import type { Simulation } from '../sim/simulation';
import type { SiteLife } from '../sim/site';
import { box, disposeGroup, mat, wheel } from './kit';
import type { Worker } from './people';
import { buildWorker } from './people';
import { glass, paint } from './realism';

/**
 * Levende bouwplaats in 3D: bouwvakkers (lopen, werken, rennen weg onder een last), een
 * vrachtwagen die aan- en afrijdt, bouwketen en materiaal buiten het bereik van de kraan en een
 * afzetting (rood-wit lint) rond de draaicirkel.
 */
export class SiteLife3D {
  readonly root = new THREE.Group();
  private figures: Worker[] = [];
  private truck: THREE.Group | null = null;
  private wheels: THREE.Object3D[] = [];

  constructor(
    private site: SiteLife,
    sim: Simulation,
    night: boolean,
  ) {
    for (const w of site.workers) {
      const f = buildWorker(w.vest, w.id % 3 === 0 ? 0xffffff : w.id % 3 === 1 ? 0xffd21f : 0x2f6db5);
      this.figures.push(f);
      this.root.add(f.root);
    }
    if (site.truck) {
      this.truck = buildTruck(night, this.wheels);
      this.root.add(this.truck);
    }
    this.buildProps(sim, night);
  }

  /** Keten, materiaal en de afzetting: alleen op vrije grond, keten en materiaal buiten het bereik. */
  private buildProps(sim: Simulation, night: boolean): void {
    const cx = sim.geom.slewX;
    const cz = sim.geom.slewZ;
    const freeGround = (x: number, z: number, hw: number, hd: number): boolean => {
      if (sim.surfaceBelow(x, z, hw, hd, 80).y > 0.05) return false;
      for (const zn of sim.mission.zones) if (Math.abs(x - zn.x) < hw + zn.tolerance + 1 && Math.abs(z - (zn.z ?? 0)) < hd + zn.tolerance + 1) return false;
      const t = this.site.truck;
      if (t && Math.abs(z - t.z) < hd + 3) return false;
      return true;
    };
    // bouwketen (6 × 2,5 m) en materiaalstapels buiten de maximale reikwijdte
    const reach = sim.spec.gb.boomMax + Math.max(0, ...sim.spec.jibOptions) + 6;
    const hutMat = paint(0xe8e4d8, { worn: true });
    const hutDoor = mat(0x3a5a78, { rough: 0.6 });
    let placed = 0;
    for (let k = 0; k < 24 && placed < 3; k++) {
      const a = 2.2 + k * 0.53;
      const x = cx + Math.cos(a) * reach;
      const z = cz + Math.sin(a) * reach;
      if (!freeGround(x, z, 3.5, 1.8)) continue;
      const hut = new THREE.Group();
      hut.add(box(6, 2.6, 2.5, hutMat, 0, 1.3 + 0.15, 0));
      hut.add(box(6.1, 0.12, 2.6, mat(0x8d949b, { metal: 0.4 }), 0, 2.81, 0));
      hut.add(box(0.9, 2, 0.04, hutDoor, -1.8, 1.15, 1.27));
      for (const wx of [0.2, 1.8]) hut.add(box(1.1, 0.8, 0.04, glass(night), wx, 1.75, 1.27));
      for (const sx of [-2.6, 2.6]) hut.add(box(0.3, 0.3, 2.3, mat(0x5a5e63), sx, 0.15, 0));
      hut.position.set(x, 0, z);
      hut.rotation.y = -a + Math.PI / 2;
      this.root.add(hut);
      placed++;
    }
    const pallet = mat(0xb98a4b, { rough: 0.9 });
    const bricks = mat(0xa4553a, { rough: 0.85 });
    for (let k = 0, n = 0; k < 30 && n < 4; k++) {
      const a = -0.6 + k * 0.41;
      const x = cx + Math.cos(a) * (reach - 1);
      const z = cz + Math.sin(a) * (reach - 1);
      if (!freeGround(x, z, 1.5, 1.5)) continue;
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        g.add(box(1.2, 0.14, 1, pallet, (i - 1) * 1.3, 0.07, 0));
        g.add(box(1.1, 0.9, 0.95, bricks, (i - 1) * 1.3, 0.6, 0));
      }
      g.position.set(x, 0, z);
      g.rotation.y = a;
      this.root.add(g);
      n++;
    }
    // afzetting rond de draaicirkel: paaltjes met rood-wit lint, alleen op vrije grond
    const r = this.site.rMin - 0.8;
    const n = Math.max(12, Math.round((2 * Math.PI * r) / 2.2));
    const post = mat(0xe8e8e8, { rough: 0.6 });
    const foot = mat(0xd02a1e, { rough: 0.7 });
    const tape = tapeMaterial();
    let prev: THREE.Vector3 | null = null;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (!freeGround(x, z, 0.3, 0.3)) {
        prev = null;
        continue;
      }
      this.root.add(box(0.06, 1, 0.06, post, x, 0.5, z), box(0.3, 0.06, 0.3, foot, x, 0.03, z));
      const p = new THREE.Vector3(x, 0.9, z);
      if (prev) {
        const len = prev.distanceTo(p);
        const t = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.08), tape);
        t.position.copy(prev).add(p).multiplyScalar(0.5);
        t.rotation.y = -Math.atan2(p.z - prev.z, p.x - prev.x);
        (t.material as THREE.Material).side = THREE.DoubleSide;
        this.root.add(t);
      }
      prev = p;
    }
  }

  update(dt: number): void {
    const s = this.site;
    for (let i = 0; i < s.workers.length; i++) {
      const w = s.workers[i];
      const f = this.figures[i];
      f.root.position.set(w.x, 0, w.z);
      f.root.rotation.y = Math.PI / 2 - w.heading;
      const sw = Math.sin(w.phase);
      if (w.state === 'work') {
        // bezig: armen voor het lichaam, af en toe een slag
        f.legL.rotation.x = 0;
        f.legR.rotation.x = 0;
        f.armL.rotation.set(-0.7, 0, 0);
        f.armR.rotation.set(-1.1 + Math.max(0, Math.sin(w.phase * 1.3)) * 0.8, 0, 0);
      } else {
        const amp = w.state === 'flee' ? 0.8 : 0.45;
        f.legL.rotation.x = sw * amp;
        f.legR.rotation.x = -sw * amp;
        f.armL.rotation.set(-sw * amp * 0.9, 0, 0);
        f.armR.rotation.set(sw * amp * 0.9, 0, 0);
      }
    }
    const t = s.truck;
    if (t && this.truck) {
      this.truck.visible = t.state !== 'away';
      this.truck.position.set(t.x, 0, t.z);
      for (const wh of this.wheels) wh.rotation.z -= (t.speed * dt) / 0.5;
    }
  }

  dispose(): void {
    disposeGroup(this.root);
  }
}

let tapeMat: THREE.MeshStandardMaterial | null = null;
function tapeMaterial(): THREE.MeshStandardMaterial {
  if (tapeMat) return tapeMat;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#ffffff' : '#d02a1e';
    g.fillRect(i * 16, 0, 16, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tapeMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
  return tapeMat;
}

/** Bouwvrachtwagen (3-asser met laadbak en stenen), rijdt langs +x. */
function buildTruck(night: boolean, wheels: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  const body = paint(0xd8dde2, { gloss: 0.6 });
  const chassis = mat(0x1f2226, { rough: 0.7, metal: 0.4 });
  g.add(box(8.6, 0.35, 0.9, chassis, 0, 0.95, 0));
  // cabine voorop
  g.add(box(2.1, 2.3, 2.45, body, 3.3, 2.3, 0));
  g.add(box(0.05, 0.9, 2.1, glass(night), 4.36, 2.85, 0));
  for (const side of [-1, 1]) g.add(box(1.2, 0.8, 0.04, glass(night), 3.4, 2.85, side * 1.23));
  g.add(box(0.1, 0.45, 2.3, mat(0x2b2f33), 4.36, 1.55, 0));
  if (night) for (const side of [-0.85, 0.85]) g.add(box(0.06, 0.18, 0.35, mat(0xfff4d0, { emissive: 0xfff4d0 }), 4.4, 1.5, side));
  // laadbak met pallets stenen
  g.add(box(5.6, 0.2, 2.45, mat(0x6e7378, { metal: 0.5 }), -1.2, 1.25, 0));
  for (const side of [-1, 1]) g.add(box(5.6, 0.5, 0.06, mat(0x6e7378, { metal: 0.5 }), -1.2, 1.6, side * 1.2));
  for (const px of [-3.2, -1.8, -0.4, 1.0]) g.add(box(1.15, 0.9, 1.0, mat(0xa4553a, { rough: 0.85 }), px, 1.8, -0.5), box(1.15, 0.9, 1.0, mat(0xa4553a, { rough: 0.85 }), px, 1.8, 0.55));
  for (const ax of [3.2, -1.6, -3.0]) {
    for (const side of [-1, 1]) {
      const w = wheel(0.5, 0.38);
      const holder = new THREE.Group();
      holder.add(w);
      holder.position.set(ax, 0.5, side * 1.05);
      g.add(holder);
      wheels.push(holder);
    }
  }
  return g;
}
