import type { Quad } from '../collision/geometry';
import type { Vec2, Vec3 } from '../../utils/math';
import { cross2 } from '../../utils/math';

/**
 * Star lichaam voor XPBD: translatie in 3D (x, y, z), rotatie alleen in het xy-vlak (zijaanzicht).
 * `pos` is het zwaartepunt. De doos (botsingsvorm) ligt in het lichaamsframe rond `boxOffset`.
 */
export interface RigidBody {
  mass: number;
  invMass: number;
  inertia: number;
  invInertia: number;
  pos: Vec3;
  prevPos: Vec3;
  vel: Vec3;
  angle: number;
  prevAngle: number;
  angVel: number;
  halfW: number;
  halfH: number;
  /** Diepte (z) van de doos in m. */
  depth: number;
  /** Middelpunt van de doos t.o.v. het zwaartepunt (lichaamsframe). */
  boxOffset: Vec2;
  /** Ophangpunt van de kabel (haak/hijsoog) in het lichaamsframe. */
  apex: Vec2;
  /** Cd·A in m² voor wind langs x en z. */
  dragAreaX: number;
  dragAreaZ: number;
  sleeping: boolean;
  sleepTimer: number;
  /** Is het lichaam statisch vastgezet (bijv. op een vrachtwagen geborgd)? */
  frozen: boolean;
}

export interface BodyInit {
  mass: number;
  width: number;
  height: number;
  depth: number;
  x: number;
  y: number;
  z?: number;
  angle?: number;
  comOffsetX?: number;
  apexHeight: number;
  dragCoeff?: number;
}

/** Maak een doosvormig lichaam. (x, y) is het midden van de onderkant van de doos. */
export function createBoxBody(init: BodyInit): RigidBody {
  const w = init.width;
  const h = init.height;
  const m = init.mass;
  const comX = init.comOffsetX ?? 0;
  const I = (m * (w * w + h * h)) / 12 + m * comX * comX;
  const cd = init.dragCoeff ?? 1.1;
  const pos = { x: init.x + comX, y: init.y + h / 2, z: init.z ?? 0 };
  return {
    mass: m,
    invMass: 1 / m,
    inertia: I,
    invInertia: 1 / I,
    pos,
    prevPos: { ...pos },
    vel: { x: 0, y: 0, z: 0 },
    angle: init.angle ?? 0,
    prevAngle: init.angle ?? 0,
    angVel: 0,
    halfW: w / 2,
    halfH: h / 2,
    depth: init.depth,
    boxOffset: { x: -comX, y: 0 },
    apex: { x: -comX, y: h / 2 + init.apexHeight },
    dragAreaX: cd * w * h,
    dragAreaZ: cd * init.depth * h,
    sleeping: false,
    sleepTimer: 0,
    frozen: false,
  };
}

/** Lichaamsframe → wereld (xy). */
export function localToWorld(b: RigidBody, lx: number, ly: number, usePrev = false): Vec2 {
  const a = usePrev ? b.prevAngle : b.angle;
  const p = usePrev ? b.prevPos : b.pos;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x + lx * c - ly * s, y: p.y + lx * s + ly * c };
}

/** Wereld (xy) → lichaamsframe. */
export function worldToLocal(b: RigidBody, wx: number, wy: number, usePrev = false): Vec2 {
  const a = usePrev ? b.prevAngle : b.angle;
  const p = usePrev ? b.prevPos : b.pos;
  const dx = wx - p.x;
  const dy = wy - p.y;
  const c = Math.cos(-a);
  const s = Math.sin(-a);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

/** Hoekpunten van de doos (CCW) in wereldcoördinaten. */
export function bodyQuad(b: RigidBody, usePrev = false): Quad {
  const ox = b.boxOffset.x;
  const oy = b.boxOffset.y;
  return [
    localToWorld(b, ox - b.halfW, oy - b.halfH, usePrev),
    localToWorld(b, ox + b.halfW, oy - b.halfH, usePrev),
    localToWorld(b, ox + b.halfW, oy + b.halfH, usePrev),
    localToWorld(b, ox - b.halfW, oy + b.halfH, usePrev),
  ];
}

export function bodyCornersLocal(b: RigidBody): Vec2[] {
  const ox = b.boxOffset.x;
  const oy = b.boxOffset.y;
  return [
    { x: ox - b.halfW, y: oy - b.halfH },
    { x: ox + b.halfW, y: oy - b.halfH },
    { x: ox + b.halfW, y: oy + b.halfH },
    { x: ox - b.halfW, y: oy + b.halfH },
  ];
}

/** Ophangpunt van de kabel in wereldcoördinaten (3D). */
export function apexWorld(b: RigidBody, usePrev = false): Vec3 {
  const p = localToWorld(b, b.apex.x, b.apex.y, usePrev);
  return { x: p.x, y: p.y, z: usePrev ? b.prevPos.z : b.pos.z };
}

/** Snelheid van een wereldpunt (xy) dat aan het lichaam vastzit. */
export function pointVelocity(b: RigidBody, wx: number, wy: number): Vec2 {
  const rx = wx - b.pos.x;
  const ry = wy - b.pos.y;
  return { x: b.vel.x - b.angVel * ry, y: b.vel.y + b.angVel * rx };
}

/** Gegeneraliseerde inverse massa voor een correctie in richting n op punt r (xy-deel). */
export function generalizedInvMass(b: RigidBody | null, rx: number, ry: number, nx: number, ny: number): number {
  if (!b || b.frozen) return 0;
  const rn = cross2(rx, ry, nx, ny);
  return b.invMass + b.invInertia * rn * rn;
}

/**
 * Pas een positionele correctie toe op het contactpunt: lichaam A beweegt in richting n,
 * lichaam B (optioneel) in tegengestelde richting. Geeft de Lagrange-multiplier (impuls·dt) terug.
 */
export function applyPositionalCorrection(
  a: RigidBody,
  pax: number,
  pay: number,
  b: RigidBody | null,
  pbx: number,
  pby: number,
  nx: number,
  ny: number,
  nz: number,
  magnitude: number,
  compliance = 0,
  dt = 1,
): number {
  if (magnitude <= 0) return 0;
  const rax = pax - a.pos.x;
  const ray = pay - a.pos.y;
  const rbx = b ? pbx - b.pos.x : 0;
  const rby = b ? pby - b.pos.y : 0;
  const wA = a.frozen ? 0 : a.invMass * (nx * nx + ny * ny + nz * nz) + a.invInertia * cross2(rax, ray, nx, ny) ** 2;
  const wB = !b || b.frozen ? 0 : b.invMass * (nx * nx + ny * ny + nz * nz) + b.invInertia * cross2(rbx, rby, nx, ny) ** 2;
  const w = wA + wB + compliance / (dt * dt);
  if (w <= 0) return 0;
  const dl = magnitude / w;
  if (!a.frozen) {
    a.pos.x += nx * dl * a.invMass;
    a.pos.y += ny * dl * a.invMass;
    a.pos.z += nz * dl * a.invMass;
    a.angle += a.invInertia * cross2(rax, ray, nx * dl, ny * dl);
  }
  if (b && !b.frozen) {
    b.pos.x -= nx * dl * b.invMass;
    b.pos.y -= ny * dl * b.invMass;
    b.pos.z -= nz * dl * b.invMass;
    b.angle -= b.invInertia * cross2(rbx, rby, nx * dl, ny * dl);
  }
  return dl;
}

export function wakeBody(b: RigidBody): void {
  b.sleeping = false;
  b.sleepTimer = 0;
}

/** Herbereken massa-eigenschappen (bijv. bij aanslaan van de haak aan een last). */
export function setBodyMass(b: RigidBody, mass: number, extraInertia = 0): void {
  const w = b.halfW * 2;
  const h = b.halfH * 2;
  const comX = -b.boxOffset.x;
  b.mass = mass;
  b.invMass = 1 / mass;
  b.inertia = (mass * (w * w + h * h)) / 12 + mass * comX * comX + extraInertia;
  b.invInertia = 1 / b.inertia;
}
