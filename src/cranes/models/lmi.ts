import type { ResolvedCrane } from './craneSpec';
import type { CraneState } from './craneState';
import { allowedCapacityT, supportState } from './capacity';

/**
 * Instelling van de lastmomentbegrenzer, zoals een machinist die in de cabine invoert:
 * opstelling, contragewicht, aantal kabelparten (schijvenstel) en hulpgiek. De begrenzer rekent
 * met deze invoer, niet met de werkelijkheid: een verkeerde invoer geeft een verkeerd lastdiagram.
 */
export type LmiSetup = 'outriggers' | 'partial' | 'tires';

export interface LmiConfig {
  configured: boolean;
  setup: LmiSetup;
  counterweightIndex: number;
  parts: number;
  jibIndex: number;
}

export const LMI_SETUP_LABEL: Record<LmiSetup, string> = { outriggers: 'Stempels 100 %', partial: 'Stempels 50 %', tires: 'Op banden/rupsen' };

/** Heeft deze kraan een in te stellen begrenzer? (Torenkranen en zelfopbouwers: vaste instelling.) */
export const hasLmiSetup = (spec: ResolvedCrane): boolean => !spec.gb.anchored && spec.cfg.kind !== 'tower';

/** Maximaal aantal kabelparten (schijven in het haakblok), volgt de grootte van het haakblok. */
export function maxParts(spec: ResolvedCrane): number {
  const m = spec.gb.hookMassKg;
  return m > 3000 ? 8 : m > 400 ? 4 : 2;
}

/** Mogelijke schijvensteloverzichten voor de invoer. */
export function partOptions(spec: ResolvedCrane): number[] {
  const max = maxParts(spec);
  return [1, 2, 4, 6, 8].filter((p) => p <= max);
}

/** Maximale trekkracht per kabelpart (t). */
export const linePullT = (spec: ResolvedCrane): number => spec.gb.maxCapacityT / maxParts(spec);

/** Grens door het schijvenstel: parten × trekkracht per part. */
export const reevingCapacityT = (spec: ResolvedCrane, parts: number): number => linePullT(spec) * parts;

/** Opstelling volgens de werkelijke stempelstand. */
export function actualSetup(spec: ResolvedCrane, s: CraneState): LmiSetup {
  const m = supportState(spec, s).mode;
  if (m === 'outriggers') return 'outriggers';
  if (m === 'partial') return 'partial';
  return 'tires';
}

/** Een virtuele kraantoestand zoals de begrenzer hem ziet (volgens de invoer). */
function lmiView(s: CraneState, cfg: LmiConfig): CraneState {
  const beam = cfg.setup === 'outriggers' ? 1 : cfg.setup === 'partial' ? 0.5 : 0;
  const jack = cfg.setup === 'tires' ? 0 : 1;
  return { ...s, counterweightIndex: cfg.counterweightIndex, jibIndex: cfg.jibIndex, outriggerBeam: s.outriggerBeam.map(() => beam), outriggerJack: s.outriggerJack.map(() => jack) };
}

/** Toelaatbare last volgens de begrenzer (t). Niet ingesteld = 0 (geen hijs mogelijk). */
export function lmiCapacityT(spec: ResolvedCrane, s: CraneState, cfg: LmiConfig): number {
  if (!cfg.configured) return 0;
  return Math.min(allowedCapacityT(spec, lmiView(s, cfg)), reevingCapacityT(spec, cfg.parts));
}

/** Werkelijk veilige last (t): werkelijke opstelling en het werkelijke schijvenstel. */
export function actualCapacityT(spec: ResolvedCrane, s: CraneState, parts: number): number {
  return Math.min(allowedCapacityT(spec, s), reevingCapacityT(spec, parts));
}

/** Waarin de invoer afwijkt van de werkelijkheid (leeg = klopt). */
export function lmiMismatch(spec: ResolvedCrane, s: CraneState, cfg: LmiConfig, actualParts: number): string[] {
  if (!cfg.configured) return [];
  const out: string[] = [];
  const setup = actualSetup(spec, s);
  if (setup !== cfg.setup) out.push(`opstelling (ingevoerd: ${LMI_SETUP_LABEL[cfg.setup].toLowerCase()}, werkelijk: ${LMI_SETUP_LABEL[setup].toLowerCase()})`);
  if (cfg.counterweightIndex !== s.counterweightIndex) out.push('contragewicht');
  if (cfg.parts !== actualParts) out.push(`schijvenstel (${cfg.parts} i.p.v. ${actualParts} parten)`);
  if (cfg.jibIndex !== s.jibIndex) out.push('hulpgiek');
  return out;
}

/** Een correcte, volledig ingestelde begrenzer voor de huidige toestand (voor tests, bot en oefenen). */
export function autoLmi(spec: ResolvedCrane, s: CraneState, parts: number, setup: LmiSetup = 'outriggers'): LmiConfig {
  return { configured: true, setup: spec.gb.outriggerCount > 0 && !spec.gb.liftOnTires ? setup : actualSetup(spec, s), counterweightIndex: s.counterweightIndex, parts, jibIndex: s.jibIndex };
}
