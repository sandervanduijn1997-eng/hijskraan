import { getCrane } from '../cranes/config/cranes';
import type { CraneId } from '../cranes/config/types';
import type { MissionDef } from '../missions/data/types';
import type { ScoreBreakdown } from '../missions/runtime/scoring';
import type { MatId } from '../physics/stability/groundPressure';
import { standardMatSide } from '../physics/stability/groundPressure';
import type { SaveData } from '../save/saveSystem';
import { hashString } from '../utils/math';
import { REPEAT_FACTOR, STAR_FACTOR, rentCost } from './economy';

/**
 * Het kraanbedrijf: offertes, verzekering, huur, matten, boetes, weekkosten en reputatie.
 * Een scherpe prijs wint de opdracht vaker maar levert minder op; een hoge prijs alleen met een goede
 * naam. Fouten kosten geld én reputatie, en een slechte naam kost werk.
 */

export type Quote = 'sharp' | 'normal' | 'high';

export const QUOTES: Record<Quote, { label: string; pay: number; win: number }> = {
  sharp: { label: 'Scherp (−15 %)', pay: 0.85, win: 0.35 },
  normal: { label: 'Marktprijs', pay: 1, win: 0.15 },
  high: { label: 'Hoog (+25 %)', pay: 1.25, win: -0.2 },
};

/** Opdrachten per week; daarna worden de vaste lasten van de vloot afgerekend. */
export const JOBS_PER_WEEK = 5;
/** Eigen risico bij een verzekerde schade (€). */
export const DEDUCTIBLE = 250;

export interface JobPlan {
  craneId: CraneId;
  quote: Quote;
  insured: boolean;
  mats: MatId;
}

/** Kans dat de opdrachtgever de offerte accepteert (0..1). */
export function winChance(save: SaveData, quote: Quote): number {
  return Math.min(1, Math.max(0.05, 0.45 + (save.business.reputation - 50) / 80 + QUOTES[quote].win));
}

/**
 * Wordt de offerte geaccepteerd? Deterministisch per offerte (missie + offertenummer), zodat herladen
 * het resultaat niet verandert. De eerste opdracht van elke missie gaat tegen marktprijs altijd door,
 * zodat de verhaallijn nooit vastloopt.
 */
export function quoteAccepted(save: SaveData, m: MissionDef, quote: Quote): boolean {
  if ((save.completed[m.id]?.completions ?? 0) === 0 && quote !== 'high') return true;
  const roll = (hashString(`${m.id}|${save.business.quotes}`) % 1000) / 1000;
  return roll < winChance(save, quote);
}

/** Huur van kraanmatten voor deze opdracht (€). */
export function matsCost(craneId: CraneId, mats: MatId): number {
  if (mats === 'none') return 0;
  const side = standardMatSide(getCrane(craneId).gameBalance.maxCapacityT);
  return Math.round((mats === 'large' ? 160 : 60) * side * side);
}

export const insurancePremium = (m: MissionDef): number => Math.round(m.reward.money * 0.06);

/** Factor op de aanneemsom door de reputatie (0,9 bij 0 tot 1,1 bij 100). */
export const reputationFactor = (rep: number): number => 0.9 + (0.2 * rep) / 100;

export interface JobOutcome {
  success: boolean;
  score: ScoreBreakdown | null;
  time: number;
  damagePct: number;
  violations: number;
  /** Extra kosten uit een inspectie na een zware botsing (€), zie gevolgen. */
  inspectionCost?: number;
}

export interface Settlement {
  lines: { label: string; amount: number }[];
  total: number;
  reputation: number;
  repDelta: number;
  weekClosed: boolean;
}

/** Schaal voor boetes: zwaardere hoofdstukken, grotere bedragen. */
const scale = (m: MissionDef) => 1 + m.chapter * 0.25;

/** Afrekening van een opdracht (pure functie). */
export function settleJob(save: SaveData, m: MissionDef, plan: JobPlan, o: JobOutcome): Settlement {
  const lines: { label: string; amount: number }[] = [];
  const first = (save.completed[m.id]?.completions ?? 0) === 0;
  if (o.success && o.score) {
    const sum = m.reward.money * QUOTES[plan.quote].pay * STAR_FACTOR[o.score.stars] * (first ? 1 : REPEAT_FACTOR) * reputationFactor(save.business.reputation);
    lines.push({ label: `Aanneemsom (${QUOTES[plan.quote].label.toLowerCase()}, ${'★'.repeat(o.score.stars)}${first ? '' : ', herhaling'})`, amount: Math.round(sum) });
  }
  const rent = rentCost(save, plan.craneId);
  if (rent) lines.push({ label: 'Kraanhuur', amount: -rent });
  const mc = matsCost(plan.craneId, plan.mats);
  if (mc) lines.push({ label: 'Huur kraanmatten', amount: -mc });
  if (plan.insured) lines.push({ label: 'Verzekeringspremie (6 %)', amount: -insurancePremium(m) });
  const damage = Math.round(o.damagePct * m.reward.money * 0.04);
  if (damage > 0) lines.push(plan.insured ? { label: 'Schade (verzekerd, eigen risico)', amount: -Math.min(damage, DEDUCTIBLE) } : { label: 'Schade aan lasten en omgeving', amount: -damage });
  if (o.violations > 0) lines.push({ label: `Boete veiligheidsovertredingen (${o.violations}×)`, amount: -Math.round(o.violations * 300 * scale(m)) });
  if (o.inspectionCost) lines.push({ label: 'Stillegging en inspectie', amount: -Math.round(o.inspectionCost) });
  const late = m.deadline && o.success ? Math.max(0, o.time - m.deadline) : 0;
  if (late > 0) lines.push({ label: `Te laat opgeleverd (${Math.ceil(late / 60)} min)`, amount: -Math.round(Math.ceil(late / 60) * 75 * scale(m)) });
  // weekafsluiting: vaste lasten van de eigen vloot (verzekering, stalling, keuringen)
  const weekClosed = save.business.weekJobs + 1 >= JOBS_PER_WEEK;
  if (weekClosed) {
    const fleet = save.ownedCranes.reduce((a, id) => a + getCrane(id).economy.buyPrice, 0);
    lines.push({ label: `Weekkosten vloot (week ${save.business.week})`, amount: -Math.round(fleet * 0.004) });
  }
  // reputatie
  let rep = 0;
  if (o.success && o.score) rep += 1 + o.score.stars + (late > 0 ? -2 : 1);
  else rep -= 5;
  rep -= 3 * o.violations;
  if (o.damagePct > 10) rep -= 2;
  if (o.inspectionCost) rep -= 3;
  const total = lines.reduce((a, l) => a + l.amount, 0);
  return { lines, total, reputation: Math.min(100, Math.max(0, save.business.reputation + rep)), repDelta: rep, weekClosed };
}

/** Pas de afrekening toe op het savebestand (muteert). Het saldo kan niet onder nul. */
export function applySettlement(save: SaveData, s: Settlement): void {
  save.money = Math.max(0, save.money + s.total);
  save.business.reputation = s.reputation;
  if (s.weekClosed) {
    save.business.weekJobs = 0;
    save.business.week++;
  } else save.business.weekJobs++;
}

