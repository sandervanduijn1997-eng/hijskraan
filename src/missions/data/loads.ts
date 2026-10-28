export type LoadStyle =
  | 'pallet'
  | 'container'
  | 'beam'
  | 'concrete'
  | 'hvac'
  | 'machine'
  | 'panel'
  | 'pipe'
  | 'transformer'
  | 'generator'
  | 'engine'
  | 'module'
  | 'turbineTower'
  | 'nacelle'
  | 'bridge'
  | 'counterweight'
  | 'bucket'
  | 'craneParts'
  | 'truss'
  | 'testWeight'
  | 'bricks'
  | 'towerMast'
  | 'towerSlewing'
  | 'towerHead'
  | 'towerJib'
  | 'slab'
  | 'glass'
  | 'wall'
  | 'tree'
  | 'vehicle'
  | 'basket'
  | 'pool'
  | 'blade'
  | 'vessel';

/** Lasttype. Afmetingen in m, massa in kg. Alle waarden zijn spelwaarden. */
export interface LoadType {
  id: string;
  name: string;
  massKg: number;
  width: number;
  height: number;
  depth: number;
  /** Zwaartepunt t.o.v. het geometrische midden (m, langs x). */
  comOffsetX?: number;
  /** Luchtweerstandscoëfficiënt (windgevoeligheid). */
  dragCoeff: number;
  /** Kwetsbaarheid 0..1: hoger = strengere landing en meer schade. */
  fragility: number;
  /** Maximale landingssnelheid zonder schade (m/s). */
  landingSpeedLimit: number;
  /** Hoogte van het haakpunt boven de bovenkant van de last (stroppen/evenaar). */
  slingHeight: number;
  /** Scherpe randen (standaard volgt uit de stijl; zie rigging.sharpEdges). */
  sharpEdges?: boolean;
  /** Hijspunten (omschrijving voor de briefing). */
  liftPoints: string;
  style: LoadStyle;
  color: number;
}

const L = (t: LoadType): LoadType => t;

export const LOADS: Record<string, LoadType> = {
  pallet500: L({ id: 'pallet500', name: 'Pallet bouwmateriaal', massKg: 500, width: 1.2, height: 1.0, depth: 1.0, dragCoeff: 1.1, fragility: 0.3, landingSpeedLimit: 0.6, slingHeight: 1.4, liftPoints: '4 strophaken op de pallet', style: 'pallet', color: 0xb98a4b }),
  palletBricks: L({ id: 'palletBricks', name: 'Pallet stenen', massKg: 1200, width: 1.2, height: 1.1, depth: 1.0, dragCoeff: 1.1, fragility: 0.35, landingSpeedLimit: 0.5, slingHeight: 1.5, liftPoints: 'palletvork', style: 'bricks', color: 0xa4553a }),
  palletRoof: L({ id: 'palletRoof', name: 'Pallet dakpannen', massKg: 900, width: 1.2, height: 1.0, depth: 1.0, dragCoeff: 1.1, fragility: 0.6, landingSpeedLimit: 0.4, slingHeight: 1.4, liftPoints: 'palletvork', style: 'bricks', color: 0x8f3b2b }),
  palletWood: L({ id: 'palletWood', name: 'Houten pallet met materiaal', massKg: 750, width: 1.4, height: 0.9, depth: 1.1, dragCoeff: 1.1, fragility: 0.3, landingSpeedLimit: 0.5, slingHeight: 1.3, liftPoints: 'palletvork', style: 'pallet', color: 0xc49a5a }),
  siteContainer: L({ id: 'siteContainer', name: 'Bouwcontainer', massKg: 750, width: 3.0, height: 1.4, depth: 2.0, dragCoeff: 1.2, fragility: 0.3, landingSpeedLimit: 0.5, slingHeight: 2.2, liftPoints: '4 hoekogen', style: 'container', color: 0x2f6db5 }),
  steelBeam6: L({ id: 'steelBeam6', name: 'Stalen balk HEB 300 (6 m)', massKg: 700, width: 6.0, height: 0.32, depth: 0.3, dragCoeff: 1.4, fragility: 0.15, landingSpeedLimit: 0.6, slingHeight: 2.6, liftPoints: '2 stroppen op 1/4 en 3/4', style: 'beam', color: 0x7b8794 }),
  steelBeam9: L({ id: 'steelBeam9', name: 'Stalen ligger (9 m)', massKg: 1800, width: 9.0, height: 0.5, depth: 0.35, dragCoeff: 1.4, fragility: 0.15, landingSpeedLimit: 0.5, slingHeight: 3.5, liftPoints: '2 stroppen', style: 'beam', color: 0x6c7a89 }),
  concreteElement: L({ id: 'concreteElement', name: 'Betonnen element', massKg: 2400, width: 2.4, height: 1.2, depth: 0.6, dragCoeff: 1.2, fragility: 0.4, landingSpeedLimit: 0.4, slingHeight: 1.8, liftPoints: '2 instortankers', style: 'concrete', color: 0xa9a59c }),
  concreteBlock: L({ id: 'concreteBlock', name: 'Betonnen funderingsblok', massKg: 3600, width: 1.6, height: 1.2, depth: 1.6, dragCoeff: 1.1, fragility: 0.25, landingSpeedLimit: 0.45, slingHeight: 1.6, liftPoints: 'hijsoog', style: 'concrete', color: 0xb0aba1 }),
  rebar: L({ id: 'rebar', name: 'Bundel wapeningsstaal', massKg: 1500, width: 5.0, height: 0.4, depth: 0.6, dragCoeff: 1.2, fragility: 0.1, landingSpeedLimit: 0.7, slingHeight: 2.4, liftPoints: '2 stroppen', style: 'beam', color: 0x8a5a3c }),
  hvac: L({ id: 'hvac', name: 'Airco-unit (dakmodel)', massKg: 4200, width: 3.4, height: 1.9, depth: 2.0, dragCoeff: 1.2, fragility: 0.7, landingSpeedLimit: 0.3, slingHeight: 2.6, liftPoints: 'hijsbalk met 4 ogen', style: 'hvac', color: 0xd9dee3 }),
  machine: L({ id: 'machine', name: 'Industriële machine', massKg: 4800, width: 2.6, height: 1.8, depth: 1.6, comOffsetX: 0.25, dragCoeff: 1.1, fragility: 0.7, landingSpeedLimit: 0.25, slingHeight: 2.0, liftPoints: 'hijsframe', style: 'machine', color: 0x3a8f6a }),
  machineSmall: L({ id: 'machineSmall', name: 'Compacte productiemachine', massKg: 3200, width: 2.4, height: 1.7, depth: 1.5, dragCoeff: 1.1, fragility: 0.7, landingSpeedLimit: 0.25, slingHeight: 1.8, liftPoints: 'hijsframe', style: 'machine', color: 0x2e8b57 }),
  machineParts: L({ id: 'machineParts', name: 'Defect machineonderdeel', massKg: 2200, width: 1.6, height: 1.2, depth: 1.2, dragCoeff: 1.1, fragility: 0.4, landingSpeedLimit: 0.4, slingHeight: 1.5, liftPoints: 'hijsogen', style: 'machine', color: 0x8c6d3f }),
  craneParts: L({ id: 'craneParts', name: 'Kraanonderdelen (ballast)', massKg: 2000, width: 2.0, height: 0.8, depth: 1.2, dragCoeff: 1.1, fragility: 0.1, landingSpeedLimit: 0.6, slingHeight: 1.6, liftPoints: 'hijsogen', style: 'craneParts', color: 0x9aa0a6 }),
  testWeight: L({ id: 'testWeight', name: 'Proeflast', massKg: 2000, width: 1.4, height: 1.0, depth: 1.4, dragCoeff: 1.0, fragility: 0.1, landingSpeedLimit: 0.6, slingHeight: 1.4, liftPoints: 'hijsoog', style: 'testWeight', color: 0xf2b705 }),
  concreteBucket: L({ id: 'concreteBucket', name: 'Betonkubel (gevuld)', massKg: 2600, width: 1.5, height: 1.8, depth: 1.5, dragCoeff: 1.0, fragility: 0.3, landingSpeedLimit: 0.45, slingHeight: 1.0, liftPoints: 'hijsbeugel', style: 'bucket', color: 0x8d9399 }),
  facadePanel: L({ id: 'facadePanel', name: 'Breed gevelpaneel', massKg: 1500, width: 6.0, height: 3.0, depth: 0.25, dragCoeff: 1.9, fragility: 0.6, landingSpeedLimit: 0.3, slingHeight: 2.6, liftPoints: '2 hijsankers', style: 'panel', color: 0xcfd6dc }),
  steelElement: L({ id: 'steelElement', name: 'Constructie-element', massKg: 2800, width: 3.0, height: 1.0, depth: 0.6, dragCoeff: 1.4, fragility: 0.35, landingSpeedLimit: 0.35, slingHeight: 2.2, liftPoints: '2 hijsogen', style: 'truss', color: 0xc0392b }),
  pipe: L({ id: 'pipe', name: 'Lange leiding (DN600)', massKg: 2600, width: 10.0, height: 0.65, depth: 0.65, dragCoeff: 1.0, fragility: 0.35, landingSpeedLimit: 0.35, slingHeight: 3.6, liftPoints: '2 stroppen', style: 'pipe', color: 0x5d7d8f }),
  transformer: L({ id: 'transformer', name: 'Vermogenstransformator', massKg: 42000, width: 4.2, height: 3.4, depth: 2.6, dragCoeff: 1.2, fragility: 0.8, landingSpeedLimit: 0.2, slingHeight: 3.2, liftPoints: '4 hijsnokken + evenaar', style: 'transformer', color: 0x6a7f6a }),
  roofTruss: L({ id: 'roofTruss', name: 'Stalen dakspant', massKg: 9000, width: 16.0, height: 2.2, depth: 0.5, dragCoeff: 1.6, fragility: 0.45, landingSpeedLimit: 0.3, slingHeight: 6.0, liftPoints: '2 hijspunten + evenaar', style: 'truss', color: 0xb03a2e }),
  counterweightSlab: L({ id: 'counterweightSlab', name: 'Contragewichtplaat', massKg: 12000, width: 2.6, height: 0.7, depth: 2.4, dragCoeff: 1.0, fragility: 0.05, landingSpeedLimit: 0.5, slingHeight: 2.2, liftPoints: '4-sprong', style: 'counterweight', color: 0x3b3f45 }),
  heavyMachine: L({ id: 'heavyMachine', name: 'Zware persmachine', massKg: 68000, width: 5.0, height: 3.6, depth: 3.0, dragCoeff: 1.2, fragility: 0.7, landingSpeedLimit: 0.2, slingHeight: 4.0, liftPoints: 'hijsbalk', style: 'machine', color: 0x2f7d5b }),
  generator: L({ id: 'generator', name: 'Industriële generator', massKg: 38000, width: 6.0, height: 2.8, depth: 2.4, dragCoeff: 1.2, fragility: 0.7, landingSpeedLimit: 0.2, slingHeight: 3.4, liftPoints: '4 hijsogen + evenaar', style: 'generator', color: 0x3a6ea5 }),
  steelElementXL: L({ id: 'steelElementXL', name: 'Lang constructie-element', massKg: 14000, width: 8.0, height: 1.2, depth: 0.8, dragCoeff: 1.5, fragility: 0.35, landingSpeedLimit: 0.3, slingHeight: 4.0, liftPoints: '2 hijsogen', style: 'truss', color: 0xc0392b }),
  containerLoaded: L({ id: 'containerLoaded', name: '20ft-container (beladen)', massKg: 22000, width: 6.06, height: 2.59, depth: 2.44, dragCoeff: 1.2, fragility: 0.3, landingSpeedLimit: 0.3, slingHeight: 4.5, liftPoints: '4 twistlock-hoeken (spreader)', style: 'container', color: 0xc0392b }),
  shipEngine: L({ id: 'shipEngine', name: 'Scheepsmotor', massKg: 85000, width: 7.0, height: 4.0, depth: 3.0, comOffsetX: 0.4, dragCoeff: 1.1, fragility: 0.75, landingSpeedLimit: 0.2, slingHeight: 4.5, liftPoints: 'hijsframe 4 punten', style: 'engine', color: 0x4a5560 }),
  steelModule: L({ id: 'steelModule', name: 'Stalen procesmodule', massKg: 55000, width: 9.0, height: 5.0, depth: 4.0, dragCoeff: 1.4, fragility: 0.5, landingSpeedLimit: 0.2, slingHeight: 5.0, liftPoints: 'hijsbalk', style: 'module', color: 0x7f8c8d }),
  spareUnit: L({ id: 'spareUnit', name: 'Vervangingsonderdeel', massKg: 900, width: 1.3, height: 0.9, depth: 0.9, dragCoeff: 1.1, fragility: 0.75, landingSpeedLimit: 0.25, slingHeight: 1.2, liftPoints: 'hijsoog', style: 'machine', color: 0x2e86c1 }),
  oldUnit: L({ id: 'oldUnit', name: 'Oud onderdeel', massKg: 950, width: 1.3, height: 0.9, depth: 0.9, dragCoeff: 1.1, fragility: 0.2, landingSpeedLimit: 0.5, slingHeight: 1.2, liftPoints: 'hijsoog', style: 'machine', color: 0x7d6608 }),
  driveUnit: L({ id: 'driveUnit', name: 'Zware aandrijfeenheid', massKg: 3000, width: 2.4, height: 1.6, depth: 1.6, comOffsetX: -0.2, dragCoeff: 1.1, fragility: 0.5, landingSpeedLimit: 0.3, slingHeight: 1.8, liftPoints: '2 hijsogen', style: 'machine', color: 0x6e2c00 }),
  craneBoomSection: L({ id: 'craneBoomSection', name: 'Giekdeel (vakwerk)', massKg: 4500, width: 12.0, height: 2.0, depth: 2.0, dragCoeff: 1.0, fragility: 0.3, landingSpeedLimit: 0.4, slingHeight: 4.0, liftPoints: '2 stroppen', style: 'truss', color: 0xf2b705 }),
  bridgeGirder: L({ id: 'bridgeGirder', name: 'Brugligger', massKg: 48000, width: 24.0, height: 1.8, depth: 1.2, dragCoeff: 1.4, fragility: 0.4, landingSpeedLimit: 0.2, slingHeight: 8.0, liftPoints: '2 hijspunten + evenaar', style: 'bridge', color: 0x95a5a6 }),
  steelFrame: L({ id: 'steelFrame', name: 'Staalconstructie', massKg: 8500, width: 7.0, height: 3.0, depth: 1.0, dragCoeff: 1.5, fragility: 0.4, landingSpeedLimit: 0.3, slingHeight: 4.0, liftPoints: '4 hijsogen', style: 'truss', color: 0xa93226 }),
  buildingModule: L({ id: 'buildingModule', name: 'Bouwmodule', massKg: 9000, width: 6.0, height: 2.8, depth: 2.6, dragCoeff: 1.3, fragility: 0.5, landingSpeedLimit: 0.3, slingHeight: 3.6, liftPoints: '4 hoekogen', style: 'module', color: 0xe5e8e8 }),
  turbineTower: L({ id: 'turbineTower', name: 'Torensegment windturbine', massKg: 70000, width: 4.4, height: 22.0, depth: 4.4, dragCoeff: 0.8, fragility: 0.5, landingSpeedLimit: 0.15, slingHeight: 2.0, liftPoints: 'hijsflens bovenzijde', style: 'turbineTower', color: 0xeef1f3 }),
  nacelle: L({ id: 'nacelle', name: 'Windturbinegondel', massKg: 95000, width: 12.0, height: 4.2, depth: 4.2, comOffsetX: -0.6, dragCoeff: 1.1, fragility: 0.8, landingSpeedLimit: 0.12, slingHeight: 4.0, liftPoints: 'hijsjuk', style: 'nacelle', color: 0xf4f6f7 }),
  // tandemlasten: lang en zwaar genoeg voor twee kranen, met aanslagpunten aan beide einden
  girder18: L({ id: 'girder18', name: 'Stalen plaatligger (16 m)', massKg: 9000, width: 16.0, height: 1.2, depth: 0.5, dragCoeff: 1.5, fragility: 0.2, landingSpeedLimit: 0.4, slingHeight: 2.0, liftPoints: 'hijsogen aan beide einden (tandem)', style: 'beam', color: 0x6c7a89 }),
  precastBeam: L({ id: 'precastBeam', name: 'Voorgespannen brugligger (28 m)', massKg: 48000, width: 28.0, height: 1.6, depth: 1.2, dragCoeff: 1.4, fragility: 0.5, landingSpeedLimit: 0.2, slingHeight: 3.0, liftPoints: 'hijslussen aan beide einden (tandem)', style: 'concrete', color: 0xa9a59c }),
  pipeRack: L({ id: 'pipeRack', name: 'Leidingbrugsectie (14 m)', massKg: 13000, width: 14.0, height: 2.4, depth: 2.2, dragCoeff: 1.0, fragility: 0.5, landingSpeedLimit: 0.3, slingHeight: 2.5, liftPoints: 'hijsogen aan beide einden (tandem)', style: 'truss', color: 0x8d6e3f }),
  bridgeSpan: L({ id: 'bridgeSpan', name: 'Brugoverspanning', massKg: 165000, width: 30.0, height: 2.6, depth: 4.0, dragCoeff: 1.4, fragility: 0.45, landingSpeedLimit: 0.15, slingHeight: 10.0, liftPoints: '4 hijspunten + spreaderbalk', style: 'bridge', color: 0x7b7d7d }),
  criticalModule: L({ id: 'criticalModule', name: 'Uitzonderlijk zware module', massKg: 185000, width: 10.0, height: 6.0, depth: 6.0, dragCoeff: 1.3, fragility: 0.6, landingSpeedLimit: 0.15, slingHeight: 6.0, liftPoints: 'hijsbalk 4 punten', style: 'module', color: 0x5d6d7e }),
  offshoreModule: L({ id: 'offshoreModule', name: 'Offshore-energiemodule', massKg: 230000, width: 12.0, height: 8.0, depth: 8.0, comOffsetX: 0.3, dragCoeff: 1.4, fragility: 0.7, landingSpeedLimit: 0.12, slingHeight: 7.0, liftPoints: 'hijsframe 4 punten', style: 'module', color: 0xd35400 }),
  // torenkraandelen voor de montage met een hulpkraan (maten passen bij de TC 160, zie towerErection.ts)
  towerMast: L({ id: 'towerMast', name: 'Mastsectie torenkraan', massKg: 3200, width: 1.6, height: 6.25, depth: 1.6, dragCoeff: 0.7, fragility: 0.3, landingSpeedLimit: 0.25, slingHeight: 1.6, liftPoints: '4 stroppen aan de bovenste hoekstijlen', style: 'towerMast', color: 0xf0c419 }),
  towerSlewing: L({ id: 'towerSlewing', name: 'Draaikrans met cabine', massKg: 9000, width: 2.4, height: 2.0, depth: 2.4, dragCoeff: 1.1, fragility: 0.5, landingSpeedLimit: 0.2, slingHeight: 2.4, liftPoints: '4 hijsogen', style: 'towerSlewing', color: 0xf0c419 }),
  towerHead: L({ id: 'towerHead', name: 'Torenkop (A-bok)', massKg: 4000, width: 1.4, height: 7.0, depth: 1.4, dragCoeff: 0.7, fragility: 0.35, landingSpeedLimit: 0.2, slingHeight: 1.2, liftPoints: 'hijsoog in de top', style: 'towerHead', color: 0xf0c419 }),
  towerCounterJib: L({ id: 'towerCounterJib', name: 'Tegengiek met lier', massKg: 7000, width: 16.4, height: 1.2, depth: 1.8, dragCoeff: 0.8, fragility: 0.35, landingSpeedLimit: 0.25, slingHeight: 4.0, liftPoints: '4 stroppen + stuurlijnen', style: 'towerJib', color: 0xf0c419 }),
  towerJib: L({ id: 'towerJib', name: 'Giek 60 m (voorgemonteerd)', massKg: 14000, width: 58.4, height: 1.5, depth: 1.5, dragCoeff: 0.6, fragility: 0.35, landingSpeedLimit: 0.2, slingHeight: 6.0, liftPoints: 'hijsbalk op het zwaartepunt + stuurlijnen', style: 'towerJib', color: 0xf0c419 }),
  towerBallast6: L({ id: 'towerBallast6', name: 'Ballastblok 6 t', massKg: 6000, width: 1.1, height: 2.4, depth: 2.2, dragCoeff: 1.0, fragility: 0.05, landingSpeedLimit: 0.3, slingHeight: 1.4, liftPoints: '2 hijsogen', style: 'counterweight', color: 0x8c9096 }),
  towerBallast9: L({ id: 'towerBallast9', name: 'Ballastblok 9 t', massKg: 9000, width: 1.1, height: 2.4, depth: 2.2, dragCoeff: 1.0, fragility: 0.05, landingSpeedLimit: 0.3, slingHeight: 1.4, liftPoints: '2 hijsogen', style: 'counterweight', color: 0x8c9096 }),
};

export const LOAD_IDS = Object.keys(LOADS);

export function getLoad(id: string): LoadType {
  const l = LOADS[id];
  if (!l) throw new Error(`Onbekend lasttype: ${id}`);
  return l;
}
