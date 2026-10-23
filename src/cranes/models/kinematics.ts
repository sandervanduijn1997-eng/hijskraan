import type { Vec3 } from '../../utils/math';
import { DEG, clamp, lerp } from '../../utils/math';
import type { ResolvedCrane } from './craneSpec';
import type { CraneState } from './craneState';
import { TOWER_ERECTION_SECTIONS, TOWER_MAST_SECTIONS, TOWER_SLEW_UNIT_H } from './towerErection';

export type SegmentKind = 'boom' | 'boomSection' | 'jib' | 'mast' | 'counterJib' | 'arm1' | 'arm2' | 'tele' | 'column';

/** Segment in het draaiframe: u = horizontaal in giekrichting vanaf de draaias, y = hoogte. */
export interface Segment {
  kind: SegmentKind;
  u0: number;
  y0: number;
  u1: number;
  y1: number;
  /** Dikte voor rendering/botsing (m). */
  width: number;
}

export interface CraneGeometry {
  /** Wereld-x en -z van de draaias. */
  slewX: number;
  slewZ: number;
  /** Ophangpunt kabel in het draaiframe. */
  tipU: number;
  tipY: number;
  /** Ophangpunt kabel in wereldcoördinaten (incl. kanteling). */
  tip: Vec3;
  /** Werkstraal: horizontale afstand draaias → ophangpunt (m). */
  radius: number;
  tipHeight: number;
  segments: Segment[];
  boomMassT: number;
  boomCogRadius: number;
  /** Effectieve giekhoek voor de HUD (rad). */
  displayBoomAngle: number;
  /** Effectieve gieklengte (incl. hulpgiek / knikarm) voor de HUD. */
  displayBoomLength: number;
  /** Voor zelfopbouw: masthoek en gieksvouw (0..1). */
  mastAngle: number;
  jibUnfold: number;
  /** Kantelpunt (wereld-x op de grond) waarom de kraan kantelt. */
  tiltPivotX: number;
}

export const SELF_ERECT_STAGES = [
  { from: 0, to: 0.2, label: 'Stempels uitzetten' },
  { from: 0.2, to: 0.4, label: 'Ballast plaatsen' },
  { from: 0.4, to: 0.75, label: 'Mast oprichten' },
  { from: 0.75, to: 1, label: 'Giek uitklappen' },
] as const;

/** Klimmen van een torenkraan: aantal mastsecties dat bij voortgang p staat (fractioneel tijdens het klimmen). */
export function towerClimbSections(p: number): number {
  const climb = TOWER_MAST_SECTIONS - TOWER_ERECTION_SECTIONS;
  return TOWER_ERECTION_SECTIONS + clamp(p, 0, 1) * climb;
}

/** Heeft deze kraan een opbouwprocedure die je met B uitvoert? */
export const hasSetupProcedure = (spec: ResolvedCrane): boolean =>
  spec.gb.setupType === 'selfErect' || spec.gb.setupType === 'boomAssembly' || spec.gb.setupType === 'towerAssembly';

/** Leesbare naam van de huidige opbouwstap. */
export function setupStageLabel(spec: ResolvedCrane, p: number): string {
  if (spec.gb.setupType === 'towerAssembly') {
    const k = Math.min(TOWER_MAST_SECTIONS, Math.floor(towerClimbSections(p) + 1e-9) + 1);
    return `Klimmen: mastsectie ${k}/${TOWER_MAST_SECTIONS} inbouwen`;
  }
  const list: readonly { to: number; label: string }[] | null = spec.gb.setupType === 'selfErect' ? SELF_ERECT_STAGES : null;
  if (!list) return `Giekmontage ${Math.round(p * 100)} %`;
  let i = list.findIndex((x) => p < x.to);
  if (i < 0) i = list.length - 1;
  return `Stap ${i + 1}/${list.length}: ${list[i].label}`;
}

export function selfErectStage(p: number): number {
  if (p >= 1) return SELF_ERECT_STAGES.length;
  for (let i = 0; i < SELF_ERECT_STAGES.length; i++) if (p < SELF_ERECT_STAGES[i].to) return i;
  return SELF_ERECT_STAGES.length;
}

/** Huidige giekhoek voor de berekening (tijdens montage wordt de giek automatisch opgericht). */
function effectiveBoomAngle(spec: ResolvedCrane, s: CraneState): number {
  if (spec.gb.setupType === 'boomAssembly' && s.setupProgress < 1) {
    const raise = clamp((s.setupProgress - 0.8) / 0.2, 0, 1);
    return lerp(0, s.boomAngle, raise);
  }
  return s.boomAngle;
}

export function computeGeometry(spec: ResolvedCrane, s: CraneState): CraneGeometry {
  const gb = spec.gb;
  const slewX = s.baseX + gb.slewOffsetX;
  const segments: Segment[] = [];
  let tipU = 0;
  let tipY = 0;
  let boomMassT = 0;
  let boomCogRadius = 0;
  let displayBoomAngle = 0;
  let displayBoomLength = 0;
  let mastAngle = Math.PI / 2;
  let jibUnfold = 1;

  switch (spec.cfg.kind) {
    case 'telescopic': {
      const th = effectiveBoomAngle(spec, s);
      const L = s.boomLength;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      tipU = gb.pivotU + L * c;
      tipY = gb.pivotHeight + L * sn;
      const n = Math.max(1, gb.telescopeSections);
      const sectionLen = (L - gb.boomMin) / Math.max(1, n - 1);
      // basissectie + uitgeschoven secties (visueel taps toelopend)
      segments.push({ kind: 'boom', u0: gb.pivotU, y0: gb.pivotHeight, u1: gb.pivotU + gb.boomMin * c, y1: gb.pivotHeight + gb.boomMin * sn, width: 1.1 });
      for (let i = 1; i < n; i++) {
        const a = gb.boomMin + sectionLen * (i - 1) - 0.6;
        const b = gb.boomMin + sectionLen * i;
        if (b - a < 0.05) continue;
        segments.push({ kind: 'boomSection', u0: gb.pivotU + a * c, y0: gb.pivotHeight + a * sn, u1: gb.pivotU + b * c, y1: gb.pivotHeight + b * sn, width: 1.0 - i * 0.1 });
      }
      boomMassT = gb.boomBaseT + gb.boomPerMeterT * L;
      boomCogRadius = gb.pivotU + (L / 2) * c;
      displayBoomAngle = th;
      displayBoomLength = L;
      break;
    }
    case 'lattice': {
      const th = effectiveBoomAngle(spec, s);
      const assembled = spec.gb.setupType === 'boomAssembly' ? clamp(s.setupProgress / 0.8, 0, 1) : 1;
      const L = s.boomLength * Math.max(0.08, assembled);
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const bu = gb.pivotU + L * c;
      const by = gb.pivotHeight + L * sn;
      segments.push({ kind: 'boom', u0: gb.pivotU, y0: gb.pivotHeight, u1: bu, y1: by, width: 1.6 });
      tipU = bu;
      tipY = by;
      const jib = spec.jibOptions[s.jibIndex] ?? 0;
      let jibMass = 0;
      if (jib > 0 && assembled >= 1) {
        const ja = th - (gb.jibOffsetDeg ?? 10) * DEG;
        tipU = bu + jib * Math.cos(ja);
        tipY = by + jib * Math.sin(ja);
        segments.push({ kind: 'jib', u0: bu, y0: by, u1: tipU, y1: tipY, width: 0.9 });
        jibMass = jib * gb.boomPerMeterT * 0.5;
      }
      boomMassT = gb.boomBaseT + gb.boomPerMeterT * s.boomLength + jibMass;
      boomCogRadius = gb.pivotU + (s.boomLength / 2) * c + (jibMass > 0 ? (jibMass / boomMassT) * (tipU - bu) : 0);
      displayBoomAngle = th;
      displayBoomLength = s.boomLength + jib;
      break;
    }
    case 'tower': {
      const H = gb.towerHeight ?? 30;
      const J = gb.jibLength ?? 30;
      const CJ = gb.counterJibLength ?? 8;
      let mastH = H;
      const jibLen = J;
      const cjLen = CJ;
      if (gb.setupType === 'selfErect' && s.setupProgress < 1) {
        const p = s.setupProgress;
        mastAngle = lerp(0, Math.PI / 2, clamp((p - 0.4) / 0.35, 0, 1));
        jibUnfold = clamp((p - 0.75) / 0.25, 0, 1);
      }
      if (gb.setupType === 'towerAssembly' && s.setupProgress < 1) {
        // de kraan staat op montagehoogte en klimt zelf: de mast groeit sectie voor sectie onder de draaikrans
        const secH = (H - TOWER_SLEW_UNIT_H) / TOWER_MAST_SECTIONS;
        mastH = towerClimbSections(s.setupProgress) * secH + TOWER_SLEW_UNIT_H;
      }
      const baseH = spec.cfg.visual.carrierHeight;
      // mast ligt opgevouwen naar achteren (−u) en komt omhoog
      const topU = -Math.cos(mastAngle) * mastH;
      const topY = baseH + Math.sin(mastAngle) * mastH;
      segments.push({ kind: 'mast', u0: 0, y0: baseH, u1: topU, y1: topY, width: 1.6 });
      // giek: opgevouwen langs de mast naar beneden, uitklappen naar horizontaal
      const folded = mastAngle + Math.PI;
      const jibDir = folded + jibUnfold * (Math.PI * 2 - folded);
      const jdx = Math.cos(jibDir);
      const jdy = Math.sin(jibDir);
      segments.push({ kind: 'jib', u0: topU, y0: topY, u1: topU + jdx * jibLen, y1: topY + jdy * jibLen, width: 1.3 });
      if (cjLen > 0) segments.push({ kind: 'counterJib', u0: topU, y0: topY, u1: topU - jdx * cjLen, y1: topY - jdy * cjLen, width: 1.1 });
      const tr = Math.min(s.trolley, Math.max(gb.trolleyMin ?? 0, jibLen));
      tipU = topU + jdx * tr;
      tipY = topY + jdy * tr - 0.9;
      boomMassT = 0;
      boomCogRadius = 0;
      displayBoomAngle = 0;
      displayBoomLength = J;
      break;
    }
    case 'knuckle': {
      const colH = gb.columnHeight ?? 3.5;
      const L1 = gb.arm1Length ?? 4;
      const L2 = (gb.arm2Length ?? 3) + s.knuckleTele;
      segments.push({ kind: 'column', u0: 0, y0: spec.cfg.visual.carrierHeight + 0.4, u1: 0, y1: colH, width: 0.7 });
      const a1 = s.boomAngle;
      const ku = L1 * Math.cos(a1);
      const ky = colH + L1 * Math.sin(a1);
      segments.push({ kind: 'arm1', u0: 0, y0: colH, u1: ku, y1: ky, width: 0.55 });
      const a2 = a1 + s.knuckle;
      const base2 = gb.arm2Length ?? 3;
      const eu = ku + base2 * Math.cos(a2);
      const ey = ky + base2 * Math.sin(a2);
      segments.push({ kind: 'arm2', u0: ku, y0: ky, u1: eu, y1: ey, width: 0.45 });
      tipU = ku + L2 * Math.cos(a2);
      tipY = ky + L2 * Math.sin(a2);
      if (s.knuckleTele > 0.02) segments.push({ kind: 'tele', u0: eu - 0.3 * Math.cos(a2), y0: ey - 0.3 * Math.sin(a2), u1: tipU, y1: tipY, width: 0.32 });
      boomMassT = gb.boomBaseT + gb.boomPerMeterT * (L1 + L2);
      boomCogRadius = (ku * L1 + ((ku + tipU) / 2) * L2) / (L1 + L2);
      displayBoomAngle = a1;
      displayBoomLength = L1 + L2;
      break;
    }
  }

  const cs = Math.cos(s.slew);
  const sn = Math.sin(s.slew);
  let tx = slewX + tipU * cs;
  let ty = tipY;
  const tz = s.baseZ + tipU * sn;
  // kanteling rond de voorste kantellijn (in de richting van de giek)
  const dir = cs >= 0 ? 1 : -1;
  const fp = spec.gb.footprintOutriggers ?? spec.gb.footprintRetracted;
  const tiltPivotX = slewX + dir * fp.a;
  if (s.tilt !== 0) {
    const ang = -dir * s.tilt;
    const rx = tx - tiltPivotX;
    const c2 = Math.cos(ang);
    const s2 = Math.sin(ang);
    tx = tiltPivotX + rx * c2 - ty * s2;
    ty = rx * s2 + ty * c2;
  }
  return {
    slewX,
    slewZ: s.baseZ,
    tipU,
    tipY,
    tip: { x: tx, y: ty, z: tz },
    radius: Math.abs(tipU),
    tipHeight: tipY,
    segments,
    boomMassT,
    boomCogRadius,
    displayBoomAngle,
    displayBoomLength,
    mastAngle,
    jibUnfold,
    tiltPivotX,
  };
}

/** Projecteer een segment van het draaiframe naar wereld-xy (zijaanzicht) + z. */
export function segmentToWorld(g: CraneGeometry, slew: number, seg: Segment): { x0: number; y0: number; x1: number; y1: number; z0: number; z1: number } {
  const c = Math.cos(slew);
  const s = Math.sin(slew);
  return {
    x0: g.slewX + seg.u0 * c,
    y0: seg.y0,
    x1: g.slewX + seg.u1 * c,
    y1: seg.y1,
    z0: g.slewZ + seg.u0 * s,
    z1: g.slewZ + seg.u1 * s,
  };
}

/**
 * Inverse kinematica voor een telescoop/vakwerkgiek: welke giekhoek en -lengte brengen de tip naar (u, y)?
 * Gebruikt door de autopilot (tests) en de planningsweergave.
 */
export function solveBoomIK(spec: ResolvedCrane, u: number, y: number): { angle: number; length: number } {
  const gb = spec.gb;
  const du = u - gb.pivotU;
  const dy = y - gb.pivotHeight;
  const angle = clamp(Math.atan2(dy, du), gb.boomAngleMinDeg * DEG, gb.boomAngleMaxDeg * DEG);
  const length = clamp(Math.sqrt(du * du + dy * dy), gb.boomMin, gb.boomMax);
  return { angle, length };
}
