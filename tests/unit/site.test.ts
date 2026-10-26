import { describe, expect, it } from 'vitest';
import { SiteLife } from '../../src/sim/site';
import { Simulation } from '../../src/sim/simulation';
import { getMission } from '../../src/missions/data/index';
import { DIFFICULTIES } from '../../src/sim/difficulty';
import { emptyInput } from '../../src/cranes/controllers/craneInput';
import { loadBottomCenter } from '../../src/missions/validation/placement';

const open = (x: number, z: number) => Math.hypot(x, z) > 6;
const make = (count = 6, laneZ: number | null = 20) => new SiteLife({ seed: 42, count, cx: 0, cz: 0, rMin: 6, rMax: 25, free: open, laneZ });

describe('levende bouwplaats', () => {
  it('bouwvakkers blijven buiten de afgezette draaicirkel en lopen rond', () => {
    const s = make();
    expect(s.workers.length).toBe(6);
    const start = s.workers.map((w) => [w.x, w.z]);
    for (let i = 0; i < 120 * 60; i++) s.update(1 / 120, null);
    let moved = 0;
    s.workers.forEach((w, i) => {
      expect(Math.hypot(w.x, w.z)).toBeGreaterThan(5.9);
      if (Math.hypot(w.x - start[i][0], w.z - start[i][1]) > 1) moved++;
    });
    expect(moved).toBeGreaterThan(3);
  });

  it('mensen lopen weg onder een langzaam naderende last: geen overtreding', () => {
    const s = make(6, null);
    const w = s.workers[0];
    let v = 0;
    // last nadert vanaf 12 m met 1 m/s
    const dir = Math.atan2(w.z, w.x);
    const x0 = w.x;
    const z0 = w.z;
    for (let t = 0; t < 14; t += 1 / 120) {
      const d = 12 - t;
      v += s.update(1 / 120, { x: x0 + Math.cos(dir + 1) * d, z: z0 + Math.sin(dir + 1) * d, half: 1, bottom: 3 });
    }
    expect(v).toBe(0);
  });

  it('een last die plots boven iemand komt is een overtreding (één keer per blootstelling)', () => {
    const s = make(1, null);
    const w = s.workers[0];
    let v = 0;
    for (let t = 0; t < 1; t += 1 / 120) v += s.update(1 / 120, { x: w.x, z: w.z, half: 8, bottom: 2 });
    expect(v).toBe(1);
    expect(s.peopleUnderLoad).toBe(true);
  });

  it('de vrachtwagen rijdt aan, parkeert en rijdt weer weg', () => {
    const s = make(0, 20);
    const states = new Set<string>();
    for (let i = 0; i < 120 * 200; i++) {
      s.update(1 / 120, null);
      states.add(s.truck!.state);
    }
    expect([...states]).toEqual(expect.arrayContaining(['away', 'arrive', 'parked', 'leave']));
  });

  it('in de simulatie: bouwvakkers per omgeving en uit te zetten per missie', () => {
    const m = getMission('m01')!;
    const sim = new Simulation({ mission: m });
    expect(sim.site?.workers.length).toBeGreaterThan(0);
    const none = new Simulation({ mission: { ...m, site: { workers: 0 } } });
    expect(none.site).toBeNull();
  });

  it('realistisch: last boven personen legt het werk stil', () => {
    const base = getMission('m01')!;
    const mission = { ...base, loads: [{ ...base.loads[0], type: 'siteContainer' }] };
    const sim = new Simulation({ mission, difficulty: DIFFICULTIES.realistic });
    sim.lmi = { ...sim.lmi, configured: true };
    const inp = (hoist: number) => ({ ...emptyInput(), hoist });
    for (let i = 0; i < 4000 && !sim.attachCandidate(); i++) sim.step(inp(-1));
    sim.toggleRigging();
    for (let i = 0; i < 900; i++) sim.step(inp(1));
    expect(sim.attached).not.toBeNull();
    const bc = loadBottomCenter(sim.attached!.cb.body);
    const w = sim.site!.workers[0];
    w.x = bc.x;
    w.z = bc.z;
    for (let i = 0; i < 120 && sim.outcome === 'running'; i++) sim.step(inp(0));
    expect(sim.outcome).toBe('failed');
    expect(sim.failReason).toContain('personen');
  });
});
