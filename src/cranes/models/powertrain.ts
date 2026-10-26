import { clamp } from '../../utils/math';
import type { ResolvedCrane } from './craneSpec';
import type { Axis } from './craneState';

/**
 * Aandrijving van een mobiele kraan: dieselmotor met toerentalregeling en één hydraulische pomp
 * waarvan de opbrengst meegroeit met het toerental. Bewegingen delen de oliestroom: wie tegelijk
 * hijst, de giek bedient en zwenkt, krijgt per beweging minder olie. Zwaar hijsen drukt het toerental.
 * Torenkranen zijn elektrisch: aparte aandrijvingen per beweging, geen gedeelde oliestroom.
 */

export const ENGINE = {
  /** Stationair en maximaal toerental (tpm). */
  idle: 750,
  max: 1900,
  /** Tijdconstante van het toerental (s). */
  tau: 0.7,
  /** Pompopbrengst bij maximaal toerental, in "volle bewegingen" (1 = één beweging op volle snelheid). */
  pumpCapacity: 1.6,
  /** Hoeveel het toerental onder volle hijslast inzakt (fractie van het regelbereik). */
  lug: 0.15,
  /** Werktoerental (handgas) bij een last aan de haak of vlak na een beweging. */
  work: 1200,
  /** Hoe lang (s) het werktoerental na de laatste beweging blijft staan. */
  workHold: 4,
} as const;

/** Oliebehoefte per beweging bij volle uitslag (relatief, hijsen = 1). */
export const FLOW_WEIGHT: Partial<Record<Axis, number>> = { hoist: 1, luff: 0.8, tele: 0.7, slew: 0.5, knuckle: 0.6, knuckleTele: 0.4 };

export const isElectric = (spec: ResolvedCrane): boolean => spec.cfg.kind === 'tower';

/** Totale oliebehoefte voor de gevraagde bewegingen. */
export function hydraulicDemand(commands: Partial<Record<Axis, number>>): number {
  let d = 0;
  for (const [axis, w] of Object.entries(FLOW_WEIGHT) as [Axis, number][]) d += w * Math.min(1, Math.abs(commands[axis] ?? 0));
  return d;
}

/** Pompopbrengst bij een toerental (in dezelfde eenheid als de vraag). */
export function pumpFlow(rpm: number): number {
  const lo = ENGINE.idle * 0.3;
  return clamp((rpm - lo) / (ENGINE.max - lo), 0, 1) * ENGINE.pumpCapacity;
}

/** Gewenst toerental: automatische gasregeling op de vraag, minus het inzakken onder hijslast. */
export function targetRpm(demand: number, loadPct: number, hoistingUp: boolean, working = false): number {
  const range = ENGINE.max - ENGINE.idle;
  const lug = hoistingUp ? ENGINE.lug * range * clamp(loadPct / 100, 0, 1) : 0;
  const base = Math.max(ENGINE.idle + range * clamp(demand * 1.1, 0, 1), working ? ENGINE.work : 0);
  return base - lug;
}

/** Eén stap van het toerental. */
export function stepRpm(rpm: number, target: number, dt: number): number {
  return rpm + (target - rpm) * (1 - Math.exp(-dt / ENGINE.tau));
}

/** Fractie van de gevraagde snelheid die elke hydraulische beweging krijgt (gedeelde oliestroom). */
export function flowScale(demand: number, rpm: number): number {
  if (demand <= 1e-6) return 1;
  return clamp(pumpFlow(rpm) / demand, 0, 1);
}

/** Systeemdruk (bar) voor HUD en geluid: hoger bij zware last en veel bewegingen. */
export function systemPressure(loadPct: number, demand: number, hoisting: boolean): number {
  return Math.round(35 + 250 * clamp(loadPct / 100, 0, 1.2) * (hoisting ? 1 : 0.55) + 25 * Math.min(2, demand));
}
