import { getCrane } from '../cranes/config/cranes';
import type { CraneId } from '../cranes/config/types';
import { allowedCapacityT } from '../cranes/models/capacity';
import type { ResolvedCrane } from '../cranes/models/craneSpec';
import { resolveCrane } from '../cranes/models/craneSpec';
import type { CraneStartConfig, CraneState } from '../cranes/models/craneState';
import { createCraneState } from '../cranes/models/craneState';
import type { CraneGeometry } from '../cranes/models/kinematics';
import { computeGeometry, solveBoomIK } from '../cranes/models/kinematics';
import type { LoadType } from '../missions/data/loads';
import type { ContactBody } from '../physics/collision/contacts';
import type { ExtraRope } from '../physics/world';
import { localToWorld } from '../physics/load/rigidBody';
import { GRAVITY } from '../physics/constants';
import type { Vec3 } from '../utils/math';
import { clamp, wrapAngle } from '../utils/math';

/**
 * Tandemhijs: een tweede kraan (bediend door een collega-machinist) houdt het andere einde van een
 * lange last vast. De collega volgt jouw einde met een realistische vertraging: hij houdt zijn
 * giekpunt boven zijn aanslagpunt en hijst of viert zodat de last waterpas blijft. Werk je sneller
 * dan hij kan volgen, dan gaat de last scheef hangen of lopen de kabels schuin, en verschuift de
 * belasting tussen de kranen.
 */

export interface TandemDef {
  /** Kraan van de collega en zijn opstelling. */
  craneId: CraneId;
  start: CraneStartConfig;
  /** Last die samen wordt gehesen. */
  loadId: string;
}

/** Aanslagpunt op een tandemlast (lichaamsframe t.o.v. het geometrisch midden): einde A (−x) of B (+x). */
export function tandemPoint(t: LoadType, end: 'A' | 'B'): { x: number; y: number } {
  return { x: (end === 'A' ? -1 : 1) * t.width * 0.42, y: t.height / 2 };
}

/** Volgsnelheden van de collega (spelwaarden): giekpunt horizontaal en hijsen/vieren. */
const FOLLOW_SPEED = 0.45;
const HOIST_SPEED = 0.25;
const HOIST_GAIN = 1.2;

export class PartnerCrane {
  readonly spec: ResolvedCrane;
  state: CraneState;
  geom: CraneGeometry;
  prevTip: Vec3;
  /** Kabellengte van de collega (m). */
  ropeLength: number;
  rope: ExtraRope | null = null;
  /** Horizontale afstand van jouw einde naar het zijne bij het aanslaan: zo houdt hij de last in dezelfde richting. */
  private offset = { x: 0, z: 0 };
  /** Belasting van de collega-kraan (% van zijn lastdiagram) en zijn kabelkracht (t). */
  loadPct = 0;
  tensionT = 0;

  constructor(readonly def: TandemDef) {
    this.spec = resolveCrane(getCrane(def.craneId), []);
    this.state = createCraneState(this.spec, { ...def.start, outriggersDeployed: def.start.outriggersDeployed ?? true, preassembled: true });
    this.geom = computeGeometry(this.spec, this.state);
    this.prevTip = { ...this.geom.tip };
    this.ropeLength = def.start.ropeLength ?? 6;
  }

  get attached(): boolean {
    return this.rope !== null;
  }

  /** Haakpunt (zonder last: onder de giekpunt aan de kabel). */
  hookPoint(): Vec3 {
    if (this.rope) {
      const b = this.rope.body.body;
      return localToWorld(b, this.rope.local.x, this.rope.local.y, false, this.rope.local.z);
    }
    const t = this.geom.tip;
    return { x: t.x, y: Math.max(0.3, t.y - this.ropeLength), z: t.z };
  }

  /** De collega slaat zijn einde aan (de stroppen zitten al om de last). */
  attach(body: ContactBody, local: { x: number; y: number; z: number }, myEnd: Vec3): ExtraRope {
    const a = localToWorld(body.body, local.x, local.y, false, local.z);
    this.offset = { x: a.x - myEnd.x, z: a.z - myEnd.z };
    const t = this.geom.tip;
    const d = Math.hypot(a.x - t.x, a.y - t.y, a.z - t.z);
    this.ropeLength = d;
    this.rope = { body, local, tip: { ...t }, tipStart: { ...t }, length: d, lengthStart: d, tension: 0, lambda: 0 };
    return this.rope;
  }

  detach(): void {
    this.rope = null;
    this.tensionT = 0;
    this.loadPct = 0;
  }

  /**
   * Eén stap vóór de fysica. `myEndY` = hoogte van jouw aanslagpunt: de collega houdt zijn einde op
   * dezelfde hoogte en zijn giekpunt boven zijn aanslagpunt.
   */
  update(dt: number, myEnd: Vec3 | null): void {
    const s = this.state;
    const gb = this.spec.gb;
    this.prevTip = { ...this.geom.tip };
    const lengthStart = this.ropeLength;
    if (this.rope && myEnd !== null) {
      const p = this.hookPoint();
      // horizontaal: zijn giekpunt naar de plek waar zijn einde hoort (jouw einde + vaste afstand), zodat
      // de last niet gaat draaien; begrensde snelheid
      const g = this.geom;
      const tx = myEnd.x + this.offset.x;
      const tz = myEnd.z + this.offset.z;
      const want = Math.atan2(tz - g.slewZ, tx - g.slewX);
      const u = Math.hypot(tx - g.slewX, tz - g.slewZ);
      const errA = wrapAngle(want - s.slew);
      const maxSlew = FOLLOW_SPEED / Math.max(3, g.tipU);
      s.slew += clamp(errA * 1.5, -maxSlew, maxSlew) * dt;
      if (this.spec.cfg.kind === 'telescopic' || this.spec.cfg.kind === 'lattice') {
        // giekpunt hoog genoeg houden: wordt de kabel te kort, dan de giek optoppen (hogere tip)
        const needY = p.y + gb.ropeMin + 2;
        const ik = solveBoomIK(this.spec, u, Math.max(g.tipHeight, needY));
        const maxA = (FOLLOW_SPEED / Math.max(3, s.boomLength)) * dt;
        s.boomAngle += clamp((ik.angle - s.boomAngle) * 1.5 * dt, -maxA, maxA);
        if (this.spec.cfg.kind === 'telescopic') s.boomLength += clamp((ik.length - s.boomLength) * 1.5 * dt, -FOLLOW_SPEED * dt, FOLLOW_SPEED * dt);
      } else if (this.spec.cfg.kind === 'tower') {
        s.trolley = clamp(s.trolley + clamp(u - s.trolley, -FOLLOW_SPEED * dt, FOLLOW_SPEED * dt), gb.trolleyMin ?? 0, gb.jibLength ?? 50);
      }
      // verticaal: zijn einde op de hoogte van het jouwe (positief verschil = zijn einde te hoog → vieren)
      const dy = p.y - myEnd.y;
      this.ropeLength = clamp(this.ropeLength + clamp(dy * HOIST_GAIN, -HOIST_SPEED, HOIST_SPEED) * dt, gb.ropeMin, gb.ropeMax);
    }
    this.geom = computeGeometry(this.spec, s);
    if (this.rope) {
      this.rope.tipStart = { ...this.prevTip };
      this.rope.tip = { ...this.geom.tip };
      this.rope.lengthStart = lengthStart;
      this.rope.length = this.ropeLength;
    }
  }

  /** Na de fysica: belasting van de collega-kraan. */
  measure(): void {
    if (!this.rope) return;
    this.tensionT = this.rope.tension / GRAVITY / 1000 + this.spec.gb.hookMassKg / 1000;
    this.loadPct = (this.tensionT / Math.max(0.1, allowedCapacityT(this.spec, this.state))) * 100;
  }
}
