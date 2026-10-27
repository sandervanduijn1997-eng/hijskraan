import { AIR_DENSITY, GRAVITY } from './constants';
import type { Collider } from './collision/colliders';
import type { ContactBody, FrictionParams, ImpactEvent } from './collision/contacts';
import { colliderQuads, solveContactVelocities, solveContacts } from './collision/contacts';
import type { SolvedContact } from './collision/contacts';
import type { Quad } from './collision/geometry';
import type { RopeState } from './cable/rope';
import { solveRope } from './cable/rope';
import type { RigidBody } from './load/rigidBody';
import { apexWorld, applyAngularCorrection, applyPositionalCorrection, bodyYaw, localToWorld, qAddRotation, qMul, updateDerived } from './load/rigidBody';
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
  /** Demping van het gieren (draaien om de kabel) door monteurs met stuurlijnen (1/s). */
  yawDamping: number;
  /**
   * Terugdraaistijfheid van de kabelparten: zoals een bifilaire slinger levert de afstand s tussen de parten
   * een moment k = G·s²/(4L). Dit is s²/4 (m²).
   */
  ropeTorsion: number;
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
  yawDamping: 0.35,
  ropeTorsion: 0.16,
});

/**
 * Deterministische XPBD-wereld: lichamen, één hijskabel, statische obstakels en de grond.
 * Wordt alleen met vaste tijdstappen aangeroepen.
 */
/** Tweede kabel aan een lichaam (tandemhijs). `tipStart`/`lengthStart` = begin van de stap. */
export interface ExtraRope {
  body: ContactBody;
  /** Aanslagpunt in het lichaamsframe. */
  local: { x: number; y: number; z: number };
  tip: Vec3;
  tipStart: Vec3;
  length: number;
  lengthStart: number;
  /** Gemeten kabelkracht (N). */
  tension: number;
  lambda: number;
}

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
  /**
   * Neutrale draaistand van de kabel (rad): een staalkabel draait licht op of af bij vieren en hijsen,
   * waardoor een hangende last langzaam gaat gieren.
   */
  ropeTwist = 0;
  private ropeTwistBody: ContactBody | null = null;
  /**
   * Extra kabels (tandemhijs): een tweede kraan houdt dezelfde last vast op een eigen aanslagpunt.
   * Zelfde ongelijkheidsconstraint als de hoofdkabel, aan een punt in het lichaamsframe.
   */
  readonly extraRopes: ExtraRope[] = [];

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
        b.prevQ.x = b.q.x;
        b.prevQ.y = b.q.y;
        b.prevQ.z = b.q.z;
        b.prevQ.w = b.q.w;
        b.pos.x += b.vel.x * h;
        b.pos.y += b.vel.y * h;
        b.pos.z += b.vel.z * h;
        qAddRotation(b.q, b.omega.x * h, b.omega.y * h, b.omega.z * h);
      }

      if (rb) {
        const L = lengthStart + (rope.length - lengthStart) * f;
        const lam = solveRope(rb.body, tip, L, h, p.ropeCompliance);
        lambdaSum += lam;
        // kabeltorsie: een belaste kabel trekt de last terug naar zijn neutrale draaistand (om de verticaal)
        if (lam > 0 && p.ropeTorsion > 0) {
          const tension = lam / (h * h);
          const yaw = bodyYaw(rb.body);
          let err = yaw - this.ropeTwist;
          err = Math.atan2(Math.sin(err), Math.cos(err));
          // bifilaire slinger: k = G·s²/(4L); als zachte hoekconstraint (compliance 1/k)
          const stiff = (p.ropeTorsion * tension) / Math.max(1, L);
          if (stiff > 1e-6) applyAngularCorrection(rb.body, { x: 0, y: 1, z: 0 }, -err, 1 / stiff, h);
        }
      }

      for (const er of this.extraRopes) {
        const b = er.body.body;
        b.sleeping = false;
        const et = { x: er.tipStart.x + (er.tip.x - er.tipStart.x) * f, y: er.tipStart.y + (er.tip.y - er.tipStart.y) * f, z: er.tipStart.z + (er.tip.z - er.tipStart.z) * f };
        const L = er.lengthStart + (er.length - er.lengthStart) * f;
        const a = localToWorld(b, er.local.x, er.local.y, false, er.local.z);
        const dx = a.x - et.x;
        const dy = a.y - et.y;
        const dz = a.z - et.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > L && d > 1e-6) er.lambda += applyPositionalCorrection(b, a, null, null, { x: -dx / d, y: -dy / d, z: -dz / d }, d - L, p.ropeCompliance, h);
      }

      const contacts: SolvedContact[] = solveContacts(this.bodies, this.colliders, this.quads, p.friction, this.impacts);

      for (const cb of this.bodies) {
        const b = cb.body;
        if (b.sleeping || b.frozen) continue;
        b.vel.x = (b.pos.x - b.prevPos.x) / h;
        b.vel.y = (b.pos.y - b.prevPos.y) / h;
        b.vel.z = (b.pos.z - b.prevPos.z) / h;
        // hoeksnelheid uit de rotatie van deze substap: Δq = q · prevQ⁻¹
        const dq = qMul(b.q, { x: -b.prevQ.x, y: -b.prevQ.y, z: -b.prevQ.z, w: b.prevQ.w });
        const sgn = dq.w >= 0 ? 2 / h : -2 / h;
        b.omega.x = dq.x * sgn;
        b.omega.y = dq.y * sgn;
        b.omega.z = dq.z * sgn;
        // vangnet: geen onfysische snelheden na een diepe contactcorrectie
        const sp = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
        if (sp > 25) {
          b.vel.x *= 25 / sp;
          b.vel.y *= 25 / sp;
          b.vel.z *= 25 / sp;
        }
        const lin = Math.max(0, 1 - p.linearDamping * h);
        b.vel.x *= lin;
        b.vel.y *= lin;
        b.vel.z *= lin;
        const angD = Math.max(0, 1 - (cb.touching.size > 0 ? p.angularDamping * 8 : p.angularDamping) * h);
        b.omega.x *= angD;
        b.omega.y *= angD;
        b.omega.z *= angD;
        if (cb === rb) b.omega.y *= Math.max(0, 1 - p.yawDamping * h);
        if (cb.touching.size > 0 && cb === rb) {
          // een last die half aan de kabel en half op de grond rust, zou anders blijven wippen en wiegen
          const cd = Math.max(0, 1 - CONTACT_DAMPING * h);
          b.vel.y *= cd;
          b.omega.x *= cd;
          b.omega.y *= cd;
          b.omega.z *= cd;
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
      solveContactVelocities(contacts, p.friction, h);
    }

    for (const cb of this.bodies) updateDerived(cb.body);
    // de neutrale draaistand volgt de kabel: nieuwe last → begint waar hij hangt; vieren/hijsen draait de kabel licht
    if (rb !== this.ropeTwistBody) {
      this.ropeTwistBody = rb;
      if (rb) this.ropeTwist = bodyYaw(rb.body);
    } else if (rb) this.ropeTwist += (rope.length - lengthStart) * 0.004;
    // spanning = λ / h² gemiddeld over de substappen
    rope.tension = rb ? lambdaSum / (h * h) / substeps : 0;
    for (const er of this.extraRopes) {
      er.tension = er.lambda / (h * h) / substeps;
      er.lambda = 0;
    }
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
      if (cb.touching.size > 0 && v < 0.03 && b.angVel < 0.03) {
        b.sleepTimer += dt;
        if (b.sleepTimer > 0.6) {
          b.sleeping = true;
          b.vel.x = b.vel.y = b.vel.z = 0;
          b.omega.x = b.omega.y = b.omega.z = 0;
          b.angVel = 0;
        }
      } else {
        b.sleepTimer = 0;
      }
    }
  }
}
