import type { Rect } from './geometry';

export type ColliderKind =
  | 'ground'
  | 'building'
  | 'wall'
  | 'roof'
  | 'scaffold'
  | 'truck'
  | 'platform'
  | 'support'
  | 'pipe'
  | 'machine'
  | 'container'
  | 'fence'
  | 'ceiling'
  | 'tower'
  | 'ship'
  | 'barrier'
  | 'crane'
  /** Gevarenzone zonder fysiek lichaam (veiligheidsafstand tot een hoogspanningslijn, werkvak, spoor): binnengaan is een overtreding. */
  | 'hazard';

/** Gevolg van een botsing met dit object. */
export type HitPolicy = 'none' | 'damage' | 'fail';

/** Statisch botsingsobject (AABB in xy met een diepte-bereik in z). */
export interface Collider extends Rect {
  id: string;
  kind: ColliderKind;
  minZ: number;
  maxZ: number;
  onHit: HitPolicy;
  /** Mogen lasten hier op worden neergezet zonder dat het als botsing telt? */
  landable: boolean;
  label?: string;
}

export const GROUND_ID = 'ground';
