import { CRANE_IDS, getCrane } from '../../src/cranes/config/cranes';
import { upgradePrice } from '../../src/cranes/config/upgrades';
import type { CraneId, LicenseId, UpgradeId } from '../../src/cranes/config/types';
import { isChapterUnlocked, isMissionUnlocked, levelFor, nextMission, totalStars } from '../../src/career/career';
import { QUOTES, applySettlement, insurancePremium, matsCost, quoteAccepted, settleJob, winChance } from '../../src/economy/business';
import type { JobOutcome, JobPlan, Quote } from '../../src/economy/business';
import { applyMissionResult, buyCrane, buyUpgrade, canBuyCrane, canBuyUpgrade, computePayout, formatMoney, rentCost, repairCost, repairCrane } from '../../src/economy/economy';
import { CHALLENGES } from '../../src/missions/data/challenges';
import { CHAPTERS, MISSIONS } from '../../src/missions/data/index';
import type { ScoreBreakdown, ScoreMetrics } from '../../src/missions/runtime/scoring';
import type { MatId } from '../../src/physics/stability/groundPressure';
import { defaultSave } from '../../src/save/saveSystem';
import type { SaveData } from '../../src/save/saveSystem';
import { writeRef } from './common';

/**
 * Economie, bedrijf, carrière en uitdagingsbeoordeling als functietabellen: willekeurige (maar vaste)
 * spelstanden → uitbetaling, afrekening, gemuteerd savebestand, ontgrendelingen en beoordelingen.
 * Alles is pure rekenkunde op data, dus de C++-port moet exact gelijk zijn.
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
const MAT_IDS: MatId[] = ['none', 'timber', 'large'];
const QUOTE_IDS = Object.keys(QUOTES) as Quote[];
const LIVERIES = [...new Set(MISSIONS.map((m) => m.reward.livery).filter((x): x is string => !!x))];

/** Savebestand zonder instellingen (die horen bij de UI, niet bij de rekenkern). */
function plainSave(s: SaveData): Omit<SaveData, 'settings'> {
  const { settings: _settings, ...rest } = s;
  return structuredClone(rest);
}

function randomSave(r: () => number): SaveData {
  const s = defaultSave();
  const pick = <T>(xs: readonly T[], p: number) => xs.filter(() => r() < p);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  s.money = r() < 0.1 ? 0 : int(0, 250000);
  s.xp = int(0, 40000);
  s.licenses = pick(LICENSES, r());
  s.certificates = r() < 0.3 ? ['cert-a'] : [];
  // voltooide missies: meestal een aaneengesloten begin van de carrière, soms met gaten
  const upto = int(0, MISSIONS.length);
  for (const m of MISSIONS.slice(0, upto)) {
    if (r() < 0.1) continue;
    s.completed[m.id] = { stars: int(0, 3), bestScore: int(0, 1000), bestTime: r() < 0.1 ? 0 : int(30, 900), completions: r() < 0.15 ? 0 : int(1, 5) };
  }
  s.ownedCranes = pick(CRANE_IDS, 0.3);
  for (const id of s.ownedCranes) {
    if (r() < 0.8) s.craneCondition[id] = Math.round(r() * 100) / 100;
    const ups = pick(getCrane(id).upgrades, 0.3);
    if (ups.length) s.upgrades[id] = ups;
  }
  s.liveries = pick(LIVERIES, 0.3);
  s.stats = { lifts: int(0, 500), tonnage: Math.round(r() * 50000) / 10, playTime: int(0, 100000) };
  s.business = { reputation: int(0, 100), quotes: int(0, 80), weekJobs: int(0, 4), week: int(1, 30) };
  return s;
}

function caseFor(r: () => number) {
  const save = randomSave(r);
  const m = MISSIONS[Math.floor(r() * MISSIONS.length)];
  const craneId: CraneId = r() < 0.6 ? m.craneOptions[Math.floor(r() * m.craneOptions.length)] : CRANE_IDS[Math.floor(r() * CRANE_IDS.length)];
  const stars = Math.floor(r() * 4) as ScoreBreakdown['stars'];
  const score: ScoreBreakdown = { safety: 0, precision: 0, time: 0, sway: 0, collisions: 0, damage: 0, config: 0, efficiency: 0, total: Math.round(r() * 1000), stars };
  const success = r() < 0.8;
  const time = Math.round(r() * 12000) / 10;
  const damagePct = r() < 0.5 ? 0 : Math.round(r() * 400) / 10;
  const liftedT = Math.round(r() * 3000) / 10;
  const plan: JobPlan = { craneId, quote: QUOTE_IDS[Math.floor(r() * 3)], insured: r() < 0.5, mats: MAT_IDS[Math.floor(r() * 3)] };
  const outcome: JobOutcome = { success, score: success ? score : null, time, damagePct, violations: r() < 0.6 ? 0 : Math.floor(r() * 4), ...(r() < 0.15 ? { inspectionCost: Math.round(r() * 50000) / 10 } : {}) };
  const buyId = CRANE_IDS[Math.floor(r() * CRANE_IDS.length)];
  const upCrane = r() < 0.7 && save.ownedCranes.length ? save.ownedCranes[Math.floor(r() * save.ownedCranes.length)] : buyId;
  const upList = getCrane(upCrane).upgrades;
  const up: UpgradeId = upList.length && r() < 0.9 ? upList[Math.floor(r() * upList.length)] : 'hoistSpeed';

  const addMoney = r() < 0.7;
  const afterMission = structuredClone(save);
  const payoutApplied = applyMissionResult(afterMission, m, score, time, craneId, damagePct, liftedT, addMoney);
  const settlement = settleJob(save, m, plan, outcome);
  const afterSettle = structuredClone(save);
  applySettlement(afterSettle, settlement);
  const afterBuy = structuredClone(save);
  const buy = buyCrane(afterBuy, buyId);
  const afterUpgrade = structuredClone(save);
  const upRes = buyUpgrade(afterUpgrade, upCrane, up);
  const afterRepair = structuredClone(save);
  const repairId = save.ownedCranes[0] ?? buyId;
  const repair = repairCrane(afterRepair, repairId);

  return {
    save: plainSave(save),
    missionId: m.id,
    craneId,
    score,
    time,
    damagePct,
    liftedT,
    addMoney,
    plan,
    outcome,
    buyId,
    upCrane,
    up,
    repairId,
    expect: {
      payout: computePayout(save, m, score, craneId),
      payoutApplied,
      afterMission: plainSave(afterMission),
      settlement,
      afterSettle: plainSave(afterSettle),
      winChance: QUOTE_IDS.map((q) => winChance(save, q)),
      quoteAccepted: QUOTE_IDS.map((q) => quoteAccepted(save, m, q)),
      matsCost: MAT_IDS.map((x) => matsCost(craneId, x)),
      insurancePremium: insurancePremium(m),
      rentCost: rentCost(save, craneId),
      repairCost: CRANE_IDS.map((id) => repairCost(save, id)),
      canBuyCrane: canBuyCrane(save, buyId),
      buyCrane: buy,
      afterBuy: plainSave(afterBuy),
      canBuyUpgrade: canBuyUpgrade(save, upCrane, up),
      buyUpgrade: upRes,
      afterUpgrade: plainSave(afterUpgrade),
      repairCrane: repair,
      afterRepair: plainSave(afterRepair),
      chapterUnlocked: CHAPTERS.map((c) => isChapterUnlocked(save, c.number)),
      missionUnlocked: MISSIONS.map((x) => isMissionUnlocked(save, x)),
      nextMission: nextMission(save)?.id ?? null,
      totalStars: totalStars(save),
      level: levelFor(save.xp),
    },
  };
}

function randomMetrics(r: () => number): ScoreMetrics {
  const n = Math.floor(r() * 3);
  return {
    time: Math.round(r() * 30000) / 100,
    parTime: 100 + Math.floor(r() * 400),
    maxLoadPct: r() * 120,
    overloadTime: r() < 0.7 ? 0 : r() * 5,
    safetyViolations: r() < 0.7 ? 0 : Math.floor(r() * 3),
    criticalWarningTime: r() * 3,
    placementErrors: Array.from({ length: n }, () => r()),
    maxSwayDeg: r() * 8,
    collisions: r() < 0.6 ? 0 : Math.floor(r() * 4),
    damage: r() < 0.5 ? 0 : r() * 30,
    peakLiftPct: r() * 110,
    fuelUsed: r() < 0.05 ? 0 : r() * 20,
    fuelPar: r() * 10,
  };
}

export function careerTables() {
  const r = rng(0xca7ee7);
  const cases = Array.from({ length: 400 }, () => caseFor(r));
  // randgevallen: nieuw savebestand
  const fresh = defaultSave();
  const challenges = CHALLENGES.map((c) => ({
    id: c.id,
    samples: Array.from({ length: 200 }, () => {
      const m = randomMetrics(r);
      return { metrics: m, rate: c.rate(m) };
    }),
  }));
  const xp = [0, 1, 149, 150, 151, 599, 600, 601, 1350, 2400, 15000, 18150, 40000, 123456];
  const money = [0, -0.4, 1, 999, 1000, 1234.5, 1234.49, 12345, 1234567, -1, -1500, -1234567.8, 0.5, 2.5, 999999.5];
  return {
    fresh: plainSave(fresh),
    upgradePrice: CRANE_IDS.map((id) => ({ craneId: id, prices: getCrane(id).upgrades.map((u) => ({ up: u, price: upgradePrice(getCrane(id), u) })) })),
    levels: xp.map((x) => ({ xp: x, level: levelFor(x) })),
    formatMoney: money.map((v) => ({ v, s: formatMoney(v) })),
    cases,
    challenges,
  };
}

export function exportCareer(): string[] {
  return [writeRef('units/career', careerTables(), true)];
}
