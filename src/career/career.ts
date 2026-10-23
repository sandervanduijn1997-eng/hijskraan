import type { LicenseId } from '../cranes/config/types';
import { CHAPTERS, MISSIONS, missionsInChapter } from '../missions/data/index';
import type { MissionDef } from '../missions/data/types';
import type { SaveData } from '../save/saveSystem';

export const LICENSE_LABELS: Record<LicenseId, string> = {
  basis: 'Basislicentie',
  toren: 'Torenkraanlicentie',
  industrie: 'Industriële licentie',
  terrein: 'Terreinlicentie',
  zwaar: 'Zware-kraanlicentie',
  specialist: 'Industriële specialistlicentie',
  eind: 'Eindcertificaat Heavy Lift',
};

export const isCompleted = (save: SaveData, missionId: string): boolean => (save.completed[missionId]?.completions ?? 0) > 0;

export function isChapterUnlocked(save: SaveData, chapter: number): boolean {
  if (chapter <= 1) return true;
  const def = CHAPTERS.find((c) => c.number === chapter);
  if (!def) return false;
  if (def.requiresLicense && !save.licenses.includes(def.requiresLicense)) return false;
  const prev = missionsInChapter(chapter - 1);
  return prev.length === 0 || isCompleted(save, prev[prev.length - 1].id);
}

export function isMissionUnlocked(save: SaveData, m: MissionDef): boolean {
  if (!isChapterUnlocked(save, m.chapter)) return false;
  const list = missionsInChapter(m.chapter);
  const i = list.findIndex((x) => x.id === m.id);
  return i <= 0 || isCompleted(save, list[i - 1].id);
}

export function nextMission(save: SaveData): MissionDef | null {
  return MISSIONS.find((m) => isMissionUnlocked(save, m) && !isCompleted(save, m.id)) ?? null;
}

export interface Level {
  level: number;
  title: string;
  xpForLevel: number;
  xpForNext: number;
}

const xpAt = (lvl: number): number => 150 * (lvl - 1) * (lvl - 1);

export function levelFor(xp: number): Level {
  let lvl = 1;
  while (xpAt(lvl + 1) <= xp) lvl++;
  const title =
    lvl <= 2 ? 'Junior machinist' : lvl <= 5 ? 'Kraanmachinist' : lvl <= 8 ? 'Senior machinist' : lvl <= 11 ? 'Hoofdmachinist' : 'Heavy-lift specialist';
  return { level: lvl, title, xpForLevel: xpAt(lvl), xpForNext: xpAt(lvl + 1) };
}

export function totalStars(save: SaveData): number {
  return Object.values(save.completed).reduce((a, r) => a + r.stars, 0);
}
