import { describe, expect, it } from 'vitest';
import { BACKUP_KEY, MemoryStorage, SAVE_KEY, SAVE_VERSION, defaultSave, loadGame, sanitizeSave, saveGame } from '../../src/save/saveSystem';
import { isChapterUnlocked, isMissionUnlocked, levelFor } from '../../src/career/career';
import { getMission } from '../../src/missions/data/index';
import { applyMissionResult, buyCrane, buyUpgrade, canBuyCrane, computePayout, repairCost, repairCrane, REPEAT_FACTOR } from '../../src/economy/economy';
import { computeScore, emptyMetrics } from '../../src/missions/runtime/scoring';
import { AudioEngine } from '../../src/audio/audioEngine';

const score3 = () => computeScore({ ...emptyMetrics(100, 1), time: 60, placementErrors: [0], maxSwayDeg: 1, peakLiftPct: 80, fuelUsed: 0.5 }, true);

describe('opslaan en laden', () => {
  it('rondreis behoudt de voortgang', () => {
    const st = new MemoryStorage();
    const s = defaultSave();
    s.money = 12345;
    s.licenses.push('basis');
    s.completed.m01 = { stars: 3, bestScore: 92, bestTime: 80, completions: 1 };
    s.settings.bindings.hoistUp = ['KeyX'];
    expect(saveGame(st, s)).toBe(true);
    const r = loadGame(st);
    expect(r.status).toBe('loaded');
    expect(r.data.money).toBe(12345);
    expect(r.data.licenses).toEqual(['basis']);
    expect(r.data.completed.m01.stars).toBe(3);
    expect(r.data.settings.bindings.hoistUp).toEqual(['KeyX']);
    expect(r.data.version).toBe(SAVE_VERSION);
  });

  it('ontbrekende velden worden aangevuld', () => {
    const st = new MemoryStorage();
    st.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, money: 500 }));
    const r = loadGame(st);
    expect(r.status).toBe('repaired');
    expect(r.data.money).toBe(500);
    expect(r.data.ownedCranes).toEqual(['at60']);
    expect(r.data.settings.masterVolume).toBeGreaterThan(0);
    expect(r.data.settings.bindings.pause.length).toBeGreaterThan(0);
  });

  it('ongeldige waarden worden gecorrigeerd', () => {
    const { data } = sanitizeSave({ version: SAVE_VERSION, money: -50, xp: 'veel', ownedCranes: ['nep', 'tc160'], licenses: ['basis', 'onzin'], settings: { masterVolume: 7, difficulty: 'godmode' } });
    expect(data.money).toBe(0);
    expect(data.xp).toBe(0);
    expect(data.ownedCranes).toEqual(['tc160']);
    expect(data.licenses).toEqual(['basis']);
    expect(data.settings.masterVolume).toBe(1);
    expect(data.settings.difficulty).toBe('normal');
  });

  it('beschadigd bestand: reservekopie en nieuw profiel', () => {
    const st = new MemoryStorage();
    st.setItem(SAVE_KEY, '{niet geldig');
    const r = loadGame(st);
    expect(r.status).toBe('corrupt');
    expect(r.data.money).toBe(defaultSave().money);
    expect(st.getItem(BACKUP_KEY)).toBe('{niet geldig');
  });

  it('migratie van versie 1 (cash → money)', () => {
    const { data } = sanitizeSave({ version: 1, cash: 777, ownedCranes: ['at60'], settings: {} });
    expect(data.money).toBe(777);
    expect(data.version).toBe(SAVE_VERSION);
  });
});

describe('vrijspelen van missies', () => {
  it('alleen missie 1 is in het begin speelbaar', () => {
    const s = defaultSave();
    expect(isMissionUnlocked(s, getMission('m01')!)).toBe(true);
    expect(isMissionUnlocked(s, getMission('m02')!)).toBe(false);
    expect(isChapterUnlocked(s, 2)).toBe(false);
  });
  it('volgende missie na voltooiing; hoofdstuk 2 pas met basislicentie', () => {
    const s = defaultSave();
    for (const id of ['m01', 'm02', 'm03', 'm04']) s.completed[id] = { stars: 1, bestScore: 50, bestTime: 100, completions: 1 };
    expect(isMissionUnlocked(s, getMission('m05')!)).toBe(true);
    s.completed.m05 = { stars: 1, bestScore: 50, bestTime: 100, completions: 1 };
    expect(isChapterUnlocked(s, 2)).toBe(false);
    s.licenses.push('basis');
    expect(isChapterUnlocked(s, 2)).toBe(true);
    expect(isMissionUnlocked(s, getMission('m06')!)).toBe(true);
  });
  it('niveaus op basis van XP', () => {
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(150).level).toBe(2);
    expect(levelFor(600).level).toBe(3);
  });
});

describe('geld en XP', () => {
  it('eerste voltooiing: volledige beloning met sterrenbonus, licentie en record', () => {
    const s = defaultSave();
    const m = getMission('m05')!;
    const p = applyMissionResult(s, m, score3(), 200, 'at60', 0, 2.65);
    expect(p.firstCompletion).toBe(true);
    expect(p.money).toBe(Math.round(m.reward.money * 1.2));
    expect(p.xp).toBe(Math.round(m.reward.xp * 1.2));
    expect(s.licenses).toContain('basis');
    expect(s.completed.m05.completions).toBe(1);
  });
  it('herhalen levert minder op (geen eindeloos grinden)', () => {
    const s = defaultSave();
    const m = getMission('m01')!;
    applyMissionResult(s, m, score3(), 100, 'at60', 0, 0.5);
    const p2 = computePayout(s, m, score3(), 'at60');
    expect(p2.money).toBe(Math.round(m.reward.money * 1.2 * REPEAT_FACTOR));
  });
  it('kraanhuur wordt afgetrokken als de kraan niet in de vloot staat', () => {
    const s = defaultSave();
    const m = getMission('m06')!;
    const p = computePayout(s, m, score3(), 'truck25');
    expect(p.rent).toBeGreaterThan(0);
    expect(p.money).toBe(Math.round(m.reward.money * 1.2) - p.rent);
  });
  it('kraan kopen vereist licentie en saldo; upgrades alleen voor eigen kranen', () => {
    const s = defaultSave();
    s.money = 1e6;
    expect(canBuyCrane(s, 'tc160').ok).toBe(false);
    s.licenses.push('toren');
    expect(buyCrane(s, 'tc160').ok).toBe(true);
    expect(s.ownedCranes).toContain('tc160');
    expect(buyUpgrade(s, 'hl600', 'hoistSpeed').ok).toBe(false);
    expect(buyUpgrade(s, 'tc160', 'trolleySpeed').ok).toBe(true);
    expect(buyUpgrade(s, 'tc160', 'groundMats').ok).toBe(false);
  });
  it('onderhoud herstelt de conditie tegen betaling', () => {
    const s = defaultSave();
    s.money = 5000;
    s.craneCondition.at60 = 0.5;
    const cost = repairCost(s, 'at60');
    expect(cost).toBeGreaterThan(0);
    expect(repairCrane(s, 'at60').ok).toBe(true);
    expect(s.craneCondition.at60).toBe(1);
    expect(s.money).toBe(5000 - cost);
  });
});

describe('ontbrekende audio', () => {
  it('zonder WebAudio crasht de audio-engine niet', () => {
    const a = new AudioEngine();
    expect(() => {
      a.unlock();
      a.update({ engine: 1, hydraulic: 1, winch: 1, wind: 10, drive: 1 });
      a.impact(1, 1000, true);
      a.warning('critical');
      a.ui('success');
      a.startMusic();
    }).not.toThrow();
    expect(a.available).toBe(false);
  });
});
