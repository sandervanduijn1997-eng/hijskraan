import type Phaser from 'phaser';
import type { LoadType } from '../../missions/data/loads';
import type { MissionDef, ObstacleDef } from '../../missions/data/types';
import { FULL_DEPTH } from '../../missions/runtime/buildWorld';
import type { RigidBody } from '../../physics/load/rigidBody';
import { makeRng, hashString } from '../../utils/math';
import { KX, KY, S, box3, mix, poly, polyW, proj, shade, shadow, truss3 } from './draw';
import type { EnvPalette } from './palette';
import { GROUND_COLORS } from './palette';

type G = Phaser.GameObjects.Graphics;

/** Visuele diepte voor obstakels die in de simulatie "oneindig" diep zijn. */
const VIS_DEPTH = 3;

const visZ = (o: ObstacleDef): [number, number] => {
  const z0 = o.z0 ?? -FULL_DEPTH;
  const z1 = o.z1 ?? FULL_DEPTH;
  return [Math.max(z0, -VIS_DEPTH), Math.min(z1, VIS_DEPTH)];
};

export function drawGround(g: G, m: MissionDef, pal: EnvPalette, water: [number, number][]): void {
  const x0 = m.bounds.minX - 80;
  const x1 = m.bounds.maxX + 80;
  // bovenvlak van de grond (diepte)
  const fallback = GROUND_COLORS[m.groundFallback ?? (pal.indoor ? 'floor' : 'asphalt')] ?? pal.ground;
  const zones = m.ground ?? [];
  const colorAt = (x: number) => {
    for (const z of zones) if (x >= z.x0 && x < z.x1) return GROUND_COLORS[z.type] ?? fallback;
    return fallback;
  };
  const step = 2;
  const rng = makeRng(hashString(m.id));
  for (let x = x0; x < x1; x += step) {
    const c = colorAt(x + step / 2);
    polyW(g, [[x, 0, 6], [x + step, 0, 6], [x + step, 0, -14], [x, 0, -14]], shade(c, 1.05 + (rng() - 0.5) * 0.06));
  }
  // voorrand (dwarsdoorsnede)
  for (let x = x0; x < x1; x += step) {
    const c = colorAt(x + step / 2);
    const a = proj(x, 0, 6);
    g.fillStyle(shade(c, 0.6), 1);
    g.fillRect(a.x, a.y, step * S + 1, 1.2 * S);
    g.fillStyle(shade(c, 0.38), 1);
    g.fillRect(a.x, a.y + 1.2 * S, step * S + 1, 200 * S);
    g.fillStyle(shade(c, 0.45), 1);
    g.fillRect(a.x, a.y + 1.2 * S, step * S + 1, 0.15 * S);
  }
  // water
  for (const [w0, w1] of water) {
    polyW(g, [[w0, 0.02, 6], [w1, 0.02, 6], [w1, 0.02, -14], [w0, 0.02, -14]], 0x2f5f7a, 0.95);
    for (let i = 0; i < 40; i++) {
      const x = w0 + rng() * (w1 - w0);
      const z = -14 + rng() * 20;
      const p = proj(x, 0.03, z);
      g.lineStyle(1, 0x7fb2cc, 0.5);
      g.lineBetween(p.x, p.y, p.x + 1.2 * S, p.y);
    }
  }
  // bandensporen / markeringen
  g.lineStyle(1, 0xffffff, 0.08);
  for (let i = 0; i < 30; i++) {
    const x = x0 + rng() * (x1 - x0);
    const a = proj(x, 0.01, 2);
    g.lineBetween(a.x, a.y, a.x + 3 * S, a.y);
  }
}

export function drawObstacle(g: G, o: ObstacleDef, light: number): void {
  const [z0, z1] = visZ(o);
  const X0 = o.x;
  const X1 = o.x + o.w;
  const Y0 = o.y;
  const Y1 = o.y + o.h;
  const t = (c: number) => shade(c, light);
  const style = o.style ?? o.kind;
  const rng = makeRng(hashString(o.id));
  switch (style) {
    case 'truckBed':
      box3(g, X0, X1, Y0 + 0.5, Y1, z0, z1, t(0x5b6168));
      box3(g, X0, X1, Y1 - 0.15, Y1, z0, z1, t(0x7d6a55));
      for (let x = X0 + 1; x < X1 - 0.5; x += Math.max(2.5, (X1 - X0) / 4)) {
        const c = proj(x, 0.5, z1);
        g.fillStyle(0x15171a, 1);
        g.fillCircle(c.x, c.y, 0.5 * S);
        g.fillStyle(0x6d747b, 1);
        g.fillCircle(c.x, c.y, 0.22 * S);
      }
      break;
    case 'truckCab':
    case 'truckCabL': {
      box3(g, X0, X1, 0.5, Y1, z0, z1, t(0xdfe4e8));
      const wx = style === 'truckCab' ? X1 - 1.2 : X0 + 0.15;
      const a = proj(wx, Y1 - 0.25, z1);
      const b = proj(wx + 1.05, Y1 - 1.3, z1);
      g.fillStyle(0x7fa6c4, 0.9);
      g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      const c = proj((X0 + X1) / 2, 0.5, z1);
      g.fillStyle(0x15171a, 1);
      g.fillCircle(c.x, c.y, 0.5 * S);
      break;
    }
    case 'brick': {
      box3(g, X0, X1, Y0, Y1, z0, z1, t(0x9a4b35), { facets: false });
      g.lineStyle(1, t(0x6e3324), 0.6);
      for (let y = Y0 + 0.25; y < Y1; y += 0.25) {
        const a = proj(X0, y, z1);
        const b = proj(X1, y, z1);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
      break;
    }
    case 'glass': {
      box3(g, X0, X1, Y0, Y1, z0, z1, t(0x5f7f9a));
      g.lineStyle(1, t(0x9fc2dc), 0.5);
      for (let y = Y0 + 3.5; y < Y1; y += 3.5) {
        const a = proj(X0, y, z1);
        const b = proj(X1, y, z1);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
      for (let x = X0 + 1.5; x < X1; x += 1.5) {
        const a = proj(x, Y0, z1);
        const b = proj(x, Y1, z1);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
      break;
    }
    case 'skeleton': {
      // betonnen casco: vloeren en kolommen
      const floors = Math.max(1, Math.round((Y1 - Y0) / 3.5));
      const fh = (Y1 - Y0) / floors;
      box3(g, X0, X1, Y0, Y1, z0, z1, t(0x6b6f74), { alpha: 0.35, facets: false });
      for (let f = 1; f <= floors; f++) box3(g, X0 - 0.2, X1, Y0 + f * fh - 0.3, Y0 + f * fh, z0, z1, t(0xa9a59c));
      for (let x = X0; x <= X1 - 0.4; x += Math.max(3, (X1 - X0) / 5)) box3(g, x, x + 0.4, Y0, Y1 - 0.3, z1 - 0.4, z1, t(0x9a968d), { facets: false });
      break;
    }
    case 'scaffold': {
      box3(g, X0, X1, Y1 - 0.2, Y1, z0, z1, t(0x8a6a3a));
      g.lineStyle(Math.max(1, S * 0.08), t(0xb8bec4), 1);
      for (let x = X0; x <= X1 + 0.01; x += (X1 - X0) / Math.max(1, Math.round((X1 - X0) / 1.5))) {
        const a = proj(x, Y0, z1);
        const b = proj(x, Y1, z1);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
      for (let y = Y0 + 1; y < Y1; y += 1.5) {
        const a = proj(X0, y, z1);
        const b = proj(X1, y, z1);
        g.lineBetween(a.x, a.y, b.x, b.y);
        const c = proj(X0, y - 1, z1);
        g.lineBetween(c.x, c.y, b.x, b.y);
      }
      break;
    }
    case 'fence': {
      const a = proj(X0, Y0, 1.5);
      const b = proj(X0, Y1, 1.5);
      g.fillStyle(t(0xd9dde2), 1);
      g.fillRect(a.x, b.y, Math.max(2, o.w * S), a.y - b.y);
      for (let y = Y0; y < Y1; y += 0.35) {
        const p = proj(X0, y, 1.5);
        g.fillStyle((Math.round(y / 0.35) % 2) ? 0xe74c3c : 0xffffff, 1);
        g.fillRect(p.x, p.y - 0.35 * S, Math.max(3, o.w * S), 0.35 * S);
      }
      polyW(g, [[X0, Y1, 1.5], [X0 + o.w, Y1, 1.5], [X0 + o.w, Y1, -1.5], [X0, Y1, -1.5]], 0xb0b4b8);
      break;
    }
    case 'foundation':
      box3(g, X0, X1, Y0, Y1, z0, z1, t(0xa5a29b));
      polyW(g, [[X0 + 0.1, Y1 + 0.005, z1 - 0.1], [X1 - 0.1, Y1 + 0.005, z1 - 0.1], [X1 - 0.1, Y1 + 0.005, z0 + 0.1], [X0 + 0.1, Y1 + 0.005, z0 + 0.1]], t(0xb8b5ae));
      break;
    case 'steel':
      box3(g, X0, X1, Y0, Y1, z0, z1, t(0x5d6d7e));
      break;
    case 'rack':
      box3(g, X0, X1, Y0, Y1, z0, z1, t(0x3f5a73), { facets: false });
      for (let y = Y0 + 1; y < Y1; y += 1.2) box3(g, X0, X1, y, y + 0.15, z0, z1, t(0xf2b705));
      break;
    case 'conveyor':
      box3(g, X0, X1, Y0, Y1, z0, z1, t(0x4a5560));
      box3(g, X0, X1, Y1 - 0.12, Y1, z0, z1, t(0x23272b));
      for (let x = X0 + 0.5; x < X1; x += 1) {
        const c = proj(x, Y1 - 0.35, z1);
        g.fillStyle(0x9aa3ab, 1);
        g.fillCircle(c.x, c.y, 0.18 * S);
      }
      break;
    case 'tank':
    case 'column': {
      box3(g, X0, X1, Y0, Y1, z0, z1, t(style === 'tank' ? 0xc8ccd0 : 0x9aa3ab));
      g.lineStyle(1, t(0x6d747b), 0.6);
      for (let y = Y0 + 2; y < Y1; y += 3) {
        const a = proj(X0, y, z1);
        const b = proj(X1, y, z1);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
      if (style === 'column') for (let y = Y0 + 4; y < Y1; y += 6) box3(g, X0 - 0.5, X1 + 0.5, y, y + 0.2, z0, z1, t(0xf2b705));
      break;
    }
    case 'pipe':
    case 'pipeRack': {
      const zc = (z0 + z1) / 2;
      const r = Math.min(o.h, z1 - z0) / 2;
      box3(g, X0, X1, Y0, Y1, zc - r, zc + r, t(style === 'pipe' ? 0x6b8798 : 0x5d6d7e), { facets: false });
      polyW(g, [[X0, Y1 - 0.08, zc + r], [X1, Y1 - 0.08, zc + r], [X1, Y1 - 0.02, zc + r * 0.2], [X0, Y1 - 0.02, zc + r * 0.2]], t(0xa9c2d1), 0.6);
      break;
    }
    case 'containerStack': {
      const colors = [0xc0392b, 0x2f6db5, 0x27ae60, 0xd35400];
      const n = Math.max(1, Math.round((Y1 - Y0) / 2.59));
      for (let i = 0; i < n; i++) {
        const c = colors[Math.floor(rng() * colors.length)];
        const yy = Y0 + i * 2.59;
        box3(g, X0, X1, yy, yy + 2.59, z0, z1, t(c), { facets: false });
        g.lineStyle(1, t(shade(c, 0.7)), 0.8);
        for (let x = X0 + 0.3; x < X1; x += 0.3) {
          const a = proj(x, yy + 0.1, z1);
          const b = proj(x, yy + 2.49, z1);
          g.lineBetween(a.x, a.y, b.x, b.y);
        }
      }
      break;
    }
    case 'ship': {
      polyW(g, [[X0, Y1, z1], [X1, Y1, z1], [X1 - 2, Y0 - 1, z1], [X0 + 3, Y0 - 1, z1]], t(0x1f3a52));
      polyW(g, [[X0, Y1, z1], [X1, Y1, z1], [X1, Y1, z0], [X0, Y1, z0]], t(0x7b8a8c));
      box3(g, X0, X1, Y1 - 0.8, Y1, z0, z1, t(0xa93226), { facets: false });
      break;
    }
    case 'shiphouse':
      box3(g, X0, X1, Y0, Y1, z0, z1, t(0xe9edf0));
      for (let y = Y0 + 1.5; y < Y1 - 0.5; y += 2.4) {
        const a = proj(X0 + 0.6, y + 1, z1);
        const b = proj(X1 - 0.6, y, z1);
        g.fillStyle(0x2c3e50, 0.9);
        g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      }
      break;
    case 'turbine':
      box3(g, X0, X1, Y0, Y1, z0 + 0.5, z1 - 0.5, t(0xeef1f3));
      g.lineStyle(1, t(0xb8c0c6), 0.7);
      for (let y = Y0 + 22; y < Y1; y += 22) {
        const a = proj(X0, y, z1 - 0.5);
        const b = proj(X1, y, z1 - 0.5);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
      break;
    case 'jacket': {
      // offshore jacket: vakwerkpoten met topdek
      for (const xx of [X0 + 0.5, X1 - 0.5]) truss3(g, xx, Y0, z1, xx, Y1 - 1, z1, 1.0, t(0xe67e22));
      truss3(g, X0 + 0.5, Y0 + (Y1 - Y0) * 0.5, z1, X1 - 0.5, Y0 + (Y1 - Y0) * 0.5, z1, 0.8, t(0xe67e22));
      box3(g, X0, X1, Y1 - 1, Y1, z0, z1, t(0x7f8c8d));
      break;
    }
    case 'module':
      box3(g, X0, X1, Y0, Y1, z0, z1, t(0x8e9aa6));
      for (let y = Y0 + 4; y < Y1; y += 4) box3(g, X0, X1, y, y + 0.3, z0, z1, t(0xf2b705), { facets: false });
      break;
    case 'flare':
      truss3(g, X0 + o.w / 2, Y0, 0, X0 + o.w / 2, Y1, 0, o.w, t(0xc0392b));
      break;
    case 'ceiling': {
      box3(g, X0, X1, Y0, Y1, -6, 3, t(0x30353b), { facets: false });
      for (let x = Math.ceil(X0 / 6) * 6; x < X1; x += 6) {
        truss3(g, x, Y0, 3, x + 6, Y0, 3, 0.8, t(0x4a5058));
        const c = proj(x + 3, Y0 - 0.1, 0);
        g.fillStyle(0xfff3c4, 0.9);
        g.fillRect(c.x - 0.6 * S, c.y, 1.2 * S, 0.15 * S);
        g.fillStyle(0xfff3c4, 0.05);
        g.fillTriangle(c.x - 0.6 * S, c.y, c.x + 0.6 * S, c.y, c.x, c.y + 8 * S);
      }
      break;
    }
    case 'roof':
      box3(g, X0, X1, Y0, Y1, z0, z1, t(0x5d646b));
      break;
    case 'concrete':
    default:
      box3(g, X0, X1, Y0, Y1, z0, z1, t(o.kind === 'support' ? 0x9a968d : 0x8c8f92));
      break;
  }
}

/** Last met stijlafhankelijke details. Wordt in het lichaamsframe getekend. */
export function drawLoad(g: G, type: LoadType, b: RigidBody, x: number, y: number, z: number, angle: number, damaged: number, highlight: boolean): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const hw = b.halfW;
  const hh = b.halfH;
  const ox = b.boxOffset.x;
  const oy = b.boxOffset.y;
  const d = Math.min(type.depth, 6) / 2;
  const W = (lx: number, ly: number, lz: number): [number, number, number] => [x + (ox + lx) * c - (oy + ly) * s, y + (ox + lx) * s + (oy + ly) * c, z + lz];
  const col = damaged > 15 ? mix(type.color, 0x5a3a2a, Math.min(0.6, damaged / 80)) : type.color;
  const P = (lx: number, ly: number, lz: number) => proj(...W(lx, ly, lz));
  const face = (pts: [number, number, number][], color: number, a = 1) => poly(g, pts.map(([a1, b1, c1]) => P(a1, b1, c1)), color, a);
  // georiënteerde doos: boven, zij (rechts), voor
  const box = (lx0: number, lx1: number, ly0: number, ly1: number, lz0: number, lz1: number, color: number) => {
    face([[lx0, ly1, lz1], [lx1, ly1, lz1], [lx1, ly1, lz0], [lx0, ly1, lz0]], shade(color, 1.18));
    if (s >= -0.2) face([[lx1, ly0, lz1], [lx1, ly0, lz0], [lx1, ly1, lz0], [lx1, ly1, lz1]], shade(color, 0.72));
    else face([[lx0, ly0, lz1], [lx0, ly0, lz0], [lx0, ly1, lz0], [lx0, ly1, lz1]], shade(color, 0.72));
    face([[lx0, ly0, lz1], [lx1, ly0, lz1], [lx1, ly1, lz1], [lx0, ly1, lz1]], color);
  };
  switch (type.style) {
    case 'pallet':
    case 'bricks': {
      box(-hw, hw, -hh, -hh + 0.15, -d, d, 0xb98a4b);
      box(-hw + 0.05, hw - 0.05, -hh + 0.15, hh, -d + 0.05, d - 0.05, col);
      const n = type.style === 'bricks' ? 5 : 3;
      for (let i = 1; i < n; i++) {
        const ly = -hh + 0.15 + ((2 * hh - 0.15) * i) / n;
        const a = P(-hw + 0.05, ly, d - 0.05);
        const bb = P(hw - 0.05, ly, d - 0.05);
        g.lineStyle(1, shade(col, 0.7), 0.8);
        g.lineBetween(a.x, a.y, bb.x, bb.y);
      }
      break;
    }
    case 'container': {
      box(-hw, hw, -hh, hh, -d, d, col);
      g.lineStyle(1, shade(col, 0.7), 0.9);
      for (let lx = -hw + 0.3; lx < hw; lx += 0.3) {
        const a = P(lx, -hh + 0.08, d);
        const bb = P(lx, hh - 0.08, d);
        g.lineBetween(a.x, a.y, bb.x, bb.y);
      }
      break;
    }
    case 'beam': {
      box(-hw, hw, hh - 0.06, hh, -d, d, col);
      box(-hw, hw, -hh, -hh + 0.06, -d, d, col);
      box(-hw, hw, -hh + 0.06, hh - 0.06, -0.03, 0.03, shade(col, 0.85));
      break;
    }
    case 'pipe': {
      box(-hw, hw, -hh, hh, -d, d, col);
      face([[-hw, hh * 0.4, d], [hw, hh * 0.4, d], [hw, hh * 0.8, d * 0.6], [-hw, hh * 0.8, d * 0.6]], shade(col, 1.3), 0.6);
      break;
    }
    case 'truss':
    case 'bridge': {
      if (type.style === 'bridge') {
        box(-hw, hw, -hh, hh, -d, d, col);
        box(-hw, hw, hh - 0.25, hh, -d - 0.2, d + 0.2, shade(col, 1.1));
      } else {
        const a = W(-hw, hh * 0.8, d * 0.2);
        const bb = W(hw, hh * 0.8, d * 0.2);
        const a2 = W(-hw, -hh * 0.8, d * 0.2);
        const b2 = W(hw, -hh * 0.8, d * 0.2);
        truss3(g, a[0], a[1], a[2], bb[0], bb[1], bb[2], hh * 0.4, col);
        truss3(g, a2[0], a2[1], a2[2], b2[0], b2[1], b2[2], hh * 0.4, col);
        g.lineStyle(Math.max(1, S * 0.1), col, 1);
        const n = Math.max(2, Math.round(hw * 2 / 1.5));
        for (let i = 0; i <= n; i++) {
          const lx = -hw + (2 * hw * i) / n;
          const p0 = P(lx, -hh * 0.8, d * 0.2);
          const p1 = P(lx + (i % 2 ? 1 : -1) * 0.75, hh * 0.8, d * 0.2);
          g.lineBetween(p0.x, p0.y, p1.x, p1.y);
        }
      }
      break;
    }
    case 'turbineTower':
      box(-hw, hw, -hh, hh, -d, d, col);
      box(-hw - 0.25, hw + 0.25, hh - 0.2, hh, -d - 0.25, d + 0.25, 0xb8c0c6);
      box(-hw - 0.25, hw + 0.25, -hh, -hh + 0.2, -d - 0.25, d + 0.25, 0xb8c0c6);
      break;
    case 'nacelle':
      box(-hw, hw, -hh, hh, -d, d, col);
      box(hw - 2.6, hw, -hh * 0.6, hh * 0.6, -d * 0.7, d * 0.7, 0xd5dbe0);
      break;
    case 'hvac':
    case 'generator':
    case 'transformer':
    case 'engine':
    case 'machine':
    case 'module': {
      box(-hw, hw, -hh, hh, -d, d, col);
      box(-hw + 0.1, hw - 0.1, hh - 0.15, hh, -d + 0.1, d - 0.1, shade(col, 0.85));
      if (type.style === 'hvac' || type.style === 'generator') {
        for (let i = 0; i < 2; i++) {
          const cc = P(-hw * 0.5 + i * hw, hh, 0);
          g.fillStyle(0x2b2f36, 1);
          g.fillEllipse(cc.x, cc.y, hw * 0.7 * S, 0.25 * S);
        }
      }
      if (type.style === 'transformer') for (let i = -2; i <= 2; i++) box(i * hw * 0.35 - 0.12, i * hw * 0.35 + 0.12, hh, hh + 0.6, -0.12, 0.12, 0x8d6e3f);
      if (type.style === 'module') for (let ly = -hh + 1.2; ly < hh; ly += 1.6) box(-hw, hw, ly, ly + 0.15, -d, d, 0xf2b705);
      break;
    }
    case 'counterweight':
      box(-hw, hw, -hh, hh, -d, d, col);
      g.lineStyle(1, 0xf2b705, 0.8);
      {
        const a = P(-hw + 0.2, 0, d);
        const bb = P(hw - 0.2, 0, d);
        g.lineBetween(a.x, a.y, bb.x, bb.y);
      }
      break;
    case 'bucket':
      face([[-hw, hh, d], [hw, hh, d], [hw * 0.3, -hh, d], [-hw * 0.3, -hh, d]], col);
      face([[-hw, hh, d], [hw, hh, d], [hw, hh, -d], [-hw, hh, -d]], 0x6f6a62);
      break;
    default:
      box(-hw, hw, -hh, hh, -d, d, col);
  }
  if (highlight) {
    const pts = [P(-hw, -hh, d), P(hw, -hh, d), P(hw, hh, d), P(-hw, hh, d)];
    g.lineStyle(2, 0xf2b705, 0.9);
    g.strokePoints(pts, true);
  }
}

export function drawLoadShadow(g: G, b: RigidBody, groundY: number, height: number): void {
  shadow(g, b.pos.x, groundY, b.halfW, height, b.pos.z);
}

/** Haakblok met schijf en veiligheidsklep. */
export function drawHook(g: G, x: number, y: number, z: number, w: number, h: number, angle: number): void {
  const c = proj(x, y - h / 2, z);
  g.save?.();
  const hw = (w * S) / 2;
  const hh = (h * S) / 2;
  const cs = Math.cos(-angle);
  const sn = Math.sin(-angle);
  const R = (px: number, py: number) => ({ x: c.x + px * cs - py * sn, y: c.y + px * sn + py * cs });
  poly(g, [R(-hw, -hh), R(hw, -hh), R(hw * 0.8, hh * 0.4), R(-hw * 0.8, hh * 0.4)], 0xf2b705);
  poly(g, [R(-hw * 0.8, -hh), R(hw * 0.8, -hh), R(hw * 0.6, -hh * 0.4), R(-hw * 0.6, -hh * 0.4)], 0x2b2f36);
  g.fillStyle(0x9aa3ab, 1);
  const sc = R(0, -hh * 0.7);
  g.fillCircle(sc.x, sc.y, hw * 0.35);
  g.lineStyle(Math.max(2, hw * 0.25), 0x3b3f45, 1);
  const k0 = R(0, hh * 0.4);
  const k1 = R(0, hh * 0.85);
  g.lineBetween(k0.x, k0.y, k1.x, k1.y);
  g.beginPath();
  g.arc(k1.x - hw * 0.25, k1.y, hw * 0.25, 0, Math.PI, false);
  g.strokePath();
  g.restore?.();
}

export function drawRope(g: G, tip: { x: number; y: number; z: number }, end: { x: number; y: number; z: number }, falls: number, slack: boolean): void {
  const a = proj(tip.x, tip.y, tip.z);
  const b = proj(end.x, end.y, end.z);
  g.lineStyle(Math.max(1, S * 0.05), 0x1d1f22, 0.95);
  if (slack) {
    // licht doorhangend
    const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.03;
    const my = (a.y + b.y) / 2;
    g.beginPath();
    g.moveTo(a.x, a.y);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x;
      const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y;
      g.lineTo(x, y);
    }
    g.strokePath();
    return;
  }
  const n = Math.max(1, falls);
  const sp = S * 0.09;
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * sp;
    g.lineBetween(a.x + o, a.y, b.x + o, b.y);
  }
}

export function drawZone(g: G, x: number, y: number, halfW: number, tol: number, active: boolean, done: boolean, t: number, ghost?: { w: number; h: number }): void {
  const color = done ? 0x2ecc71 : active ? 0xf2b705 : 0x9aa3ab;
  const pulse = active ? 0.55 + 0.25 * Math.sin(t * 4) : 0.35;
  const zf = 1.6;
  polyW(g, [[x - halfW - tol, y + 0.02, zf], [x + halfW + tol, y + 0.02, zf], [x + halfW + tol, y + 0.02, -zf], [x - halfW - tol, y + 0.02, -zf]], color, 0.22 * pulse + 0.1);
  g.lineStyle(2, color, pulse + 0.2);
  const c = [proj(x - halfW - tol, y + 0.02, zf), proj(x + halfW + tol, y + 0.02, zf), proj(x + halfW + tol, y + 0.02, -zf), proj(x - halfW - tol, y + 0.02, -zf)];
  g.strokePoints(c, true);
  // middenlijn
  const m0 = proj(x, y + 0.02, zf);
  const m1 = proj(x, y + 0.02, -zf);
  g.lineBetween(m0.x, m0.y, m1.x, m1.y);
  if (ghost && !done) {
    const p0 = proj(x - ghost.w / 2, y, 0.6);
    const p1 = proj(x + ghost.w / 2, y + ghost.h, 0.6);
    g.lineStyle(1, color, 0.5);
    g.strokeRect(p0.x, p1.y, p1.x - p0.x, p0.y - p1.y);
  }
  void KX;
  void KY;
}
