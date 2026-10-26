import type { GroundType } from '../ground';
import type { StabilityMasses } from './stability';

/**
 * Bodemdruk onder de stempels. De kraan staat als een stijve plaat op vier steunpunten:
 * de stempelkracht volgt uit het totale gewicht en de ligging van het gezamenlijke zwaartepunt
 * (F_i = W/4 · (1 + e_x·x_i/a² + e_z·z_i/b²)). Druk = kracht / oppervlak van plaat of kraanmat.
 * Toelaatbare bodemdruk per ondergrond (t/m²) zijn gangbare richtwaarden, geschaald met de kwaliteit.
 */

/** Toelaatbare bodemdruk (t/m²) bij kwaliteit 1. */
export const BEARING: Record<GroundType, number> = {
  concrete: 45,
  quay: 40,
  floor: 30,
  asphalt: 22,
  gravel: 18,
  sand: 12,
  grass: 9,
  mud: 4,
};

export type MatId = 'none' | 'timber' | 'large';

export interface MatOption {
  id: MatId;
  /** Maat ten opzichte van de standaardmat van deze kraan (0 = alleen de stempelplaat). */
  factor: number;
}

export const MATS: MatOption[] = [
  { id: 'none', factor: 0 },
  { id: 'timber', factor: 1 },
  { id: 'large', factor: 1.6 },
];

/** Zijde van de standaardmat (m): 1,2 m bij een kraan van 60 t, groter bij zwaardere kranen. */
export const standardMatSide = (maxCapacityT: number): number => Math.min(5, Math.max(1.2, 1.2 * Math.sqrt(maxCapacityT / 60)));

/** Zijde van de gekozen mat (m), 0 = geen. */
export const matSide = (maxCapacityT: number, mat: MatId): number => (MATS.find((m) => m.id === mat)?.factor ?? 0) * standardMatSide(maxCapacityT);

const nl = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',');
export function matLabel(maxCapacityT: number, mat: MatId): string {
  const s = matSide(maxCapacityT, mat);
  if (s === 0) return 'alleen stempelplaten';
  return `${mat === 'large' ? 'grote kraanmatten' : 'kraanmatten'} ${nl(s)} × ${nl(s)} m`;
}

/** Zijde van de standaard stempelplaat (m), groeit mee met de kraan. */
export const padSide = (maxCapacityT: number): number => Math.min(1.2, Math.max(0.5, 0.5 + 0.004 * maxCapacityT));

/** Draagoppervlak per stempel (m²): de grootste van plaat en mat. */
export function bearingArea(maxCapacityT: number, mat: MatId): number {
  const side = Math.max(padSide(maxCapacityT), matSide(maxCapacityT, mat));
  return side * side;
}

/** Toelaatbare druk (t/m²) voor een ondergrond met kwaliteit 0..1. */
export const allowedPressure = (type: GroundType, quality: number): number => BEARING[type] * Math.max(0.3, Math.min(1, quality));

export interface PadLoadInput {
  masses: StabilityMasses;
  /** Draaihoek (rad); de giek wijst langs (cos, sin). */
  slew: number;
  boomT: number;
  boomCogRadius: number;
  /** Last aan de haak (t) op de giekstraal. */
  loadT: number;
  tipRadius: number;
  /** Halve lengte en breedte van het stempelvlak (m). */
  a: number;
  b: number;
}

/**
 * Kracht per stempel (t), in dezelfde volgorde als outriggerPad: 0 = voor links, 1 = voor rechts,
 * 2 = achter links, 3 = achter rechts (voor = +x, links = −z).
 */
export function padLoadsT(p: PadLoadInput): number[] {
  const m = p.masses;
  const c = Math.cos(p.slew);
  const s = Math.sin(p.slew);
  // afstand langs de giekrichting van elk deel (achter de draaias = negatief)
  const parts: [number, number][] = [
    [m.carrierT, 0],
    [m.superT, -m.superBehind],
    [m.counterweightT, -m.cwRadius],
    [p.boomT, p.boomCogRadius],
    [p.loadT, p.tipRadius],
  ];
  let W = 0;
  let r = 0;
  for (const [t, d] of parts) {
    W += t;
    r += t * d;
  }
  if (W <= 0) return [0, 0, 0, 0];
  r /= W;
  const ex = r * c;
  const ez = r * s;
  const pads: [number, number][] = [
    [p.a, -p.b],
    [p.a, p.b],
    [-p.a, -p.b],
    [-p.a, p.b],
  ];
  return pads.map(([x, z]) => Math.max(0, (W / 4) * (1 + (ex * x) / (p.a * p.a) + (ez * z) / (p.b * p.b))));
}
