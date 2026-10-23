import type { Footprint } from '../../physics/stability/stability';

export type CraneId = 'at500' | 'at60' | 'rt80' | 'truck25' | 'lc300' | 'se32' | 'tc160' | 'hl600' | 'kb22' | 'cd15';

export type CraneKind = 'telescopic' | 'lattice' | 'tower' | 'knuckle';

export type CarrierType =
  | 'allTerrain'
  | 'roughTerrain'
  | 'truck'
  | 'crawler'
  | 'carryDeck'
  | 'towerBase'
  | 'selfErecting'
  | 'knuckleTruck';

export type CraneClass =
  | 'heavyAllTerrain'
  | 'compactAllTerrain'
  | 'roughTerrain'
  | 'truckCrane'
  | 'latticeCrawler'
  | 'selfErectingTower'
  | 'towerCrane'
  | 'heavyLiftCrawler'
  | 'knuckleBoom'
  | 'pickAndCarry';

export type LicenseId = 'basis' | 'toren' | 'industrie' | 'terrein' | 'zwaar' | 'specialist' | 'eind';

export type UpgradeId =
  | 'hoistSpeed'
  | 'precisionControls'
  | 'counterweightPlus'
  | 'boomExtension'
  | 'stabilityMonitor'
  | 'efficientEngine'
  | 'fastSetup'
  | 'advancedWarnings'
  | 'slewSpeed'
  | 'trolleySpeed'
  | 'groundMats'
  | 'antiSwayAssist';

export interface CounterweightOption {
  label: string;
  massT: number;
  /** Straal achter de draaias (m). */
  radius: number;
}

/** Referentie naar het echte machinetype. Alleen afgeronde, publiek gecommuniceerde kopcijfers. */
export interface CraneReference {
  model: string;
  publicSpecs: Record<string, string | number>;
  note: string;
}

/** Visuele maatvoering voor de renderer (m). */
export interface CraneVisual {
  carrierLength: number;
  carrierHeight: number;
  axles: number;
  wheelRadius: number;
  bodyColor: number;
  accentColor: number;
  cabFront: boolean;
}

/** Alle waarden hieronder zijn spelwaarden (gameBalance), geen fabrikantgegevens. */
export interface CraneGameBalance {
  /** x van de draaias t.o.v. het midden van het chassis. */
  slewOffsetX: number;
  /** Giekvoet in het draaiframe (u = horizontaal in giekrichting, y = hoogte). */
  pivotU: number;
  pivotHeight: number;
  /** Telescoop: min/max lengte. Vakwerk: lengte-opties. */
  boomMin: number;
  boomMax: number;
  boomOptions?: number[];
  /** Optionele vaste hulpgiek (lengte-opties, 0 = geen) en offsethoek (graden). */
  jibOptions?: number[];
  jibOffsetDeg?: number;
  telescopeSections: number;
  boomAngleMinDeg: number;
  boomAngleMaxDeg: number;
  /** Torenkraan */
  towerHeight?: number;
  jibLength?: number;
  counterJibLength?: number;
  trolleyMin?: number;
  /** Knikarm */
  columnHeight?: number;
  arm1Length?: number;
  arm2Length?: number;
  knuckleTeleMax?: number;
  knuckleMinDeg?: number;
  knuckleMaxDeg?: number;
  ropeMin: number;
  ropeMax: number;
  hookMassKg: number;
  /** Snelheden */
  hoistSpeed: number; // m/s
  luffSpeedDeg: number; // °/s
  teleSpeed: number; // m/s
  slewSpeedDeg: number; // °/s
  trolleySpeed: number; // m/s
  knuckleSpeedDeg: number; // °/s
  driveSpeed: number; // m/s
  /** Mag rijden met hangende last? Max. belasting in % tijdens rijden. */
  driveWithLoadMaxPct: number;
  /** Capaciteit */
  maxCapacityT: number;
  /** Structurele grens: maxT · (rMin/R)^p · (Lmin/L)^q, of momentgrens (t·m) voor toren/knikarm. */
  structural: { minRadius: number; p: number; q: number; momentTm?: number };
  carrierT: number;
  superT: number;
  superBehind: number;
  /** Basis-giekmassa (t) + massa per meter (t/m). */
  boomBaseT: number;
  boomPerMeterT: number;
  counterweights: CounterweightOption[];
  footprintOutriggers: Footprint | null;
  footprintRetracted: Footprint;
  /** Is de kraan verankerd (torenkraan)? Dan geen kantelmodel, alleen structurele grens. */
  anchored: boolean;
  /** Mag op banden/rupsen worden gehesen (zonder stempels)? */
  liftOnTires: boolean;
  outriggerCount: 0 | 2 | 4;
  /** Opbouwtijden (s, gecomprimeerde speltijd). */
  outriggerTime: number;
  setupTime: number;
  /** Opbouwprocedure: zelfopbouw, giekmontage (vakwerk) of volledige montage van een torenkraan. */
  setupType: 'none' | 'outriggers' | 'selfErect' | 'boomAssembly' | 'towerAssembly';
  /** Brandstofverbruik l/h bij vollast (spelwaarde). */
  fuelRate: number;
}

export interface CraneEconomy {
  buyPrice: number;
  rentPerMission: number;
  maintenancePerMission: number;
  requiredLicense: LicenseId | null;
}

export interface CraneConfig {
  id: CraneId;
  name: string;
  craneClass: CraneClass;
  classLabel: string;
  kind: CraneKind;
  carrier: CarrierType;
  description: string;
  reference: CraneReference;
  visual: CraneVisual;
  gameBalance: CraneGameBalance;
  economy: CraneEconomy;
  upgrades: UpgradeId[];
  /** Missienummers waarvoor deze kraan geschikt is (wordt in tests tegen de missiedata gecontroleerd). */
  suitableMissions: number[];
}
