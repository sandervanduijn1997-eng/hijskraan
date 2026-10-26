import { describe, expect, it } from 'vitest';
import { getCrane } from '../../src/cranes/config/cranes';
import { resolveCrane } from '../../src/cranes/models/craneSpec';
import { createCraneState } from '../../src/cranes/models/craneState';
import { actualCapacityT, autoLmi, lmiCapacityT, lmiMismatch, maxParts, reevingCapacityT } from '../../src/cranes/models/lmi';
import { Simulation } from '../../src/sim/simulation';
import { getMission } from '../../src/missions/data/index';
import { DIFFICULTIES } from '../../src/sim/difficulty';
import { emptyInput } from '../../src/cranes/controllers/craneInput';

const spec = resolveCrane(getCrane('at60'), []);

describe('lastmomentbegrenzer instellen', () => {
  it('niet ingesteld: de begrenzer laat niets toe', () => {
    const s = createCraneState(spec, { x: 0, outriggersDeployed: true, boomAngleDeg: 50, boomLength: 20 });
    const cfg = { ...autoLmi(spec, s, maxParts(spec)), configured: false };
    expect(lmiCapacityT(spec, s, cfg)).toBe(0);
  });

  it('correct ingesteld: gelijk aan de werkelijke capaciteit', () => {
    const s = createCraneState(spec, { x: 0, outriggersDeployed: true, boomAngleDeg: 50, boomLength: 20 });
    const cfg = autoLmi(spec, s, maxParts(spec));
    expect(lmiCapacityT(spec, s, cfg)).toBeCloseTo(actualCapacityT(spec, s, maxParts(spec)), 6);
    expect(lmiMismatch(spec, s, cfg, maxParts(spec))).toEqual([]);
  });

  it('stempels 100 % ingevoerd terwijl ze half uitstaan: de begrenzer laat te veel toe', () => {
    // over de zijkant (90°) bepaalt de stempelbreedte het kantelmoment
    const s = createCraneState(spec, { x: 0, outriggersDeployed: true, boomAngleDeg: 35, boomLength: 25, slewDeg: 90 });
    s.outriggerBeam = s.outriggerBeam.map(() => 0.5);
    const cfg = autoLmi(spec, s, maxParts(spec), 'outriggers');
    expect(lmiCapacityT(spec, s, cfg)).toBeGreaterThan(actualCapacityT(spec, s, maxParts(spec)) * 1.1);
    expect(lmiMismatch(spec, s, cfg, maxParts(spec))[0]).toContain('opstelling');
  });

  it('minder kabelparten: minder capaciteit (trekkracht per part)', () => {
    expect(reevingCapacityT(spec, 2)).toBeLessThan(reevingCapacityT(spec, 4));
    const s = createCraneState(spec, { x: 0, outriggersDeployed: true, boomAngleDeg: 70, boomLength: 11 });
    const four = lmiCapacityT(spec, s, autoLmi(spec, s, 4));
    const one = lmiCapacityT(spec, s, autoLmi(spec, s, 1));
    expect(one).toBeLessThan(four);
  });

  it('in de simulatie: zonder instelling waarschuwing en geen hijs; na instellen wel', () => {
    const sim = new Simulation({ mission: getMission('m01')!, difficulty: DIFFICULTIES.normal, manualLmi: true });
    sim.step(emptyInput());
    expect(sim.capacityT).toBe(0);
    expect(sim.warnings.top(5).some((w) => w.id === 'lmiSetup')).toBe(true);
    sim.configureLmi({ setup: 'outriggers', counterweightIndex: sim.crane.counterweightIndex, parts: sim.parts, jibIndex: sim.crane.jibIndex });
    sim.step(emptyInput());
    expect(sim.capacityT).toBeGreaterThan(0);
  });
});
