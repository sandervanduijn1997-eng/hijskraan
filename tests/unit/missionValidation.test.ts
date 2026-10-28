import { describe, expect, it } from 'vitest';
import { CHAPTERS, MISSIONS } from '../../src/missions/data/index';
import { validateMission } from '../../src/missions/validation/validateMission';
import { CRANES, CRANE_IDS } from '../../src/cranes/config/cranes';
import { Simulation } from '../../src/sim/simulation';
import { emptyInput } from '../../src/cranes/controllers/craneInput';
import { CHALLENGES, challengeMission, practiceMission } from '../../src/missions/data/challenges';

describe('veertig missies als data', () => {
  it('precies 73 missies, genummerd 1..73, verdeeld over 14 hoofdstukken', () => {
    expect(MISSIONS.length).toBe(73);
    expect(MISSIONS.map((m) => m.number)).toEqual(Array.from({ length: 73 }, (_, i) => i + 1));
    expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(73);
    expect(CHAPTERS.length).toBe(14);
    const COUNT: Record<number, number> = { 9: 3, 10: 8, 11: 5, 12: 5, 13: 6, 14: 6 };
    for (const ch of CHAPTERS) expect(MISSIONS.filter((m) => m.chapter === ch.number).length).toBe(COUNT[ch.number] ?? 5);
  });

  for (const m of MISSIONS) {
    it(`missie ${m.number} "${m.title}" is geldig en haalbaar`, () => {
      const v = validateMission(m);
      const errors = v.issues.filter((i) => i.severity === 'error');
      expect(errors, errors.map((e) => e.message).join('\n')).toEqual([]);
      expect(v.feasibility[0].feasible).toBe(true);
    });
  }

  it('kranen verwijzen naar de missies waarvoor ze geschikt zijn (en omgekeerd)', () => {
    for (const m of MISSIONS) for (const c of m.craneOptions) expect(CRANES[c].suitableMissions, `${c} ↔ ${m.number}`).toContain(m.number);
    for (const id of CRANE_IDS) for (const n of CRANES[id].suitableMissions) expect(MISSIONS.find((m) => m.number === n)!.craneOptions).toContain(id);
  });

  it('elke kraanklasse komt in de carrière voor', () => {
    const used = new Set(MISSIONS.flatMap((m) => m.craneOptions));
    for (const id of CRANE_IDS) expect(used.has(id)).toBe(true);
  });

  it('elke missie start zonder fouten en blijft numeriek stabiel', () => {
    for (const m of MISSIONS) {
      const sim = new Simulation({ mission: m });
      for (let i = 0; i < 120; i++) sim.step(emptyInput());
      for (const l of sim.loads) {
        expect(Number.isFinite(l.cb.body.pos.x) && Number.isFinite(l.cb.body.pos.y), `${m.id}/${l.id}`).toBe(true);
        // lasten liggen bij de start stil (niet door een obstakel geduwd)
        expect(Math.abs(l.cb.body.vel.x) + Math.abs(l.cb.body.vel.y), `${m.id}/${l.id}`).toBeLessThan(0.2);
      }
      expect(sim.outcome, `${m.id}: ${sim.failReason}`).toBe('running');
      expect(sim.metrics.damage, m.id).toBe(0);
    }
  });

  it('uitdagingen en vrije oefening leveren geldige scenario’s', () => {
    expect(CHALLENGES.length).toBe(6);
    for (const c of CHALLENGES) {
      const v = validateMission(challengeMission(c));
      expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);
    }
    for (const id of CRANE_IDS) {
      const m = practiceMission({ craneId: id, loadType: 'pallet500', environment: 'trainingYard', windBase: 0, gravity: 9.81 });
      const sim = new Simulation({ mission: m, craneId: id, freePlay: true });
      for (let i = 0; i < 60; i++) sim.step(emptyInput());
      expect(sim.outcome).toBe('running');
    }
  });
});
