/**
 * Vormgeving van analoge invoer: dode zone, responscurve en het geleidelijk oplopen van een
 * toetsenbordtoets. Pure functies (getest in tests/unit/input.test.ts).
 */

export interface AnalogSettings {
  /** Dode zone van een stick (0..0,4): kleine uitslagen doen niets. */
  deadzone: number;
  /** Exponent van de responscurve: 1 = lineair, 2–3 = fijn rond het midden, vol aan het eind. */
  curve: number;
  /** Tijd (s) waarin een vastgehouden toets van de minimale naar de volle snelheid oploopt (0 = direct vol). */
  keyRamp: number;
  /** Hijsas omkeren (stick naar voren = vieren). */
  invertHoist: boolean;
}

export const defaultAnalog = (): AnalogSettings => ({ deadzone: 0.12, curve: 2, keyRamp: 1.0, invertHoist: false });

/** Minimale snelheid van een kort aangetikte toets (fractie van vol). */
export const KEY_MIN = 0.15;

/** Dode zone met herschaling: net buiten de dode zone begint de uitslag weer bij 0. */
export function applyDeadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return (Math.sign(v) * (a - dz)) / Math.max(1e-6, 1 - dz);
}

/** Responscurve: behoudt teken, 0 → 0 en 1 → 1. */
export function shape(v: number, exponent: number): number {
  return Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), Math.max(1, exponent));
}

/** Stick → commando: dode zone, dan curve. */
export function stickToCommand(v: number, s: AnalogSettings): number {
  return shape(applyDeadzone(v, s.deadzone), s.curve);
}

/**
 * Oplopende toets: `held` is hoe lang (s) de toets al vastgehouden wordt.
 * Kort tikken geeft KEY_MIN, na `keyRamp` seconden volle snelheid (zachte S-curve ertussen).
 */
export function keyRampLevel(held: number, keyRamp: number): number {
  if (keyRamp <= 0) return 1;
  const t = Math.min(1, held / keyRamp);
  const smooth = t * t * (3 - 2 * t);
  return KEY_MIN + (1 - KEY_MIN) * smooth;
}
