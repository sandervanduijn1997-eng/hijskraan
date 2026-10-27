import { getCrane } from '../../cranes/config/cranes';
import type { CraneId } from '../../cranes/config/types';
import { resolveCrane } from '../../cranes/models/craneSpec';
import { solveBoomIK } from '../../cranes/models/kinematics';
import type { CraneStartConfig } from '../../cranes/models/craneState';
import { RAD } from '../../utils/math';
import { box, zone } from './builders';
import { LOADS } from './loads';
import type { MissionDef } from './types';

/**
 * Startopstelling van de collega-kraan: giekpunt recht boven einde B van de tandemlast, zodat zijn
 * kabel bij het aanslaan verticaal hangt.
 */
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

// ------------------------------------------------------------------ Hoofdstuk 9 — Samen hijsen (tandem)
export const CHAPTER_9: MissionDef[] = [
  {
    id: 'm41', number: 41, chapter: 9, title: 'Twee kranen, één ligger',
    briefing: 'Een stalen plaatligger van 16 m is te lang om met één kraan veilig te draaien. Jij slaat einde A aan, je collega met de tweede AT 60 einde B. Breng hem samen naar het montagevak aan de overkant.',
    hint: 'Je collega volgt jouw einde, maar niet sneller dan hij kan. Hijs en zwenk rustig, en kijk naar de belasting van zijn kraan: loopt die op, dan werk je te snel of trekken de kabels schuin.',
    learningGoal: 'Tandemhijs: gelijk werken met een tweede kraan.', difficulty: 3, craneOptions: ['at60'], environment: 'constructionSite', timeOfDay: 'morning', weather: 'clear',
    crane: { x: 0, boomAngleDeg: 50, boomLength: 12, ropeLength: 5, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [{ id: 'g1', type: 'girder18', x: 12, y: 0, z: -8 }],
    zones: [zone('z1', 'Montagevak', 12, 0, 0.6, { z: 8 })],
    obstacles: [box('c1', 'container', 10, 0, 4, 2.6, { z0: -1.3, z1: 1.3, label: 'bouwkeet', style: 'container' })],
    tasks: [{ type: 'deliver', loadId: 'g1', zoneId: 'z1' }],
    tandem: { craneId: 'at60', start: partnerAbove('at60', 26, 'girder18', 12, -8, 0), loadId: 'g1' },
    wind: { base: 2, gust: 0.3, direction: 1 }, parTime: 300, maxDamage: 25, requirements: {}, bounds: { minX: -30, maxX: 60 },
    reward: { money: 6000, xp: 900 },
  },
  {
    id: 'm42', number: 42, chapter: 9, title: 'Prefab brugligger',
    briefing: 'Een voorgespannen brugligger van 48 ton moet op de twee landhoofden. Twee AT 500 werken samen: jij aan einde A, je collega aan einde B. Op de opleggingen is maar weinig ruimte.',
    hint: 'De ligger is lang: een kleine scheefstand betekent al een groot hoogteverschil tussen de einden. Laat de laatste meter heel langzaam zakken, zodat beide einden tegelijk op de opleggingen komen.',
    learningGoal: 'Zware tandemhijs met nauwkeurig neerzetten.', difficulty: 4, craneOptions: ['at500'], environment: 'riverBridge', timeOfDay: 'day', weather: 'cloudy',
    crane: { x: 0, boomAngleDeg: 55, boomLength: 26, ropeLength: 6, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [{ id: 'pb', type: 'precastBeam', x: 22, y: 0, z: -11 }],
    zones: [zone('z1', 'Opleggingen', 22, 5, 0.35, { z: 9 })],
    obstacles: [
      box('ab1', 'support', 7, 0, 2.4, 5, { z0: 7.5, z1: 10.5, label: 'landhoofd west', style: 'concrete', landable: true }),
      box('ab2', 'support', 34.6, 0, 2.4, 5, { z0: 7.5, z1: 10.5, label: 'landhoofd oost', style: 'concrete', landable: true }),
    ],
    tasks: [{ type: 'deliver', loadId: 'pb', zoneId: 'z1' }],
    tandem: { craneId: 'at500', start: partnerAbove('at500', 46, 'precastBeam', 22, -11, 0), loadId: 'pb' },
    wind: { base: 3, gust: 0.3, direction: -1 }, parTime: 420, maxDamage: 20, requirements: { outriggers: true }, bounds: { minX: -30, maxX: 80 },
    reward: { money: 12000, xp: 1400 },
  },
  {
    id: 'm43', number: 43, chapter: 9, title: 'Leidingbrug over de weg',
    briefing: 'Een leidingbrugsectie moet over de fabrieksweg op de twee portalen. Jouw AT 60 werkt samen met een rough-terrain kraan; die is anders van karakter, dus pas je tempo aan op je collega.',
    hint: 'Twee verschillende kranen reageren verschillend. Til eerst een halve meter op en kijk of hij waterpas blijft voordat je gaat zwenken.',
    learningGoal: 'Tandemhijs met twee verschillende kranen.', difficulty: 4, craneOptions: ['at60'], environment: 'industrialPlant', timeOfDay: 'overcast', weather: 'cloudy',
    crane: { x: 0, boomAngleDeg: 55, boomLength: 12, ropeLength: 5, outriggersDeployed: true, counterweightIndex: 2 },
    loads: [{ id: 'pr', type: 'pipeRack', x: 11, y: 0, z: -8 }],
    zones: [zone('z1', 'Portalen', 11, 4, 0.4, { z: 8 })],
    obstacles: [
      box('po1', 'support', 3.4, 0, 1.2, 4, { z0: 6.5, z1: 9.5, label: 'portaal west', style: 'steel', landable: true }),
      box('po2', 'support', 17.4, 0, 1.2, 4, { z0: 6.5, z1: 9.5, label: 'portaal oost', style: 'steel', landable: true }),
    ],
    tasks: [{ type: 'deliver', loadId: 'pr', zoneId: 'z1' }],
    tandem: { craneId: 'rt80', start: partnerAbove('rt80', 23, 'pipeRack', 11, -8, 0), loadId: 'pr' },
    wind: { base: 3, gust: 0.4, direction: 1 }, parTime: 360, maxDamage: 20, requirements: {}, bounds: { minX: -30, maxX: 60 },
    reward: { money: 9000, xp: 1200 },
  },
];
