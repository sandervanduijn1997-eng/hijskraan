import { describe, expect, it } from 'vitest';
import { Telemetry, phaseOf, summarize } from '../../src/telemetry/telemetry';
import { Simulation } from '../../src/sim/simulation';
import { getMission } from '../../src/missions/data/index';
import { emptyInput } from '../../src/cranes/controllers/craneInput';
import { MemoryStorage } from '../../src/save/saveSystem';

describe('speeltestgegevens', () => {
  it('telt tijd per fase en slaat sessies lokaal op', () => {
    const store = new MemoryStorage();
    const tm = new Telemetry(store);
    const sim = new Simulation({ mission: getMission('m01')! });
    tm.begin(sim, 'career', 'practice');
    for (let i = 0; i < 4000 && !sim.attachCandidate(); i++) {
      sim.step({ ...emptyInput(), hoist: -1 });
      tm.sample(sim, 'lower');
    }
    expect(phaseOf(sim)).toBe('approach');
    sim.toggleRigging();
    for (let i = 0; i < 600; i++) {
      sim.step({ ...emptyInput(), hoist: 1 });
      tm.sample(sim, null);
    }
    expect(phaseOf(sim)).toBe('lift');
    tm.warning('sway');
    tm.end('quit');
    const all = tm.all();
    expect(all).toHaveLength(1);
    expect(all[0].phases.approach).toBeGreaterThan(0);
    expect(all[0].phases.lift).toBeGreaterThan(0);
    expect(all[0].lesson.lower).toBeGreaterThan(0);
    expect(all[0].warnings.sway).toBe(1);
    // geen persoonsgegevens in de sessie
    expect(Object.keys(all[0])).not.toContain('name');
    const sum = summarize(all);
    expect(sum[0]).toMatchObject({ mission: 'm01', tries: 1, success: 0 });
    expect(Object.keys(sum[0].quits)).toHaveLength(1);
  });

  it('een nieuwe start sluit de vorige sessie af als herstart', () => {
    const tm = new Telemetry(new MemoryStorage());
    const sim = new Simulation({ mission: getMission('m01')! });
    tm.begin(sim, 'career', 'normal');
    tm.begin(sim, 'career', 'normal');
    tm.end('success', undefined, 3);
    expect(tm.all().map((s) => s.end)).toEqual(['restart', 'success']);
    tm.clear();
    expect(tm.all()).toEqual([]);
  });
});
