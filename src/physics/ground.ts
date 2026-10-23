export type GroundType = 'asphalt' | 'concrete' | 'gravel' | 'sand' | 'mud' | 'grass' | 'quay' | 'floor';

/** Ondergrondzone langs x. Kwaliteit 0..1 bepaalt de stabiliteitsfactor van stempels/banden. */
export interface GroundZone {
  x0: number;
  x1: number;
  type: GroundType;
  quality: number;
}

export interface GroundInfo {
  type: GroundType;
  quality: number;
  /** Snelheidsfactor bij rijden (0..1). */
  driveFactor: number;
}

const DRIVE: Record<GroundType, number> = {
  asphalt: 1,
  concrete: 1,
  quay: 1,
  floor: 1,
  gravel: 0.8,
  grass: 0.75,
  sand: 0.6,
  mud: 0.4,
};

export const GROUND_LABEL: Record<GroundType, string> = {
  asphalt: 'asfalt',
  concrete: 'beton',
  quay: 'kade',
  floor: 'hallenvloer',
  gravel: 'grind',
  grass: 'gras',
  sand: 'zand',
  mud: 'modder',
};

export function groundAt(zones: readonly GroundZone[], x: number, fallback: GroundType = 'asphalt'): GroundInfo {
  for (const z of zones) {
    if (x >= z.x0 && x < z.x1) return { type: z.type, quality: z.quality, driveFactor: DRIVE[z.type] };
  }
  return { type: fallback, quality: 1, driveFactor: DRIVE[fallback] };
}

/** Ondergrondfactor voor het hele steunvlak: de slechtste plek onder de steunpunten telt. */
export function groundFactorFor(zones: readonly GroundZone[], xs: readonly number[], bonus: number, fallback: GroundType = 'asphalt'): number {
  let q = 1;
  for (const x of xs) q = Math.min(q, groundAt(zones, x, fallback).quality);
  return Math.min(1, q + bonus);
}
