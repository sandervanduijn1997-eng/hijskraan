import { CHAPTER_1, CHAPTER_2, CHAPTER_3, CHAPTER_4 } from './chapters1to4';
import { CHAPTER_5, CHAPTER_6, CHAPTER_7, CHAPTER_8 } from './chapters5to8';
import { CHAPTER_9 } from './chapter9';
import { CHAPTER_10, CHAPTER_11, CHAPTER_12, CHAPTER_13, CHAPTER_14 } from './chapters10to14';
import type { ChapterDef, MissionDef } from './types';
import { spreadAround } from './layout3d';
import { withStory } from './story';

export const CHAPTERS: ChapterDef[] = [
  { number: 1, title: 'Kraanmachinist worden', subtitle: 'Basistraining', requiresLicense: null, stage: 1 },
  { number: 2, title: 'De bouwplaats', subtitle: 'Kleine bouwprojecten', requiresLicense: 'basis', stage: 2 },
  { number: 3, title: 'Torenkranen', subtitle: 'Stedelijke opdrachten', requiresLicense: 'basis', stage: 3 },
  { number: 4, title: 'Industrie en precisie', subtitle: 'Industriële projecten', requiresLicense: 'toren', stage: 4 },
  { number: 5, title: 'Ruw terrein', subtitle: 'Grote constructies', requiresLicense: 'industrie', stage: 5 },
  { number: 6, title: 'Grote mobiele kranen', subtitle: 'Heavy-lift-projecten', requiresLicense: 'terrein', stage: 6 },
  { number: 7, title: 'Haven en zware industrie', subtitle: 'Geavanceerde opdrachten', requiresLicense: 'zwaar', stage: 7 },
  { number: 8, title: 'Heavy lift en eindproeven', subtitle: 'Specialistische eindproeven', requiresLicense: 'specialist', stage: 7 },
  { number: 9, title: 'Samen hijsen', subtitle: 'Tandemhijsen met een collega-kraan', requiresLicense: 'zwaar', stage: 6 },
  { number: 10, title: 'Woningbouw', subtitle: 'Kanaalplaten, wanden, beton en glas', requiresLicense: 'toren', stage: 3 },
  { number: 11, title: 'Infra', subtitle: 'Wegen, spoor en riolering', requiresLicense: 'terrein', stage: 5 },
  { number: 12, title: 'Industrie', subtitle: 'Fabrieken, onderstations en raffinaderijen', requiresLicense: 'zwaar', stage: 6 },
  { number: 13, title: 'Haven en energie', subtitle: 'Schepen, pontons en windturbines', requiresLicense: 'zwaar', stage: 7 },
  { number: 14, title: 'Bijzondere klussen', subtitle: 'Berging, sloop, monumenten en personen', requiresLicense: 'specialist', stage: 7 },
];

export const MISSIONS: MissionDef[] = [...CHAPTER_1, ...CHAPTER_2, ...CHAPTER_3, ...CHAPTER_4, ...CHAPTER_5, ...CHAPTER_6, ...CHAPTER_7, ...CHAPTER_8, ...CHAPTER_9, ...CHAPTER_10, ...CHAPTER_11, ...CHAPTER_12, ...CHAPTER_13, ...CHAPTER_14].map(spreadAround).map(withStory);

export function getMission(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

export function missionsInChapter(ch: number): MissionDef[] {
  return MISSIONS.filter((m) => m.chapter === ch).sort((a, b) => a.number - b.number);
}
