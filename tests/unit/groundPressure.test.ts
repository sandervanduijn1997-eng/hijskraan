import { describe, expect, it } from 'vitest';
import { allowedPressure, bearingArea, padLoadsT } from '../../src/physics/stability/groundPressure';
import { Simulation } from '../../src/sim/simulation';
import { getMission } from '../../src/missions/data/index';
import { emptyInput } from '../../src/cranes/controllers/craneInput';
import { DIFFICULTIES } from '../../src/sim/difficulty';

const masses = { carrierT: 20, superT: 10, superBehind: 1, counterweightT: 10, cwRadius: 3 };

describe('bodemdruk en kraanmatten', () => {
  it('stempelkrachten tellen op tot het totale gewicht; de last drukt op de stempels aan de lastkant', () => {
    const f = padLoadsT({ masses, slew: 0, boomT: 5, boomCogRadius: 6, loadT: 8, tipRadius: 12, a: 3, b: 3 });
    expect(f.reduce((x, y) => x + y, 0)).toBeCloseTo(53, 6);
    expect(f[0]).toBeGreaterThan(f[2]);
    // giek naar links (−z): linkerstempels zwaarder
    const g = padLoadsT({ masses, slew: -Math.PI / 2, boomT: 5, boomCogRadius: 6, loadT: 8, tipRadius: 12, a: 3, b: 3 });
    expect(g[0]).toBeGreaterThan(g[1]);
  });

  it('matten verlagen de druk; slappe grond laat minder toe', () => {
    expect(bearingArea(60, 'large')).toBeGreaterThan(bearingArea(60, 'timber'));
    expect(bearingArea(60, 'timber')).toBeGreaterThan(bearingArea(60, 'none'));
    expect(allowedPressure('mud', 1)).toBeLessThan(allowedPressure('asphalt', 1));
  });

  it('zonder matten op zachte grond zakt een stempel weg; op Normaal stopt dat de hijs', () => {
    const base = getMission('m01')!;
    const m = { ...base, mats: 'none' as const, ground: [{ x0: -100, x1: 100, type: 'sand' as const, quality: 0.5 }] };
    const sim = new Simulation({ mission: m, difficulty: DIFFICULTIES.normal });
    for (let i = 0; i < 120 * 60 && sim.outcome === 'running'; i++) sim.step(emptyInput());
    expect(Math.max(...sim.padSink)).toBeGreaterThan(0.29);
    expect(sim.failReason).toContain('kraanmatten');
    const ok = new Simulation({ mission: { ...m, mats: 'large' as const }, difficulty: DIFFICULTIES.normal });
    for (let i = 0; i < 120 * 30; i++) ok.step(emptyInput());
    expect(Math.max(...ok.padSink)).toBe(0);
  });

  it('matten wisselen kan alleen met de vijzels omhoog', () => {
    const sim = new Simulation({ mission: getMission('m01')! });
    expect(sim.cycleMats()).toContain('vijzels');
    sim.crane.outriggerJack = sim.crane.outriggerJack.map(() => 0);
    expect(sim.cycleMats()).toContain('grote kraanmatten');
    expect(sim.mats).toBe('large');
  });
});
