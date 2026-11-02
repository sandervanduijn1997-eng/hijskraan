import type { Footprint, StabilityMasses } from '../../physics/stability/stability';

import { CHART_TIPPING_FRACTION, tippingLoadT } from '../../physics/stability/stability';
import type { LoadChart } from '../../physics/stability/loadChart';
import { DEG, clamp, detPow, lerp } from '../../utils/math';
import type { ResolvedCrane } from './craneSpec';
import type { CraneState } from './craneState';
import { computeGeometry } from './kinematics';

export type SupportMode = 'outriggers' | 'partial' | 'tires';

export interface SupportState {
  mode: SupportMode;
  footprint: Footprint;
  /** Kleinste stempeluitschuiving (0..1). */
  minBeam: number;
  allJacksDown: boolean;
}

/** Bepaal het steunvlak uit de stempeltoestand. */
export function supportState(spec: ResolvedCrane, s: CraneState): SupportState {
  const gb = spec.gb;
  if (gb.outriggerCount === 0 || !gb.footprintOutriggers) {
    return { mode: 'tires', footprint: gb.footprintRetracted, minBeam: 0, allJacksDown: false };
  }
  const minBeam = Math.min(...s.outriggerBeam);
  const allJacksDown = s.outriggerJack.every((j) => j >= 0.999);
  if (!allJacksDown) return { mode: 'tires', footprint: gb.footprintRetracted, minBeam, allJacksDown };
  const full = gb.footprintOutriggers;
  const ret = gb.footprintRetracted;
  const fp = { a: full.a, b: lerp(ret.b, full.b, minBeam) };
  return { mode: minBeam >= 0.999 ? 'outriggers' : 'partial', footprint: fp, minBeam, allJacksDown };
}

export function stabilityMasses(spec: ResolvedCrane, s: CraneState): StabilityMasses {
  const gb = spec.gb;
  const cw = spec.counterweights[s.counterweightIndex] ?? spec.counterweights[0];
  return {
    carrierT: gb.carrierT,
    superT: gb.superT,
    superBehind: gb.superBehind,
    counterweightT: (cw?.massT ?? 0) + s.extraCounterweightT,
    cwRadius: cw?.radius ?? 0,
  };
}

/** Structurele grens (t) bij straal R en gieklengte L. */
export function structuralCapacityT(spec: ResolvedCrane, radius: number, boomLength: number): number {
  const gb = spec.gb;
  const st = gb.structural;
  if (st.momentTm !== undefined) {
    return Math.min(gb.maxCapacityT, st.momentTm / Math.max(radius, st.minRadius));
  }
  const rf = detPow(Math.min(1, st.minRadius / Math.max(radius, 0.01)), st.p);
  const lf = detPow(gb.boomMin / Math.max(boomLength, gb.boomMin), st.q);
  return gb.maxCapacityT * rf * lf;
}

/**
 * Toegestane last (t) volgens het lastdiagram voor de huidige configuratie en zwenkhoek.
 * Inclusief haakblok, zoals een lastmomentbegrenzer rekent.
 */
export function allowedCapacityT(spec: ResolvedCrane, s: CraneState, radiusOverride?: number): number {
  const g = computeGeometry(spec, s);
  const radius = radiusOverride ?? g.radius;
  const gb = spec.gb;
  if (gb.setupType !== 'none' && gb.setupType !== 'outriggers' && s.setupProgress < 1) return 0;
  const structural = structuralCapacityT(spec, radius, g.displayBoomLength);
  if (gb.anchored) {
    if (spec.cfg.kind === 'tower' && radius < (gb.trolleyMin ?? 0) - 0.01) return 0;
    return structural;
  }
  const sup = supportState(spec, s);
  if (sup.mode === 'tires' && !gb.liftOnTires) return 0;
  const boomCog = radiusOverride !== undefined ? g.boomCogRadius * (radius / Math.max(0.1, g.radius)) : g.boomCogRadius;
  // zwenkzone-afhankelijk (zoals een moderne LMI): over voor/achter meer capaciteit dan over de zijkant
  const tip = tippingLoadT(stabilityMasses(spec, s), sup.footprint, s.slew, radius, g.boomMassT, boomCog);
  const stability = tip * CHART_TIPPING_FRACTION;
  let cap = Math.min(structural, stability);
  // op banden (niet rupsen): extra reductie voor bandenvering en dynamiek
  if (sup.mode === 'tires' && spec.cfg.carrier !== 'crawler') cap *= 0.75;
  return Math.max(0, cap);
}

export interface ChartOptions {
  counterweightIndex: number;
  jibIndex?: number;
  support: 'outriggers' | 'tires';
}

/**
 * Genereer een lastdiagram (tabel) uit hetzelfde model dat de lastmomentbegrenzer gebruikt.
 * Rijen = gieklengtes (telescoop) of opties (vakwerk), kolommen = stralen.
 */
export function generateLoadChart(spec: ResolvedCrane, base: CraneState, opt: ChartOptions): LoadChart {
  const gb = spec.gb;
  const s: CraneState = {
    ...base,
    counterweightIndex: opt.counterweightIndex,
    jibIndex: opt.jibIndex ?? base.jibIndex,
    outriggerBeam: base.outriggerBeam.map(() => (opt.support === 'outriggers' ? 1 : 0)),
    outriggerJack: base.outriggerJack.map(() => (opt.support === 'outriggers' ? 1 : 0)),
    setupProgress: 1,
    tilt: 0,
    slew: 0,
  };
  const kind = spec.cfg.kind;
  let lengths: number[];
  if (kind === 'tower') lengths = [gb.jibLength ?? 0];
  else if (kind === 'knuckle') lengths = [0, (gb.knuckleTeleMax ?? 0) / 2, gb.knuckleTeleMax ?? 0];
  else if (kind === 'lattice') lengths = spec.boomOptions;
  else {
    const n = 5;
    lengths = Array.from({ length: n }, (_, i) => Math.round(lerp(gb.boomMin, gb.boomMax, i / (n - 1)) * 10) / 10);
  }
  const maxR = kind === 'tower' ? gb.jibLength ?? 0 : kind === 'knuckle' ? (gb.arm1Length ?? 0) + (gb.arm2Length ?? 0) + (gb.knuckleTeleMax ?? 0) : gb.boomMax + gb.pivotU;
  const minR = kind === 'tower' ? gb.trolleyMin ?? 2 : gb.structural.minRadius;
  const nR = 9;
  const radii = Array.from({ length: nR }, (_, i) => Math.round(lerp(minR, maxR * 0.95, i / (nR - 1)) * 2) / 2);
  const capacity = lengths.map((L) => {
    const st: CraneState = { ...s };
    if (kind === 'knuckle') st.knuckleTele = L;
    else if (kind !== 'tower') st.boomLength = L;
    return radii.map((R) => {
      if (kind === 'telescopic' || kind === 'lattice') {
        // reikwijdte: tip kan straal R alleen halen als L·cos(minHoek) ≥ R − pivotU en R ≥ L·cos(maxHoek)
        const fullL = L + (kind === 'lattice' ? spec.jibOptions[st.jibIndex] ?? 0 : 0);
        const maxReach = gb.pivotU + fullL * Math.cos(Math.max(0, gb.boomAngleMinDeg) * DEG);
        const minReach = gb.pivotU + fullL * Math.cos(gb.boomAngleMaxDeg * DEG);
        if (R > maxReach + 0.01 || R < minReach - 0.5) return null;
        // giekhoek bij deze straal voor het giekzwaartepunt
        const c = clamp((R - gb.pivotU) / fullL, -1, 1);
        st.boomAngle = Math.acos(c);
      }
      const v = allowedCapacityT(spec, st, R);
      return v > 0.05 ? Math.round(v * 10) / 10 : null;
    });
  });
  return { boomLengths: lengths, radii, capacity };
}
