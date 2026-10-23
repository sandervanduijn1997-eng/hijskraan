import * as THREE from 'three';
import { mat } from './kit';

type Kind = 'dust' | 'smoke' | 'spark' | 'debris';

interface P {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
}

const KINDS: Kind[] = ['dust', 'smoke', 'spark', 'debris'];
const COLORS: Record<Kind, number> = { dust: 0xb8a68a, smoke: 0x6d6d6d, spark: 0xffd27a, debris: 0x6d6d6d };

/** Deeltjespool met InstancedMesh per soort: geen allocaties in de hoofdlus. */
export class Effects3D {
  readonly root = new THREE.Group();
  enabled = true;
  private pools = new Map<Kind, { mesh: THREE.InstancedMesh; ps: P[] }>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private v = new THREE.Vector3();

  constructor(size = 160) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    for (const k of KINDS) {
      const material = k === 'spark' ? mat(COLORS[k], { emissive: 0xffa040 }) : mat(COLORS[k], { transparent: k === 'smoke' ? 0.55 : 0.8 });
      const mesh = new THREE.InstancedMesh(geo, material, size);
      mesh.frustumCulled = false;
      mesh.count = size;
      const ps: P[] = Array.from({ length: size }, () => ({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0 }));
      for (let i = 0; i < size; i++) mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      this.root.add(mesh);
      this.pools.set(k, { mesh, ps });
    }
  }

  private spawn(k: Kind, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number): void {
    if (!this.enabled) return;
    const pool = this.pools.get(k)!;
    const p = pool.ps.find((q) => !q.alive);
    if (!p) return;
    Object.assign(p, { alive: true, x, y, z, vx, vy, vz, life, max: life, size });
  }

  dust(x: number, y: number, z: number, n: number): void {
    for (let i = 0; i < n; i++) this.spawn('dust', x + (Math.random() - 0.5), y + 0.1, z + (Math.random() - 0.5), (Math.random() - 0.5) * 1.6, Math.random() * 0.8, (Math.random() - 0.5) * 1.6, 0.8 + Math.random() * 0.8, 0.25 + Math.random() * 0.4);
  }

  smoke(x: number, y: number, z: number, intensity: number, wind: number): void {
    if (Math.random() > 0.2 + intensity * 0.5) return;
    this.spawn('smoke', x, y, z, wind * 0.15 + (Math.random() - 0.5) * 0.3, 0.8 + intensity, (Math.random() - 0.5) * 0.3, 1.4 + Math.random() * 0.6, 0.15 + intensity * 0.15);
  }

  sparks(x: number, y: number, z: number, n: number): void {
    for (let i = 0; i < n; i++) this.spawn('spark', x, y, z, (Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6, 0.3 + Math.random() * 0.4, 0.06);
  }

  debris(x: number, y: number, z: number, n: number): void {
    for (let i = 0; i < n; i++) this.spawn('debris', x, y, z, (Math.random() - 0.5) * 4, 1 + Math.random() * 3, (Math.random() - 0.5) * 4, 0.8 + Math.random() * 0.5, 0.1);
  }

  update(dt: number, wind: number): void {
    for (const [k, { mesh, ps }] of this.pools) {
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (!p.alive) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.alive = false;
          mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
          continue;
        }
        if (k === 'spark' || k === 'debris') {
          p.vy -= 9.81 * dt;
          if (p.y < 0) {
            p.y = 0;
            p.vy *= -0.3;
          }
        } else {
          p.vx += wind * (k === 'smoke' ? 0.2 : 0.05) * dt;
          p.size += dt * (k === 'smoke' ? 0.35 : 0.6);
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const f = k === 'spark' || k === 'debris' ? 1 : Math.min(1, (p.life / p.max) * 1.5);
        this.s.setScalar(p.size * f);
        this.v.set(p.x, p.y, p.z);
        mesh.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
