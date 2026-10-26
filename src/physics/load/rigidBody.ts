import type { Vec2, Vec3 } from '../../utils/math';

/**
 * Star lichaam voor XPBD in volledig 3D: translatie én rotatie om alle assen (quaternion) met een
 * traagheidstensor van een doos. `pos` is het zwaartepunt. De doos (botsingsvorm) ligt in het
 * lichaamsframe rond `boxOffset` (x, y; z = 0). `angle` is een afgeleide (rol om de z-as) voor
 * HUD en plaatsingscontrole; de echte toestand zit in `q` en `omega`.
 */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface RigidBody {
  mass: number;
  invMass: number;
  /** Hoofdtraagheidsmomenten in het lichaamsframe (kg·m²) en hun inverse. */
  inertiaBody: Vec3;
  invInertiaBody: Vec3;
  pos: Vec3;
  prevPos: Vec3;
  vel: Vec3;
  q: Quat;
  prevQ: Quat;
  /** Hoeksnelheid in wereldcoördinaten (rad/s). */
  omega: Vec3;
  /** Rol om de z-as (rad), afgeleid uit `q` (compatibel met de vroegere 2D-hoek). */
  angle: number;
  /** Grootte van de hoeksnelheid (rad/s), afgeleid uit `omega`. */
  angVel: number;
  halfW: number;
  halfH: number;
  /** Diepte (z) van de doos in m. */
  depth: number;
  /** Middelpunt van de doos t.o.v. het zwaartepunt (lichaamsframe, z = 0). */
  boxOffset: Vec2;
  /** Ophangpunt van de kabel (haak/hijsoog) in het lichaamsframe (z = 0). */
  apex: Vec2;
  /** Cd·A in m² voor wind langs x en z. */
  dragAreaX: number;
  dragAreaZ: number;
  sleeping: boolean;
  sleepTimer: number;
  /** Is het lichaam statisch vastgezet (bijv. op een vrachtwagen geborgd)? */
  frozen: boolean;
  /** Bemonsteringspunten op het oppervlak (lichaamsframe) voor contacten: hoeken + randpunten. */
  samples: Vec3[];
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

// ------------------------------------------------------------------ quaternion-hulpjes

export const qIdentity = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });
export const qFromAxisAngle = (ax: number, ay: number, az: number, a: number): Quat => {
  const s = Math.sin(a / 2);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(a / 2) };
};

export function qMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function qNormalize(q: Quat): void {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  q.x /= l;
  q.y /= l;
  q.z /= l;
  q.w /= l;
}

/** Draai vector v met quaternion q (of de inverse). */
export function qRotate(q: Quat, vx: number, vy: number, vz: number, inverse = false): Vec3 {
  const qx = inverse ? -q.x : q.x;
  const qy = inverse ? -q.y : q.y;
  const qz = inverse ? -q.z : q.z;
  const qw = q.w;
  // t = 2 · (q.xyz × v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return { x: vx + qw * tx + (qy * tz - qz * ty), y: vy + qw * ty + (qz * tx - qx * tz), z: vz + qw * tz + (qx * ty - qy * tx) };
}

/** Pas een kleine rotatievector (rad, wereld) toe op q. */
export function qAddRotation(q: Quat, rx: number, ry: number, rz: number): void {
  const dq = qMul({ x: rx, y: ry, z: rz, w: 0 }, q);
  q.x += 0.5 * dq.x;
  q.y += 0.5 * dq.y;
  q.z += 0.5 * dq.z;
  q.w += 0.5 * dq.w;
  qNormalize(q);
}

const cross = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): Vec3 => ({ x: ay * bz - az * by, y: az * bx - ax * bz, z: ax * by - ay * bx });

/** Inverse traagheid in wereldcoördinaten toegepast op vector v: R · I⁻¹ · Rᵀ · v. */
export function applyInvInertia(b: RigidBody, vx: number, vy: number, vz: number): Vec3 {
  const l = qRotate(b.q, vx, vy, vz, true);
  return qRotate(b.q, l.x * b.invInertiaBody.x, l.y * b.invInertiaBody.y, l.z * b.invInertiaBody.z);
}

/** Werk de afgeleide velden (rol-hoek, hoeksnelheidsgrootte) bij. */
export function updateDerived(b: RigidBody): void {
  const up = qRotate(b.q, 0, 1, 0);
  b.angle = Math.atan2(-up.x, up.y);
  b.angVel = Math.hypot(b.omega.x, b.omega.y, b.omega.z);
}

/** Kanteling van de last t.o.v. de verticaal (rad): rol om z en stamp om x. */
export function bodyTilt(b: RigidBody): { roll: number; pitch: number } {
  const up = qRotate(b.q, 0, 1, 0);
  return { roll: Math.atan2(-up.x, up.y), pitch: Math.atan2(up.z, up.y) };
}

/** Draaiing om de verticale as (gieren, rad) van de lokale x-as. */
export function bodyYaw(b: RigidBody): number {
  const ex = qRotate(b.q, 1, 0, 0);
  return Math.atan2(-ex.z, ex.x);
}

// ------------------------------------------------------------------ opbouw

function boxInertia(m: number, w: number, h: number, d: number, comX: number): Vec3 {
  return { x: (m * (h * h + d * d)) / 12, y: (m * (w * w + d * d)) / 12 + m * comX * comX, z: (m * (w * w + h * h)) / 12 + m * comX * comX };
}

/** Hoeken + randpunten (≤ 0,5 m uit elkaar) van de doos in het lichaamsframe. */
function boxSamples(cx: number, cy: number, hx: number, hy: number, hz: number): Vec3[] {
  const out: Vec3[] = [];
  const corners: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push({ x: cx + sx * hx, y: cy + sy * hy, z: sz * hz });
  out.push(...corners);
  const edges: [number, number][] = [];
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    const a = corners[i];
    const b = corners[j];
    const diff = (a.x !== b.x ? 1 : 0) + (a.y !== b.y ? 1 : 0) + (a.z !== b.z ? 1 : 0);
    if (diff === 1) edges.push([i, j]);
  }
  for (const [i, j] of edges) {
    const a = corners[i];
    const b = corners[j];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const n = Math.ceil(len / 0.5);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

/** Maak een doosvormig lichaam. (x, y) is het midden van de onderkant van de doos. */
export function createBoxBody(init: BodyInit): RigidBody {
  const w = init.width;
  const h = init.height;
  const m = init.mass;
  const comX = init.comOffsetX ?? 0;
  const I = boxInertia(m, w, h, init.depth, comX);
  const cd = init.dragCoeff ?? 1.1;
  const pos = { x: init.x + comX, y: init.y + h / 2, z: init.z ?? 0 };
  const q = qFromAxisAngle(0, 0, 1, init.angle ?? 0);
  const b: RigidBody = {
    mass: m,
    invMass: 1 / m,
    inertiaBody: I,
    invInertiaBody: { x: 1 / I.x, y: 1 / I.y, z: 1 / I.z },
    pos,
    prevPos: { ...pos },
    vel: { x: 0, y: 0, z: 0 },
    q,
    prevQ: { ...q },
    omega: { x: 0, y: 0, z: 0 },
    angle: init.angle ?? 0,
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
    samples: boxSamples(-comX, 0, w / 2, h / 2, init.depth / 2),
  };
  return b;
}

// ------------------------------------------------------------------ transformaties

/** Lichaamsframe → wereld (3D; lz = 0 tenzij opgegeven). */
export function localToWorld(b: RigidBody, lx: number, ly: number, usePrev = false, lz = 0): Vec3 {
  const q = usePrev ? b.prevQ : b.q;
  const p = usePrev ? b.prevPos : b.pos;
  const r = qRotate(q, lx, ly, lz);
  return { x: p.x + r.x, y: p.y + r.y, z: p.z + r.z };
}

/** Wereld → lichaamsframe (3D). */
export function worldToLocal(b: RigidBody, wx: number, wy: number, usePrev = false, wz?: number): Vec3 {
  const q = usePrev ? b.prevQ : b.q;
  const p = usePrev ? b.prevPos : b.pos;
  return qRotate(q, wx - p.x, wy - p.y, (wz ?? p.z) - p.z, true);
}

/** Wereld-AABB van de doos. */
export function bodyBounds(b: RigidBody): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  const c = qRotate(b.q, b.boxOffset.x, b.boxOffset.y, 0);
  const ex = qRotate(b.q, b.halfW, 0, 0);
  const ey = qRotate(b.q, 0, b.halfH, 0);
  const ez = qRotate(b.q, 0, 0, b.depth / 2);
  const rx = Math.abs(ex.x) + Math.abs(ey.x) + Math.abs(ez.x);
  const ry = Math.abs(ex.y) + Math.abs(ey.y) + Math.abs(ez.y);
  const rz = Math.abs(ex.z) + Math.abs(ey.z) + Math.abs(ez.z);
  const cx = b.pos.x + c.x;
  const cy = b.pos.y + c.y;
  const cz = b.pos.z + c.z;
  return { minX: cx - rx, maxX: cx + rx, minY: cy - ry, maxY: cy + ry, minZ: cz - rz, maxZ: cz + rz };
}

/** Ophangpunt van de kabel in wereldcoördinaten (3D). */
export function apexWorld(b: RigidBody, usePrev = false): Vec3 {
  return localToWorld(b, b.apex.x, b.apex.y, usePrev);
}

/** Snelheid van een wereldpunt dat aan het lichaam vastzit. */
export function pointVelocity(b: RigidBody, wx: number, wy: number, wz = b.pos.z): Vec3 {
  const r = { x: wx - b.pos.x, y: wy - b.pos.y, z: wz - b.pos.z };
  const w = cross(b.omega.x, b.omega.y, b.omega.z, r.x, r.y, r.z);
  return { x: b.vel.x + w.x, y: b.vel.y + w.y, z: b.vel.z + w.z };
}

// ------------------------------------------------------------------ XPBD-correctie

/**
 * Pas een positionele correctie toe op contactpunten pa (lichaam a) en pb (lichaam b, optioneel):
 * a beweegt in richting n, b in tegengestelde richting. Geeft de Lagrange-multiplier (impuls·dt) terug.
 */
export function applyPositionalCorrection(
  a: RigidBody,
  pa: Vec3,
  b: RigidBody | null,
  pb: Vec3 | null,
  n: Vec3,
  magnitude: number,
  compliance = 0,
  dt = 1,
): number {
  if (magnitude <= 0) return 0;
  const rax = pa.x - a.pos.x;
  const ray = pa.y - a.pos.y;
  const raz = pa.z - a.pos.z;
  let wA = 0;
  let ra: Vec3 = { x: 0, y: 0, z: 0 };
  if (!a.frozen) {
    ra = cross(rax, ray, raz, n.x, n.y, n.z);
    const ia = applyInvInertia(a, ra.x, ra.y, ra.z);
    wA = a.invMass + ra.x * ia.x + ra.y * ia.y + ra.z * ia.z;
  }
  let wB = 0;
  let rb: Vec3 = { x: 0, y: 0, z: 0 };
  if (b && pb && !b.frozen) {
    rb = cross(pb.x - b.pos.x, pb.y - b.pos.y, pb.z - b.pos.z, n.x, n.y, n.z);
    const ib = applyInvInertia(b, rb.x, rb.y, rb.z);
    wB = b.invMass + rb.x * ib.x + rb.y * ib.y + rb.z * ib.z;
  }
  const w = wA + wB + compliance / (dt * dt);
  if (w <= 0) return 0;
  const dl = magnitude / w;
  if (!a.frozen) {
    a.pos.x += n.x * dl * a.invMass;
    a.pos.y += n.y * dl * a.invMass;
    a.pos.z += n.z * dl * a.invMass;
    const d = applyInvInertia(a, ra.x * dl, ra.y * dl, ra.z * dl);
    qAddRotation(a.q, d.x, d.y, d.z);
  }
  if (b && pb && !b.frozen) {
    b.pos.x -= n.x * dl * b.invMass;
    b.pos.y -= n.y * dl * b.invMass;
    b.pos.z -= n.z * dl * b.invMass;
    const d = applyInvInertia(b, rb.x * dl, rb.y * dl, rb.z * dl);
    qAddRotation(b.q, -d.x, -d.y, -d.z);
  }
  return dl;
}

/** Hoekcorrectie (alleen rotatie) om de wereldas axis met hoek angle, gewogen naar de traagheid. */
export function applyAngularCorrection(b: RigidBody, axis: Vec3, angle: number, compliance = 0, dt = 1): void {
  if (b.frozen || angle === 0) return;
  const ia = applyInvInertia(b, axis.x, axis.y, axis.z);
  const w = axis.x * ia.x + axis.y * ia.y + axis.z * ia.z + compliance / (dt * dt);
  if (w <= 0) return;
  const dl = angle / w;
  qAddRotation(b.q, ia.x * dl, ia.y * dl, ia.z * dl);
}

export function wakeBody(b: RigidBody): void {
  b.sleeping = false;
  b.sleepTimer = 0;
}

/**
 * Herbereken massa-eigenschappen (bijv. bij aanslaan van de haak aan een last).
 * `point` voegt een puntmassa toe (het haakblok op het ophangpunt).
 */
export function setBodyMass(b: RigidBody, mass: number, point?: { mass: number; x: number; y: number }): void {
  const w = b.halfW * 2;
  const h = b.halfH * 2;
  const comX = -b.boxOffset.x;
  const base = point ? mass - point.mass : mass;
  const I = boxInertia(base, w, h, b.depth, comX);
  if (point) {
    I.x += point.mass * point.y * point.y;
    I.y += point.mass * point.x * point.x;
    I.z += point.mass * (point.x * point.x + point.y * point.y);
  }
  b.mass = mass;
  b.invMass = 1 / mass;
  b.inertiaBody = I;
  b.invInertiaBody = { x: 1 / I.x, y: 1 / I.y, z: 1 / I.z };
}
