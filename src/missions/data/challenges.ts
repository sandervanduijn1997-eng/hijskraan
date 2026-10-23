import { withTowerAssembly } from './towerAssembly';
import { getCrane } from '../../cranes/config/cranes';
import type { CraneId } from '../../cranes/config/types';
import type { ScoreMetrics } from '../runtime/scoring';
import { getMission } from './index';
import { getLoad } from './loads';
import type { EnvironmentId, MissionDef } from './types';

export type ChallengeKind = 'fastest' | 'minSway' | 'perfectLanding' | 'noCollision' | 'minFuel' | 'confined';

export interface ChallengeDef {
  id: string;
  kind: ChallengeKind;
  title: string;
  description: string;
  baseMissionId: string;
  /** Beoordeling 0..100 op basis van de meetwaarden (alleen bij een geslaagde missie). */
  rate: (m: ScoreMetrics) => { score: number; value: string; pass: boolean };
}

const clamp100 = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export const CHALLENGES: ChallengeDef[] = [
  {
    id: 'ch-fast', kind: 'fastest', title: 'Snelste veilige hijs', baseMissionId: 'm12',
    description: 'Beton naar de derde verdieping, zo snel mogelijk — maar elke veiligheidsovertreding of overbelasting diskwalificeert.',
    rate: (m) => ({ pass: m.safetyViolations === 0 && m.overloadTime === 0, score: clamp100(100 - (m.time - 60) * 0.8), value: `${m.time.toFixed(1)} s` }),
  },
  {
    id: 'ch-sway', kind: 'minSway', title: 'Minimale slingering', baseMissionId: 'm03',
    description: 'Verplaats de stalen balk met zo min mogelijk slinger. Doel: onder 1,5°.',
    rate: (m) => ({ pass: m.maxSwayDeg <= 4, score: clamp100(100 - m.maxSwayDeg * 20), value: `${m.maxSwayDeg.toFixed(2)}°` }),
  },
  {
    id: 'ch-landing', kind: 'perfectLanding', title: 'Perfecte landing', baseMissionId: 'm02',
    description: 'Zet de container exact in het midden van het vak, zonder harde landing.',
    rate: (m) => {
      const err = m.placementErrors[0] ?? 1;
      return { pass: m.damage < 1, score: clamp100(100 - err * 100 - m.damage * 10), value: `${Math.round((1 - err) * 100)} % nauwkeurig` };
    },
  },
  {
    id: 'ch-clean', kind: 'noCollision', title: 'Geen enkele botsing', baseMissionId: 'm07',
    description: 'Stalen ligger op de kolommen zonder één aanraking van kabel, giek of last.',
    rate: (m) => ({ pass: m.collisions === 0, score: m.collisions === 0 ? clamp100(100 - m.maxSwayDeg * 5) : 0, value: `${m.collisions} botsingen` }),
  },
  {
    id: 'ch-fuel', kind: 'minFuel', title: 'Minimaal brandstofverbruik', baseMissionId: 'm09',
    description: 'Plaats de funderingsblokken met zo min mogelijk diesel. Onnodige bewegingen kosten brandstof.',
    rate: (m) => ({ pass: true, score: clamp100(100 * (m.fuelPar / Math.max(0.01, m.fuelUsed)) - 20), value: `${m.fuelUsed.toFixed(2)} l` }),
  },
  {
    id: 'ch-confined', kind: 'confined', title: 'Beperkte werkruimte', baseMissionId: 'm16',
    description: 'De machine naar de productielijn, maar het hallendak hangt nu een meter lager.',
    rate: (m) => ({ pass: m.collisions === 0, score: clamp100(100 - m.time * 0.15 - m.collisions * 30), value: `${m.time.toFixed(0)} s` }),
  },
];

/** Bouw de missiedefinitie voor een uitdaging. */
export function challengeMission(c: ChallengeDef): MissionDef {
  const base = getMission(c.baseMissionId)!;
  const m: MissionDef = structuredClone(base);
  m.id = `${c.id}`;
  m.title = c.title;
  m.briefing = c.description;
  m.timeLimit = undefined;
  if (c.kind === 'confined') {
    m.obstacles = m.obstacles.map((o) => (o.kind === 'ceiling' ? { ...o, y: o.y - 1 } : o));
    m.requirements = { ...m.requirements, noCollision: true };
  }
  if (c.kind === 'noCollision') m.requirements = { ...m.requirements, noCollision: true };
  return m;
}

export interface PracticeOptions {
  craneId: CraneId;
  loadType: string;
  environment: EnvironmentId;
  windBase: number;
  gravity: number;
}

/** Vrije oefening: een open terrein met één last en één doelzone binnen het bereik van de kraan. */
export function practiceMission(o: PracticeOptions): MissionDef {
  const cfg = getCrane(o.craneId);
  const gb = cfg.gameBalance;
  const load = getLoad(o.loadType);
  const slewX = gb.slewOffsetX;
  const half = cfg.visual.carrierLength / 2;
  let reach: number;
  if (cfg.kind === 'tower') reach = (gb.jibLength ?? 30) * 0.7;
  else if (cfg.kind === 'knuckle') reach = 10;
  else reach = Math.min(gb.boomMax * 0.55, gb.boomMin * 1.6);
  const loadX = Math.max(slewX + half + load.width / 2 + 1.5 - slewX, reach * 0.45) + slewX;
  const zoneX = Math.max(loadX + load.width + 3, slewX + reach);
  const startU = cfg.kind === 'tower' ? loadX - slewX : 0;
  // torenkranen moeten ook in de vrije oefening eerst volledig worden opgebouwd:
  // zelfopbouwers met hun eigen procedure, de grote torenkraan met de mobiele hulpkraan
  const needsBuild = cfg.kind === 'tower' && gb.setupType === 'selfErect';
  const m: MissionDef = {
    id: 'practice',
    number: 0,
    chapter: 0,
    title: 'Vrije oefening',
    briefing: `Oefen vrij met de ${cfg.name} en een ${load.name.toLowerCase()} (${(load.massKg / 1000).toFixed(1)} t). Geen tijdslimiet.`,
    hint: 'Verplaats de last naar de gele zone. Druk R(estart) in het pauzemenu om opnieuw te beginnen.',
    learningGoal: 'Vrij oefenen.',
    difficulty: 1,
    craneOptions: [o.craneId],
    environment: o.environment,
    timeOfDay: 'day',
    weather: o.windBase > 10 ? 'cloudy' : 'clear',
    crane: { x: 0, boomAngleDeg: 50, boomLength: gb.boomMin * 1.3, trolley: startU, ropeLength: 6, outriggersDeployed: true, preassembled: !needsBuild, knuckleDeg: -90 },
    loads: [{ id: 'l1', type: o.loadType, x: loadX, y: 0 }],
    zones: [{ id: 'z1', label: 'Oefenzone', x: zoneX, y: 0, tolerance: 0.6 }],
    obstacles: [],
    tasks: [...(needsBuild ? [{ type: 'setup' as const, label: 'Kraan volledig opbouwen' }] : []), { type: 'deliver', loadId: 'l1', zoneId: 'z1' }],
    wind: { base: o.windBase, gust: o.windBase > 0 ? 0.4 : 0, direction: 1, variable: o.windBase > 6 },
    parTime: 300,
    maxDamage: 1000,
    requirements: {},
    reward: { money: 1, xp: 1 },
    bounds: { minX: -60, maxX: 90 },
  };
  return gb.setupType === 'towerAssembly' ? withTowerAssembly(m) : m;
}
