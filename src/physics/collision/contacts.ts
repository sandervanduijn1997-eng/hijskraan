import type { Collider } from './colliders';
import { GROUND_ID } from './colliders';
import type { Quad, Rect } from './geometry';
import { rectQuad } from './geometry';
import type { RigidBody } from '../load/rigidBody';
import { applyInvInertia, applyPositionalCorrection, bodyBounds, localToWorld, pointVelocity, qRotate, worldToLocal } from '../load/rigidBody';
import type { Vec3 } from '../../utils/math';

/**
 * Contacten in volledig 3D: georiënteerde dozen (OBB) tegen de grond, tegen statische obstakels
 * (AABB) en tegen elkaar. Bemonsterde oppervlaktepunten (hoeken + randen) worden in de andere vorm
 * gezocht; de instapzijde volgt uit de vorige positie, zodat een last nooit door een dunne wand
 * "springt". Wrijving werkt in het volledige raakvlak (statisch/dynamisch, XPBD).
 */
export interface ContactBody {
  id: string;
  body: RigidBody;
  /** Ids van objecten die in deze stap geraakt worden. */
  touching: Set<string>;
  /** Ids van objecten waar het lichaam op steunt (normaal grotendeels omhoog). */
  supports: Set<string>;
  lastTouching: Set<string>;
  /**
   * Contacten van de afgelopen ~0,4 s (id → resterende tijd). Een inslag telt alleen bij een écht nieuw
   * contact; zo levert een rustende last die licht wiebelt op smalle steunpunten geen valse schade op.
   */
  recent: Map<string, number>;
  /** Extra contactpunten in het lichaamsframe (bijv. de haak), z = 0. */
  extraPoints: { x: number; y: number }[];
}

export interface ImpactEvent {
  bodyId: string;
  otherId: string;
  /** Normaalsnelheid bij inslag (m/s). */
  speed: number;
  x: number;
  y: number;
  /** Is de botsing grotendeels een neerzetting (normaal omhoog)? */
  landing: boolean;
}

export interface FrictionParams {
  staticMu: number;
  dynamicMu: number;
}

const SUPPORT_NY = 0.6;

/** Een opgelost contact van deze substap, voor de wrijving op snelheidsniveau. */
export interface SolvedContact {
  a: RigidBody;
  b: RigidBody | null;
  p: Vec3;
  n: Vec3;
  /** Lagrange-multiplier van de normaalcorrectie (N·s²). */
  lambda: number;
  /** Relatieve normaalsnelheid vóór de correctie (m/s, negatief = naar elkaar toe). */
  vnPre: number;
}

/** Restitutie (terugveren) van staal/beton bij een neerzetting: vrijwel nul. */
const RESTITUTION = 0.1;

function relNormalVelocity(a: RigidBody, b: RigidBody | null, p: Vec3, n: Vec3): number {
  const va = pointVelocity(a, p.x, p.y, p.z);
  if (b) {
    const vb = pointVelocity(b, p.x, p.y, p.z);
    va.x -= vb.x;
    va.y -= vb.y;
    va.z -= vb.z;
  }
  return va.x * n.x + va.y * n.y + va.z * n.z;
}

let solved: SolvedContact[] = [];
function correct(a: RigidBody, p: Vec3, b: RigidBody | null, n: Vec3, depth: number): void {
  const vnPre = relNormalVelocity(a, b, p, n);
  const lambda = applyPositionalCorrection(a, p, b, b ? p : null, n, Math.min(depth, MAX_CORRECTION));
  if (lambda > 0) solved.push({ a, b, p, n, lambda, vnPre });
}

/**
 * Wrijving op snelheidsniveau (Müller e.a., XPBD): per contact een tangentiële tegenimpuls,
 * begrensd door μ maal de normaalkracht. Rustende lasten blijven zo echt liggen.
 */
export function solveContactVelocities(contacts: readonly SolvedContact[], fr: FrictionParams, h: number): void {
  // restitutie: de positiecorrectie mag geen onechte wegvliegsnelheid geven
  for (const c of contacts) {
    const vn = relNormalVelocity(c.a, c.b, c.p, c.n);
    if (vn <= 0) continue;
    const target = Math.max(0, -RESTITUTION * c.vnPre);
    if (vn > target) applyVelocityImpulse(c.a, c.b, c.p, c.n, target - vn);
  }
  for (const c of contacts) {
    const va = pointVelocity(c.a, c.p.x, c.p.y, c.p.z);
    if (c.b) {
      const vb = pointVelocity(c.b, c.p.x, c.p.y, c.p.z);
      va.x -= vb.x;
      va.y -= vb.y;
      va.z -= vb.z;
    }
    const vn = va.x * c.n.x + va.y * c.n.y + va.z * c.n.z;
    const tx = va.x - vn * c.n.x;
    const ty = va.y - vn * c.n.y;
    const tz = va.z - vn * c.n.z;
    const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (vt < 1e-7) continue;
    const fn = c.lambda / (h * h);
    // bijna stilstaand: statische wrijving houdt alles vast; anders dynamisch begrensd
    const mu = vt < 0.05 ? fr.staticMu : fr.dynamicMu;
    const dv = Math.min(vt, mu * fn * h);
    const t = { x: tx / vt, y: ty / vt, z: tz / vt };
    applyVelocityImpulse(c.a, c.b, c.p, t, -dv);
  }
}

/** Snelheidsimpuls in richting t op punt p (a positief, b negatief) zodat de relatieve snelheid dv verandert. */
function applyVelocityImpulse(a: RigidBody, b: RigidBody | null, p: Vec3, t: Vec3, dv: number): void {
  const wOf = (body: RigidBody) => {
    if (body.frozen) return { w: 0, r: { x: 0, y: 0, z: 0 } };
    const r = { x: p.x - body.pos.x, y: p.y - body.pos.y, z: p.z - body.pos.z };
    const rt = { x: r.y * t.z - r.z * t.y, y: r.z * t.x - r.x * t.z, z: r.x * t.y - r.y * t.x };
    const ia = applyInvInertia(body, rt.x, rt.y, rt.z);
    return { w: body.invMass + rt.x * ia.x + rt.y * ia.y + rt.z * ia.z, r };
  };
  const A = wOf(a);
  const B = b ? wOf(b) : { w: 0, r: { x: 0, y: 0, z: 0 } };
  const w = A.w + B.w;
  if (w <= 0) return;
  const j = dv / w;
  const push = (body: RigidBody, r: Vec3, s: number) => {
    if (body.frozen) return;
    body.vel.x += t.x * j * s * body.invMass;
    body.vel.y += t.y * j * s * body.invMass;
    body.vel.z += t.z * j * s * body.invMass;
    const tq = { x: r.y * t.z - r.z * t.y, y: r.z * t.x - r.x * t.z, z: r.x * t.y - r.y * t.x };
    const dw = applyInvInertia(body, tq.x * j * s, tq.y * j * s, tq.z * j * s);
    body.omega.x += dw.x;
    body.omega.y += dw.y;
    body.omega.z += dw.z;
  };
  push(a, A.r, 1);
  if (b) push(b, B.r, -1);
}
const EPS = 1e-4;
/** Maximale extra diepte waarbij de instapzijde nog voorrang krijgt (m). */
const ENTRY_SLACK = 0.12;
/** Maximale correctie per contactpunt per substap (m): diepe indringing wordt over enkele substappen opgelost. */
const MAX_CORRECTION = 0.04;

function recordContact(cb: ContactBody, otherId: string, p: Vec3, n: Vec3, impacts: ImpactEvent[], other?: RigidBody): void {
  if (!cb.lastTouching.has(otherId) && !cb.touching.has(otherId) && !cb.recent.has(otherId)) {
    const v = pointVelocity(cb.body, p.x, p.y, p.z);
    if (other) {
      const vo = pointVelocity(other, p.x, p.y, p.z);
      v.x -= vo.x;
      v.y -= vo.y;
      v.z -= vo.z;
    }
    const vn = v.x * n.x + v.y * n.y + v.z * n.z;
    if (vn < -0.02) impacts.push({ bodyId: cb.id, otherId, speed: -vn, x: p.x, y: p.y, landing: n.y > SUPPORT_NY });
  }
  cb.touching.add(otherId);
  if (n.y > SUPPORT_NY) cb.supports.add(otherId);
}

/** Alle contactpunten van een lichaam in het lichaamsframe: oppervlaktemonsters + extra punten. */
function samplePoints(cb: ContactBody): Vec3[] {
  const pts = cb.body.samples;
  if (!cb.extraPoints.length) return pts;
  return [...pts, ...cb.extraPoints.map((e) => ({ x: e.x, y: e.y, z: 0 }))];
}

/** Contact van een lichaam met de grond (vlak y = 0). */
function solveGround(cb: ContactBody, _fr: FrictionParams, impacts: ImpactEvent[]): void {
  const b = cb.body;
  if (bodyBounds(b).minY > 0) return;
  for (const lp of samplePoints(cb)) {
    const w = localToWorld(b, lp.x, lp.y, false, lp.z);
    if (w.y >= 0) continue;
    const n = { x: 0, y: 1, z: 0 };
    recordContact(cb, GROUND_ID, w, n, impacts);
    const depth = -w.y;
    correct(b, w, null, n, depth);
  }
}

type Box = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
const boxesOverlap = (a: Box, b: Box) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;

/**
 * Uitstoot van een punt uit een AABB: normaal en diepte. De instapzijde volgt uit de vorige positie;
 * lag het punt toen al binnen, dan de zijde met de kleinste indringing.
 */
function aabbPenetration(c: Box, p: Vec3, prev: Vec3): { n: Vec3; depth: number } | null {
  if (p.x <= c.minX || p.x >= c.maxX || p.y <= c.minY || p.y >= c.maxY || p.z <= c.minZ || p.z >= c.maxZ) return null;
  const faces: { n: Vec3; depth: number; entered: boolean }[] = [
    { n: { x: -1, y: 0, z: 0 }, depth: p.x - c.minX, entered: prev.x <= c.minX },
    { n: { x: 1, y: 0, z: 0 }, depth: c.maxX - p.x, entered: prev.x >= c.maxX },
    { n: { x: 0, y: -1, z: 0 }, depth: p.y - c.minY, entered: prev.y <= c.minY },
    { n: { x: 0, y: 1, z: 0 }, depth: c.maxY - p.y, entered: prev.y >= c.maxY },
    { n: { x: 0, y: 0, z: -1 }, depth: p.z - c.minZ, entered: prev.z <= c.minZ },
    { n: { x: 0, y: 0, z: 1 }, depth: c.maxZ - p.z, entered: prev.z >= c.maxZ },
  ];
  // instapzijde alleen als die niet veel dieper ligt dan de ondiepste zijde (anders schiet de last weg)
  let minD = Infinity;
  for (const f of faces) minD = Math.min(minD, f.depth);
  let best: (typeof faces)[number] | null = null;
  for (const f of faces) if (f.entered && f.depth <= minD + ENTRY_SLACK && (!best || f.depth < best.depth)) best = f;
  if (!best) for (const f of faces) if (!best || f.depth < best.depth) best = f;
  return best ? { n: best.n, depth: best.depth } : null;
}

/**
 * Indringing van een wereldpunt in de doos van lichaam b. Normaal = naar buiten wijzende zijde van b
 * (in wereldcoördinaten), instapzijde uit de vorige positie van het punt t.o.v. de vorige pose van b.
 */
function obbPenetration(b: RigidBody, p: Vec3, prevP: Vec3): { n: Vec3; depth: number } | null {
  const l = worldToLocal(b, p.x, p.y, false, p.z);
  const lx = l.x - b.boxOffset.x;
  const ly = l.y - b.boxOffset.y;
  const lz = l.z;
  const hz = b.depth / 2;
  if (Math.abs(lx) >= b.halfW || Math.abs(ly) >= b.halfH || Math.abs(lz) >= hz) return null;
  const pl = worldToLocal(b, prevP.x, prevP.y, true, prevP.z);
  const plx = pl.x - b.boxOffset.x;
  const ply = pl.y - b.boxOffset.y;
  const plz = pl.z;
  const faces: { ax: Vec3; depth: number; entered: boolean }[] = [
    { ax: { x: Math.sign(lx) || 1, y: 0, z: 0 }, depth: b.halfW - Math.abs(lx), entered: Math.abs(plx) >= b.halfW },
    { ax: { x: 0, y: Math.sign(ly) || 1, z: 0 }, depth: b.halfH - Math.abs(ly), entered: Math.abs(ply) >= b.halfH },
    { ax: { x: 0, y: 0, z: Math.sign(lz) || 1 }, depth: hz - Math.abs(lz), entered: Math.abs(plz) >= hz },
  ];
  // instapzijde alleen als die niet veel dieper ligt dan de ondiepste zijde (anders schiet de last weg)
  let minD = Infinity;
  for (const f of faces) minD = Math.min(minD, f.depth);
  let best: (typeof faces)[number] | null = null;
  for (const f of faces) if (f.entered && f.depth <= minD + ENTRY_SLACK && (!best || f.depth < best.depth)) best = f;
  if (!best) for (const f of faces) if (!best || f.depth < best.depth) best = f;
  if (!best) return null;
  return { n: qRotate(b.q, best.ax.x, best.ax.y, best.ax.z), depth: best.depth };
}

/** Punt op een rand van een AABB met de twee zijden (buitennormalen) waartussen die rand ligt. */
interface EdgePoint {
  p: Vec3;
  faces: [Vec3, Vec3];
}

/** Punten op de randen van een AABB, beperkt tot het gebied rond een lichaam (stap ≤ 0,4 m, altijd ook binnenpunten). */
function aabbEdgePoints(c: Box, around: Box): EdgePoint[] {
  const out: EdgePoint[] = [];
  const along = (a0: number, a1: number, b0: number, b1: number, emit: (t: number) => void) => {
    const lo = Math.max(a0, b0);
    const hi = Math.min(a1, b1);
    if (lo > hi) return;
    const n = Math.max(2, Math.ceil((hi - lo) / 0.4));
    for (let i = 0; i <= n; i++) emit(lo + ((hi - lo) * i) / n);
  };
  const inR = (v: number, lo: number, hi: number) => v >= lo - 0.5 && v <= hi + 0.5;
  const fx = (x: number): Vec3 => ({ x: x === c.maxX ? 1 : -1, y: 0, z: 0 });
  const fy = (y: number): Vec3 => ({ x: 0, y: y === c.maxY ? 1 : -1, z: 0 });
  const fz = (z: number): Vec3 => ({ x: 0, y: 0, z: z === c.maxZ ? 1 : -1 });
  for (const y of [c.minY, c.maxY]) for (const z of [c.minZ, c.maxZ]) if (inR(y, around.minY, around.maxY) && inR(z, around.minZ, around.maxZ)) along(c.minX, c.maxX, around.minX, around.maxX, (x) => out.push({ p: { x, y, z }, faces: [fy(y), fz(z)] }));
  for (const x of [c.minX, c.maxX]) for (const z of [c.minZ, c.maxZ]) if (inR(x, around.minX, around.maxX) && inR(z, around.minZ, around.maxZ)) along(c.minY, c.maxY, around.minY, around.maxY, (y) => out.push({ p: { x, y, z }, faces: [fx(x), fz(z)] }));
  for (const x of [c.minX, c.maxX]) for (const y of [c.minY, c.maxY]) if (inR(x, around.minX, around.maxX) && inR(y, around.minY, around.maxY)) along(c.minZ, c.maxZ, around.minZ, around.maxZ, (z) => out.push({ p: { x, y, z }, faces: [fx(x), fy(y)] }));
  return out;
}

/** Afstand vanaf een punt binnen de doos van b tot waar een straal in richting d de doos verlaat. */
function exitDistance(b: RigidBody, p: Vec3, d: Vec3): number {
  const l = worldToLocal(b, p.x, p.y, false, p.z);
  const ld = qRotate(b.q, d.x, d.y, d.z, true);
  const lp = [l.x - b.boxOffset.x, l.y - b.boxOffset.y, l.z];
  const dd = [ld.x, ld.y, ld.z];
  const hh = [b.halfW, b.halfH, b.depth / 2];
  let t = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-9) continue;
    const ti = ((dd[i] > 0 ? hh[i] : -hh[i]) - lp[i]) / dd[i];
    if (ti < t) t = ti;
  }
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/** Lichaam tegen een statisch obstakel (AABB): punten van het lichaam in het obstakel en randen van het obstakel in het lichaam. */
function solveStatic(cb: ContactBody, c: Collider, _fr: FrictionParams, impacts: ImpactEvent[]): void {
  const b = cb.body;
  const bb = bodyBounds(b);
  if (!boxesOverlap(bb, c)) return;
  for (const lp of samplePoints(cb)) {
    const w = localToWorld(b, lp.x, lp.y, false, lp.z);
    if (w.x <= c.minX || w.x >= c.maxX || w.y <= c.minY || w.y >= c.maxY || w.z <= c.minZ || w.z >= c.maxZ) continue;
    const prev = localToWorld(b, lp.x, lp.y, true, lp.z);
    const pen = aabbPenetration(c, w, prev);
    if (!pen) continue;
    recordContact(cb, c.id, w, pen.n, impacts);
    correct(b, w, null, pen.n, pen.depth + EPS);
  }
  // randen van het obstakel die in het lichaam steken: duw het lichaam weg van de zijde van het obstakel
  // waar het werkelijk aan ligt (zoals bij een scheidende as), met de diepte tot het diepste punt van het lichaam
  const center = localToWorld(b, b.boxOffset.x, b.boxOffset.y);
  for (const ep of aabbEdgePoints(c, bodyBounds(b))) {
    const p = ep.p;
    if (!obbPenetration(b, p, p)) continue;
    const plane = (n: Vec3) => (n.x ? (n.x > 0 ? c.maxX : -c.minX) : n.y ? (n.y > 0 ? c.maxY : -c.minY) : n.z > 0 ? c.maxZ : -c.minZ);
    const outside = (n: Vec3) => center.x * n.x + center.y * n.y + center.z * n.z - plane(n);
    const n = outside(ep.faces[0]) >= outside(ep.faces[1]) ? ep.faces[0] : ep.faces[1];
    // lokale diepte: hoe ver het lichaam in richting −n onder dit punt doorloopt (straal binnen de doos)
    const depth = exitDistance(b, p, { x: -n.x, y: -n.y, z: -n.z });
    if (depth <= 0) continue;
    recordContact(cb, c.id, p, n, impacts);
    correct(b, p, null, n, depth + EPS);
  }
}

/** Twee dynamische lichamen tegen elkaar (punten van elk in de doos van de ander). */
function solvePair(a: ContactBody, b: ContactBody, _fr: FrictionParams, impacts: ImpactEvent[]): void {
  const A = a.body;
  const B = b.body;
  if (A.frozen && B.frozen) return;
  if (!boxesOverlap(bodyBounds(A), bodyBounds(B))) return;
  let touched = false;
  const run = (P: ContactBody, Q: ContactBody) => {
    for (const lp of samplePoints(P)) {
      const w = localToWorld(P.body, lp.x, lp.y, false, lp.z);
      const prev = localToWorld(P.body, lp.x, lp.y, true, lp.z);
      const pen = obbPenetration(Q.body, w, prev);
      if (!pen) continue;
      touched = true;
      recordContact(P, Q.id, w, pen.n, impacts, Q.body);
      recordContact(Q, P.id, w, { x: -pen.n.x, y: -pen.n.y, z: -pen.n.z }, impacts, P.body);
      correct(P.body, w, Q.body, pen.n, pen.depth + EPS);
    }
  };
  run(a, b);
  run(b, a);
  if (touched) {
    if (A.sleeping && !B.sleeping) A.sleeping = false;
    if (B.sleeping && !A.sleeping) B.sleeping = false;
  }
}

/** Quads van statische obstakels (alleen nog voor oudere xy-controles). */
export function colliderQuads(colliders: readonly Collider[]): Quad[] {
  return colliders.map((c) => rectQuad(c as Rect));
}

export function solveContacts(bodies: ContactBody[], colliders: readonly Collider[], _quads: readonly Quad[], fr: FrictionParams, impacts: ImpactEvent[]): SolvedContact[] {
  solved = [];
  for (const cb of bodies) {
    if (cb.body.sleeping || cb.body.frozen) continue;
    solveGround(cb, fr, impacts);
    for (let i = 0; i < colliders.length; i++) solveStatic(cb, colliders[i], fr, impacts);
  }
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      if ((a.body.sleeping || a.body.frozen) && (b.body.sleeping || b.body.frozen)) continue;
      solvePair(a, b, fr, impacts);
    }
  }
  return solved;
}
