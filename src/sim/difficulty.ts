export type DifficultyId = 'practice' | 'normal' | 'realistic';

export interface DifficultyProfile {
  id: DifficultyId;
  label: string;
  description: string;
  /** Slingerdemping (1/s). Hoger = rustiger last. */
  swayDamping: number;
  windScale: number;
  /** Kan de kraan kantelen? */
  tipping: boolean;
  damageScale: number;
  /** Telt de tijdslimiet? */
  timer: boolean;
  /** Overbelasting > 110 % gedurende 1,5 s = mislukt. */
  overloadFail: boolean;
  /** Hijsen zonder vereiste stempels = mislukt (i.p.v. alleen strafpunten). */
  strictOutriggers: boolean;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyProfile> = {
  practice: {
    id: 'practice',
    label: 'Oefenen',
    description: 'Extra slingerdemping, halve wind, de kraan kantelt niet en schade telt half. Geen tijdsdruk.',
    swayDamping: 0.45,
    windScale: 0.5,
    tipping: false,
    damageScale: 0.5,
    timer: false,
    overloadFail: false,
    strictOutriggers: false,
  },
  normal: {
    id: 'normal',
    label: 'Normaal',
    description: 'Gebalanceerde fysica. De lastmomentbegrenzer beschermt je, maar dynamische overbelasting kan de kraan laten kantelen.',
    swayDamping: 0.25,
    windScale: 1,
    tipping: true,
    damageScale: 1,
    timer: true,
    overloadFail: false,
    strictOutriggers: false,
  },
  realistic: {
    id: 'realistic',
    label: 'Realistisch',
    description: 'Minimale demping, iets hardere wind en strikte veiligheidsregels: overbelasting of hijsen zonder stempels beëindigt de opdracht.',
    swayDamping: 0.06,
    windScale: 1.2,
    tipping: true,
    damageScale: 1.25,
    timer: true,
    overloadFail: true,
    strictOutriggers: true,
  },
};
