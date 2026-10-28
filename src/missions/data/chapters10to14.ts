import { getCrane } from '../../cranes/config/cranes';
import type { CraneId } from '../../cranes/config/types';
import { resolveCrane } from '../../cranes/models/craneSpec';
import { createCraneState } from '../../cranes/models/craneState';
import type { CraneStartConfig } from '../../cranes/models/craneState';
import { computeGeometry, solveBoomIK } from '../../cranes/models/kinematics';
import { RAD } from '../../utils/math';
import { box, zone } from './builders';
import { LOADS } from './loads';
import { towerStanding } from './towerAssembly';
import type { MissionDef, ObstacleDef } from './types';

/**
 * Praktijkklussen: opdrachten zoals een kraanmachinist ze echt tegenkomt, uit de missiecatalogus
 * (woningbouw, infra, industrie, haven en energie, bijzondere klussen). Elke opdracht heeft een eigen
 * moeilijkheid uit de praktijk: een last die zwaarder is dan op papier, een last die vastzit, een
 * gevarenzone, een werkstop, een opkomende storm, een tweede torenkraan, blind hijsen of een ponton.
 */

/** Vrachtwagen met laadvloer op een diepte z (laadvloer langs x, cabine aan de +x-kant). */
function lorry(id: string, x: number, z: number, len = 8, bedH = 1.3, label = 'laadvloer'): ObstacleDef[] {
  return [
    box(`${id}-bed`, 'truck', x, 0, len, bedH, { z0: z - 1.25, z1: z + 1.25, landable: true, label, style: 'truckBed' }),
    box(`${id}-cab`, 'truck', x + len, 0, 2.6, 3.2, { z0: z - 1.25, z1: z + 1.25, landable: false, label: 'cabine', style: 'truckCab' }),
  ];
}

/** Gevarenzone (geen fysiek lichaam): binnengaan is een veiligheidsovertreding; `fail` = afkeur op streng. */
const hazard = (id: string, x: number, y: number, w: number, h: number, z0: number, z1: number, label: string, style?: string, fail = true): ObstacleDef =>
  box(id, 'hazard', x, y, w, h, { z0, z1, label, style, onHit: fail ? 'fail' : 'damage' });

/** Mast van een tweede torenkraan (de giek draait mee via `otherCrane`). */
function otherTowerMast(craneId: CraneId, x: number, z: number): ObstacleDef {
  const spec = resolveCrane(getCrane(craneId), []);
  const g = computeGeometry(spec, createCraneState(spec, { x, z, preassembled: true }));
  const top = g.segments.find((s) => s.kind === 'mast')?.y1 ?? 40;
  return box('oc-mast', 'tower', x - 1, 0, 2, top - 2, { z0: z - 1, z1: z + 1, label: 'mast van de andere torenkraan', style: 'steel' });
}

/** Giekpunt (wereld) van een kraan in een startopstelling: daar hangt een last die al aan de haak zit. */
function tipOf(craneId: CraneId, start: CraneStartConfig): { x: number; z: number } {
  const spec = resolveCrane(getCrane(craneId), []);
  const t = computeGeometry(spec, createCraneState(spec, start)).tip;
  return { x: Math.round(t.x * 100) / 100, z: Math.round(t.z * 100) / 100 };
}

const PILE_CRANE: CraneStartConfig = { x: 0, slewDeg: -30, boomAngleDeg: 70, boomOptionIndex: 1, ropeLength: 10, counterweightIndex: 2, preassembled: true };
const PILE_TIP = tipOf('lc300', PILE_CRANE);

/** Startopstelling van de collega-kraan boven einde B van een tandemlast (zoals in hoofdstuk 9). */
function partnerAbove(craneId: CraneId, x: number, loadType: string, lx: number, lz: number, ly: number, cw = 2): CraneStartConfig {
  const spec = resolveCrane(getCrane(craneId), []);
  const t = LOADS[loadType];
  const bx = lx + t.width * 0.42;
  const sx = x + spec.gb.slewOffsetX;
  const u = Math.hypot(bx - sx, lz);
  const hookTop = ly + t.height + t.slingHeight + 1.2;
  const ik = solveBoomIK(spec, u, hookTop + spec.gb.ropeMin + 1.5);
  return { x, slewDeg: Math.atan2(lz, bx - sx) * RAD, boomAngleDeg: ik.angle * RAD, boomLength: ik.length, ropeLength: spec.gb.ropeMin + 1.5, outriggersDeployed: true, counterweightIndex: cw };
}

// ------------------------------------------------------------------ Hoofdstuk 10 — Woningbouw
export const CHAPTER_10: MissionDef[] = [
  towerStanding({
    id: 'm44', number: 44, chapter: 10, title: 'Kanaalplaatvloer',
    briefing: 'Drie kanaalplaten van 6,8 t moeten op het metselwerk van de eerste verdieping, strak tegen elkaar. De vrachtwagen is verkeerd geladen: de plaat voor vak 1 ligt onderop. Leg de bovenste eerst opzij.',
    hint: 'Gebruik de plaatklem (handmatig aanslaan) en laat elke plaat de laatste halve meter heel rustig zakken, recht boven het vak. Een plaat die hard neerkomt scheurt.',
    learningGoal: 'Werken in een vaste volgorde, met een verkeerd geladen vrachtwagen.', difficulty: 3, craneOptions: ['tc160'], environment: 'constructionSite', timeOfDay: 'morning', weather: 'clear',
    crane: { x: 0, trolley: 12, ropeLength: 38 },
    loads: [
      { id: 's1', type: 'hollowSlab', x: 12, y: 1.3, z: -7 },
      { id: 's2', type: 'hollowSlab', x: 12, y: 1.56, z: -7 },
      { id: 's3', type: 'hollowSlab', x: -11, y: 0, z: -4 },
    ],
    zones: [
      zone('tmp', 'Tussenopslag', -11, 0, 0.8, { z: 2, zTolerance: 0.8 }),
      zone('v1', 'Vak 1', 12.6, 6, 0.18, { z: 5.2, zTolerance: 0.15 }),
      zone('v2', 'Vak 2', 12.6, 6, 0.18, { z: 6.4, zTolerance: 0.15 }),
      zone('v3', 'Vak 3', 12.6, 6, 0.18, { z: 7.6, zTolerance: 0.15 }),
    ],
    obstacles: [
      ...lorry('tr', 8, -7, 8, 1.3),
      box('w1', 'support', 8.9, 0, 0.3, 6, { z0: 4.4, z1: 8.4, label: 'metselwerk', style: 'brick', landable: true }),
      box('w2', 'support', 16.0, 0, 0.3, 6, { z0: 4.4, z1: 8.4, label: 'metselwerk', style: 'brick', landable: true }),
    ],
    tasks: [
      { type: 'deliver', loadId: 's2', zoneId: 'tmp', label: 'Bovenste plaat opzij leggen' },
      { type: 'deliver', loadId: 's1', zoneId: 'v1' },
      { type: 'deliver', loadId: 's2', zoneId: 'v2' },
      { type: 'deliver', loadId: 's3', zoneId: 'v3' },
    ],
    surprise: null,
    wind: { base: 3, gust: 0.3, direction: 1 }, parTime: 520, maxDamage: 25, requirements: { ordered: true, maxSwayDeg: 3 }, bounds: { minX: -35, maxX: 60 },
    reward: { money: 4200, xp: 650 },
  }),
  {
    id: 'm45', number: 45, chapter: 10, title: 'Prefab wanden schoren',
    briefing: 'Twee prefab betonwanden van 7,5 t moeten rechtop op de funderingsstrook. De monteurs zetten de schoren terwijl jij de wand stil houdt — pas als ze klaar zijn mag je vieren. Er is wind voorspeld.',
    hint: 'Een hoge, smalle wand vangt veel wind en wil draaien. Breng hem laag en langzaam naar de strook, en houd hem doodstil boven het vak tot de schoren zitten.',
    learningGoal: 'Een last lang stilhouden terwijl anderen hem vastzetten.', difficulty: 3, craneOptions: ['at60'], environment: 'constructionSite', timeOfDay: 'day', weather: 'cloudy',
    crane: { x: 0, boomAngleDeg: 60, boomLength: 14, ropeLength: 6, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [
      { id: 'w1', type: 'precastWall', x: 7, y: 1.3, z: -7.5 },
      { id: 'w2', type: 'precastWall', x: 11.2, y: 1.3, z: -7.5 },
    ],
    zones: [
      zone('z1', 'Wand 1 (schoren)', 8, 0.55, 0.2, { z: 8, zTolerance: 0.2, yTolerance: 0.15, yawDeg: 0, yawTolDeg: 6 }),
      zone('z2', 'Wand 2 (schoren)', 11.8, 0.55, 0.2, { z: 8, zTolerance: 0.2, yTolerance: 0.15, yawDeg: 0, yawTolDeg: 6 }),
    ],
    obstacles: [...lorry('tr', 4.5, -7.5, 9, 1.3), box('fs', 'platform', 5, 0, 10, 0.5, { z0: 7, z1: 9, label: 'funderingsstrook', style: 'foundation' })],
    tasks: [
      { type: 'deliver', loadId: 'w1', zoneId: 'z1', hold: 8, effect: { type: 'fix' }, label: 'Wand 1 stilhouden tot de schoren zitten' },
      { type: 'deliver', loadId: 'w2', zoneId: 'z2', hold: 8, effect: { type: 'fix' }, label: 'Wand 2 stilhouden tot de schoren zitten' },
    ],
    windRamp: { to: 8, over: 90, afterPlaced: 1, text: 'De wind trekt aan, de tweede wand gaat flink bewegen. Laag houden en rustig aan.' },
    surprise: null,
    wind: { base: 3, gust: 0.35, direction: 1 }, parTime: 380, maxDamage: 20, requirements: { maxSwayDeg: 4 }, bounds: { minX: -30, maxX: 50 },
    reward: { money: 3600, xp: 600 },
  },
  towerStanding({
    id: 'm46', number: 46, chapter: 10, title: 'Betonstort met de kubel',
    briefing: 'De betonmixer staat klaar. Breng de gevulde kubel naar de bekisting op de verdieping, houd hem stil terwijl de ploeg hem leeg laat lopen, en zet hem terug bij de mixer. Twee rondes, en de ploeg werkt onder de kubel.',
    hint: 'Een stort is een ritme: vroeg afremmen, slinger dempen boven de bekisting en nooit boven de mensen bij de mixer zwenken. Pas na "leeg" terug.',
    learningGoal: 'Tempo houden zonder slingeren boven een werkende ploeg.', difficulty: 3, craneOptions: ['tc160'], environment: 'highrise', timeOfDay: 'day', weather: 'clear',
    crane: { x: 0, trolley: 10, ropeLength: 40 },
    loads: [{ id: 'k1', type: 'concreteBucket', x: 9, y: 0, z: -8 }],
    zones: [
      zone('pour', 'Bekisting (storten)', 17, 8.2, 0.7, { z: 9, zTolerance: 0.7, yTolerance: 0.5 }),
      zone('mix', 'Bij de mixer', 9, 0, 0.6, { z: -8, zTolerance: 0.6 }),
    ],
    obstacles: [box('deck', 'building', 13, 0, 9, 7, { z0: 4, z1: 15, label: 'verdiepingsvloer', style: 'skeleton', landable: true }), ...lorry('mx', 11.5, -8.5, 6, 2.6, 'betonmixer')],
    tasks: [
      { type: 'deliver', loadId: 'k1', zoneId: 'pour', hold: 5, keep: true, label: 'Kubel 1 leeg laten lopen boven de bekisting' },
      { type: 'deliver', loadId: 'k1', zoneId: 'mix', label: 'Kubel terug bij de mixer' },
      { type: 'deliver', loadId: 'k1', zoneId: 'pour', hold: 5, keep: true, label: 'Kubel 2 leeg laten lopen boven de bekisting' },
      { type: 'deliver', loadId: 'k1', zoneId: 'mix', label: 'Kubel terug bij de mixer' },
    ],
    surprise: null,
    wind: { base: 3, gust: 0.3, direction: -1 }, parTime: 420, maxDamage: 25, requirements: { ordered: true, maxSwayDeg: 3 }, bounds: { minX: -30, maxX: 60 },
    reward: { money: 3800, xp: 620 },
  }),
  {
    id: 'm47', number: 47, chapter: 10, title: 'Dakelementen in de woonwijk',
    briefing: 'Twee prefab dakelementen moeten op een rij nieuwe huizen. Je staat in een smalle straat met geparkeerde auto’s, en op de stoep aan de overkant kijken bewoners mee: daar mag niets boven komen.',
    hint: 'Een groot, licht dakelement vangt veel wind. Zwenk over de huizen heen, niet over de stoep, en houd de last laag tot je boven het dak bent.',
    learningGoal: 'Opstellen in een krappe straat en publiek op afstand houden.', difficulty: 3, craneOptions: ['at60'], environment: 'cityCenter', timeOfDay: 'morning', weather: 'clear',
    crane: { x: 0, boomAngleDeg: 60, boomLength: 18, ropeLength: 6, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [
      { id: 'd1', type: 'roofElement', x: 8, y: 1.3, z: -7 },
      { id: 'd2', type: 'roofElement', x: 8, y: 1.65, z: -7 },
    ],
    zones: [
      zone('z1', 'Dakvlak 1', 11, 7.5, 0.3, { z: 9, zTolerance: 0.3 }),
      zone('z2', 'Dakvlak 2', 11, 7.5, 0.3, { z: 11.6, zTolerance: 0.3 }),
    ],
    obstacles: [
      ...lorry('tr', 4, -7, 8, 1.3),
      box('huis', 'building', 6, 0, 10, 7.5, { z0: 7.4, z1: 13.2, label: 'nieuwbouwwoningen', style: 'brick', landable: true }),
      box('car1', 'truck', -14, 0, 4.2, 1.5, { z0: 3.2, z1: 5, label: 'geparkeerde auto', style: 'truckCab' }),
      box('car2', 'truck', 14, 0, 4.2, 1.5, { z0: 3.2, z1: 5, label: 'geparkeerde auto', style: 'truckCab' }),
      hazard('stoep', -16, 0, 12, 30, -14, -9, 'stoep met publiek', undefined, false),
    ],
    tasks: [
      { type: 'deliver', loadId: 'd2', zoneId: 'z1' },
      { type: 'deliver', loadId: 'd1', zoneId: 'z2' },
    ],
    surprise: { type: 'stop', text: 'Stop! Een bewoner rijdt zijn auto de straat uit, onder je last door. Alles stil, alleen zakken mag.', seconds: 18, endText: 'Auto is weg, je mag weer.' },
    wind: { base: 4, gust: 0.35, direction: 1 }, parTime: 360, maxDamage: 25, requirements: { maxSwayDeg: 4 }, bounds: { minX: -30, maxX: 45 },
    reward: { money: 3400, xp: 580 },
  },
  {
    id: 'm48', number: 48, chapter: 10, title: 'Glazen gevel',
    briefing: 'Een glasplaat van 950 kg moet in de gevelopening op de eerste verdieping. De glaszetter zet hem vast terwijl jij hem stil houdt. Glas kan alleen aan de vacuümheffer, en die heeft een strenge windgrens.',
    hint: 'Kies bij het aanslaan de vacuümheffer. Breng de plaat langzaam tegen de gevel en houd hem millimeterstil tot de glaszetter klaar is. Boven 9 m/s wind laat het vacuüm los.',
    learningGoal: 'Precisiewerk met een vacuümheffer.', difficulty: 4, craneOptions: ['at60'], environment: 'cityCenter', timeOfDay: 'day', weather: 'clear',
    crane: { x: 0, boomAngleDeg: 62, boomLength: 14, ropeLength: 5, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [{ id: 'g1', type: 'glassPane', x: 8, y: 1.3, z: -7.5 }],
    zones: [zone('z1', 'Gevelopening', 9, 3.6, 0.12, { z: 8.6, zTolerance: 0.12, yTolerance: 0.1, yawDeg: 0, yawTolDeg: 3 })],
    obstacles: [
      ...lorry('tr', 4.5, -7.5, 7, 1.3),
      box('gevel', 'building', 4, 0, 12, 12, { z0: 9.2, z1: 20, label: 'gevel', style: 'glass', landable: false }),
    ],
    tasks: [{ type: 'deliver', loadId: 'g1', zoneId: 'z1', hold: 8, effect: { type: 'fix' }, label: 'Glasplaat stilhouden tot hij vastzit' }],
    surprise: { type: 'stop', text: 'Vacuümalarm! Niet bewegen, de glaszetter controleert de pomp.', seconds: 15, endText: 'Vacuüm is weer op druk. Rustig verder.' },
    wind: { base: 3, gust: 0.3, direction: 1 }, parTime: 280, maxDamage: 10, requirements: { maxSwayDeg: 2.5 }, bounds: { minX: -30, maxX: 45 },
    reward: { money: 3600, xp: 640 },
  },
  towerStanding({
    id: 'm49', number: 49, chapter: 10, title: 'Stormklaar maken',
    briefing: 'Er is een stormwaarschuwing afgegeven. De uitvoerder wil nog twee pallets stenen op de verdieping, daarna moet de torenkraan stormklaar: geen last, haak omhoog, loopkat naar binnen.',
    hint: 'Kijk naar de windmeter en de windgrens in het HUD. Haal je de tweede pallet niet meer veilig, dan is stoppen het goede antwoord. Parkeer de kraan voordat het echt hard waait.',
    learningGoal: 'Op tijd stoppen en de kraan stormklaar zetten.', difficulty: 3, craneOptions: ['tc160'], environment: 'highrise', timeOfDay: 'dusk', weather: 'cloudy',
    crane: { x: 0, trolley: 10, ropeLength: 40 },
    loads: [
      { id: 'p1', type: 'palletBricks', x: 9, y: 0, z: -6 },
      { id: 'p2', type: 'palletBricks', x: 10.6, y: 0, z: -6 },
    ],
    zones: [
      zone('z1', 'Verdieping 2', 18, 7, 0.6, { z: 8, zTolerance: 0.6 }),
      zone('z2', 'Verdieping 2', 20, 7, 0.6, { z: 8, zTolerance: 0.6 }),
    ],
    obstacles: [box('casco', 'building', 14, 0, 12, 7, { z0: 3, z1: 14, label: 'casco', style: 'skeleton', landable: true })],
    tasks: [
      { type: 'deliver', loadId: 'p1', zoneId: 'z1' },
      { type: 'deliver', loadId: 'p2', zoneId: 'z2', label: 'Nog één pallet (uitvoerder)' },
      { type: 'park' },
    ],
    windRamp: { to: 17, over: 160, afterPlaced: 1, text: 'Weerbericht: de storm komt eerder. Windstoten tot 17 m/s binnen een paar minuten.' },
    surprise: null,
    wind: { base: 5, gust: 0.4, direction: 1 }, parTime: 300, maxDamage: 25, requirements: {}, bounds: { minX: -30, maxX: 60 },
    reward: { money: 3000, xp: 560 },
  }),
  towerStanding({
    id: 'm50', number: 50, chapter: 10, title: 'Twee torenkranen',
    briefing: 'Op deze bouwplaats staat een tweede torenkraan van een andere aannemer. Zijn giek draait door jouw werkgebied. Breng het staalwerk naar de verdieping zonder zijn giek met je kabel of last te raken.',
    hint: 'Kijk waar de andere giek staat voordat je zwenkt. Wacht liever even tot hij weer weg draait. Het anti-collisiesysteem waarschuwt pas op 2,5 m.',
    learningGoal: 'Werken naast een andere torenkraan.', difficulty: 4, craneOptions: ['tc160'], environment: 'highrise', timeOfDay: 'day', weather: 'clear',
    crane: { x: 0, trolley: 10, ropeLength: 40 },
    loads: [
      { id: 'b1', type: 'steelBeam6', x: 10, y: 0, z: -9 },
      { id: 'b2', type: 'steelBeam6', x: 10, y: 0, z: -11 },
    ],
    zones: [
      zone('z1', 'Verdieping 3', 14, 10.5, 0.5, { z: 10, zTolerance: 0.5 }),
      zone('z2', 'Verdieping 3', 14, 10.5, 0.5, { z: 12, zTolerance: 0.5 }),
    ],
    obstacles: [box('casco', 'building', 9, 0, 12, 10.5, { z0: 6, z1: 16, label: 'casco', style: 'skeleton', landable: true }), otherTowerMast('tc160', 46, 4)],
    otherCrane: { craneId: 'tc160', x: 46, z: 4, trolley: 30, fromDeg: 160, toDeg: 215, speedDeg: 5, pause: 18 },
    tasks: [
      { type: 'deliver', loadId: 'b1', zoneId: 'z1' },
      { type: 'deliver', loadId: 'b2', zoneId: 'z2' },
    ],
    wind: { base: 3, gust: 0.3, direction: 1 }, parTime: 380, maxDamage: 20, requirements: {}, bounds: { minX: -30, maxX: 75 },
    reward: { money: 4400, xp: 700 },
  }),
  towerStanding({
    id: 'm51', number: 51, chapter: 10, title: 'Bekistingstafels',
    briefing: 'Na het storten gaan de bekistingstafels een verdieping hoger. De eerste tafel zit nog vast aan het beton: trek rustig op tot hij loskomt, en vang de ruk op.',
    hint: 'Een tafel die vastzit trekt veel meer dan zijn gewicht. Hijs recht boven de tafel en bouw de trekkracht langzaam op; kijk naar de lastmeter. Komt hij los, dan schiet hij omhoog.',
    learningGoal: 'Een vastzittende last veilig losmaken.', difficulty: 3, craneOptions: ['tc160'], environment: 'highrise', timeOfDay: 'morning', weather: 'cloudy',
    crane: { x: 0, trolley: 10, ropeLength: 36 },
    loads: [
      { id: 't1', type: 'tableForm', x: 14, y: 6, z: -8, stuckT: 2.5 },
      { id: 't2', type: 'tableForm', x: 14, y: 6, z: -11 },
    ],
    zones: [
      zone('z1', 'Volgende verdieping', 14, 9, 0.5, { z: 8, zTolerance: 0.5 }),
      zone('z2', 'Volgende verdieping', 14, 9, 0.5, { z: 11, zTolerance: 0.5 }),
    ],
    obstacles: [
      box('vloer1', 'building', 9, 0, 11, 6, { z0: -14, z1: -5, label: 'gestorte vloer', style: 'skeleton', landable: true }),
      box('vloer2', 'building', 9, 0, 11, 9, { z0: 5, z1: 14, label: 'volgende verdieping', style: 'skeleton', landable: true }),
    ],
    tasks: [
      { type: 'deliver', loadId: 't1', zoneId: 'z1' },
      { type: 'deliver', loadId: 't2', zoneId: 'z2' },
    ],
    surprise: null,
    wind: { base: 3, gust: 0.3, direction: -1 }, parTime: 360, maxDamage: 25, requirements: {}, bounds: { minX: -30, maxX: 60 },
    reward: { money: 3600, xp: 600 },
  }),
];

// ------------------------------------------------------------------ Hoofdstuk 11 — Infra
export const CHAPTER_11: MissionDef[] = [
  {
    id: 'm52', number: 52, chapter: 11, title: 'Brugligger in de nacht',
    briefing: 'De snelweg is vannacht een paar uur dicht. Samen met een tweede AT 500 leg je een voorgespannen ligger van 48 t op de landhoofden. Om vijf uur moet de weg weer open — wie te laat is kost de opdrachtgever een fortuin.',
    hint: 'Werklampen geven weinig diepte. Gebruik de hoogtehulp en til eerst een halve meter op om te zien of hij waterpas hangt. De eindtijd is hard.',
    learningGoal: 'Tandemhijs in de nacht met een harde eindtijd.', difficulty: 4, craneOptions: ['at500'], environment: 'riverBridge', timeOfDay: 'night', weather: 'clear',
    crane: { x: 0, boomAngleDeg: 55, boomLength: 26, ropeLength: 6, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [{ id: 'pb', type: 'precastBeam', x: 22, y: 0, z: -11 }],
    zones: [zone('z1', 'Opleggingen', 22, 5, 0.35, { z: 9 })],
    obstacles: [
      box('ab1', 'support', 7, 0, 2.4, 5, { z0: 7.5, z1: 10.5, label: 'landhoofd west', style: 'concrete', landable: true }),
      box('ab2', 'support', 34.6, 0, 2.4, 5, { z0: 7.5, z1: 10.5, label: 'landhoofd oost', style: 'concrete', landable: true }),
      box('gb', 'barrier', 4, 0, 40, 0.9, { z0: 2.5, z1: 3.1, label: 'vangrail', style: 'concrete' }),
    ],
    tasks: [{ type: 'deliver', loadId: 'pb', zoneId: 'z1' }],
    tandem: { craneId: 'at500', start: partnerAbove('at500', 46, 'precastBeam', 22, -11, 0), loadId: 'pb' },
    surprise: { type: 'delay', text: 'Verkeersleiding: er rijdt nog een wegbeheerder onder de opleggingen. Hou hem even vast.', seconds: 25 },
    wind: { base: 2, gust: 0.3, direction: -1 }, timeLimit: 900, parTime: 480, maxDamage: 20, requirements: { outriggers: true }, bounds: { minX: -30, maxX: 80 },
    reward: { money: 14000, xp: 1600 },
  },
  {
    id: 'm53', number: 53, chapter: 11, title: 'Geluidsschermen',
    briefing: 'Langs de snelweg plaats je schermpanelen tussen de stalen staanders. Je staat op een afgezette rijstrook; op de rijbaan ernaast raast het verkeer voorbij. Daar mag je nooit boven komen.',
    hint: 'Laat elk paneel recht van boven tussen de staanders zakken; dwars hangen = vastlopen. Zwenk aan de kant van de berm, niet over de rijbaan.',
    learningGoal: 'Precies tussen geleiders plaatsen naast open verkeer.', difficulty: 3, craneOptions: ['truck25'], environment: 'riverBridge', timeOfDay: 'morning', weather: 'cloudy',
    crane: { x: 0, boomAngleDeg: 55, boomLength: 16, ropeLength: 5, outriggersDeployed: true, counterweightIndex: 1 },
    loads: [
      { id: 'p1', type: 'noiseScreen', x: 4.5, y: 1.3, z: 6.5 },
      { id: 'p2', type: 'noiseScreen', x: 9.5, y: 1.3, z: 6.5 },
    ],
    zones: [
      zone('z1', 'Vak 1', 7.85, 0, 0.12, { z: -7, zTolerance: 0.15, yawDeg: 0, yawTolDeg: 4 }),
      zone('z2', 'Vak 2', 12.85, 0, 0.12, { z: -7, zTolerance: 0.15, yawDeg: 0, yawTolDeg: 4 }),
    ],
    obstacles: [
      ...lorry('tr', 2, 6.5, 10, 1.3),
      box('st1', 'support', 5.25, 0, 0.3, 4, { z0: -7.5, z1: -6.5, label: 'staander', style: 'steel' }),
      box('st2', 'support', 10.25, 0, 0.3, 4, { z0: -7.5, z1: -6.5, label: 'staander', style: 'steel' }),
      box('st3', 'support', 15.25, 0, 0.3, 4, { z0: -7.5, z1: -6.5, label: 'staander', style: 'steel' }),
      hazard('rijbaan', -30, 0, 80, 40, 10, 22, 'open rijbaan'),
    ],
    tasks: [
      { type: 'deliver', loadId: 'p2', zoneId: 'z1' },
      { type: 'deliver', loadId: 'p1', zoneId: 'z2' },
    ],
    surprise: { type: 'gust', text: 'Pas op: een rij vrachtwagens geeft flinke windstoten.', speed: 9, duration: 14 },
    wind: { base: 4, gust: 0.4, direction: 1 }, parTime: 340, maxDamage: 20, requirements: {}, bounds: { minX: -30, maxX: 45 },
    reward: { money: 3800, xp: 640 },
  },
  {
    id: 'm54', number: 54, chapter: 11, title: 'Rioolbuizen in de sleuf',
    briefing: 'Laat twee betonnen rioolbuizen in de sleuf tussen de damwanden. Onderin staan de buizenleggers; jij ziet de bodem van de sleuf niet en werkt op aanwijzing van de seinman. De sleufrand is slap.',
    hint: 'Je zit in de cabine en ziet de bodem niet: luister naar de seinman. Zet de stempels niet op de slappe strook langs de sleuf.',
    learningGoal: 'Blind hijsen in een sleuf op aanwijzing.', difficulty: 4, craneOptions: ['rt80'], environment: 'roughTerrain', timeOfDay: 'day', weather: 'rain',
    crane: { x: 0, boomAngleDeg: 55, boomLength: 16, ropeLength: 5, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [
      { id: 'r1', type: 'sewerPipe', x: 6, y: 0, z: -8 },
      { id: 'r2', type: 'sewerPipe', x: 9, y: 0, z: -8 },
    ],
    zones: [
      zone('z1', 'Sleuf (buis 1)', 12, 0, 0.25, { z: 8.1, zTolerance: 0.2 }),
      zone('z2', 'Sleuf (buis 2)', 14.6, 0, 0.25, { z: 8.1, zTolerance: 0.2 }),
    ],
    obstacles: [
      box('dw1', 'wall', 6, 0, 16, 2.8, { z0: 6.8, z1: 7.0, label: 'damwand', style: 'steel' }),
      box('dw2', 'wall', 6, 0, 16, 2.8, { z0: 9.2, z1: 9.4, label: 'damwand', style: 'steel' }),
    ],
    ground: [{ x0: -8, x1: 26, type: 'mud', quality: 0.45 }],
    groundFallback: 'gravel',
    mats: 'large',
    cameraLock: 'cab',
    tasks: [
      { type: 'deliver', loadId: 'r1', zoneId: 'z1' },
      { type: 'deliver', loadId: 'r2', zoneId: 'z2' },
    ],
    wind: { base: 3, gust: 0.3, direction: 1 }, parTime: 360, maxDamage: 25, requirements: {}, bounds: { minX: -30, maxX: 45 },
    reward: { money: 4000, xp: 680 },
  },
  {
    id: 'm55', number: 55, chapter: 11, title: 'Portaal voor de bovenleiding',
    briefing: 'In een spoorvrije periode plaats je een bovenleidingportaal op twee masten. Jouw spoor is spanningsloos, maar het spoor ernaast niet: blijf met giek, kabel en last uit de veiligheidszone van die bovenleiding.',
    hint: 'De rode zone is de veiligheidsafstand tot de bovenleiding die nog onder spanning staat. Plan de zwenk eromheen, en let op de eindtijd van de buitendienststelling.',
    learningGoal: 'Werken binnen een tijdvenster naast spanning.', difficulty: 4, craneOptions: ['at60'], environment: 'riverBridge', timeOfDay: 'night', weather: 'clear',
    crane: { x: 0, boomAngleDeg: 62, boomLength: 18, ropeLength: 6, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [{ id: 'po', type: 'catenaryPortal', x: 8, y: 0, z: -8 }],
    zones: [zone('z1', 'Op de masten', 13.75, 7, 0.2, { z: 9, zTolerance: 0.2 })],
    obstacles: [
      box('m1', 'support', 8.5, 0, 0.5, 7, { z0: 8.6, z1: 9.4, label: 'bovenleidingmast', style: 'steel', landable: true }),
      box('m2', 'support', 18.5, 0, 0.5, 7, { z0: 8.6, z1: 9.4, label: 'bovenleidingmast', style: 'steel', landable: true }),
      hazard('spoor1', -20, 0, 70, 0.4, 10.5, 13.5, 'spoor', 'rail', false),
      hazard('bl2', -20, 4.5, 70, 6, 14, 18, 'bovenleiding onder spanning', 'powerline'),
    ],
    tasks: [{ type: 'deliver', loadId: 'po', zoneId: 'z1' }],
    surprise: null,
    wind: { base: 2, gust: 0.3, direction: 1 }, timeLimit: 600, parTime: 300, maxDamage: 20, requirements: {}, bounds: { minX: -30, maxX: 50 },
    reward: { money: 4600, xp: 760 },
  },
  {
    id: 'm56', number: 56, chapter: 11, title: 'Damwanden trillen',
    briefing: 'Met een trilblok aan de haak tril je damwandplanken de grond in. De eerste plank hangt al aan de haak. Houd elke plank precies verticaal op zijn plek terwijl hij de grond in trilt, en pak dan de tweede uit het rek.',
    hint: 'Hang de plank stil boven het merkteken en houd hem daar; trillen duurt even. De grond is slap: kraanmatten en een rustige hand.',
    learningGoal: 'Een zware, hangende last lang precies op zijn plek houden.', difficulty: 3, craneOptions: ['lc300'], environment: 'riverBridge', timeOfDay: 'morning', weather: 'cloudy',
    crane: PILE_CRANE,
    loads: [
      { id: 'd1', type: 'sheetPile', x: PILE_TIP.x, y: 0.5, z: PILE_TIP.z, attached: true },
      { id: 'd2', type: 'sheetPile', x: 6, y: 0, z: -12 },
    ],
    zones: [
      zone('z1', 'Plank 1', 14, 0.3, 0.15, { z: 8, zTolerance: 0.15, yTolerance: 0.35 }),
      zone('z2', 'Plank 2', 15.1, 0.3, 0.15, { z: 8, zTolerance: 0.15, yTolerance: 0.35 }),
    ],
    obstacles: [
      box('rk1', 'support', 5.1, 0, 0.2, 5, { z0: -12.6, z1: -11.4, label: 'plankenrek', style: 'steel' }),
      box('rk2', 'support', 6.7, 0, 0.2, 5, { z0: -12.6, z1: -11.4, label: 'plankenrek', style: 'steel' }),
      box('rk3', 'support', 5.3, 0, 1.4, 5, { z0: -12.95, z1: -12.75, label: 'plankenrek', style: 'steel' }),
      box('rk4', 'support', 5.3, 0, 1.4, 5, { z0: -11.25, z1: -11.05, label: 'plankenrek', style: 'steel' }),
      box('dw0', 'wall', 9, 0, 4.2, 1.2, { z0: 7.65, z1: 8.35, label: 'bestaande damwand', style: 'steel' }),
    ],
    ground: [{ x0: -10, x1: 30, type: 'mud', quality: 0.55 }],
    groundFallback: 'gravel',
    tasks: [
      { type: 'deliver', loadId: 'd1', zoneId: 'z1', hold: 10, effect: { type: 'fix' }, label: 'Plank 1 de grond in trillen' },
      { type: 'deliver', loadId: 'd2', zoneId: 'z2', hold: 10, effect: { type: 'fix' }, label: 'Plank 2 de grond in trillen' },
    ],
    wind: { base: 3, gust: 0.3, direction: 1 }, parTime: 380, maxDamage: 25, requirements: { maxSwayDeg: 3 }, bounds: { minX: -30, maxX: 50 },
    reward: { money: 4800, xp: 760 },
  },
];

// ------------------------------------------------------------------ Hoofdstuk 12 — Industrie
export const CHAPTER_12: MissionDef[] = [
  {
    id: 'm57', number: 57, chapter: 12, title: 'Machineverhuizing door het dak',
    briefing: 'Een oude pers moet via de dakopening uit de hal, de nieuwe gaat erin. Het dak mag je niet raken. Volgens de papieren weegt de oude pers 26 t — maar machines zijn vaak zwaarder dan iemand nog weet.',
    hint: 'Til de oude pers eerst een handbreed op en kijk wat de lastmeter zegt. Klopt het niet met de papieren, controleer dan je straal voordat je verder gaat. De kabel moet recht door de opening.',
    learningGoal: 'Werkelijk gewicht controleren met een proefhijs.', difficulty: 4, craneOptions: ['at500'], environment: 'industrialPlant', timeOfDay: 'day', weather: 'clear',
    crane: { x: 0, boomAngleDeg: 64, boomLength: 30, ropeLength: 10, outriggersDeployed: true, counterweightIndex: 3 },
    loads: [
      { id: 'old', type: 'pressMachine', x: 16, y: 0, z: 0, massFactor: 1.2 },
      { id: 'new', type: 'pressMachine', x: -2, y: 1.3, z: -12 },
    ],
    zones: [
      zone('out', 'Afvoer (dieplader)', 0, 1.3, 0.5, { z: 12, zTolerance: 0.5 }),
      zone('in', 'Fundatie in de hal', 16, 0, 0.2, { z: 0, zTolerance: 0.2 }),
    ],
    obstacles: [
      ...lorry('dl1', -4, 12, 9, 1.3, 'dieplader'),
      ...lorry('dl2', -6, -12, 9, 1.3, 'dieplader'),
      box('roofW', 'roof', 10, 9, 3.5, 0.6, { z0: -9, z1: 9, label: 'hallendak', style: 'roof' }),
      box('roofE', 'roof', 18.5, 9, 9, 0.6, { z0: -9, z1: 9, label: 'hallendak', style: 'roof' }),
      box('roofN', 'roof', 13.5, 9, 5, 0.6, { z0: 2.6, z1: 9, label: 'hallendak', style: 'roof' }),
      box('roofS', 'roof', 13.5, 9, 5, 0.6, { z0: -9, z1: -2.6, label: 'hallendak', style: 'roof' }),
      box('wW', 'wall', 10, 0, 0.3, 9, { z0: -9, z1: 9, label: 'gevel', style: 'blockwall' }),
    ],
    tasks: [
      { type: 'deliver', loadId: 'old', zoneId: 'out', label: 'Oude pers eruit' },
      { type: 'deliver', loadId: 'new', zoneId: 'in', label: 'Nieuwe pers erin' },
    ],
    surprise: null,
    wind: { base: 3, gust: 0.3, direction: 1 }, parTime: 520, maxDamage: 20, requirements: { maxSwayDeg: 2.5 }, planning: { chooseCounterweight: true, plannedRadius: 18 }, bounds: { minX: -35, maxX: 50 },
    reward: { money: 9000, xp: 1200 },
  },
  {
    id: 'm58', number: 58, chapter: 12, title: 'Transformator in het onderstation',
    briefing: 'Wissel een transformator van 42 t in een onderstation waar de velden ernaast nog onder hoogspanning staan. Voor giek, kabel en last geldt een vaste veiligheidsafstand — de rode zones. Raken = afgekeurd.',
    hint: 'Teken de route in je hoofd voordat je hijst: tussen de twee spanningsvelden door, laag genoeg en met de giek steil. Een korte straal geeft marge op het lastdiagram én afstand tot de zones.',
    learningGoal: 'Hoogspanningszones respecteren met een zware last.', difficulty: 4, craneOptions: ['at500'], environment: 'industrialPlant', timeOfDay: 'morning', weather: 'cloudy',
    crane: { x: 0, boomAngleDeg: 58, boomLength: 30, ropeLength: 12, outriggersDeployed: true, counterweightIndex: 3 },
    loads: [{ id: 'tr', type: 'transformer', x: 12, y: 1.0, z: -10 }],
    zones: [zone('z1', 'Transformatorvak', 13, 1.0, 0.25, { z: 11, zTolerance: 0.25 })],
    obstacles: [
      box('ll', 'truck', 8, 0, 8, 1.0, { z0: -11.6, z1: -8.4, landable: true, label: 'dieplader', style: 'truckBed' }),
      box('pf', 'platform', 10.5, 0, 5, 1.0, { z0: 9.5, z1: 12.5, label: 'betonplatform', style: 'foundation' }),
      hazard('veld1', 21, 0, 10, 14, 4, 18, 'hoogspanningsveld 1', 'powerline'),
      hazard('veld2', 2, 0, 6, 14, 15, 24, 'hoogspanningsveld 2', 'powerline'),
    ],
    tasks: [{ type: 'deliver', loadId: 'tr', zoneId: 'z1' }],
    surprise: null,
    wind: { base: 3, gust: 0.3, direction: -1 }, parTime: 420, maxDamage: 15, requirements: { maxSwayDeg: 2.5 }, planning: { chooseCounterweight: true, plannedRadius: 17 }, bounds: { minX: -35, maxX: 50 },
    reward: { money: 10000, xp: 1300 },
  },
  {
    id: 'm59', number: 59, chapter: 12, title: 'Kolom op de zadels',
    briefing: 'Een destillatiekolom van 20 m en 26 t gaat met twee kranen op zijn zadels in de installatie. Jij tilt de top, je collega de voet. Het grote ronde oppervlak vangt veel wind.',
    hint: 'Werk langzaam, zodat je collega bij kan houden. Kijk naar de scheefstand en naar zijn belasting. Komt er wind, hou dan stil tot hij weer zakt.',
    learningGoal: 'Tandemhijs met een windgevoelige, lange last.', difficulty: 4, craneOptions: ['at500'], environment: 'industrialPlant', timeOfDay: 'day', weather: 'cloudy',
    crane: { x: 0, boomAngleDeg: 55, boomLength: 26, ropeLength: 6, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [{ id: 'kol', type: 'distColumn', x: 18, y: 0, z: -10 }],
    zones: [zone('z1', 'Zadels', 18, 3, 0.3, { z: 9 })],
    obstacles: [
      box('za1', 'support', 10.5, 0, 1.4, 3, { z0: 8, z1: 10, label: 'zadel', style: 'steel', landable: true }),
      box('za2', 'support', 24.5, 0, 1.4, 3, { z0: 8, z1: 10, label: 'zadel', style: 'steel', landable: true }),
      box('pr', 'pipe', 4, 7, 32, 1, { z0: 14, z1: 15, label: 'leidingbaan', style: 'pipeRack' }),
    ],
    tasks: [{ type: 'deliver', loadId: 'kol', zoneId: 'z1' }],
    tandem: { craneId: 'at500', start: partnerAbove('at500', 40, 'distColumn', 18, -10, 0), loadId: 'kol' },
    surprise: { type: 'gust', text: 'Windstoot op komst — met dat oppervlak gaat hij draaien. Stil houden!', speed: 9, duration: 16 },
    wind: { base: 3, gust: 0.35, direction: 1 }, parTime: 460, maxDamage: 20, requirements: {}, bounds: { minX: -30, maxX: 75 },
    reward: { money: 12000, xp: 1500 },
  },
  {
    id: 'm60', number: 60, chapter: 12, title: 'Stop in de raffinaderij',
    briefing: 'Onderhoudsstop: trek een warmtewisselaarbundel van 14 t uit zijn mantel en zet de gereviseerde bundel terug. Alles met werkvergunning en gasmeter. Slaat de gasmeter aan, dan ligt het werk direct stil.',
    hint: 'Achter de mantel loopt een leidingbaan en ernaast staat een kolom: houd giek en kabel er vrij van. Bij een gasalarm: alles stil, alleen zakken mag, tot de ruimte vrij is gegeven.',
    learningGoal: 'Werkstop en vergunningen in een raffinaderij.', difficulty: 4, craneOptions: ['at500'], environment: 'industrialPlant', timeOfDay: 'morning', weather: 'cloudy',
    crane: { x: 0, boomAngleDeg: 62, boomLength: 30, ropeLength: 10, outriggersDeployed: true, counterweightIndex: 3 },
    loads: [
      { id: 'oud', type: 'exchangerBundle', x: 15, y: 2, z: 9 },
      { id: 'rev', type: 'exchangerBundle', x: 10, y: 0, z: -11 },
    ],
    zones: [
      zone('ld', 'Afzetplaats', -4, 0, 0.8, { z: -12, zTolerance: 0.8 }),
      zone('in', 'Mantel (zadels)', 15, 2, 0.2, { z: 9, zTolerance: 0.2 }),
    ],
    obstacles: [
      box('s1', 'support', 12, 0, 0.8, 2, { z0: 8, z1: 10, label: 'zadel', style: 'steel', landable: true }),
      box('s2', 'support', 17.2, 0, 0.8, 2, { z0: 8, z1: 10, label: 'zadel', style: 'steel', landable: true }),
      box('pr1', 'pipe', 6, 6, 22, 1, { z0: 12.5, z1: 13.7, label: 'leidingbaan', style: 'pipeRack' }),
      box('tk', 'machine', 24, 0, 4, 9, { z0: 4, z1: 9, label: 'kolom', style: 'tank' }),
    ],
    tasks: [
      { type: 'deliver', loadId: 'oud', zoneId: 'ld', label: 'Bundel uittrekken en afzetten' },
      { type: 'deliver', loadId: 'rev', zoneId: 'in', label: 'Gereviseerde bundel terugzetten' },
    ],
    surprise: { type: 'stop', text: 'GASALARM! Werk stil, alleen de last laten zakken. Iedereen blijft op zijn plek.', seconds: 30, endText: 'Gasmeting is weer schoon. Vergunning is vrijgegeven, je mag verder.' },
    wind: { base: 3, gust: 0.3, direction: 1 }, parTime: 520, maxDamage: 20, requirements: {}, bounds: { minX: -35, maxX: 50 },
    reward: { money: 11000, xp: 1400 },
  },
  {
    id: 'm61', number: 61, chapter: 12, title: 'Koelmachine op het kantoordak',
    briefing: 'Zondagochtend, de straat is afgesloten. Een koelmachine van 9 t moet over het kantoorgebouw heen op het dak. Je ziet het dak niet: de seinman boven leidt je via de portofoon.',
    hint: 'Je zit in de cabine en ziet het dak niet. Werk op de stem van de seinman en de hoogtehulp. Verandert de plek, kijk dan opnieuw naar je straal.',
    learningGoal: 'Blind hijsen over een gebouw op aanwijzing.', difficulty: 4, craneOptions: ['at500'], environment: 'cityCenter', timeOfDay: 'morning', weather: 'cloudy',
    crane: { x: 0, boomAngleDeg: 68, boomLength: 40, ropeLength: 12, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [{ id: 'cu', type: 'coolingUnit', x: 8, y: 1.3, z: -9 }],
    zones: [
      zone('z1', 'Dakvak (gepland)', 22, 18, 0.35, { z: 10, zTolerance: 0.35 }),
      zone('z2', 'Dakvak boven de kolommen', 18, 18, 0.35, { z: 13, zTolerance: 0.35 }),
    ],
    obstacles: [...lorry('tr', 4, -9, 9, 1.3), box('kantoor', 'building', 8, 0, 22, 18, { z0: 6, z1: 22, label: 'kantoorgebouw', style: 'glass', landable: true })],
    cameraLock: 'cab',
    tasks: [{ type: 'deliver', loadId: 'cu', zoneId: 'z1' }],
    surprise: { type: 'change', text: 'Constructeur hier: dat dakvak draagt minder dan gedacht. Zet hem boven de kolommen, de nieuwe plek.', fromZone: 'z1', toZone: 'z2' },
    wind: { base: 4, gust: 0.35, direction: 1 }, parTime: 420, maxDamage: 20, requirements: { maxSwayDeg: 2.5 }, bounds: { minX: -35, maxX: 50 },
    reward: { money: 9000, xp: 1200 },
  },
];

// ------------------------------------------------------------------ Hoofdstuk 13 — Haven en energie
export const CHAPTER_13: MissionDef[] = [
  {
    id: 'm62', number: 62, chapter: 13, title: 'Projectlading uit het ruim',
    briefing: 'Een generator van 38 t ligt in het ruim van een vrachtschip. Hijs hem door het luik naar de kade zonder de luikranden te raken.',
    hint: 'Zet de kabel recht boven de last voordat je hijst — een schuine kabel trekt hem tegen de luikrand. Pas als hij boven de luikrand is, mag je zwenken.',
    learningGoal: 'Uit een ruim hijsen zonder de luikranden te raken.', difficulty: 4, craneOptions: ['lc300'], environment: 'port', timeOfDay: 'day', weather: 'cloudy',
    crane: { x: 0, boomAngleDeg: 66, boomOptionIndex: 1, ropeLength: 14, counterweightIndex: 2, preassembled: true },
    loads: [{ id: 'gen', type: 'generator', x: 22, y: 0.5, z: 0 }],
    zones: [zone('z1', 'Kade', -2, 0, 0.6, { z: -15, zTolerance: 0.6 })],
    obstacles: [
      box('bodem', 'ship', 12, 0, 22, 0.5, { z0: -7, z1: 7, label: 'ruim', style: 'ship', landable: true }),
      box('hW', 'ship', 12, 0.5, 6, 5, { z0: -7, z1: 7, label: 'luikrand', style: 'ship' }),
      box('hE', 'ship', 27, 0.5, 7, 5, { z0: -7, z1: 7, label: 'luikrand', style: 'ship' }),
      box('hN', 'ship', 18, 0.5, 9, 5, { z0: 4, z1: 7, label: 'luikrand', style: 'ship' }),
      box('hS', 'ship', 18, 0.5, 9, 5, { z0: -7, z1: -4, label: 'luikrand', style: 'ship' }),
    ],
    water: [[10, 45]],
    groundFallback: 'concrete',
    tasks: [{ type: 'deliver', loadId: 'gen', zoneId: 'z1' }],
    wind: { base: 5, gust: 0.4, direction: -1 }, parTime: 420, maxDamage: 20, requirements: {}, bounds: { minX: -35, maxX: 50 },
    reward: { money: 10000, xp: 1300 },
  },
  {
    id: 'm63', number: 63, chapter: 13, title: 'Hijsen vanaf een ponton',
    briefing: 'Je rupskraan staat op een ponton en plaatst betonblokken voor een nieuwe kademuur. Het ponton deint met de golven en helt over zodra de last naar buiten gaat. Er vaart af en toe een binnenvaartschip langs.',
    hint: 'Het ponton helt mee met het lastmoment: hoe verder de last naar buiten, hoe schuiner. Vang de deining op met de lier en wacht met neerzetten tot een rustig moment. Bij een boeggolf: stilhouden.',
    learningGoal: 'Hijsen vanaf een bewegende ondergrond.', difficulty: 5, craneOptions: ['lc300'], environment: 'port', timeOfDay: 'morning', weather: 'cloudy',
    crane: { x: 0, boomAngleDeg: 66, boomOptionIndex: 1, ropeLength: 12, counterweightIndex: 2, preassembled: true },
    loads: [
      { id: 'b1', type: 'concreteBlock', x: 8, y: 0, z: -6 },
      { id: 'b2', type: 'concreteBlock', x: 9, y: 0, z: -10 },
    ],
    zones: [
      zone('z1', 'Kademuur blok 1', 15.6, 1.0, 0.5, { z: 9, zTolerance: 0.5 }),
      zone('z2', 'Kademuur blok 2', 18.4, 1.0, 0.5, { z: 9, zTolerance: 0.5 }),
    ],
    obstacles: [box('fund', 'platform', 13, 0, 8, 1.0, { z0: 7.8, z1: 10.2, label: 'fundering kademuur', style: 'foundation' })],
    water: [[-40, 60]],
    craneMotion: { heave: 0.08, roll: 0.25, period: 6.5, heelPer100Tm: 1.0, waveAt: 70 },
    tasks: [
      { type: 'deliver', loadId: 'b1', zoneId: 'z1' },
      { type: 'deliver', loadId: 'b2', zoneId: 'z2' },
    ],
    surprise: null,
    wind: { base: 4, gust: 0.35, direction: 1 }, parTime: 420, maxDamage: 25, requirements: {}, bounds: { minX: -35, maxX: 50 },
    reward: { money: 9000, xp: 1300 },
  },
  {
    id: 'm64', number: 64, chapter: 13, title: 'Jacht te water',
    briefing: 'Een motorjacht van 24 t moet van de trailer in het water. Kwetsbaar, duur, en de eigenaar staat ernaast. De werf zegt dat het zwaartepunt in het midden ligt; de eigenaar weet zeker dat het naar achteren zit.',
    hint: 'Til eerst een handbreed op: hangt het jacht scheef, dan klopt het zwaartepunt niet. Met handmatig aanslaan kun je de hijspunten verschuiven. Zet hem héél zacht in het water.',
    learningGoal: 'Excentrisch zwaartepunt herkennen en een kwetsbare last neerzetten.', difficulty: 4, craneOptions: ['at500'], environment: 'port', timeOfDay: 'day', weather: 'clear',
    crane: { x: 0, boomAngleDeg: 60, boomLength: 26, ropeLength: 10, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [{ id: 'j', type: 'yacht', x: 6, y: 1.2, z: -10 }],
    zones: [zone('z1', 'In het water (bok)', 14, 0, 0.8, { z: 11, zTolerance: 0.8, angleTolDeg: 3 })],
    obstacles: [box('trl', 'truck', -2, 0, 16, 1.2, { z0: -11.8, z1: -8.2, landable: true, label: 'boottrailer', style: 'truckBed' })],
    water: [[6, 45]],
    tasks: [{ type: 'deliver', loadId: 'j', zoneId: 'z1' }],
    wind: { base: 3, gust: 0.3, direction: 1 }, parTime: 380, maxDamage: 10, requirements: { maxSwayDeg: 2.5 }, bounds: { minX: -35, maxX: 50 },
    reward: { money: 9000, xp: 1200 },
  },
  {
    id: 'm65', number: 65, chapter: 13, title: 'Rotorblad monteren',
    briefing: 'Een rotorblad van 44 m gaat horizontaal met de bladklem naar de naaf op 62 m hoogte. Het blad is licht, maar vangt enorm veel wind. Stuurlijnen en de windgrens bepalen alles.',
    hint: 'Gebruik stuurlijnen tegen het draaien. Til in een rustig moment, breng het blad zonder slingering naar de naaf en houd het stil tot de bouten erin zitten. Draait de wind, wacht dan.',
    learningGoal: 'Een groot, windgevoelig deel op hoogte monteren.', difficulty: 5, craneOptions: ['hl600'], environment: 'windFarm', timeOfDay: 'morning', weather: 'clear',
    crane: { x: 0, boomAngleDeg: 74, boomOptionIndex: 4, jibIndex: 0, ropeLength: 16, counterweightIndex: 2, preassembled: true },
    loads: [{ id: 'bl', type: 'bladeL', x: -2, y: 1, z: -18 }],
    zones: [zone('z1', 'Naaf (bladlager)', 24, 60, 0.25, { z: 8, zTolerance: 0.25, yTolerance: 0.25, yawDeg: 0, yawTolDeg: 8 })],
    obstacles: [
      box('bok1', 'platform', -18, 0, 3, 1, { z0: -19.6, z1: -16.4, label: 'transportbok', style: 'steel' }),
      box('bok2', 'platform', 8, 0, 3, 1, { z0: -19.6, z1: -16.4, label: 'transportbok', style: 'steel' }),
      box('tw', 'tower', 47.2, 0, 4.4, 57.5, { z0: 5.8, z1: 10.2, label: 'windturbinetoren', style: 'turbine' }),
    ],
    groundFallback: 'gravel',
    tasks: [{ type: 'deliver', loadId: 'bl', zoneId: 'z1', hold: 8, effect: { type: 'fix' }, label: 'Blad op de naaf houden tot de bouten zitten' }],
    surprise: { type: 'gust', text: 'De wind draait! Het blad gaat zich richten — stuurlijnen strak, niet zwenken.', speed: 9, duration: 18 },
    wind: { base: 4, gust: 0.35, direction: 1, variable: true }, parTime: 520, maxDamage: 12, requirements: { maxSwayDeg: 2 }, bounds: { minX: -50, maxX: 70 },
    reward: { money: 14000, xp: 1700 },
  },
  {
    id: 'm66', number: 66, chapter: 13, title: 'Zonnepanelen op het dak',
    briefing: 'Pallets zonnepanelen moeten verspreid over een groot plat dak, zonder één vak te zwaar te belasten. Het rode vak boven de oude hal mag helemaal niet belast worden — daar mag ook niets overheen.',
    hint: 'Plan de volgorde: de verste vakken eerst, zodat je niet over neergezette pallets heen hoeft. Blijf met de last buiten het rode vak.',
    learningGoal: 'Veel hijsen efficiënt plannen met een dakbelasting.', difficulty: 3, craneOptions: ['at60'], environment: 'industrialPlant', timeOfDay: 'day', weather: 'clear',
    crane: { x: 0, boomAngleDeg: 62, boomLength: 18, ropeLength: 6, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [
      { id: 'p1', type: 'solarPallet', x: 6, y: 1.3, z: -8 },
      { id: 'p2', type: 'solarPallet', x: 7.6, y: 1.3, z: -8 },
      { id: 'p3', type: 'solarPallet', x: 9.2, y: 1.3, z: -8 },
    ],
    zones: [
      zone('z1', 'Dakvak A', 16, 8, 0.6, { z: 12, zTolerance: 0.6 }),
      zone('z2', 'Dakvak B', 12, 8, 0.6, { z: 12, zTolerance: 0.6 }),
      zone('z3', 'Dakvak C', 8, 8, 0.6, { z: 12, zTolerance: 0.6 }),
    ],
    obstacles: [
      ...lorry('tr', 4.5, -8, 8, 1.3),
      box('hal', 'building', 4, 0, 22, 8, { z0: 9, z1: 22, label: 'bedrijfshal', style: 'concrete', landable: true }),
      hazard('zwak', 19, 8, 7, 14, 9, 22, 'dakvak dat niet belast mag worden', undefined, false),
    ],
    tasks: [
      { type: 'deliver', loadId: 'p1', zoneId: 'z1' },
      { type: 'deliver', loadId: 'p2', zoneId: 'z2' },
      { type: 'deliver', loadId: 'p3', zoneId: 'z3' },
    ],
    wind: { base: 4, gust: 0.35, direction: 1 }, parTime: 420, maxDamage: 25, requirements: {}, bounds: { minX: -30, maxX: 45 },
    reward: { money: 4200, xp: 680 },
  },
  {
    id: 'm67', number: 67, chapter: 13, title: 'Gondel wisselen',
    briefing: 'Een defecte gondel moet van de toren en de nieuwe erop. Je hebt een weervenster van een paar uur — en het weer sluit eerder dan voorspeld zodra de oude gondel beneden staat.',
    hint: 'Werk de oude gondel rustig naar beneden; daarna gaat de wind oplopen. Kijk naar de windgrens: haal je de nieuwe niet meer veilig omhoog, dan wacht je.',
    learningGoal: 'Zware hijs op grote hoogte binnen een weervenster.', difficulty: 5, craneOptions: ['hl600'], environment: 'windFarm', timeOfDay: 'morning', weather: 'cloudy',
    crane: { x: 0, boomAngleDeg: 74, boomOptionIndex: 5, jibIndex: 0, ropeLength: 20, counterweightIndex: 2, preassembled: true },
    loads: [
      { id: 'old', type: 'nacelle', x: 30.2, y: 80, z: 0 },
      { id: 'new', type: 'nacelle', x: -6, y: 1, z: -22 },
    ],
    zones: [
      zone('down', 'Afzetbok', -6, 1, 1.0, { z: 22, zTolerance: 1.0 }),
      zone('up', 'Toptoren (yaw-lager)', 30.2, 80, 0.12, { angleTolDeg: 2 }),
    ],
    obstacles: [
      box('stand1', 'platform', -13, 0, 14, 1, { z0: -24.1, z1: -19.9, label: 'transportbok', style: 'steel' }),
      box('stand2', 'platform', -13, 0, 14, 1, { z0: 19.9, z1: 24.1, label: 'afzetbok', style: 'steel', landable: true }),
      box('tower', 'tower', 28, 0, 4.4, 80, { label: 'windturbinetoren', style: 'turbine', landable: true }),
    ],
    groundFallback: 'gravel',
    mats: 'large',
    tasks: [
      { type: 'deliver', loadId: 'old', zoneId: 'down', label: 'Oude gondel naar beneden' },
      { type: 'deliver', loadId: 'new', zoneId: 'up', label: 'Nieuwe gondel op de toren' },
    ],
    windRamp: { to: 9, over: 240, afterPlaced: 1, text: 'Weervenster sluit eerder: de wind loopt op. Als het boven de grens komt, stop je.' },
    surprise: null,
    wind: { base: 4, gust: 0.35, direction: -1, variable: true }, parTime: 720, maxDamage: 12, requirements: { maxSwayDeg: 2.5 }, bounds: { minX: -50, maxX: 70 },
    reward: { money: 18000, xp: 2000 },
  },
];

// ------------------------------------------------------------------ Hoofdstuk 14 — Bijzondere klussen
export const CHAPTER_14: MissionDef[] = [
  {
    id: 'm68', number: 68, chapter: 14, title: 'Zwembad over het huis',
    briefing: 'Een polyester zwembad moet vanaf de straat over het huis heen in de achtertuin. Een klassieker: je ziet de tuin niet en werkt volledig op de portofoon van de seinman achter het huis.',
    hint: 'Je zit in de cabine. Hoog over de nok, dan pas zakken. Valt de seinman weg, dan stop je — direct, en je wacht tot hij er weer is.',
    learningGoal: 'Blind hijsen over een dak op de portofoon.', difficulty: 4, craneOptions: ['at60'], environment: 'cityCenter', timeOfDay: 'morning', weather: 'clear',
    crane: { x: 0, boomAngleDeg: 66, boomLength: 22, ropeLength: 6, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [{ id: 'zw', type: 'pool', x: 6, y: 1.3, z: -8 }],
    zones: [zone('z1', 'Uitgegraven put', 12, 0, 0.35, { z: 16, zTolerance: 0.35, yawDeg: 0, yawTolDeg: 6 })],
    obstacles: [
      ...lorry('tr', 2, -8, 9, 1.3),
      box('huis', 'building', 5, 0, 12, 9, { z0: 5, z1: 12, label: 'woonhuis', style: 'brick', landable: false }),
      box('schutting', 'fence', 3, 0, 16, 2, { z0: 20, z1: 20.2, label: 'schutting', style: 'fence' }),
    ],
    cameraLock: 'cab',
    tasks: [{ type: 'deliver', loadId: 'zw', zoneId: 'z1' }],
    surprise: { type: 'stop', text: '… (de seinman valt weg — geen verbinding) … Stop! Zonder seinman beweeg je niets.', seconds: 15, endText: 'Seinman: hoor je me weer? Sorry, batterij. We gaan verder.' },
    wind: { base: 3, gust: 0.3, direction: 1 }, parTime: 360, maxDamage: 20, requirements: { maxSwayDeg: 3 }, bounds: { minX: -30, maxX: 45 },
    reward: { money: 4000, xp: 700 },
  },
  {
    id: 'm69', number: 69, chapter: 14, title: 'Boom in delen',
    briefing: 'Een zieke boom naast een huis kan niet veilig vallen. De boomverzorger slaat de kroon en dan het stamdeel aan en zaagt; jij houdt het stuk vast en zet het op de wagen. Het gewicht van een stuk hout is altijd een schatting.',
    hint: 'Hout dat losgezaagd wordt springt op als het loskomt. Hou de kabel strak maar niet te strak, en kijk naar de lastmeter: is een stuk zwaarder dan geschat, controleer dan je straal.',
    learningGoal: 'Onbekend gewicht en een last die plots loskomt.', difficulty: 4, craneOptions: ['at60'], environment: 'cityCenter', timeOfDay: 'day', weather: 'cloudy',
    crane: { x: 0, boomAngleDeg: 68, boomLength: 20, ropeLength: 6, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [
      { id: 'kr', type: 'treeCrown', x: 12, y: 9, z: 8, stuckT: 0.8 },
      { id: 'st', type: 'treeTrunk', x: 12, y: 5, z: 8, stuckT: 1.2, massFactor: 1.6 },
    ],
    zones: [
      zone('z1', 'Containerwagen', 4, 1.3, 0.8, { z: -9, zTolerance: 0.8 }),
      zone('z2', 'Containerwagen', 8, 1.3, 0.8, { z: -9, zTolerance: 0.8 }),
    ],
    obstacles: [
      box('stam', 'support', 11.6, 0, 0.8, 5, { z0: 7.6, z1: 8.4, label: 'stam', style: 'concrete', landable: true }),
      box('huis', 'building', 15, 0, 10, 8, { z0: 3, z1: 14, label: 'woonhuis', style: 'brick', landable: false }),
      ...lorry('cw', 1, -9, 10, 1.3, 'containerwagen'),
    ],
    tasks: [
      { type: 'deliver', loadId: 'kr', zoneId: 'z1', label: 'Kroon op de wagen' },
      { type: 'deliver', loadId: 'st', zoneId: 'z2', label: 'Stamdeel op de wagen' },
    ],
    surprise: null,
    wind: { base: 3, gust: 0.35, direction: 1 }, parTime: 400, maxDamage: 30, requirements: {}, bounds: { minX: -30, maxX: 45 },
    reward: { money: 3800, xp: 680 },
  },
  {
    id: 'm70', number: 70, chapter: 14, title: 'Berging na een ongeval',
    briefing: 'Een gekantelde vrachtwagen ligt in de berm. De politie wil de weg zo snel mogelijk open, de lading is onbekend en de cabine mag niet verder beschadigen. Hij ligt ook nog half in de modder.',
    hint: 'Onbekende lading = onbekend gewicht. Bouw de trekkracht rustig op en kijk naar de lastmeter voordat hij loskomt. Het zwaartepunt ligt niet in het midden.',
    learningGoal: 'Berging: onbekend gewicht, vreemd zwaartepunt en tijdsdruk.', difficulty: 4, craneOptions: ['at500'], environment: 'roughTerrain', timeOfDay: 'night', weather: 'rain',
    crane: { x: 0, boomAngleDeg: 60, boomLength: 26, ropeLength: 10, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [{ id: 'wr', type: 'wreck', x: 12, y: 0, z: 9, massFactor: 1.3, stuckT: 4 }],
    zones: [zone('z1', 'Dieplader', 8, 1.2, 0.6, { z: -10, zTolerance: 0.5 })],
    obstacles: [
      box('dl', 'truck', 2, 0, 13, 1.2, { z0: -11.4, z1: -8.6, landable: true, label: 'dieplader', style: 'truckBed' }),
      box('gb', 'barrier', -10, 0, 50, 0.9, { z0: 5, z1: 5.6, label: 'vangrail', style: 'concrete' }),
    ],
    ground: [{ x0: 5, x1: 25, type: 'mud', quality: 0.5 }],
    groundFallback: 'asphalt',
    tasks: [{ type: 'deliver', loadId: 'wr', zoneId: 'z1' }],
    surprise: null,
    wind: { base: 3, gust: 0.35, direction: 1 }, timeLimit: 720, parTime: 400, maxDamage: 25, requirements: {}, bounds: { minX: -35, maxX: 50 },
    reward: { money: 9000, xp: 1200 },
  },
  {
    id: 'm71', number: 71, chapter: 14, title: 'Sloop: betondeel losnemen',
    briefing: 'Bij de gecontroleerde sloop van een parkeergarage worden vloerdelen losgezaagd en weggehesen. Er zit nog wapening vast: als een deel losscheurt krijgt de kraan een klap en schiet de last omhoog.',
    hint: 'Hijs recht boven het deel en bouw de kracht rustig op. Hou de lastmeter in de gaten en geef de zagers de tijd. Komt hij los: vang de slingering op voordat je zwenkt.',
    learningGoal: 'Een vastzittende last die plots loskomt.', difficulty: 4, craneOptions: ['lc300'], environment: 'cityCenter', timeOfDay: 'day', weather: 'cloudy',
    crane: { x: 0, boomAngleDeg: 70, boomOptionIndex: 1, ropeLength: 14, counterweightIndex: 2, preassembled: true },
    loads: [
      { id: 'd1', type: 'demoSegment', x: 16, y: 9, z: 6, stuckT: 6 },
      { id: 'd2', type: 'demoSegment', x: 16, y: 9, z: 10, stuckT: 9 },
    ],
    zones: [
      zone('z1', 'Puinvak', 2, 0, 1.0, { z: -14, zTolerance: 1.0 }),
      zone('z2', 'Puinvak', 7, 0, 1.0, { z: -14, zTolerance: 1.0 }),
    ],
    obstacles: [box('garage', 'building', 12, 0, 10, 9, { z0: 3, z1: 14, label: 'parkeergarage', style: 'skeleton', landable: true })],
    tasks: [
      { type: 'deliver', loadId: 'd1', zoneId: 'z1' },
      { type: 'deliver', loadId: 'd2', zoneId: 'z2' },
    ],
    surprise: null,
    wind: { base: 3, gust: 0.3, direction: -1 }, parTime: 420, maxDamage: 30, requirements: {}, bounds: { minX: -35, maxX: 50 },
    reward: { money: 8000, xp: 1100 },
  },
  {
    id: 'm72', number: 72, chapter: 14, title: 'De torenspits',
    briefing: 'De koperen spits van de dorpskerk gaat eraf voor restauratie. Oud, kwetsbaar, met pers en publiek erbij. De spits zit vaster aan de toren dan de restaurateur dacht.',
    hint: 'De spits zit vast: bouw de trekkracht héél rustig op. Een spits die losschiet zwiept en raakt de toren. Zet hem zacht op de bok; elke stoot is schade aan eeuwenoud koper.',
    learningGoal: 'Een kwetsbare last die vastzit, op grote hoogte.', difficulty: 4, craneOptions: ['at500'], environment: 'cityCenter', timeOfDay: 'morning', weather: 'clear',
    crane: { x: 0, boomAngleDeg: 72, boomLength: 40, ropeLength: 10, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [{ id: 'sp', type: 'spire', x: 18, y: 28, z: 6, stuckT: 3 }],
    zones: [zone('z1', 'Restauratiebok', 6, 0.8, 0.4, { z: -12, zTolerance: 0.4 })],
    obstacles: [
      box('toren', 'building', 15.5, 0, 5, 28, { z0: 3.5, z1: 8.5, label: 'kerktoren', style: 'brick', landable: true }),
      box('kerk', 'building', 21, 0, 18, 14, { z0: 1, z1: 11, label: 'kerk', style: 'brick', landable: false }),
      box('bok', 'platform', 4, 0, 4, 0.8, { z0: -14, z1: -10, label: 'bok', style: 'steel' }),
      hazard('publiek', -20, 0, 14, 30, 6, 16, 'publiek en pers', undefined, false),
    ],
    tasks: [{ type: 'deliver', loadId: 'sp', zoneId: 'z1' }],
    surprise: null,
    wind: { base: 3, gust: 0.3, direction: 1 }, parTime: 400, maxDamage: 10, requirements: { maxSwayDeg: 2.5 }, bounds: { minX: -35, maxX: 50 },
    reward: { money: 9000, xp: 1300 },
  },
  {
    id: 'm73', number: 73, chapter: 14, title: 'Mensen in de werkbak',
    briefing: 'Twee monteurs moeten naar een gevelanker op 14 m hoogte. Personen hijsen mag alleen met een gekeurde werkbak, maximaal 50 % van het lastdiagram, op halve snelheid en zonder slingering. Breng ze omhoog, houd ze stil tijdens het werk en zet ze weer veilig op de grond.',
    hint: 'De kraan beweegt automatisch op halve snelheid. Ga rustig, rem nog eerder af dan normaal en houd de bak doodstil bij de gevel. Neemt de wind toe, breng ze dan naar beneden.',
    learningGoal: 'Personen hijsen volgens de regels.', difficulty: 3, craneOptions: ['at60'], environment: 'cityCenter', timeOfDay: 'day', weather: 'clear',
    crane: { x: 0, boomAngleDeg: 64, boomLength: 20, ropeLength: 5, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [{ id: 'wb', type: 'manBasket', x: 7, y: 0, z: -7 }],
    zones: [
      zone('up', 'Bij het gevelanker', 12, 14, 0.4, { z: 9.4, zTolerance: 0.3, yTolerance: 0.4 }),
      zone('down', 'Opstapplaats', 7, 0, 0.5, { z: -7, zTolerance: 0.5 }),
    ],
    obstacles: [box('gevel', 'building', 4, 0, 16, 22, { z0: 10.2, z1: 22, label: 'gevel', style: 'brick', landable: false })],
    tasks: [
      { type: 'deliver', loadId: 'wb', zoneId: 'up', hold: 10, keep: true, label: 'Werkbak stil bij het gevelanker' },
      { type: 'deliver', loadId: 'wb', zoneId: 'down', label: 'Monteurs veilig terug op de grond' },
    ],
    windRamp: { to: 8, over: 120, at: 60, text: 'De wind neemt toe terwijl ze boven staan. Rustig, geen schokken.' },
    surprise: null,
    wind: { base: 3, gust: 0.3, direction: 1 }, parTime: 380, maxDamage: 5, requirements: { personnel: true, maxLoadPercent: 50, maxSwayDeg: 3, ordered: true }, bounds: { minX: -30, maxX: 45 },
    reward: { money: 3600, xp: 700 },
  },
];
