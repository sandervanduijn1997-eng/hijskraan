import { clamp } from '../../utils/math';

/** Meetwaarden die tijdens een missie worden verzameld. */
export interface ScoreMetrics {
  time: number;
  parTime: number;
  maxLoadPct: number;
  /** Tijd (s) boven 100 % belasting. */
  overloadTime: number;
  /** Ernstige veiligheidsovertredingen (hijsen zonder stempels, slechte ondergrond, ...). */
  safetyViolations: number;
  /** Tijd (s) met kritieke waarschuwingen actief. */
  criticalWarningTime: number;
  /** Plaatsingsfout per levering, genormaliseerd (0 = perfect, 1 = rand van de tolerantie). */
  placementErrors: number[];
  maxSwayDeg: number;
  collisions: number;
  damage: number;
  /** Hoogste belasting tijdens een stabiele hijs (%) — maat voor configuratiekeuze. */
  peakLiftPct: number;
  fuelUsed: number;
  fuelPar: number;
}

export const emptyMetrics = (parTime: number, fuelPar: number): ScoreMetrics => ({
  time: 0,
  parTime,
  maxLoadPct: 0,
  overloadTime: 0,
  safetyViolations: 0,
  criticalWarningTime: 0,
  placementErrors: [],
  maxSwayDeg: 0,
  collisions: 0,
  damage: 0,
  peakLiftPct: 0,
  fuelUsed: 0,
  fuelPar,
});

export interface ScoreBreakdown {
  safety: number;
  precision: number;
  time: number;
  sway: number;
  collisions: number;
  damage: number;
  config: number;
  efficiency: number;
  total: number;
  stars: 0 | 1 | 2 | 3;
}

export const SCORE_WEIGHTS = {
  safety: 0.25,
  precision: 0.2,
  time: 0.1,
  sway: 0.1,
  collisions: 0.1,
  damage: 0.1,
  config: 0.075,
  efficiency: 0.075,
} as const;

export const SCORE_LABELS: Record<keyof typeof SCORE_WEIGHTS, string> = {
  safety: 'Veiligheid',
  precision: 'Precisie',
  time: 'Tijd',
  sway: 'Slingering',
  collisions: 'Botsingen',
  damage: 'Schade',
  config: 'Configuratiekeuze',
  efficiency: 'Efficiëntie',
};

export function computeScore(m: ScoreMetrics, success: boolean): ScoreBreakdown {
  const safety = clamp(100 - m.overloadTime * 20 - m.safetyViolations * 35 - Math.max(0, m.maxLoadPct - 90) * 2 - m.criticalWarningTime * 1.5, 0, 100);
  const avgErr = m.placementErrors.length ? m.placementErrors.reduce((a, b) => a + b, 0) / m.placementErrors.length : 1;
  const precision = clamp(100 * (1 - avgErr * 0.8), 0, 100);
  // snelheid telt alleen mee naar rato van de veiligheid
  const rawTime = clamp(100 * (2 - m.time / Math.max(1, m.parTime)), 0, 100);
  const time = rawTime * (safety / 100);
  const sway = clamp(100 - Math.max(0, m.maxSwayDeg - 2) * 10, 0, 100);
  const collisions = clamp(100 - m.collisions * 34, 0, 100);
  const damage = clamp(100 - m.damage * 4, 0, 100);
  let config: number;
  if (m.peakLiftPct <= 0) config = 80;
  else if (m.peakLiftPct < 40) config = 60 + m.peakLiftPct;
  else if (m.peakLiftPct <= 92) config = 100;
  else config = clamp(100 - (m.peakLiftPct - 92) * 5, 0, 100);
  const fr = m.fuelPar > 0 ? m.fuelUsed / m.fuelPar : 1;
  const efficiency = clamp(fr <= 1 ? 100 : 100 - (fr - 1) * 60, 0, 100);
  const W = SCORE_WEIGHTS;
  const total =
    safety * W.safety +
    precision * W.precision +
    time * W.time +
    sway * W.sway +
    collisions * W.collisions +
    damage * W.damage +
    config * W.config +
    efficiency * W.efficiency;
  let stars: 0 | 1 | 2 | 3 = 0;
  if (success) {
    if (total >= 85 && m.collisions === 0 && m.damage < 3 && safety >= 85 && m.maxSwayDeg <= 6) stars = 3;
    else if (total >= 65 && safety >= 50) stars = 2;
    else stars = 1;
  }
  return { safety, precision, time, sway, collisions, damage, config, efficiency, total: Math.round(total), stars };
}
