import { CRANES } from '../../cranes/config/cranes';
import { TOWER_ERECTION_SECTIONS, TOWER_HEAD_H, erectionLayout } from '../../cranes/models/towerErection';
import { zone } from './builders';
import type { LoadSpawn, MissionDef, TaskDef, TowerAssemblyDef, ZoneDef } from './types';

/** Extra richttijd voor de montage met de hulpkraan (s). */
export const TOWER_ASSEMBLY_PAR = 720;
/** Giek wijst tijdens de montage van het werkterrein af (naar −x), zodat hij niet door hoge gebouwen gaat. */
const ERECT_SLEW_DEG = 180;
const PREINSTALLED = 1;

/** Ids van alle lasten die bij de montage horen (voor validatie en weergave). */
export const isAssemblyLoad = (id: string): boolean => id.startsWith('tw-');

/**
 * Voeg de montage van de torenkraan met een mobiele hulpkraan toe aan een torenkraanmissie.
 *
 * Opstelling: torenkraan op `m.crane.x`, z = 0. De hulpkraan staat 14 m achter de toren (z = −14),
 * de onderdelen liggen tussen beide in. Volgorde zoals op de bouwplaats: hulpkraan opstempelen →
 * mastsecties tot montagehoogte → draaikrans met cabine → torenkop → tegengiek → eerste ballastblok →
 * giek → resterende ballast → hulpkraan in transportstand → overstappen → torenkraan klimt naar werkhoogte.
 */
export function withTowerAssembly(m: MissionDef): MissionDef {
  const cfg = CRANES.tc160;
  const tx = m.crane.x;
  const L = erectionLayout(cfg, tx, 0, ERECT_SLEW_DEG);
  const assembly: TowerAssemblyDef = {
    assistCrane: 'at500',
    assist: { x: tx - 6.5, z: -14, slewDeg: 45, boomAngleDeg: 30, boomLength: 15.5, ropeLength: 5, outriggersDeployed: false, counterweightIndex: 1 },
    erectSlewDeg: ERECT_SLEW_DEG,
    preinstalledSections: PREINSTALLED,
  };
  const cjX = (L.counterJib.x0 + L.counterJib.x1) / 2;
  const jibX = (L.jib.x0 + L.jib.x1) / 2;
  const row = -6;
  const loads: LoadSpawn[] = [];
  const zones: ZoneDef[] = [];
  const tasks: TaskDef[] = [{ type: 'outriggers', label: 'Hulpkraan opstempelen' }];
  const part = (id: string, type: string, x: number, z: number, zn: ZoneDef, label: string, partKind: Parameters<typeof towerTask>[3], hold?: number) => {
    loads.push({ id, type, x, y: 0, z });
    zones.push(zn);
    tasks.push(towerTask(id, zn.id, label, partKind, hold));
  };

  let sx = tx + 2.8;
  for (let n = PREINSTALLED + 1; n <= TOWER_ERECTION_SECTIONS; n++) {
    part(`tw-m${n}`, 'towerMast', sx, row, zone(`tw-zm${n}`, `Mastsectie ${n}`, tx, L.mastTop(n - 1), 0.2, { zTolerance: 0.2, angleTolDeg: 3 }), n === TOWER_ERECTION_SECTIONS ? `Mastsectie ${n} plaatsen (montagehoogte)` : `Mastsectie ${n} op de voetsectie`, 'mast');
    sx += 2.2;
  }
  part('tw-su', 'towerSlewing', tx + 7.6, row, zone('tw-zsu', 'Draaikrans', tx, L.mastTop(TOWER_ERECTION_SECTIONS), 0.2, { zTolerance: 0.2, angleTolDeg: 3 }), 'Draaikrans met cabine op de mast', 'slewingUnit');
  part('tw-th', 'towerHead', tx + 10.2, row, zone('tw-zth', 'Torenkop', tx, L.deckY, 0.15, { zTolerance: 0.15, angleTolDeg: 2 }), 'Torenkop (A-bok) op de draaikrans', 'towerHead');
  part('tw-cj', 'towerCounterJib', cjX, -9.5, zone('tw-zcj', 'Tegengiek', cjX, L.counterJib.y0, 0.3, { zTolerance: 0.3, yTolerance: 0.25, angleTolDeg: 2 }), 'Tegengiek inhangen — stil houden tot pennen en trekstangen vastzitten', 'counterJib', 3);
  const slotY = L.counterJib.y1;
  part('tw-b1', 'towerBallast6', tx + 12.4, row, zone('tw-zb1', 'Ballast 1', L.ballastSlots[0], slotY, 0.15, { zTolerance: 0.25, angleTolDeg: 3 }), 'Ballast deel 1: één blok (6 t) — vóór de giek', 'ballast');
  part('tw-jb', 'towerJib', jibX, -5.5, zone('tw-zjb', 'Giek', jibX, L.jib.y0, 0.35, { zTolerance: 0.3, yTolerance: 0.25, angleTolDeg: 1.5 }), 'Giek inhangen — stil houden tot pennen en trekstangen vastzitten', 'jib', 4);
  part('tw-b2', 'towerBallast9', tx + 14.2, row, zone('tw-zb2', 'Ballast 2', L.ballastSlots[1], slotY, 0.15, { zTolerance: 0.25, angleTolDeg: 3 }), 'Ballast deel 2: blok 2 (9 t)', 'ballast');
  part('tw-b3', 'towerBallast9', tx + 16.0, row, zone('tw-zb3', 'Ballast 3', L.ballastSlots[2], slotY, 0.15, { zTolerance: 0.25, angleTolDeg: 3 }), 'Ballast deel 2: blok 3 (9 t)', 'ballast');
  tasks.push(
    { type: 'stow', label: 'Hulpkraan in transportstand (giek in en neer, haak op)' },
    { type: 'switchCrane', label: 'Overstappen naar de torenkraan' },
    { type: 'setup', label: 'Torenkraan naar werkhoogte klimmen (houd B)' },
  );

  return {
    ...m,
    assembly,
    // na de montage staat de giek naar −x; de speler draait hem zelf naar het werkterrein.
    // De haak hangt hoog: tijdens het klimmen viert de lier mee, zodat hij op dezelfde hoogte blijft.
    crane: { ...m.crane, slewDeg: ERECT_SLEW_DEG, ropeLength: 6 },
    loads: [...loads, ...m.loads],
    zones: [...zones, ...m.zones],
    tasks: [...tasks, ...m.tasks],
    parTime: m.parTime + TOWER_ASSEMBLY_PAR,
    bounds: { minX: Math.min(m.bounds.minX, tx - 72), maxX: m.bounds.maxX },
    hint: `${m.hint} Montage: stempel de hulpkraan op en hijs de delen in de aangegeven volgorde. Giek en tegengiek houd je stil in positie tot de monteurs ze hebben vastgezet. Daarna klimt de torenkraan zelf naar werkhoogte (B).`,
  };
}

/**
 * Torenkraanmissie waarbij de kraan er al staat (na missie 12): direct met de opdracht beginnen.
 * Opnieuw zelf opbouwen kan in de planning en levert bonus-XP op (zie withOptionalAssembly).
 */
export function towerStanding(m: MissionDef): MissionDef {
  return { ...m, assemblyOptional: true, crane: { ...m.crane, preassembled: true } };
}

/** Bonus-XP voor zelf opbouwen. */
export const ASSEMBLY_XP_BONUS = 0.5;

/** De missie met de volledige montage (de speler koos zelf opbouwen in de planning). */
export function withOptionalAssembly(m: MissionDef): MissionDef {
  const a = withTowerAssembly({ ...m, crane: { ...m.crane, preassembled: false } });
  return { ...a, assemblyOptional: false, reward: { ...a.reward, xp: Math.round(a.reward.xp * (1 + ASSEMBLY_XP_BONUS)) } };
}

function towerTask(loadId: string, zoneId: string, label: string, part: 'mast' | 'slewingUnit' | 'towerHead' | 'counterJib' | 'jib' | 'ballast', hold?: number): TaskDef {
  return { type: 'deliver', loadId, zoneId, label, inOrder: true, hold, effect: { type: 'towerPart', part } };
}

/** Hoogte van de top van de torenkop op montagehoogte (voor validatie). */
export const towerHeadTop = (): number => erectionLayout(CRANES.tc160, 0, 0, ERECT_SLEW_DEG).deckY + TOWER_HEAD_H;
