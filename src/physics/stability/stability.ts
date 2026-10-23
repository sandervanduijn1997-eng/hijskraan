import { GRAVITY } from '../constants';

/**
 * Stabiliteitsmodel (kantelmoment) voor mobiele kranen, rupskranen en knikarmkranen.
 *
 * Alle momenten worden genomen rond de kantellijn van het steunvlak in de richting van de last.
 * Het steunvlak is een rechthoek rond de draaikrans: halve lengte `a` (langs het chassis, x) en
 * halve breedte `b` (diepte, z). Bij draaihoek φ ligt de kantellijn op afstand e(φ) = min(a/|cos φ|, b/|sin φ|).
 *
 * Kantelfactor K = (M_last + M_giek + M_wind + M_helling) / (M_stabiel · ondergrondfactor).
 * K ≥ 1 betekent kantelen. Het lastdiagram wordt uit hetzelfde model afgeleid met 75 % van de
 * kantellast (gebruikelijke veiligheidsmarge voor kranen op stempels) — zie docs/PHYSICS.md.
 */
export interface Footprint {
  /** Halve lengte langs het chassis (m). */
  a: number;
  /** Halve breedte (m). */
  b: number;
}

export interface StabilityMasses {
  /** Onderwagen incl. stempels, zwaartepunt op de draaias (t). */
  carrierT: number;
  /** Bovenwagen zonder contragewicht (t), zwaartepunt `superBehind` m achter de draaias. */
  superT: number;
  superBehind: number;
  /** Actueel contragewicht (t) op straal `cwRadius` achter de draaias. */
  counterweightT: number;
  cwRadius: number;
}

export interface StabilityInput {
  masses: StabilityMasses;
  footprint: Footprint;
  /** Draaihoek bovenwagen t.o.v. het chassis (rad). */
  slew: number;
  /** Horizontale afstand draaias → giekkop (m). */
  tipRadius: number;
  /** Hoogte giekkop boven het steunvlak (m). */
  tipHeight: number;
  /** Giekmassa (t) en horizontale afstand van het giekzwaartepunt tot de draaias. */
  boomT: number;
  boomCogRadius: number;
  /** Kabelkracht (N) en kabelhoek t.o.v. verticaal in de giekrichting (rad, positief = naar buiten). */
  ropeTension: number;
  ropeOutwardAngle: number;
  /** Ondergrondfactor 0..1 (1 = vaste ondergrond). */
  groundFactor: number;
  /** Hellingshoek chassis richting de last (rad). */
  slope: number;
  /** Extra kantelmoment door wind op giek en last (N·m). */
  windMoment: number;
}

export interface StabilityResult {
  tippingDistance: number;
  overturningMoment: number;
  stabilizingMoment: number;
  /** K: 1 = kantelgrens. */
  tippingRatio: number;
}

export function tippingDistance(fp: Footprint, slew: number): number {
  const c = Math.abs(Math.cos(slew));
  const s = Math.abs(Math.sin(slew));
  const ea = c > 1e-6 ? fp.a / c : Infinity;
  const eb = s > 1e-6 ? fp.b / s : Infinity;
  return Math.min(ea, eb);
}

export function stabilizingMoment(m: StabilityMasses, e: number): number {
  return GRAVITY * 1000 * (m.carrierT * e + m.superT * (e + m.superBehind) + m.counterweightT * (e + m.cwRadius));
}

export function computeStability(inp: StabilityInput): StabilityResult {
  const e = tippingDistance(inp.footprint, inp.slew);
  const fv = inp.ropeTension * Math.cos(inp.ropeOutwardAngle);
  const fh = inp.ropeTension * Math.sin(inp.ropeOutwardAngle);
  const mLoad = fv * (inp.tipRadius - e) + fh * inp.tipHeight;
  const mBoom = inp.boomT * 1000 * GRAVITY * (inp.boomCogRadius - e);
  const mSlope = (fv + inp.boomT * 1000 * GRAVITY) * inp.tipHeight * Math.sin(Math.max(0, inp.slope));
  const over = mLoad + mBoom + mSlope + inp.windMoment;
  const stab = stabilizingMoment(inp.masses, e) * Math.max(0.05, inp.groundFactor);
  return { tippingDistance: e, overturningMoment: over, stabilizingMoment: stab, tippingRatio: over / stab };
}

/**
 * Kantellast (t) op de gegeven straal bij stilhangende last op vaste, vlakke ondergrond.
 */
export function tippingLoadT(m: StabilityMasses, fp: Footprint, slew: number, radius: number, boomT: number, boomCogRadius: number): number {
  const e = tippingDistance(fp, slew);
  const arm = radius - e;
  const net = stabilizingMoment(m, e) - boomT * 1000 * GRAVITY * (boomCogRadius - e);
  if (arm <= 0.05) return Infinity;
  return Math.max(0, net / (GRAVITY * 1000 * arm));
}

/** Fractie van de kantellast die het lastdiagram toestaat. */
export const CHART_TIPPING_FRACTION = 0.75;
