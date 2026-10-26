import { describe, expect, it } from 'vitest';
import { getMission } from '../../src/missions/data/index';
import { Simulation } from '../../src/sim/simulation';
import { DIFFICULTIES } from '../../src/sim/difficulty';
import { Signalman } from '../../src/sim/signalman';
import { emptyInput } from '../../src/cranes/controllers/craneInput';
import { run, hoistTo, steerTip } from '../helpers/autopilot';

describe('signaalgever', () => {
  it('zonder last: stuurt de haak naar de last en laat hem zakken', () => {
    const sim = new Simulation({ mission: getMission('m01')!, difficulty: DIFFICULTIES.practice });
    sim.step(emptyInput());
    const sm = new Signalman();
    const c = sm.update(sim);
    expect(c).not.toBeNull();
    expect(['slewLeft', 'slewRight', 'out', 'in', 'lower']).toContain(c!.signal);
  });

  it('met last boven de zone: zakken, langzaam, en herhaalt zich niet elke stap', () => {
    const sim = new Simulation({ mission: getMission('m01')!, difficulty: DIFFICULTIES.practice });
    const load = sim.loads[0];
    const sp = sim.slingPoint(load);
    run(sim, 60, () => { const i = steerTip(sim, sp.x, sim.geom.tipHeight); hoistTo(sim, i, sp.y + 0.2); return i; }, () => sim.attachCandidate() === load);
    sim.toggleRigging();
    const zone = sim.mission.zones[0];
    run(sim, 40, () => { const i = steerTip(sim, zone.x, sim.geom.tipHeight, 0.3); hoistTo(sim, i, 5.5); return i; }, () => Math.abs(sim.geom.tip.x - zone.x) < 0.05 && sim.swayDeg < 0.5);
    const sm = new Signalman();
    const calls: string[] = [];
    for (let k = 0; k < 60 * 6; k++) {
      sim.step(emptyInput());
      const c = sm.update(sim);
      if (c) calls.push(c.signal);
    }
    expect(calls[0]).toBe('lower');
    expect(calls.length).toBeLessThan(5);
  });
});
