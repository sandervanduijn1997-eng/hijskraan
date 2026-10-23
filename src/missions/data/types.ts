import type { CraneId, LicenseId } from '../../cranes/config/types';
import type { CraneStartConfig } from '../../cranes/models/craneState';
import type { ColliderKind, HitPolicy } from '../../physics/collision/colliders';
import type { GroundType, GroundZone } from '../../physics/ground';
import type { WindDef } from '../../physics/wind';

export type EnvironmentId =
  | 'trainingYard'
  | 'constructionSite'
  | 'cityCenter'
  | 'highrise'
  | 'factory'
  | 'roughTerrain'
  | 'riverBridge'
  | 'port'
  | 'industrialPlant'
  | 'windFarm';

export type TimeOfDay = 'morning' | 'day' | 'dusk' | 'overcast' | 'night';
export type Weather = 'clear' | 'cloudy' | 'rain' | 'fog';

/** Obstakel in de missie. Positie = linkeronderhoek (x, y), afmetingen in m. */
export interface ObstacleDef {
  id: string;
  kind: ColliderKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Diepte-bereik (z). Standaard: vol (−40..40). */
  z0?: number;
  z1?: number;
  onHit?: HitPolicy;
  landable?: boolean;
  label?: string;
  /** Visuele stijl (bijv. 'brick', 'glass', 'steel', 'truck', 'tank'). */
  style?: string;
}

/** Doelzone: de onderkant van de last moet op hoogte `y` rusten, gecentreerd rond `x`. */
export interface ZoneDef {
  id: string;
  label: string;
  x: number;
  y: number;
  /** Diepte van het zonemidden (m), standaard 0. */
  z?: number;
  /** Toegestane afwijking van het midden (m). */
  tolerance: number;
  /** Toegestane hoogteafwijking (m) — vooral voor delen die in de lucht worden vastgehouden. */
  yTolerance?: number;
  /** Toegestane z-afwijking (m). */
  zTolerance?: number;
  /** Doeloriëntatie (graden) en toegestane hoekafwijking. */
  angleDeg?: number;
  angleTolDeg?: number;
  /** Zone-breedte voor de weergave (standaard 2 × tolerance + lastbreedte). */
  displayWidth?: number;
}

export interface LoadSpawn {
  id: string;
  type: string;
  x: number;
  /** Onderkant van de last. */
  y: number;
  z?: number;
  angleDeg?: number;
  /** Al aangeslagen bij de start. */
  attached?: boolean;
}

/** Onderdelen van een torenkraan die met de hulpkraan worden gemonteerd. */
export type TowerPartKind = 'mast' | 'slewingUnit' | 'towerHead' | 'counterJib' | 'jib' | 'ballast';

/** Effect na het neerzetten van een last (bijv. contragewicht monteren, torenkraandeel inbouwen). */
export type PlaceEffect =
  | { type: 'addCounterweight'; massT: number; consume: boolean }
  | { type: 'consume' }
  | { type: 'towerPart'; part: TowerPartKind };

export type TaskDef =
  | {
      type: 'deliver';
      loadId: string;
      zoneId: string;
      label?: string;
      effect?: PlaceEffect;
      /** Alleen deze taak is actief tot hij klaar is (vaste montagevolgorde). */
      inOrder?: boolean;
      /** De last moet aan de haak stil in positie worden gehouden (monteurs pinnen hem vast); geen ondergrond nodig. */
      hold?: number;
    }
  | { type: 'drive'; x0: number; x1: number; label: string }
  | { type: 'outriggers'; label?: string }
  | { type: 'setup'; label?: string }
  | { type: 'stow'; label?: string }
  /** Overstappen van de hulpkraan naar de (gemonteerde) missiekraan. */
  | { type: 'switchCrane'; label?: string };

/** Montage van een torenkraan met een mobiele hulpkraan die de speler zelf bedient. */
export interface TowerAssemblyDef {
  /** De hulpkraan (wordt door de missie geleverd, niet gehuurd). */
  assistCrane: CraneId;
  assist: CraneStartConfig;
  /** Draairichting van de giek tijdens de montage (graden; 180 = giek naar −x). */
  erectSlewDeg: number;
  /** Mastsecties die vóór de start al op de fundering staan. */
  preinstalledSections: number;
}

export interface MissionRequirements {
  /** Stempels volledig uitgezet vereist voordat er gehesen wordt. */
  outriggers?: boolean;
  /** Maximale belasting in % (standaard 100). */
  maxLoadPercent?: number;
  /** Elke botsing met een obstakel is een mislukking. */
  noCollision?: boolean;
  /** Leveringen in de opgegeven volgorde. */
  ordered?: boolean;
  /** Maximale slingerhoek (graden) tijdens transport boven de doelzone. */
  maxSwayDeg?: number;
  /** Minimale ondergrondfactor tijdens het hijsen. */
  minGroundFactor?: number;
  /** Vereist contragewicht (index) of giekoptie (index) vanuit de planning. */
  minCounterweightIndex?: number;
}

export interface PlanningOptions {
  chooseCounterweight?: boolean;
  chooseBoom?: boolean;
  chooseJib?: boolean;
  chooseCrane?: boolean;
  /** Geplande hijsstraal voor de lastdiagramcontrole (m). */
  plannedRadius?: number;
  /** Geplande hijshoogte boven maaiveld (m). */
  plannedHeight?: number;
}

export interface Reward {
  money: number;
  xp: number;
  license?: LicenseId;
  certificate?: string;
  livery?: string;
}

export interface MissionDef {
  id: string;
  number: number;
  chapter: number;
  title: string;
  briefing: string;
  hint: string;
  learningGoal: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  craneOptions: CraneId[];
  environment: EnvironmentId;
  timeOfDay: TimeOfDay;
  weather: Weather;
  crane: CraneStartConfig;
  /** Torenkraanmontage met een hulpkraan vóór de eigenlijke opdracht. */
  assembly?: TowerAssemblyDef;
  loads: LoadSpawn[];
  zones: ZoneDef[];
  obstacles: ObstacleDef[];
  ground?: GroundZone[];
  groundFallback?: GroundType;
  tasks: TaskDef[];
  wind: WindDef;
  /** Tijdslimiet (s). Geen = onbeperkt. */
  timeLimit?: number;
  /** Richttijd voor de tijdscore (s). */
  parTime: number;
  /** Maximale schade in % voordat de missie mislukt. */
  maxDamage: number;
  /** Hellingshoek chassis (graden). */
  slopeDeg?: number;
  requirements: MissionRequirements;
  planning?: PlanningOptions;
  reward: Reward;
  /** Wereldgrenzen (m). */
  bounds: { minX: number; maxX: number };
}

export interface ChapterDef {
  number: number;
  title: string;
  subtitle: string;
  /** Vereiste licentie om het hoofdstuk te openen. */
  requiresLicense: LicenseId | null;
  /** Voortgangsfase in de carrière (1..7). */
  stage: number;
}
