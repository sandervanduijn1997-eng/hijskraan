import { describe, expect, it } from 'vitest';
import { getMission } from '../../src/missions/data/index';
import { Simulation } from '../../src/sim/simulation';
import { DIFFICULTIES } from '../../src/sim/difficulty';
import { emptyInput } from '../../src/cranes/controllers/craneInput';
import { apexWorld } from '../../src/physics/load/rigidBody';
import { pendulumPeriod } from '../../src/physics/cable/rope';
import { GRAVITY } from '../../src/physics/constants';
import { hoistTo, run, steerTip } from '../helpers/autopilot';

function liftPallet(): Simulation {
  const sim = new Simulation({ mission: getMission('m01')!, difficulty: DIFFICULTIES.normal });
  const load = sim.loads[0];
  const sp = sim.slingPoint(load);
  run(sim, 60, () => {
    const i = steerTip(sim, sp.x, sim.geom.tipHeight);
    hoistTo(sim, i, Math.abs(sim.geom.tip.x - sp.x) < 0.3 ? sp.y + 0.2 : sim.hookPoint().y);
    return i;
  }, () => sim.attachCandidate() === load && Math.abs(sim.geom.tip.x - sp.x) < 0.25);
  sim.toggleRigging();
  run(sim, 20, () => { const i = emptyInput(); hoistTo(sim, i, 6); return i; }, () => sim.hookPoint().y > 5.8);
  run(sim, 4, () => emptyInput());
  return sim;
}

describe('slingergedrag van de last aan de kraan', () => {
  it('periode volgt de kabellengte plus het ophangpunt tot het zwaartepunt', () => {
    const sim = liftPallet();
    const b = sim.loads[0].cb.body;
    run(sim, 2, () => { const i = emptyInput(); i.tele = 1; return i; });
    const crossings: number[] = [];
    let prev = apexWorld(b).x - sim.geom.tip.x;
    for (let k = 0; k < 60 * 25; k++) {
      sim.step(emptyInput());
      const rel = apexWorld(b).x - sim.geom.tip.x;
      if (Math.sign(rel) !== Math.sign(prev) && prev !== 0) crossings.push(sim.time);
      prev = rel;
    }
    const period = ((crossings[crossings.length - 1] - crossings[1]) / (crossings.length - 2)) * 2;
    const leff = sim.rope.length + b.apex.y;
    expect(period).toBeGreaterThan(pendulumPeriod(leff, GRAVITY) * 0.9);
    expect(period).toBeLessThan(pendulumPeriod(leff, GRAVITY) * 1.15);
  });

  it('de last loopt achter bij versnellen en schiet door bij stoppen', () => {
    const sim = liftPallet();
    const b = sim.loads[0].cb.body;
    run(sim, 1.5, () => { const i = emptyInput(); i.tele = 1; return i; });
    expect(apexWorld(b).x - sim.geom.tip.x).toBeLessThan(-0.05);
    let maxAhead = 0;
    run(sim, 4, () => {
      maxAhead = Math.max(maxAhead, apexWorld(b).x - sim.geom.tip.x);
      return emptyInput();
    });
    expect(maxAhead).toBeGreaterThan(0.05);
  });

  it('zwenken op volle snelheid en loslaten geeft een realistische, geen extreme slinger', () => {
    const sim = liftPallet();
    let max = 0;
    run(sim, 14, (t) => {
      max = Math.max(max, sim.swayDeg);
      const i = emptyInput();
      if (t < 6) i.slew = 1;
      return i;
    });
    expect(max).toBeGreaterThan(0.5);
    expect(max).toBeLessThan(8);
  });

  it('torenkraan: giekpunt beweegt niet sneller dan een echte torenkraan', () => {
    const sim = new Simulation({ mission: getMission('m12')! });
    run(sim, 20, () => { const i = emptyInput(); i.slew = 1; i.trolley = 1; return i; });
    const tipSpeed = Math.abs(sim.crane.vel.slew) * sim.geom.radius;
    expect(tipSpeed).toBeLessThan(6);
  });
});
