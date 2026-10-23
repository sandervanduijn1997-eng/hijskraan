import { describe, expect, it } from 'vitest';
import { getMission } from '../../src/missions/data/index';
import { Simulation } from '../../src/sim/simulation';
import { DIFFICULTIES } from '../../src/sim/difficulty';
import { performLift } from '../helpers/autopilot';

describe('missieverloop (headless)', () => {
  it('missie 1 kan volledig worden voltooid met een beloning en sterren', () => {
    const sim = new Simulation({ mission: getMission('m01')!, difficulty: DIFFICULTIES.normal });
    performLift(sim, 'p1', 11.5, 0, 2.6 + 1.0);
    expect(sim.outcome).toBe('success');
    expect(sim.score!.stars).toBeGreaterThanOrEqual(1);
    expect(sim.metrics.placementErrors.length).toBe(1);
  });

  it('missie met meerdere opeenvolgende lasten (m06) telt elke levering', () => {
    const sim = new Simulation({ mission: getMission('m06')!, difficulty: DIFFICULTIES.practice });
    performLift(sim, 'p1', -10, 0, 4);
    expect(sim.tasks[0].status).toBe('done');
    expect(sim.outcome).toBe('running');
    performLift(sim, 'p2', -12.5, 0, 4);
    expect(sim.tasks[1].status).toBe('done');
  });
});
