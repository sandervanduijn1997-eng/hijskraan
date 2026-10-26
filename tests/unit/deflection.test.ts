import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/simulation';
import { getMission } from '../../src/missions/data/index';
import { emptyInput } from '../../src/cranes/controllers/craneInput';
import { computeGeometry } from '../../src/cranes/models/kinematics';
import { cloneCraneState } from '../../src/cranes/models/craneState';

describe('doorbuiging en trillen van de giek', () => {
  it('een doorgebogen giek brengt de tip omlaag en naar voren', () => {
    const sim = new Simulation({ mission: getMission('m01')! });
    const st = cloneCraneState(sim.crane);
    st.boomDeflect = 0;
    const g0 = computeGeometry(sim.spec, st);
    st.boomDeflect = 0.3;
    const g1 = computeGeometry(sim.spec, st);
    expect(g1.tip.y).toBeLessThan(g0.tip.y - 0.15);
    expect(g1.tipU).toBeGreaterThan(g0.tipU);
  });

  it('buigt door onder last en trilt na als de last wordt neergezet', () => {
    const m = getMission('m01')!;
    const sim = new Simulation({ mission: { ...m, loads: [{ ...m.loads[0], type: 'machine' }] } });
    const inp = (hoist: number) => ({ ...emptyInput(), hoist });
    for (let i = 0; i < 4000 && !sim.attachCandidate(); i++) sim.step(inp(-1));
    const unloaded = sim.crane.boomDeflect;
    sim.toggleRigging();
    for (let i = 0; i < 1200; i++) sim.step(inp(1));
    const loaded = sim.crane.boomDeflect;
    expect(loaded).toBeGreaterThan(unloaded + 0.005);
    // last laten zakken tot hij staat: de giek veert terug naar de onbelaste stand
    for (let i = 0; i < 6000 && sim.attached!.cb.supports.size === 0; i++) sim.step(inp(-1));
    for (let i = 0; i < 600; i++) sim.step(inp(-0.3));
    expect(sim.crane.boomDeflect).toBeLessThan(unloaded + (loaded - unloaded) * 0.3);
  });
});
