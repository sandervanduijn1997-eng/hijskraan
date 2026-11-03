import { CRANE_IDS } from '../../src/cranes/config/cranes';
import { UPGRADES } from '../../src/cranes/config/upgrades';
import type { CraneId, LicenseId, UpgradeId } from '../../src/cranes/config/types';
import { CHALLENGES } from '../../src/missions/data/challenges';
import { MISSIONS } from '../../src/missions/data/index';
import { DEFAULT_BINDINGS, MemoryStorage, SAVE_KEY, defaultSave, loadGame } from '../../src/save/saveSystem';
import type { ActionId, SaveData } from '../../src/save/saveSystem';
import { writeRef } from './common';

/**
 * Savebestanden inlezen (E7): tekst uit localStorage → loadGame() → status en gerepareerd savebestand.
 * Geldige saves, v1-saves, saves met kapotte velden (verkeerd type, buiten bereik, ontbrekend), geen object
 * en ongeldige JSON. De C++-port (CraneSimJson/SaveJson.h) moet dezelfde status en exact dezelfde data geven.
 */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LICENSES: LicenseId[] = ['basis', 'toren', 'industrie', 'terrein', 'zwaar', 'specialist', 'eind'];
const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];
const ACTIONS = Object.keys(DEFAULT_BINDINGS) as ActionId[];
const KEYS = ['KeyW', 'KeyA', 'KeyZ', 'Digit1', 'ArrowUp', 'Space', 'ShiftLeft', 'Numpad8', 'F2'];

/** Getallen die JSON.stringify niet kan schrijven, als letterlijke tekst in de JSON (zie lit). */
const lit = (text: string) => `@@NUM(${text})@@`;
const toText = (v: unknown) => JSON.stringify(v).replace(/"@@NUM\(([^)]*)\)@@"/g, '$1');

/** Fisher-Yates met de vaste reeks. */
function shuffle<T>(xs: T[], r: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

function validSave(r: () => number): SaveData {
  const s = defaultSave();
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[], p: number) => xs.filter(() => r() < p);
  const one = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  s.money = r() < 0.1 ? 0 : Math.round(r() * 2500000) / 10;
  s.xp = int(0, 40000);
  s.licenses = pick(LICENSES, r());
  s.certificates = r() < 0.3 ? ['cert-a', 'Certificaat “zwaar” ✓'] : [];
  // in willekeurige volgorde: de volgorde van objectsleutels mag niet uitmaken
  for (const m of shuffle(pick(MISSIONS, r()), r))
    s.completed[m.id] = { stars: int(0, 3), bestScore: int(0, 100), bestTime: Math.round(r() * 9000) / 10, completions: int(0, 6) };
  s.ownedCranes = pick(CRANE_IDS, 0.4);
  if (!s.ownedCranes.length) s.ownedCranes = ['at60'];
  for (const c of s.ownedCranes) s.craneCondition[c] = Math.round(r() * 100) / 100;
  for (const c of pick(s.ownedCranes, 0.5)) s.upgrades[c] = pick(UPGRADE_IDS, 0.3);
  s.liveries = ['standard', ...pick(['gold', 'retro', 'night'], 0.4)];
  s.activeLivery = one(s.liveries);
  for (const c of pick(CHALLENGES, 0.5)) s.challengeBest[c.id] = int(0, 100);
  const st = s.settings;
  st.masterVolume = Math.round(r() * 100) / 100;
  st.musicVolume = r();
  st.sfxVolume = 1;
  st.difficulty = one(['practice', 'normal', 'realistic'] as const);
  st.cameraShake = r() < 0.5;
  st.showHints = r() < 0.5;
  st.particles = r() < 0.5;
  st.depthAid = r() < 0.5;
  st.signalman = one(['voice', 'text', 'off'] as const);
  st.language = one(['nl', 'en', 'de'] as const);
  st.graphics = one(['low', 'medium', 'high', 'ultra'] as const);
  st.analog = { deadzone: r() * 0.4, curve: 1 + 2 * r(), keyRamp: 2.5 * r(), invertHoist: r() < 0.5 };
  for (const a of pick(ACTIONS, 0.2)) st.bindings[a] = pick(KEYS, 0.3).length ? pick(KEYS, 0.3) : [one(KEYS)];
  s.stats = { lifts: int(0, 900), tonnage: Math.round(r() * 1e5) / 10, playTime: r() * 1e6 };
  s.business = { reputation: int(0, 100), quotes: int(0, 300), weekJobs: int(0, 4), week: int(1, 80) };
  return s;
}

/** Kapotte of afwijkende waarden, inclusief getallen die alleen als letterlijke JSON bestaan. */
function junk(r: () => number): unknown {
  const pool: unknown[] = [
    null, true, false, 0, -1, -7.5, 0.25, 0.5, 1, 1.5, 2, 3, 3.7, 4, 99.99, 100, 101, 1e9, 2.5, 0.4, 0.41,
    lit('-0'), lit('1e400'), lit('-1e400'), lit('1e-400'), lit('2.0'), lit('1E2'),
    '', 'tekst', '12', 'basis', 'at60', 'standard', 'voice', 'nl', 'ultra', 'realistic', 'hoistSpeed',
    [], ['x', 1, null, 'at60', 'at60', 'basis', 'hoistSpeed', 'KeyW'], [1, 2], { a: 1 }, {}, { stars: 2 },
  ];
  return pool[Math.floor(r() * pool.length)];
}

/** Paden in een savebestand die gemuteerd kunnen worden. */
function paths(s: Record<string, unknown>, r: () => number): string[][] {
  const out: string[][] = [];
  const walk = (v: unknown, p: string[]) => {
    out.push(p);
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], [...p, k]);
  };
  for (const k of Object.keys(s)) walk(s[k], [k]);
  // ook velden die er nog niet zijn
  out.push(['cash'], ['craneCondition', CRANE_IDS[Math.floor(r() * CRANE_IDS.length)]], ['upgrades', CRANE_IDS[Math.floor(r() * CRANE_IDS.length)]], ['completed', 'm99']);
  return out;
}

function mutate(s: Record<string, unknown>, r: () => number, n: number): void {
  for (let i = 0; i < n; i++) {
    const all = paths(s, r);
    const p = all[Math.floor(r() * all.length)];
    let o = s as Record<string, unknown>;
    for (const k of p.slice(0, -1)) {
      const next = o[k];
      if (!next || typeof next !== 'object' || Array.isArray(next)) return;
      o = next as Record<string, unknown>;
    }
    const last = p[p.length - 1];
    if (r() < 0.2) delete o[last];
    else o[last] = junk(r);
  }
}

/** v1: geen statistieken, geld als 'cash' (zie MIGRATIONS in saveSystem.ts). */
function v1Save(r: () => number): Record<string, unknown> {
  const s = validSave(r) as unknown as Record<string, unknown>;
  const mode = Math.floor(r() * 5);
  if (mode === 0) delete s.version;
  else s.version = 1;
  if (r() < 0.7) {
    s.cash = s.money;
    if (r() < 0.6) delete s.money;
    else if (r() < 0.5) s.money = null;
  }
  if (r() < 0.7) delete s.stats;
  else if (r() < 0.5) s.stats = null;
  if (mode === 4) s.version = lit('1.0');
  return s;
}

/** Ongeldige JSON en randgevallen die JSON.parse precies zo moet behandelen. */
const RAW_TEXTS: string[] = [
  '',
  ' ',
  '{niet geldig',
  '{"version":2,',
  '{"version":2}}',
  '{"version":2} x',
  "{'version':2}",
  '{"version":2,}',
  '{"money":01}',
  '{"money":1.}',
  '{"money":.5}',
  '{"money":+1}',
  '{"money":-}',
  '{"money":NaN}',
  '{"money":Infinity}',
  '{"money":0x10}',
  '{"money":1e}',
  '{"money":1e+}',
  '{"activeLivery":"a\tb"}',
  '{"activeLivery":"a\nb"}',
  '{"activeLivery":"\\x41"}',
  '{"activeLivery":"\\u12"}',
  '{"version":2 // commentaar\n}',
  '[1,2,]',
  'nul',
  'True',
  '"tekst',
  '﻿{"version":2}',
  // geldig maar geen object
  'null',
  'true',
  '42',
  '"save"',
  '[]',
  '[{"version":2}]',
  // geldige JSON met randgevallen
  ' \t\r\n{"version":2,"ownedCranes":["at60"],"settings":{}} \n',
  '{"version":2,"money":5,"money":7,"ownedCranes":["at60"],"settings":{}}',
  '{"version":2,"completed":{"m01":{"stars":3},"m01":5},"ownedCranes":["at60"],"settings":{}}',
  '{"version":2,"completed":{"m01":5,"m01":{"stars":2}},"ownedCranes":["at60"],"settings":{}}',
  '{"version":2,"completed":{"__proto__":{"stars":3},"m02":{"stars":1}},"challengeBest":{"__proto__":40,"ch-fast":50},"ownedCranes":["at60"],"settings":{}}',
  '{"version":2,"completed":{"__proto__":7},"ownedCranes":["at60"],"settings":{}}',
  '{"__proto__":{"money":5},"version":2,"ownedCranes":["at60"],"settings":{}}',
  '{"version":2,"completed":{"10":{"stars":1},"2":{"stars":2},"b":{"stars":3},"a":{"stars":0}},"ownedCranes":["at60"],"settings":{}}',
  '{"version":2,"certificates":["\\u00e9\\u20ac\\ud83c\\udfd7","\\"\\\\\\/\\b\\f\\n\\r\\t","é€🏗","\\u0000\\u001f"],"ownedCranes":["at60"],"settings":{}}',
  '{"version":2,"ownedCranes":["at60","rt80","at60","nep","rt80"],"liveries":["a","a"],"activeLivery":"a","settings":{}}',
  '{"version":2.0,"ownedCranes":["at60"],"settings":{}}',
  '{"version":2e0,"ownedCranes":["at60"],"settings":{}}',
  '{"version":20e-1,"ownedCranes":["at60"],"settings":{}}',
  '{"version":"2","ownedCranes":["at60"],"settings":{}}',
  '{"version":3,"ownedCranes":["at60"],"settings":{}}',
  '{"version":1.5,"money":3,"cash":4,"ownedCranes":["at60"],"settings":{}}',
  '{"version":0,"money":3,"cash":4,"ownedCranes":["at60"],"settings":{}}',
  '{"version":-0,"cash":4,"ownedCranes":["at60"],"settings":{}}',
  '{"version":1,"money":null,"cash":"veel","stats":{"lifts":3}}',
  '{"version":1,"cash":1e400}',
  '{"version":2,"xp":-0,"money":-0,"ownedCranes":["at60"],"settings":{"analog":{"deadzone":-0,"curve":0.9999999999999999,"keyRamp":2.5000000000000004}}}',
  '{"version":2,"money":1e-400,"xp":4.9e-324,"ownedCranes":["at60"],"settings":{"masterVolume":1e-320}}',
  '{"version":2,"money":123456789012345678901234567890,"xp":0.1e1,"ownedCranes":["at60"],"settings":{}}',
  '{"version":2,"ownedCranes":[],"craneCondition":{"at60":0.3,"rt80":7,"nep":0.5},"upgrades":{"rt80":null,"at60":"hoistSpeed"},"settings":{"bindings":{"boomUp":[],"slewLeft":["KeyJ",3],"bestaatNiet":["KeyX"],"hoistUp":"KeyE"}}}',
  '{"version":2,"ownedCranes":["at60"],"settings":[]}',
  '{"version":2,"ownedCranes":{"0":"at60"},"settings":{}}',
];

export function exportSaves(): string[] {
  const r = rng(0x5a7e5);
  const texts: string[] = [];
  for (let i = 0; i < 150; i++) texts.push(toText(validSave(r)));
  for (let i = 0; i < 450; i++) {
    const s = validSave(r) as unknown as Record<string, unknown>;
    mutate(s, r, 1 + Math.floor(r() * 4));
    texts.push(toText(s));
  }
  for (let i = 0; i < 80; i++) {
    const s = v1Save(r);
    if (r() < 0.5) mutate(s, r, 1 + Math.floor(r() * 2));
    texts.push(toText(s));
  }
  texts.push(...RAW_TEXTS);

  const cases = texts.map((text) => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, text);
    const { data, status } = loadGame(storage);
    // zoals saveGame() het zou opslaan: alleen eigen velden (een sleutel __proto__ in completed wordt in JS het prototype)
    return { text, status, data: JSON.parse(JSON.stringify(data)) as SaveData };
  });
  const count = (s: string) => cases.filter((c) => c.status === s).length;
  console.log(`saves: ${cases.length} gevallen (${count('loaded')} loaded, ${count('repaired')} repaired, ${count('corrupt')} corrupt, ${count('new')} new)`);
  return [writeRef('units/saves', { craneIds: CRANE_IDS as CraneId[], defaultSave: defaultSave(), cases }, true)];
}
