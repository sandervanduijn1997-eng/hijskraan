import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CRANES } from '../../src/cranes/config/cranes';
import { UPGRADES } from '../../src/cranes/config/upgrades';
import { DEDUCTIBLE, JOBS_PER_WEEK, QUOTES } from '../../src/economy/business';
import { DE, EN } from '../../src/i18n/index';
import { CHALLENGES, challengeMission } from '../../src/missions/data/challenges';
import { CHAPTERS, MISSIONS } from '../../src/missions/data/index';
import { LOADS } from '../../src/missions/data/loads';
import { DIFFICULTIES } from '../../src/sim/difficulty';
import { writeRef } from './common';

/**
 * Speldata zoals de game hem na alle bewerkingen gebruikt (missies na spreadAround en withStory),
 * zodat Unreal precies dezelfde kranen, lasten en missies inleest als de TypeScript-versie.
 */
export function exportData(): string[] {
  const nlKeys: string[] = JSON.parse(readFileSync(join(process.cwd(), 'i18n', 'keys.nl.json'), 'utf8'));
  return [
    writeRef('data/cranes', CRANES),
    writeRef('data/upgrades', UPGRADES),
    writeRef('data/loads', LOADS),
    writeRef('data/missions', { chapters: CHAPTERS, missions: MISSIONS }),
    // rate() is code per kind (zie units/challengeRates), geen data
    writeRef('data/challenges', CHALLENGES.map(({ rate: _rate, ...c }) => ({ challenge: c, mission: challengeMission({ ...c, rate: _rate }) }))),
    writeRef('data/difficulties', DIFFICULTIES),
    writeRef('data/economy', { quotes: QUOTES, jobsPerWeek: JOBS_PER_WEEK, deductible: DEDUCTIBLE }),
    writeRef('data/i18n', { nlKeys, en: EN, de: DE }),
  ];
}
