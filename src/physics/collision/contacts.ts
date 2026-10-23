import type { Collider } from './colliders';
import { GROUND_ID } from './colliders';
import type { Quad, Rect } from './geometry';
import { pointPenetration, quadBounds, rangesOverlap, rectQuad, rectsOverlap } from './geometry';
import type { RigidBody } from '../load/rigidBody';
import { applyPositionalCorrection, bodyCornersLocal, bodyQuad, localToWorld, pointVelocity, worldToLocal } from '../load/rigidBody';

export interface ContactBody {
  id: string;
  body: RigidBody;
  /** Ids van objecten die in deze stap geraakt worden. */
  touching: Set<string>;
  /** Ids van objecten waar het lichaam op steunt (normaal grotendeels omhoog). */
  supports: Set<string>;
  lastTouching: Set<string>;
  /** Extra contactpunten in het lichaamsframe (bijv. de haak). */
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

function zOverlap(b: RigidBody, c: Collider): boolean {
  return rangesOverlap(b.pos.z - b.depth / 2, b.pos.z + b.depth / 2, c.minZ, c.maxZ);
}

function recordContact(
  cb: ContactBody,
  otherId: string,
  px: number,
  py: number,
  nx: number,
  ny: number,
  impacts: ImpactEvent[],
): void {
  if (!cb.lastTouching.has(otherId) && !cb.touching.has(otherId)) {
    const v = pointVelocity(cb.body, px, py);
    const vn = v.x * nx + v.y * ny;
    if (vn < -0.02) impacts.push({ bodyId: cb.id, otherId, speed: -vn, x: px, y: py, landing: ny > SUPPORT_NY });
  }
  cb.touching.add(otherId);
  if (ny > SUPPORT_NY) cb.supports.add(otherId);
}

/** Wrijving: corrigeer de tangentiële verplaatsing van het contactpunt (XPBD statisch/dynamisch). */
function applyFriction(
  a: RigidBody,
  b: RigidBody | null,
  localA: { x: number; y: number },
  localB: { x: number; y: number } | null,
  nx: number,
  ny: number,
  normalDepth: number,
  fr: FrictionParams,
): void {
  const pa = localToWorld(a, localA.x, localA.y);
  const paPrev = localToWorld(a, localA.x, localA.y, true);
  let dx = pa.x - paPrev.x;
  let dy = pa.y - paPrev.y;
  let pbx = 0;
  let pby = 0;
  if (b && localB) {
    const pb = localToWorld(b, localB.x, localB.y);
    const pbPrev = localToWorld(b, localB.x, localB.y, true);
    dx -= pb.x - pbPrev.x;
    dy -= pb.y - pbPrev.y;
    pbx = pb.x;
    pby = pb.y;
  }
  const dn = dx * nx + dy * ny;
  const tx = dx - dn * nx;
  const ty = dy - dn * ny;
  const tl = Math.sqrt(tx * tx + ty * ty);
  if (tl < 1e-9) return;
  const limitStatic = fr.staticMu * normalDepth;
  const corr = tl < limitStatic ? tl : Math.min(tl, fr.dynamicMu * normalDepth);
  applyPositionalCorrection(a, pa.x, pa.y, b, pbx, pby, -tx / tl, -ty / tl, 0, corr);
}

/** Contact van een lichaam met de grond (vlak y = 0). */
function solveGround(cb: ContactBody, fr: FrictionParams, impacts: ImpactEvent[]): void {
  const b = cb.body;
  const pts = bodyCornersLocal(b);
  for (const e of cb.extraPoints) pts.push(e);
  for (const lp of pts) {
    const w = localToWorld(b, lp.x, lp.y);
    if (w.y < 0) {
      recordContact(cb, GROUND_ID, w.x, w.y, 0, 1, impacts);
      const depth = -w.y;
      applyPositionalCorrection(b, w.x, w.y, null, 0, 0, 0, 1, 0, depth);
      applyFriction(b, null, lp, null, 0, 1, depth, fr);
    }
  }
}

/** Lichaam tegen een statisch obstakel (beide richtingen hoekpunt-in-vorm). */
function solveStatic(cb: ContactBody, c: Collider, cq: Quad, fr: FrictionParams, impacts: ImpactEvent[]): void {
  const b = cb.body;
  const bb = quadBounds(bodyQuad(b));
  if (!rectsOverlap(bb, c)) return;

  // z-instap: lichaam schuift zijdelings (draaien) een obstakel in → terugduwen in z.
  if (zOverlap(b, c)) {
    const prevZmin = b.prevPos.z - b.depth / 2;
    const prevZmax = b.prevPos.z + b.depth / 2;
    if (!rangesOverlap(prevZmin, prevZmax, c.minZ, c.maxZ)) {
      if (prevZmax <= c.minZ) b.pos.z = c.minZ - b.depth / 2 - 1e-4;
      else b.pos.z = c.maxZ + b.depth / 2 + 1e-4;
      const vz = Math.abs(b.vel.z);
      if (!cb.lastTouching.has(c.id) && vz > 0.02)
        impacts.push({ bodyId: cb.id, otherId: c.id, speed: vz, x: b.pos.x, y: b.pos.y, landing: false });
      cb.touching.add(c.id);
      b.vel.z = 0;
      return;
    }
  } else {
    return;
  }

  // Hoekpunten van het lichaam in het obstakel
  const pts = bodyCornersLocal(b);
  for (const e of cb.extraPoints) pts.push(e);
  for (const lp of pts) {
    const w = localToWorld(b, lp.x, lp.y);
    if (w.x <= c.minX || w.x >= c.maxX || w.y <= c.minY || w.y >= c.maxY) continue;
    const prev = localToWorld(b, lp.x, lp.y, true);
    const pen = pointPenetration(cq, w, prev);
    if (!pen) continue;
    recordContact(cb, c.id, w.x, w.y, pen.nx, pen.ny, impacts);
    applyPositionalCorrection(b, w.x, w.y, null, 0, 0, pen.nx, pen.ny, 0, pen.depth);
    applyFriction(b, null, lp, null, pen.nx, pen.ny, pen.depth, fr);
  }

  // Hoekpunten van het obstakel in het lichaam
  const bq = bodyQuad(b);
  const bqPrev = bodyQuad(b, true);
  for (const corner of cq) {
    const pen = pointPenetration(bq, corner, corner, bqPrev);
    if (!pen) continue;
    // lichaam beweegt weg: tegengesteld aan de naar buiten wijzende normaal van zijn eigen rand
    const nx = -pen.nx;
    const ny = -pen.ny;
    recordContact(cb, c.id, corner.x, corner.y, nx, ny, impacts);
    applyPositionalCorrection(b, corner.x, corner.y, null, 0, 0, nx, ny, 0, pen.depth);
    const local = worldToLocal(b, corner.x, corner.y);
    applyFriction(b, null, local, null, nx, ny, pen.depth, fr);
  }
}

/** Twee dynamische lichamen tegen elkaar. */
function solvePair(a: ContactBody, b: ContactBody, fr: FrictionParams, impacts: ImpactEvent[]): void {
  const A = a.body;
  const B = b.body;
  if (A.frozen && B.frozen) return;
  if (!rangesOverlap(A.pos.z - A.depth / 2, A.pos.z + A.depth / 2, B.pos.z - B.depth / 2, B.pos.z + B.depth / 2)) return;
  const aq = bodyQuad(A);
  const bq = bodyQuad(B);
  const ab = quadBounds(aq);
  const bbx = quadBounds(bq);
  if (!rectsOverlap(ab, bbx)) return;
  const aqPrev = bodyQuad(A, true);
  const bqPrev = bodyQuad(B, true);
  let touched = false;
  const run = (P: ContactBody, Q: ContactBody, pq: Quad, pqPrev: Quad, qq: Quad, qqPrev: Quad) => {
    for (let i = 0; i < 4; i++) {
      const w = pq[i];
      const pen = pointPenetration(qq, w, pqPrev[i], qqPrev);
      if (!pen) continue;
      touched = true;
      recordContact(P, Q.id, w.x, w.y, pen.nx, pen.ny, impacts);
      recordContact(Q, P.id, w.x, w.y, -pen.nx, -pen.ny, impacts);
      applyPositionalCorrection(P.body, w.x, w.y, Q.body, w.x, w.y, pen.nx, pen.ny, 0, pen.depth);
      const lp = worldToLocal(P.body, w.x, w.y);
      const lq = worldToLocal(Q.body, w.x, w.y);
      applyFriction(P.body, Q.body, lp, lq, pen.nx, pen.ny, pen.depth, fr);
    }
  };
  run(a, b, aq, aqPrev, bq, bqPrev);
  run(b, a, bodyQuad(B), bqPrev, bodyQuad(A), aqPrev);
  if (touched) {
    if (A.sleeping && !B.sleeping) A.sleeping = false;
    if (B.sleeping && !A.sleeping) B.sleeping = false;
  }
}

/** Precomputeer quads van statische obstakels. */
export function colliderQuads(colliders: readonly Collider[]): Quad[] {
  return colliders.map((c) => rectQuad(c as Rect));
}

export function solveContacts(
  bodies: ContactBody[],
  colliders: readonly Collider[],
  quads: readonly Quad[],
  fr: FrictionParams,
  impacts: ImpactEvent[],
): void {
  for (const cb of bodies) {
    if (cb.body.sleeping || cb.body.frozen) continue;
    solveGround(cb, fr, impacts);
    for (let i = 0; i < colliders.length; i++) solveStatic(cb, colliders[i], quads[i], fr, impacts);
  }
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      if ((a.body.sleeping || a.body.frozen) && (b.body.sleeping || b.body.frozen)) continue;
      solvePair(a, b, fr, impacts);
    }
  }
}
