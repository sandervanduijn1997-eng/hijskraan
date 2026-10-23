/**
 * Abstracte besturingsinvoer voor een kraan (bron-onafhankelijk: toetsenbord, muis, later controller).
 * Assen in [-1, 1]. Positief: giek omhoog, rechtsom draaien, hijsen (kabel korter), uitschuiven,
 * loopkat naar buiten, knikarm omhoog, rijden naar rechts.
 */
export interface CraneInput {
  luff: number;
  slew: number;
  hoist: number;
  tele: number;
  trolley: number;
  knuckle: number;
  knuckleTele: number;
  drive: number;
  precision: boolean;
  /** Stempelbediening: -1 = automatische procedure, 0..3 = individuele stempel, null = geen. */
  outriggerTarget: number | null;
  outriggerBeam: number;
  outriggerJack: number;
  /** Automatische stempelprocedure (uitzetten/inhalen) starten — flank. */
  outriggerAuto: boolean;
  /** Opbouwprocedure (zelfopbouw / giekmontage) vasthouden om voort te zetten. */
  setupHold: boolean;
}

export const emptyInput = (): CraneInput => ({
  luff: 0,
  slew: 0,
  hoist: 0,
  tele: 0,
  trolley: 0,
  knuckle: 0,
  knuckleTele: 0,
  drive: 0,
  precision: false,
  outriggerTarget: null,
  outriggerBeam: 0,
  outriggerJack: 0,
  outriggerAuto: false,
  setupHold: false,
});
