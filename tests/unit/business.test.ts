import { describe, expect, it } from 'vitest';
import { applySettlement, quoteAccepted, settleJob, winChance, JOBS_PER_WEEK } from '../../src/economy/business';
import { getMission } from '../../src/missions/data/index';
import { defaultSave } from '../../src/save/saveSystem';
import type { ScoreBreakdown } from '../../src/missions/runtime/scoring';
import { Simulation } from '../../src/sim/simulation';
import { DIFFICULTIES } from '../../src/sim/difficulty';
import { emptyInput } from '../../src/cranes/controllers/craneInput';

const score = (stars: 0 | 1 | 2 | 3): ScoreBreakdown => ({ total: 80, stars } as ScoreBreakdown);
const m = getMission('m04')!;
const plan = { craneId: 'at60' as const, quote: 'normal' as const, insured: false, mats: 'timber' as const };

describe('bedrijf en economie', () => {
  it('missies hebben een opdrachtgever en een deadline', () => {
    expect(m.client?.name).toBeTruthy();
    expect(m.deadline).toBeGreaterThan(m.parTime);
  });

  it('een scherpe prijs wint vaker, een hoge prijs alleen met een goede naam', () => {
    const s = defaultSave();
    expect(winChance(s, 'sharp')).toBeGreaterThan(winChance(s, 'normal'));
    expect(winChance(s, 'normal')).toBeGreaterThan(winChance(s, 'high'));
    const good = defaultSave();
    good.business.reputation = 95;
    expect(winChance(good, 'high')).toBeGreaterThan(winChance(s, 'high'));
    // de eerste keer gaat een opdracht tegen marktprijs altijd door
    expect(quoteAccepted(s, m, 'normal')).toBe(true);
  });

  it('afrekening: aanneemsom min matten, boetes en te laat; reputatie stijgt bij succes', () => {
    const s = defaultSave();
    const ok = settleJob(s, m, plan, { success: true, score: score(3), time: 60, damagePct: 0, violations: 0 });
    expect(ok.total).toBeGreaterThan(0);
    expect(ok.repDelta).toBeGreaterThan(0);
    const bad = settleJob(s, m, plan, { success: true, score: score(1), time: m.deadline! + 200, damagePct: 12, violations: 2 });
    expect(bad.total).toBeLessThan(ok.total);
    expect(bad.lines.some((l) => l.label.startsWith('Te laat'))).toBe(true);
    expect(bad.repDelta).toBeLessThan(0);
    const fail = settleJob(s, m, plan, { success: false, score: null, time: 100, damagePct: 5, violations: 0 });
    expect(fail.total).toBeLessThan(0);
  });

  it('verzekering: premie vooraf, maar schade alleen tot het eigen risico', () => {
    const s = defaultSave();
    const nIns = settleJob(s, m, plan, { success: true, score: score(2), time: 60, damagePct: 30, violations: 0 });
    const ins = settleJob(s, m, { ...plan, insured: true }, { success: true, score: score(2), time: 60, damagePct: 30, violations: 0 });
    expect(ins.total).toBeGreaterThan(nIns.total);
  });

  it('na een week worden de vaste lasten van de vloot afgerekend', () => {
    const s = defaultSave();
    for (let i = 0; i < JOBS_PER_WEEK - 1; i++) applySettlement(s, settleJob(s, m, plan, { success: true, score: score(2), time: 60, damagePct: 0, violations: 0 }));
    const last = settleJob(s, m, plan, { success: true, score: score(2), time: 60, damagePct: 0, violations: 0 });
    expect(last.weekClosed).toBe(true);
    expect(last.lines.some((l) => l.label.startsWith('Weekkosten'))).toBe(true);
    applySettlement(s, last);
    expect(s.business.week).toBe(2);
  });
});

describe('gevolgen en inspectie', () => {
  it('een zwaar incident legt het werk stil, daarna volgt een rapport met kosten', () => {
    const sim = new Simulation({ mission: getMission('m01')!, difficulty: DIFFICULTIES.normal });
    // incident nabootsen via een harde botsing van de giek
    (sim as unknown as { incident(c: string, s: number): void }).incident('test: giek raakte de afzetting', 10);
    expect(sim.stopped).toBe(true);
    const slew0 = sim.crane.slew;
    for (let i = 0; i < 60 * 5; i++) sim.step({ ...emptyInput(), slew: 1 });
    expect(sim.crane.slew).toBeCloseTo(slew0, 3);
    for (let i = 0; i < 60 * 20; i++) sim.step(emptyInput());
    expect(sim.stopped).toBe(false);
    expect(sim.inspection!.reported).toBe(true);
    expect(sim.inspection!.findings[0]).toContain('giek');
    expect(sim.inspection!.cost).toBeGreaterThan(0);
    const st = settleJob(defaultSave(), sim.mission, plan, { success: true, score: score(2), time: 100, damagePct: 0, violations: 0, inspectionCost: sim.inspection!.cost });
    expect(st.lines.some((l) => l.label.includes('inspectie'))).toBe(true);
  });

  it('op Oefenen wel een rapport maar geen stillegging', () => {
    const sim = new Simulation({ mission: getMission('m01')!, difficulty: DIFFICULTIES.practice });
    (sim as unknown as { incident(c: string, s: number): void }).incident('test', 10);
    expect(sim.stopped).toBe(false);
  });
});
