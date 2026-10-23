import type Phaser from 'phaser';
import { proj, S } from './draw';

type Kind = 'dust' | 'smoke' | 'spark' | 'debris';

interface Particle {
  alive: boolean;
  kind: Kind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: number;
}

/** Herbruikbare deeltjespool (geen allocaties in de hoofdlus). */
export class Effects {
  private pool: Particle[] = [];
  enabled = true;

  constructor(private g: Phaser.GameObjects.Graphics, size = 400) {
    for (let i = 0; i < size; i++) this.pool.push({ alive: false, kind: 'dust', x: 0, y: 0, z: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, color: 0 });
  }

  private spawn(kind: Kind, x: number, y: number, z: number, vx: number, vy: number, life: number, size: number, color: number): void {
    if (!this.enabled) return;
    const p = this.pool.find((q) => !q.alive);
    if (!p) return;
    p.alive = true;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.max = life;
    p.size = size;
    p.color = color;
  }

  dust(x: number, y: number, z: number, amount: number, color = 0xb8a68a): void {
    for (let i = 0; i < amount; i++) this.spawn('dust', x + (Math.random() - 0.5) * 0.6, y + 0.1, z, (Math.random() - 0.5) * 1.6, Math.random() * 0.8, 0.8 + Math.random() * 0.8, 0.3 + Math.random() * 0.5, color);
  }

  smoke(x: number, y: number, z: number, intensity: number, windX: number): void {
    if (Math.random() > 0.25 + intensity * 0.6) return;
    this.spawn('smoke', x, y, z, windX * 0.15 + (Math.random() - 0.5) * 0.3, 0.8 + intensity, 1.2 + Math.random() * 0.6, 0.12 + intensity * 0.12, intensity > 0.6 ? 0x3a3a3a : 0x6d6d6d);
  }

  sparks(x: number, y: number, z: number, n: number): void {
    for (let i = 0; i < n; i++) this.spawn('spark', x, y, z, (Math.random() - 0.5) * 6, Math.random() * 5, 0.3 + Math.random() * 0.4, 0.08, 0xffd27a);
  }

  debris(x: number, y: number, z: number, n: number): void {
    for (let i = 0; i < n; i++) this.spawn('debris', x, y, z, (Math.random() - 0.5) * 4, 1 + Math.random() * 3, 0.8 + Math.random() * 0.5, 0.12, 0x6d6d6d);
  }

  update(dt: number, windX: number): void {
    const g = this.g;
    g.clear();
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      const k = p.life / p.max;
      switch (p.kind) {
        case 'dust':
          p.vx += windX * 0.05 * dt;
          p.vy -= 0.3 * dt;
          p.size += dt * 0.8;
          break;
        case 'smoke':
          p.vx += windX * 0.2 * dt;
          p.size += dt * 0.35;
          break;
        case 'spark':
        case 'debris':
          p.vy -= 9.81 * dt;
          if (p.y < 0) {
            p.y = 0;
            p.vy *= -0.3;
          }
          break;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const c = proj(p.x, p.y, p.z);
      const a = p.kind === 'spark' ? k : p.kind === 'smoke' ? 0.28 * k : 0.5 * k;
      g.fillStyle(p.color, a);
      if (p.kind === 'spark' || p.kind === 'debris') g.fillRect(c.x, c.y, Math.max(2, p.size * S), Math.max(2, p.size * S));
      else g.fillCircle(c.x, c.y, p.size * S);
    }
  }
}
