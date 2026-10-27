import { describe, expect, it } from 'vitest';
import { getMission } from '../../src/missions/data/index';
import { DIFFICULTIES } from '../../src/sim/difficulty';
import { Simulation, replayStep } from '../../src/sim/simulation';
import { Bot } from '../helpers/missionBot';
import { validateMission } from '../../src/missions/validation/validateMission';

function playAndRecord(id: string, seconds: number) {
  const m = getMission(id)!;
  const f = validateMission(m).feasibility.find((x) => x.feasible)!;
  const opt = { mission: m, craneId: f.craneId, difficulty: DIFFICULTIES.normal, counterweightIndex: f.config?.cw, boomOptionIndex: f.config?.boom, jibIndex: f.config?.jib };
  const sim = new Simulation(opt);
  const gen = new Bot(sim).run(f.config);
  for (let i = 0; i < seconds * 60 && sim.outcome === 'running'; i++) {
    sim.step(gen.next().value!);
    sim.drainEvents();
  }
  return { sim, opt };
}

describe('herhaling', () => {
  it('opnieuw afspelen van de opname geeft exact hetzelfde verloop (deterministisch)', () => {
    for (const id of ['m01', 'm05', 'm09']) {
      const { sim, opt } = playAndRecord(id, 600);
      const rec = sim.recorder.rec;
      const re = new Simulation(opt);
      while (re.stepCount < rec.steps) {
        replayStep(re, rec);
        re.drainEvents();
      }
      expect(re.outcome).toBe(sim.outcome);
      expect(re.time).toBeCloseTo(sim.time, 9);
      for (let i = 0; i < sim.loads.length; i++) {
        expect(re.loads[i].cb.body.pos.x).toBeCloseTo(sim.loads[i].cb.body.pos.x, 6);
        expect(re.loads[i].cb.body.pos.z).toBeCloseTo(sim.loads[i].cb.body.pos.z, 6);
      }
    }
  }, 60000);

  it('tijdlijn en markeringen: aanslaan, plaatsen en het einde staan erin', () => {
    const { sim } = playAndRecord('m01', 600);
    const r = sim.recorder.rec;
    expect(r.samples.length).toBeGreaterThan(10);
    expect(r.markers.some((m) => m.kind === 'attach')).toBe(true);
    expect(r.markers.some((m) => m.kind === 'success' || m.kind === 'fail')).toBe(true);
    // invoer wordt alleen bij een wijziging opgeslagen (de bot stuurt analoog, dus vaak)
    expect(r.inputs.length).toBeLessThanOrEqual(r.steps);
  });
});
