/** Kleine, allocatie-arme vector-hulpfuncties. Alle eenheden in SI (meter, seconde, radialen). */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const approach = (current: number, target: number, maxDelta: number): number =>
  current < target ? Math.min(current + maxDelta, target) : Math.max(current - maxDelta, target);

export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const len2 = (x: number, y: number): number => Math.sqrt(x * x + y * y);
export const len3 = (v: Vec3): number => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
export const dist3 = (a: Vec3, b: Vec3): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/** 2D-kruisproduct (z-component). */
export const cross2 = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

/** Roteer (x, y) over hoek a. */
export const rot = (x: number, y: number, a: number): Vec2 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: x * c - y * s, y: x * s + y * c };
};

/** Normaliseer hoek naar (-PI, PI]. */
export const wrapAngle = (a: number): number => {
  let r = a % (Math.PI * 2);
  if (r <= -Math.PI) r += Math.PI * 2;
  if (r > Math.PI) r -= Math.PI * 2;
  return r;
};

/** Lineaire interpolatie in een gesorteerde tabel. Waarden buiten bereik worden geclamped. */
export function interp1(xs: readonly number[], ys: readonly number[], x: number): number {
  if (xs.length === 0) return 0;
  if (x <= xs[0]) return ys[0];
  const n = xs.length - 1;
  if (x >= xs[n]) return ys[n];
  for (let i = 0; i < n; i++) {
    if (x <= xs[i + 1]) {
      const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
      return ys[i] + (ys[i + 1] - ys[i]) * t;
    }
  }
  return ys[n];
}

/** Kritisch gedempte veer richting doel (voor camera's en smoothing), frame-onafhankelijk. */
export function smoothDamp(current: number, target: number, velocity: { v: number }, smoothTime: number, dt: number): number {
  const omega = 2 / Math.max(0.0001, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity.v + omega * change) * dt;
  velocity.v = (velocity.v - omega * temp) * exp;
  return target + (change + temp) * exp;
}

/** Deterministische pseudo-random generator (mulberry32). */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash van een string naar een 32-bit seed. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
