import { CRANE_IDS } from '../cranes/config/cranes';
import type { CraneId, LicenseId, UpgradeId } from '../cranes/config/types';
import type { DifficultyId } from '../sim/difficulty';
import type { AnalogSettings } from '../game/input/analog';
import { defaultAnalog } from '../game/input/analog';

export const SAVE_VERSION = 2;
export const SAVE_KEY = 'crane-operator-heavy-lift.save';
export const BACKUP_KEY = 'crane-operator-heavy-lift.save.corrupt';

export type ActionId =
  | 'boomUp' | 'boomDown' | 'slewLeft' | 'slewRight' | 'hoistUp' | 'hoistDown' | 'teleOut' | 'teleIn'
  | 'trolleyOut' | 'trolleyIn' | 'knuckleUp' | 'knuckleDown' | 'knuckleTeleOut' | 'knuckleTeleIn'
  | 'driveLeft' | 'driveRight' | 'precision' | 'rigging' | 'outriggerMode' | 'outriggerAuto' | 'setup'
  | 'pause' | 'menu' | 'zoomIn' | 'zoomOut' | 'overview' | 'cameraReset' | 'cameraMode' | 'horn' | 'help' | 'lmi';

export const DEFAULT_BINDINGS: Record<ActionId, string[]> = {
  boomUp: ['KeyW'],
  boomDown: ['KeyS'],
  slewLeft: ['KeyA'],
  slewRight: ['KeyD'],
  hoistDown: ['KeyQ'],
  hoistUp: ['KeyE'],
  teleOut: ['KeyR'],
  teleIn: ['KeyF'],
  trolleyOut: ['KeyW'],
  trolleyIn: ['KeyS'],
  knuckleUp: ['KeyI'],
  knuckleDown: ['KeyK'],
  knuckleTeleOut: ['KeyR'],
  knuckleTeleIn: ['KeyF'],
  driveLeft: ['ArrowLeft'],
  driveRight: ['ArrowRight'],
  precision: ['ShiftLeft', 'ShiftRight'],
  rigging: ['KeyT'],
  outriggerMode: ['KeyO'],
  outriggerAuto: ['KeyP'],
  setup: ['KeyB'],
  pause: ['Space'],
  menu: ['Escape'],
  zoomIn: ['Equal', 'NumpadAdd'],
  zoomOut: ['Minus', 'NumpadSubtract'],
  overview: ['Tab'],
  cameraReset: ['KeyC'],
  cameraMode: ['KeyV'],
  horn: ['KeyH'],
  help: ['F1'],
  lmi: ['KeyL'],
};

export interface Settings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  difficulty: DifficultyId;
  cameraShake: boolean;
  showHints: boolean;
  particles: boolean;
  /** Loodlijn, voetafdruk en hoogte in cm onder de last. */
  depthAid: boolean;
  /** Signaalgever via de portofoon: gesproken, alleen tekst of uit. */
  signalman: 'voice' | 'text' | 'off';
  /** Grafische kwaliteit (laag, middel, hoog, ultra). */
  graphics: 'low' | 'medium' | 'high' | 'ultra';
  /** Sticks en oplopende toetsen. */
  analog: AnalogSettings;
  bindings: Record<ActionId, string[]>;
}

export interface MissionRecord {
  stars: number;
  bestScore: number;
  bestTime: number;
  completions: number;
}

export interface SaveData {
  version: number;
  money: number;
  xp: number;
  licenses: LicenseId[];
  certificates: string[];
  completed: Record<string, MissionRecord>;
  ownedCranes: CraneId[];
  craneCondition: Partial<Record<CraneId, number>>;
  upgrades: Partial<Record<CraneId, UpgradeId[]>>;
  liveries: string[];
  activeLivery: string;
  challengeBest: Record<string, number>;
  settings: Settings;
  stats: { lifts: number; tonnage: number; playTime: number };
}

export const defaultSettings = (): Settings => ({
  masterVolume: 0.8,
  musicVolume: 0.35,
  sfxVolume: 0.8,
  difficulty: 'normal',
  cameraShake: true,
  showHints: true,
  particles: true,
  depthAid: true,
  signalman: 'voice',
  graphics: 'high',
  analog: defaultAnalog(),
  bindings: structuredClone(DEFAULT_BINDINGS),
});

export const defaultSave = (): SaveData => ({
  version: SAVE_VERSION,
  money: 2000,
  xp: 0,
  licenses: [],
  certificates: [],
  completed: {},
  ownedCranes: ['at60'],
  craneCondition: { at60: 1 },
  upgrades: {},
  liveries: ['standard'],
  activeLivery: 'standard',
  challengeBest: {},
  settings: defaultSettings(),
  stats: { lifts: 0, tonnage: 0, playTime: 0 },
});

const LICENSES: LicenseId[] = ['basis', 'toren', 'industrie', 'terrein', 'zwaar', 'specialist', 'eind'];
const DIFFS: DifficultyId[] = ['practice', 'normal', 'realistic'];

const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Migraties per versie: oude data → volgende versie. */
const MIGRATIONS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 had geen statistieken en sloeg geld op als 'cash'
  1: (d) => ({ ...d, money: d.money ?? d.cash, stats: d.stats ?? { lifts: 0, tonnage: 0, playTime: 0 }, version: 2 }),
};

/**
 * Valideer en repareer geladen data. Ontbrekende of ongeldige velden krijgen standaardwaarden;
 * het resultaat is altijd een bruikbaar savebestand.
 */
export function sanitizeSave(raw: unknown): { data: SaveData; repaired: boolean } {
  const def = defaultSave();
  if (!isObj(raw)) return { data: def, repaired: true };
  let d: Record<string, unknown> = { ...raw };
  let repaired = false;
  let v = num(d.version, 1);
  while (v < SAVE_VERSION && MIGRATIONS[v]) {
    d = MIGRATIONS[v](d);
    v = num(d.version, v + 1);
  }
  const out = defaultSave();
  out.money = num(d.money, def.money, 0);
  out.xp = num(d.xp, 0, 0);
  out.licenses = strArr(d.licenses).filter((l): l is LicenseId => LICENSES.includes(l as LicenseId));
  out.certificates = strArr(d.certificates);
  if (isObj(d.completed)) {
    for (const [k, r] of Object.entries(d.completed)) {
      if (!isObj(r)) {
        repaired = true;
        continue;
      }
      out.completed[k] = { stars: num(r.stars, 1, 0, 3), bestScore: num(r.bestScore, 0, 0, 100), bestTime: num(r.bestTime, 0, 0), completions: num(r.completions, 1, 0) };
    }
  } else repaired = true;
  const owned = strArr(d.ownedCranes).filter((c): c is CraneId => CRANE_IDS.includes(c as CraneId));
  out.ownedCranes = owned.length ? Array.from(new Set(owned)) : def.ownedCranes;
  if (isObj(d.craneCondition)) for (const c of CRANE_IDS) if (d.craneCondition[c] !== undefined) out.craneCondition[c] = num(d.craneCondition[c], 1, 0, 1);
  for (const c of out.ownedCranes) if (out.craneCondition[c] === undefined) out.craneCondition[c] = 1;
  if (isObj(d.upgrades)) for (const c of CRANE_IDS) if (d.upgrades[c] !== undefined) out.upgrades[c] = strArr(d.upgrades[c]) as UpgradeId[];
  out.liveries = strArr(d.liveries).length ? strArr(d.liveries) : def.liveries;
  out.activeLivery = typeof d.activeLivery === 'string' && out.liveries.includes(d.activeLivery) ? d.activeLivery : 'standard';
  if (isObj(d.challengeBest)) for (const [k, s] of Object.entries(d.challengeBest)) out.challengeBest[k] = num(s, 0, 0, 100);
  const s = isObj(d.settings) ? d.settings : {};
  out.settings = {
    masterVolume: num(s.masterVolume, def.settings.masterVolume, 0, 1),
    musicVolume: num(s.musicVolume, def.settings.musicVolume, 0, 1),
    sfxVolume: num(s.sfxVolume, def.settings.sfxVolume, 0, 1),
    difficulty: DIFFS.includes(s.difficulty as DifficultyId) ? (s.difficulty as DifficultyId) : def.settings.difficulty,
    cameraShake: bool(s.cameraShake, true),
    showHints: bool(s.showHints, true),
    particles: bool(s.particles, true),
    depthAid: bool(s.depthAid, true),
    signalman: (['voice', 'text', 'off'] as const).includes(s.signalman as 'voice') ? (s.signalman as Settings['signalman']) : 'voice',
    analog: (() => {
      const a = isObj(s.analog) ? s.analog : {};
      const d = defaultAnalog();
      return { deadzone: num(a.deadzone, d.deadzone, 0, 0.4), curve: num(a.curve, d.curve, 1, 3), keyRamp: num(a.keyRamp, d.keyRamp, 0, 2.5), invertHoist: bool(a.invertHoist, d.invertHoist) };
    })(),
    graphics: (['low', 'medium', 'high', 'ultra'] as const).includes(s.graphics as 'low') ? (s.graphics as Settings['graphics']) : 'high',
    bindings: structuredClone(DEFAULT_BINDINGS),
  };
  if (isObj(s.bindings)) {
    for (const k of Object.keys(DEFAULT_BINDINGS) as ActionId[]) {
      const b = strArr(s.bindings[k]);
      if (b.length) out.settings.bindings[k] = b;
    }
  }
  const st = isObj(d.stats) ? d.stats : {};
  out.stats = { lifts: num(st.lifts, 0, 0), tonnage: num(st.tonnage, 0, 0), playTime: num(st.playTime, 0, 0) };
  // vergelijk met origineel om te melden of er gerepareerd is
  if (raw.version !== SAVE_VERSION || !isObj(raw.settings) || !Array.isArray(raw.ownedCranes)) repaired = true;
  return { data: out, repaired };
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Geheugenopslag als terugval (privévenster, geblokkeerde opslag, tests). */
export class MemoryStorage implements StorageLike {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

export function browserStorage(): StorageLike {
  try {
    const ls = window.localStorage;
    const probe = '__probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return new MemoryStorage();
  }
}

export interface LoadResult {
  data: SaveData;
  status: 'new' | 'loaded' | 'repaired' | 'corrupt';
}

export function loadGame(storage: StorageLike): LoadResult {
  let text: string | null = null;
  try {
    text = storage.getItem(SAVE_KEY);
  } catch {
    return { data: defaultSave(), status: 'new' };
  }
  if (!text) return { data: defaultSave(), status: 'new' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      storage.setItem(BACKUP_KEY, text);
    } catch {
      /* negeren */
    }
    return { data: defaultSave(), status: 'corrupt' };
  }
  const { data, repaired } = sanitizeSave(parsed);
  return { data, status: repaired ? 'repaired' : 'loaded' };
}

export function saveGame(storage: StorageLike, data: SaveData): boolean {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify({ ...data, version: SAVE_VERSION }));
    return true;
  } catch {
    return false;
  }
}
