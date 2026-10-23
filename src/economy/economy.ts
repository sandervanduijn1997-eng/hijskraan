import { getCrane } from '../cranes/config/cranes';
import type { CraneId, UpgradeId } from '../cranes/config/types';
import { upgradePrice } from '../cranes/config/upgrades';
import type { MissionDef } from '../missions/data/types';
import type { ScoreBreakdown } from '../missions/runtime/scoring';
import type { SaveData } from '../save/saveSystem';

/** Opbrengstfactor per aantal sterren. */
export const STAR_FACTOR = [0, 0.9, 1.0, 1.2] as const;
/** Herhaalde voltooiingen leveren minder op (voorkomt eindeloos dezelfde opdracht herhalen). */
export const REPEAT_FACTOR = 0.35;

export interface Payout {
  baseMoney: number;
  starBonus: number;
  repeatPenalty: number;
  rent: number;
  wear: number;
  money: number;
  xp: number;
  firstCompletion: boolean;
  newLicense: string | null;
  newLivery: string | null;
}

export const isOwned = (save: SaveData, id: CraneId): boolean => save.ownedCranes.includes(id);

export function rentCost(save: SaveData, id: CraneId): number {
  return isOwned(save, id) ? 0 : getCrane(id).economy.rentPerMission;
}

/** Bereken de uitbetaling (pure functie, muteert niets). */
export function computePayout(save: SaveData, m: MissionDef, score: ScoreBreakdown, craneId: CraneId): Payout {
  const first = (save.completed[m.id]?.completions ?? 0) === 0;
  const f = STAR_FACTOR[score.stars];
  const base = m.reward.money;
  const gross = base * f * (first ? 1 : REPEAT_FACTOR);
  const rent = rentCost(save, craneId);
  const wear = isOwned(save, craneId) ? getCrane(craneId).economy.maintenancePerMission : 0;
  const money = Math.max(0, Math.round(gross - rent));
  const xp = Math.round(m.reward.xp * f * (first ? 1 : REPEAT_FACTOR));
  return {
    baseMoney: base,
    starBonus: Math.round(base * (f - 1)),
    repeatPenalty: first ? 0 : Math.round(base * f * (1 - REPEAT_FACTOR)),
    rent,
    wear,
    money,
    xp,
    firstCompletion: first,
    newLicense: m.reward.license && !save.licenses.includes(m.reward.license) ? m.reward.license : null,
    newLivery: m.reward.livery && !save.liveries.includes(m.reward.livery) ? m.reward.livery : null,
  };
}

/** Pas een geslaagde missie toe op het savebestand (muteert). */
export function applyMissionResult(save: SaveData, m: MissionDef, score: ScoreBreakdown, time: number, craneId: CraneId, damagePct: number, liftedT: number): Payout {
  const p = computePayout(save, m, score, craneId);
  save.money += p.money;
  save.xp += p.xp;
  const rec = save.completed[m.id];
  if (!rec) save.completed[m.id] = { stars: score.stars, bestScore: score.total, bestTime: time, completions: 1 };
  else {
    rec.stars = Math.max(rec.stars, score.stars);
    rec.bestScore = Math.max(rec.bestScore, score.total);
    rec.bestTime = rec.bestTime > 0 ? Math.min(rec.bestTime, time) : time;
    rec.completions++;
  }
  if (p.newLicense) save.licenses.push(m.reward.license!);
  if (m.reward.certificate && !save.certificates.includes(m.reward.certificate)) save.certificates.push(m.reward.certificate);
  if (p.newLivery) save.liveries.push(m.reward.livery!);
  if (isOwned(save, craneId)) {
    const c = save.craneCondition[craneId] ?? 1;
    save.craneCondition[craneId] = Math.max(0, c - 0.05 - damagePct * 0.002);
  }
  save.stats.lifts += m.tasks.filter((t) => t.type === 'deliver').length;
  save.stats.tonnage += liftedT;
  return p;
}

export type PurchaseResult = { ok: true } | { ok: false; reason: string };

export function canBuyCrane(save: SaveData, id: CraneId): PurchaseResult {
  const c = getCrane(id);
  if (isOwned(save, id)) return { ok: false, reason: 'Al in je vloot.' };
  if (c.economy.requiredLicense && !save.licenses.includes(c.economy.requiredLicense)) return { ok: false, reason: 'Vereiste licentie ontbreekt.' };
  if (save.money < c.economy.buyPrice) return { ok: false, reason: 'Onvoldoende saldo.' };
  return { ok: true };
}

export function buyCrane(save: SaveData, id: CraneId): PurchaseResult {
  const r = canBuyCrane(save, id);
  if (!r.ok) return r;
  save.money -= getCrane(id).economy.buyPrice;
  save.ownedCranes.push(id);
  save.craneCondition[id] = 1;
  return { ok: true };
}

export function repairCost(save: SaveData, id: CraneId): number {
  const cond = save.craneCondition[id] ?? 1;
  return Math.round(((1 - cond) * 100 * getCrane(id).economy.maintenancePerMission) / 10);
}

export function repairCrane(save: SaveData, id: CraneId): PurchaseResult {
  if (!isOwned(save, id)) return { ok: false, reason: 'Niet in je vloot.' };
  const cost = repairCost(save, id);
  if (cost <= 0) return { ok: false, reason: 'Geen onderhoud nodig.' };
  if (save.money < cost) return { ok: false, reason: 'Onvoldoende saldo.' };
  save.money -= cost;
  save.craneCondition[id] = 1;
  return { ok: true };
}

export function canBuyUpgrade(save: SaveData, id: CraneId, up: UpgradeId): PurchaseResult {
  const c = getCrane(id);
  if (!isOwned(save, id)) return { ok: false, reason: 'Koop eerst de kraan.' };
  if (!c.upgrades.includes(up)) return { ok: false, reason: 'Niet beschikbaar voor deze kraan.' };
  if ((save.upgrades[id] ?? []).includes(up)) return { ok: false, reason: 'Al geïnstalleerd.' };
  if (save.money < upgradePrice(c, up)) return { ok: false, reason: 'Onvoldoende saldo.' };
  return { ok: true };
}

export function buyUpgrade(save: SaveData, id: CraneId, up: UpgradeId): PurchaseResult {
  const r = canBuyUpgrade(save, id, up);
  if (!r.ok) return r;
  save.money -= upgradePrice(getCrane(id), up);
  save.upgrades[id] = [...(save.upgrades[id] ?? []), up];
  return { ok: true };
}

export const formatMoney = (v: number): string => `€${Math.round(v).toLocaleString('nl-NL')}`;
