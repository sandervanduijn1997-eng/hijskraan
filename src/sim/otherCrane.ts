import { getCrane } from '../cranes/config/cranes';
import type { ResolvedCrane } from '../cranes/models/craneSpec';
import { resolveCrane } from '../cranes/models/craneSpec';
import type { CraneState } from '../cranes/models/craneState';
import { createCraneState } from '../cranes/models/craneState';
import type { CraneGeometry } from '../cranes/models/kinematics';
import { computeGeometry } from '../cranes/models/kinematics';
import type { OtherCraneDef } from '../missions/data/types';
import type { Vec3 } from '../utils/math';
import { DEG } from '../utils/math';

/**
 * Tweede torenkraan op de bouwplaats (AI). Hij draait heen en weer tussen twee standen met een pauze
 * aan elk einde, zoals een collega die stenen van de opslag naar de verdieping brengt. Deterministisch
 * in de tijd, zodat een herhaling precies hetzelfde loopt.
 */
export class OtherCrane {
  readonly spec: ResolvedCrane;
  readonly state: CraneState;
  geom: CraneGeometry;

  constructor(readonly def: OtherCraneDef) {
    this.spec = resolveCrane(getCrane(def.craneId), []);
    this.state = createCraneState(this.spec, { x: def.x, z: def.z, slewDeg: def.fromDeg, trolley: def.trolley, preassembled: true });
    this.geom = computeGeometry(this.spec, this.state);
  }

  update(time: number): void {
    this.state.slew = slewAt(this.def, time) * DEG;
    this.geom = computeGeometry(this.spec, this.state);
  }

  /** De giek (en tegengiek) in wereldcoördinaten. */
  jibSegments(): { a: Vec3; b: Vec3 }[] {
    const g = this.geom;
    const cs = Math.cos(this.state.slew);
    const sn = Math.sin(this.state.slew);
    const w = (u: number, y: number): Vec3 => ({ x: g.slewX + u * cs, y, z: g.slewZ + u * sn });
    return g.segments.filter((s) => s.kind === 'jib' || s.kind === 'counterJib').map((s) => ({ a: w(s.u0, s.y0), b: w(s.u1, s.y1) }));
  }
}

export function slewAt(oc: OtherCraneDef, time: number): number {
  const span = Math.abs(oc.toDeg - oc.fromDeg);
  const move = span / Math.max(0.1, oc.speedDeg);
  const cycle = 2 * (move + oc.pause);
  const t = time % cycle;
  let f: number;
  if (t < oc.pause) f = 0;
  else if (t < oc.pause + move) f = smooth((t - oc.pause) / move);
  else if (t < 2 * oc.pause + move) f = 1;
  else f = 1 - smooth((t - 2 * oc.pause - move) / move);
  return oc.fromDeg + (oc.toDeg - oc.fromDeg) * f;
}

/** Optrekken en afremmen (geen schokken). */
const smooth = (x: number) => x * x * (3 - 2 * x);
