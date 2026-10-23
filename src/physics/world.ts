import { AIR_DENSITY, GRAVITY } from './constants';
import type { Collider } from './collision/colliders';
import type { ContactBody, FrictionParams, ImpactEvent } from './collision/contacts';
import { colliderQuads, solveContacts } from './collision/contacts';
import type { Quad } from './collision/geometry';
import type { RopeState } from './cable/rope';
import { solveRope } from './cable/rope';
import type { RigidBody } from './load/rigidBody';
import { apexWorld } from './load/rigidBody';
import type { Vec3 } from '../utils/math';

export interface PhysicsParams {
  gravity: number;
  /** Demping van de slingerbeweging t.o.v. het ophangpunt (1/s). */
  swayDamping: number;
  linearDamping: number;
  angularDamping: number;
  /** Elasticiteit van kabel + giek (m/N): de last wordt geleidelijk overgenomen bij het heffen. */
  ropeCompliance: number;
  /** Maximale demping van de kabelrek (1/s); werkelijk kritisch gedempt (2ω) zodat de kabel niet terugveert of de last vasthoudt. */
  ropeDamping: number;
  friction: FrictionParams;
}

/** Hoe lang (s) een contact "onthouden" wordt voor inslagdetectie. */
const CONTACT_MEMORY = 0.4;
/** Extra demping (1/s) voor een aangeslagen last die nog contact maakt met de ondergrond. */
const CONTACT_DAMPING = 12;

export const defaultPhysicsParams = (): PhysicsParams => ({
  gravity: GRAVITY,
  swayDamping: 0.06,
  linearDamping: 0.01,
  angularDamping: 0.25,
  ropeCompliance: 0,
  ropeDamping: 60,
  friction: { staticMu: 0.65, dynamicMu: 0.45 },
});

/**
 * Deterministische XPBD-wereld: lichamen, één hijskabel, statische obstakels en de grond.
 * Wordt alleen met vaste tijdstappen aangeroepen.
 */
export class PhysicsWorld {
  readonly bodies: ContactBody[] = [];
  colliders: Collider[] = [];
  private quads: Quad[] = [];
  params: PhysicsParams;
  /** Wind (m/s) langs x en z. */
  wind = { x: 0, z: 0 };
  /** Lichaam dat aan de kabel hangt (haakblok of last+haak). */
  ropeBody: ContactBody | null = null;
  impacts: ImpactEvent[] = [];

  constructor(params: PhysicsParams = defaultPhysicsParams()) {
    this.params = params;
  }

  setColliders(colliders: Collider[]): void {
    this.colliders = colliders;
    this.quads = colliderQuads(colliders);
  }

  addBody(id: string, body: RigidBody, extraPoints: { x: number; y: number }[] = []): ContactBody {
    const cb: ContactBody = { id, body, touching: new Set(), supports: new Set(), lastTouching: new Set(), recent: new Map(), extraPoints };
    this.bodies.push(cb);
    return cb;
  }

  removeBody(cb: ContactBody): void {
    const i = this.bodies.indexOf(cb);
    if (i >= 0) this.bodies.splice(i, 1);
    if (this.ropeBody === cb) this.ropeBody = null;
  }

  getBody(id: string): ContactBody | undefined {
    return this.bodies.find((b) => b.id === id);
  }

  /**
   * Eén vaste stap. De kabeltip beweegt lineair van tipStart naar rope.tip en de kabellengte
   * van lengthStart naar rope.length, verdeeld over de substappen (geen sprongen bij een strakke kabel).
   * Werkt rope.tension en rope.stretch bij.
   */
  step(dt: number, substeps: number, rope: RopeState, tipStart: Vec3, lengthStart = rope.length): void {
    const h = dt / substeps;
    const p = this.params;
    this.impacts.length = 0;
    for (const cb of this.bodies) {
      if (cb.body.sleeping) {
        // wakker worden als een ondersteunend lichaam beweegt
        for (const sid of cb.supports) {
          const s = this.bodies.find((o) => o.id === sid);
          if (s && !s.body.sleeping && !s.body.frozen) {
            cb.body.sleeping = false;
            cb.body.sleepTimer = 0;
            break;
          }
        }
        if (cb.body.sleeping) continue;
      }
      const t = cb.lastTouching;
      cb.lastTouching = cb.touching;
      cb.touching = t;
      t.clear();
      cb.supports.clear();
    }
    const tipEnd = rope.tip;
    const tipVx = (tipEnd.x - tipStart.x) / dt;
    const tipVz = (tipEnd.z - tipStart.z) / dt;
    const tip = { x: 0, y: 0, z: 0 };
    let lambdaSum = 0;
    const rb = this.ropeBody;
    if (rb) rb.body.sleeping = false;

    for (let s = 0; s < substeps; s++) {
      const f = (s + 1) / substeps;
      tip.x = tipStart.x + (tipEnd.x - tipStart.x) * f;
      tip.y = tipStart.y + (tipEnd.y - tipStart.y) * f;
      tip.z = tipStart.z + (tipEnd.z - tipStart.z) * f;

      for (const cb of this.bodies) {
        const b = cb.body;
        if (b.sleeping || b.frozen) continue;
        // externe krachten: zwaartekracht + wind (kwadratische weerstand)
        const rvx = this.wind.x - b.vel.x;
        const rvz = this.wind.z - b.vel.z;
        const fx = 0.5 * AIR_DENSITY * b.dragAreaX * rvx * Math.abs(rvx);
        const fz = 0.5 * AIR_DENSITY * b.dragAreaZ * rvz * Math.abs(rvz);
        b.vel.x += (fx * b.invMass) * h;
        b.vel.z += (fz * b.invMass) * h;
        b.vel.y -= p.gravity * h;
        b.prevPos.x = b.pos.x;
        b.prevPos.y = b.pos.y;
        b.prevPos.z = b.pos.z;
        b.prevAngle = b.angle;
        b.pos.x += b.vel.x * h;
        b.pos.y += b.vel.y * h;
        b.pos.z += b.vel.z * h;
        b.angle += b.angVel * h;
      }

      if (rb) lambdaSum += solveRope(rb.body, tip, lengthStart + (rope.length - lengthStart) * f, h, p.ropeCompliance);

      solveContacts(this.bodies, this.colliders, this.quads, p.friction, this.impacts);

      for (const cb of this.bodies) {
        const b = cb.body;
        if (b.sleeping || b.frozen) continue;
        b.vel.x = (b.pos.x - b.prevPos.x) / h;
        b.vel.y = (b.pos.y - b.prevPos.y) / h;
        b.vel.z = (b.pos.z - b.prevPos.z) / h;
        b.angVel = (b.angle - b.prevAngle) / h;
        const lin = Math.max(0, 1 - p.linearDamping * h);
        b.vel.x *= lin;
        b.vel.y *= lin;
        b.vel.z *= lin;
        const angD = cb.touching.size > 0 ? p.angularDamping * 8 : p.angularDamping;
        b.angVel *= Math.max(0, 1 - angD * h);
        if (cb.touching.size > 0 && cb === rb) {
          // een last die half aan de kabel en half op de grond rust, zou anders blijven wippen en wiegen
          const cd = Math.max(0, 1 - CONTACT_DAMPING * h);
          b.vel.y *= cd;
          b.angVel *= cd;
        }
        if (cb === rb) {
          // demping van de kabelrek langs de kabelrichting (alleen bij strakke kabel)
          if (p.ropeCompliance > 0) {
            const a = apexWorld(b);
            const dx = a.x - tip.x;
            const dy = a.y - tip.y;
            const dz = a.z - tip.z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const Ls = lengthStart + (rope.length - lengthStart) * f;
            if (d >= Ls - 1e-4 && d > 1e-6) {
              const nx = dx / d;
              const ny = dy / d;
              const nz = dz / d;
              // rek-snelheid = radiale snelheid min de lengteverandering van de lier; alleen die dempen,
              // anders werkt de demping als een rem op het hijsen zelf (en meet de begrenzer te veel kracht)
              const dLdt = (rope.length - lengthStart) / dt;
              const vr = (b.vel.x - tipVx) * nx + (b.vel.y - (tipEnd.y - tipStart.y) / dt) * ny + (b.vel.z - tipVz) * nz - dLdt;
              // kritische demping van de kabelveer: c = 2·√(k/m), begrensd door ropeDamping
              const omega = Math.sqrt(1 / (p.ropeCompliance * b.mass));
              const k = Math.min(1, Math.min(p.ropeDamping, 2 * omega) * h);
              b.vel.x -= nx * vr * k;
              b.vel.y -= ny * vr * k;
              b.vel.z -= nz * vr * k;
            }
          }
          // slingerdemping relatief t.o.v. de beweging van het ophangpunt
          const k = Math.max(0, 1 - p.swayDamping * h);
          b.vel.x = tipVx + (b.vel.x - tipVx) * k;
          b.vel.z = tipVz + (b.vel.z - tipVz) * k;
        }
      }
    }

    // spanning = λ / h² gemiddeld over de substappen
    rope.tension = rb ? lambdaSum / (h * h) / substeps : 0;
    if (rb) {
      const a = apexWorld(rb.body);
      const dx = a.x - tipEnd.x;
      const dy = a.y - tipEnd.y;
      const dz = a.z - tipEnd.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      rope.stretch = d - rope.length;
      rope.slack = rope.stretch < -0.02 || rope.tension < 1;
    } else {
      rope.stretch = 0;
      rope.slack = true;
    }

    for (const cb of this.bodies) {
      for (const [id, t] of cb.recent) {
        if (t - dt <= 0) cb.recent.delete(id);
        else cb.recent.set(id, t - dt);
      }
      for (const id of cb.touching) cb.recent.set(id, CONTACT_MEMORY);
    }
    this.updateSleep(dt);
  }

  private updateSleep(dt: number): void {
    for (const cb of this.bodies) {
      const b = cb.body;
      if (b.frozen || cb === this.ropeBody) {
        b.sleepTimer = 0;
        continue;
      }
      if (b.sleeping) continue;
      const v = Math.abs(b.vel.x) + Math.abs(b.vel.y) + Math.abs(b.vel.z);
      if (cb.touching.size > 0 && v < 0.03 && Math.abs(b.angVel) < 0.03) {
        b.sleepTimer += dt;
        if (b.sleepTimer > 0.6) {
          b.sleeping = true;
          b.vel.x = b.vel.y = b.vel.z = 0;
          b.angVel = 0;
        }
      } else {
        b.sleepTimer = 0;
      }
    }
  }
}
