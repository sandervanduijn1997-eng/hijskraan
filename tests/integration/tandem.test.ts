import { describe, expect, it } from 'vitest';
import { getMission, MISSIONS } from '../../src/missions/data/index';
import { Simulation } from '../../src/sim/simulation';
import { emptyInput } from '../../src/cranes/controllers/craneInput';
import { bodyTilt } from '../../src/physics/load/rigidBody';
import { validateMission } from '../../src/missions/validation/validateMission';
import { hoistTo, run, steerTip } from '../helpers/autopilot';

function attachTandem(id: string) {
  const sim = new Simulation({ mission: getMission(id)! });
  const load = sim.loads[0];
  const sp = sim.slingPoint(load);
  run(sim, 90, () => {
    const i = steerTip(sim, sp.x, sim.geom.tipHeight, 0.45, sp.z);
    hoistTo(sim, i, Math.hypot(sim.geom.tip.x - sp.x, sim.geom.tip.z - sp.z) < 0.3 ? sp.y + 0.2 : sim.hookPoint().y);
    return i;
  }, () => sim.attachCandidate() === load);
  expect(sim.toggleRigging()).toContain('aangeslagen');
  return { sim, load };
}

describe('tandemhijs', () => {
  it('vijf tandemmissies (hoofdstuk 9, nachtligger, kolom) die valideren', () => {
    const t = MISSIONS.filter((m) => m.tandem);
    expect(t.length).toBe(5);
    for (const m of t) expect(validateMission(m).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('rustig hijsen: de collega volgt, de last blijft waterpas en de belasting is verdeeld', () => {
    const { sim, load } = attachTandem('m41');
    expect(sim.partner?.attached).toBe(true);
    // langzaam hijsen (de collega kan 0,25 m/s)
    run(sim, 25, () => ({ ...emptyInput(), hoist: 0.3, precision: true }));
    expect(load.cb.supports.size).toBe(0);
    const roll = Math.abs(bodyTilt(load.cb.body).roll) * (180 / Math.PI);
    expect(roll).toBeLessThan(4);
    const mine = sim.tensionF / 9.81 / 1000;
    const his = sim.partner!.tensionT;
    expect(mine).toBeGreaterThan(3);
    expect(his).toBeGreaterThan(3);
    expect(Math.abs(mine - his) / (mine + his)).toBeLessThan(0.3);
  });

  it('te snel hijsen: de last gaat scheef en de belasting verschuift', () => {
    const { sim, load } = attachTandem('m41');
    let maxRoll = 0;
    run(sim, 8, () => {
      maxRoll = Math.max(maxRoll, Math.abs(bodyTilt(load.cb.body).roll));
      return { ...emptyInput(), hoist: 1 };
    });
    expect(maxRoll * (180 / Math.PI)).toBeGreaterThan(3);
  });
});
