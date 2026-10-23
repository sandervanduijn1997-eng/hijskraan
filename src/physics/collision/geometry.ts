import type { Vec2 } from '../../utils/math';

/** Convexe vierhoek in het xy-vlak, hoekpunten tegen de klok in. */
export type Quad = [Vec2, Vec2, Vec2, Vec2];

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const rectQuad = (r: Rect): Quad => [
  { x: r.minX, y: r.minY },
  { x: r.maxX, y: r.minY },
  { x: r.maxX, y: r.maxY },
  { x: r.minX, y: r.maxY },
];

export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

export const rangesOverlap = (a0: number, a1: number, b0: number, b1: number): boolean => a0 < b1 && a1 > b0;

export function quadBounds(q: Quad): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of q) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Afstand van punt p tot de binnenkant van rand i (positief = binnen). */
function edgeInsideDistance(q: Quad, i: number, px: number, py: number): number {
  const a = q[i];
  const b = q[(i + 1) & 3];
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const l = Math.sqrt(ex * ex + ey * ey) || 1;
  // CCW: binnenkant ligt links van de rand → normaal naar buiten = (ey, -ex)/l
  return ((px - a.x) * -ey + (py - a.y) * ex) / l;
}

export interface Penetration {
  depth: number;
  /** Naar buiten wijzende normaal van de gekozen rand van het doel-quad. */
  nx: number;
  ny: number;
}

/**
 * Als punt p binnen quad q ligt, geeft dit de penetratie terug langs de rand waardoor het punt
 * (op basis van zijn vorige positie) is binnengekomen. Dit voorkomt doorschieten door dunne objecten.
 */
export function pointPenetration(q: Quad, p: Vec2, prev: Vec2 | null, qPrev?: Quad): Penetration | null {
  let minD = Infinity;
  let minI = -1;
  for (let i = 0; i < 4; i++) {
    const d = edgeInsideDistance(q, i, p.x, p.y);
    if (d <= 0) return null;
    if (d < minD) {
      minD = d;
      minI = i;
    }
  }
  let chosen = minI;
  if (prev) {
    const ref = qPrev ?? q;
    let bestEntry = -1;
    let bestEntryD = Infinity;
    for (let i = 0; i < 4; i++) {
      const dPrev = edgeInsideDistance(ref, i, prev.x, prev.y);
      if (dPrev <= 0.0005) {
        const d = edgeInsideDistance(q, i, p.x, p.y);
        if (d < bestEntryD) {
          bestEntryD = d;
          bestEntry = i;
        }
      }
    }
    if (bestEntry >= 0) chosen = bestEntry;
  }
  const a = q[chosen];
  const b = q[(chosen + 1) & 3];
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const l = Math.sqrt(ex * ex + ey * ey) || 1;
  return { depth: edgeInsideDistance(q, chosen, p.x, p.y), nx: ey / l, ny: -ex / l };
}

/** Snijdt lijnstuk (ax,ay)-(bx,by) een rechthoek? (Liang–Barsky) */
export function segmentIntersectsRect(ax: number, ay: number, bx: number, by: number, r: Rect, pad = 0): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - (r.minX - pad), r.maxX + pad - ax, ay - (r.minY - pad), r.maxY + pad - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

/** Ligt punt binnen rechthoek? */
export const pointInRect = (x: number, y: number, r: Rect): boolean =>
  x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
