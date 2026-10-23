import type Phaser from 'phaser';
import { PIXELS_PER_METER } from '../../physics/constants';

/**
 * Projectie wereld (m) → scherm (px): cabinet-achtige schuine projectie.
 * Diepte (z negatief = verder weg) schuift naar rechtsboven, zodat dozen een voor-, boven- en zijvlak tonen.
 */
export const S = PIXELS_PER_METER;
export const KX = 0.32;
export const KY = 0.22;

export interface P2 {
  x: number;
  y: number;
}

export const proj = (x: number, y: number, z = 0): P2 => ({ x: (x - z * KX) * S, y: (-y + z * KY) * S });

export function shade(color: number, f: number): number {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const m = (c: number) => Math.max(0, Math.min(255, Math.round(f >= 1 ? c + (255 - c) * (f - 1) : c * f)));
  return (m(r) << 16) | (m(g) << 8) | m(b);
}

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

type G = Phaser.GameObjects.Graphics;

export function poly(g: G, pts: P2[], color: number, alpha = 1): void {
  g.fillStyle(color, alpha);
  g.fillPoints(pts as Phaser.Types.Math.Vector2Like[], true);
}

export function polyW(g: G, pts: [number, number, number][], color: number, alpha = 1): void {
  poly(g, pts.map(([x, y, z]) => proj(x, y, z)), color, alpha);
}

export function outline(g: G, pts: P2[], color: number, width = 1, alpha = 1): void {
  g.lineStyle(width, color, alpha);
  g.strokePoints(pts as Phaser.Types.Math.Vector2Like[], true);
}

export function lineW(g: G, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width: number, color: number, alpha = 1): void {
  const a = proj(x0, y0, z0);
  const b = proj(x1, y1, z1);
  g.lineStyle(width, color, alpha);
  g.lineBetween(a.x, a.y, b.x, b.y);
}

/**
 * Low-poly doos met voor-, boven- en rechterzijvlak. Lichte facetvariatie geeft een "gesneden" uitstraling.
 */
export function box3(g: G, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number, opts: { alpha?: number; facets?: boolean; edge?: number } = {}): void {
  const a = opts.alpha ?? 1;
  // bovenvlak
  polyW(g, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], shade(color, 1.18), a);
  // zijvlak (rechts)
  polyW(g, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], shade(color, 0.72), a);
  // voorvlak
  const f0 = proj(x0, y0, z1);
  const f1 = proj(x1, y1, z1);
  g.fillStyle(color, a);
  g.fillRect(Math.min(f0.x, f1.x), Math.min(f0.y, f1.y), Math.abs(f1.x - f0.x), Math.abs(f1.y - f0.y));
  if (opts.facets !== false && x1 - x0 > 1.2 && y1 - y0 > 1.2) {
    // diagonaal facet voor het low-poly effect
    polyW(g, [[x0, y0, z1], [x1, y1, z1], [x0, y1, z1]], shade(color, 1.06), a * 0.6);
  }
  if (opts.edge !== undefined) {
    g.lineStyle(1, opts.edge, 0.5 * a);
    g.strokeRect(Math.min(f0.x, f1.x), Math.min(f0.y, f1.y), Math.abs(f1.x - f0.x), Math.abs(f1.y - f0.y));
  }
}

/** Dikke balk (giek) tussen twee 3D-punten als prisma met boven- en voorvlak. */
export function beam3(g: G, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width: number, depth: number, color: number, alpha = 1): void {
  const a0 = proj(x0, y0, z0);
  const a1 = proj(x1, y1, z1);
  const dx = a1.x - a0.x;
  const dy = a1.y - a0.y;
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * (width * S) / 2;
  const ny = (dx / l) * (width * S) / 2;
  const ox = depth * KX * S;
  const oy = -depth * KY * S;
  // achtervlak (dieptezijde)
  poly(g, [
    { x: a0.x - nx + ox, y: a0.y - ny + oy },
    { x: a1.x - nx + ox, y: a1.y - ny + oy },
    { x: a1.x + nx + ox, y: a1.y + ny + oy },
    { x: a0.x + nx + ox, y: a0.y + ny + oy },
  ], shade(color, 0.7), alpha);
  // bovenzijde
  const up = ny < 0 ? 1 : -1;
  poly(g, [
    { x: a0.x + up * nx, y: a0.y + up * ny },
    { x: a1.x + up * nx, y: a1.y + up * ny },
    { x: a1.x + up * nx + ox, y: a1.y + up * ny + oy },
    { x: a0.x + up * nx + ox, y: a0.y + up * ny + oy },
  ], shade(color, 1.15), alpha);
  // voorvlak
  poly(g, [
    { x: a0.x - nx, y: a0.y - ny },
    { x: a1.x - nx, y: a1.y - ny },
    { x: a1.x + nx, y: a1.y + ny },
    { x: a0.x + nx, y: a0.y + ny },
  ], color, alpha);
  g.lineStyle(1, shade(color, 0.5), 0.6 * alpha);
  g.lineBetween(a0.x - up * nx, a0.y - up * ny, a1.x - up * nx, a1.y - up * ny);
}

/** Vakwerk (lattice) tussen twee punten. */
export function truss3(g: G, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width: number, color: number, alpha = 1): void {
  const a0 = proj(x0, y0, z0);
  const a1 = proj(x1, y1, z1);
  const dx = a1.x - a0.x;
  const dy = a1.y - a0.y;
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * (width * S) / 2;
  const ny = (dx / l) * (width * S) / 2;
  const lw = Math.max(1, S * 0.07);
  // achterste koorden
  g.lineStyle(lw, shade(color, 0.6), alpha);
  const ox = width * 0.6 * KX * S;
  const oy = -width * 0.6 * KY * S;
  g.lineBetween(a0.x + nx + ox, a0.y + ny + oy, a1.x + nx + ox, a1.y + ny + oy);
  g.lineBetween(a0.x - nx + ox, a0.y - ny + oy, a1.x - nx + ox, a1.y - ny + oy);
  // vakwerkdiagonalen
  const n = Math.max(2, Math.round(l / (width * S)));
  g.lineStyle(Math.max(1, lw * 0.6), shade(color, 0.85), alpha);
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const s = i % 2 === 0 ? 1 : -1;
    g.lineBetween(a0.x + dx * t0 + s * nx, a0.y + dy * t0 + s * ny, a0.x + dx * t1 - s * nx, a0.y + dy * t1 - s * ny);
  }
  // voorste koorden
  g.lineStyle(lw * 1.3, color, alpha);
  g.lineBetween(a0.x + nx, a0.y + ny, a1.x + nx, a1.y + ny);
  g.lineBetween(a0.x - nx, a0.y - ny, a1.x - nx, a1.y - ny);
}

/** Low-poly wiel (achthoek met naaf en spaken die meedraaien). */
export function wheel(g: G, x: number, y: number, z: number, r: number, rot: number, tire = 0x1d1f22, rim = 0x9aa3ab): void {
  const c = proj(x, y, z);
  const R = r * S;
  const n = 10;
  const pts: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push({ x: c.x + Math.cos(a) * R, y: c.y + Math.sin(a) * R });
  }
  poly(g, pts, tire);
  g.fillStyle(rim, 1);
  g.fillCircle(c.x, c.y, R * 0.5);
  g.fillStyle(shade(rim, 0.6), 1);
  g.fillCircle(c.x, c.y, R * 0.18);
  g.lineStyle(Math.max(1, R * 0.08), shade(rim, 0.55), 1);
  for (let i = 0; i < 5; i++) {
    const a = rot * 1 + (i / 5) * Math.PI * 2;
    g.lineBetween(c.x + Math.cos(a) * R * 0.2, c.y + Math.sin(a) * R * 0.2, c.x + Math.cos(a) * R * 0.48, c.y + Math.sin(a) * R * 0.48);
  }
  // loopvlakfacetten
  g.lineStyle(Math.max(1, R * 0.06), 0x34383d, 1);
  for (let i = 0; i < n; i += 2) {
    const a = rot + (i / n) * Math.PI * 2;
    g.lineBetween(c.x + Math.cos(a) * R * 0.78, c.y + Math.sin(a) * R * 0.78, c.x + Math.cos(a) * R, c.y + Math.sin(a) * R);
  }
}

/** Zachte schaduw op de grond. */
export function shadow(g: G, x: number, groundY: number, halfW: number, height: number, z = 0): void {
  const c = proj(x, groundY, z);
  const spread = 1 + height * 0.04;
  const alpha = Math.max(0.05, 0.35 - height * 0.006);
  g.fillStyle(0x000000, alpha * 0.6);
  g.fillEllipse(c.x + height * 0.05 * S, c.y, halfW * 2 * S * spread * 1.2, Math.max(4, 0.6 * S * spread));
  g.fillStyle(0x000000, alpha * 0.4);
  g.fillEllipse(c.x + height * 0.05 * S, c.y, halfW * 2 * S * spread * 0.8, Math.max(3, 0.35 * S * spread));
}
