import { describe, expect, it } from 'vitest';
import { ENGINE, flowScale, hydraulicDemand, pumpFlow, stepRpm, targetRpm } from '../../src/cranes/models/powertrain';
import { Simulation } from '../../src/sim/simulation';
import { getMission } from '../../src/missions/data/index';
import { DIFFICULTIES } from '../../src/sim/difficulty';
import { emptyInput } from '../../src/cranes/controllers/craneInput';

describe('hydrauliek en motor', () => {
  it('de pomp levert meer olie bij een hoger toerental', () => {
    expect(pumpFlow(ENGINE.idle)).toBeLessThan(pumpFlow(1400));
    expect(pumpFlow(ENGINE.max)).toBeCloseTo(ENGINE.pumpCapacity, 6);
  });

  it('meerdere bewegingen tegelijk delen de oliestroom', () => {
    const alone = flowScale(hydraulicDemand({ hoist: 1 }), ENGINE.max);
    const all = flowScale(hydraulicDemand({ hoist: 1, luff: 1, slew: 1, tele: 1 }), ENGINE.max);
    expect(alone).toBe(1);
    expect(all).toBeLessThan(0.6);
  });

  it('het toerental loopt traag op en zakt in onder zware hijslast', () => {
    let rpm: number = ENGINE.idle;
    for (let i = 0; i < 6; i++) rpm = stepRpm(rpm, targetRpm(1, 0, false), 1 / 60);
    expect(rpm).toBeLessThan(ENGINE.idle + 200);
    expect(targetRpm(1, 100, true)).toBeLessThan(targetRpm(1, 0, true));
    expect(targetRpm(0, 0, false, true)).toBe(ENGINE.work);
  });

  it('in de simulatie: hijsen gaat trager als je tegelijk zwenkt, de giek bedient en uitschuift', () => {
    const speed = (all: boolean) => {
      const sim = new Simulation({ mission: getMission('m01')!, difficulty: DIFFICULTIES.practice });
      let v = 0;
      for (let k = 0; k < 60 * 4; k++) {
        const i = emptyInput();
        i.hoist = -1;
        if (all) {
          i.slew = 1;
          i.luff = 1;
          i.tele = 1;
        }
        sim.step(i);
        v = Math.abs(sim.crane.vel.hoist);
      }
      return { v, rpm: sim.crane.rpm, p: sim.crane.hydPressure };
    };
    const a = speed(false);
    const b = speed(true);
    expect(b.v).toBeLessThan(a.v * 0.75);
    expect(b.rpm).toBeGreaterThan(ENGINE.idle + 500);
    expect(b.p).toBeGreaterThan(a.p);
  });

  it('een torenkraan is elektrisch: geen toerental, geen gedeelde olie', () => {
    const m = getMission('m11')!;
    const sim = new Simulation({ mission: m });
    sim.step(emptyInput());
    expect(sim.crane.rpm).toBe(0);
  });
});
