import { describe, expect, it } from 'vitest';
import { LessonRunner } from '../../src/sim/lesson';
import { Simulation } from '../../src/sim/simulation';
import { getMission } from '../../src/missions/data/index';
import { emptyInput } from '../../src/cranes/controllers/craneInput';
import { DIFFICULTIES } from '../../src/sim/difficulty';

describe('geregisseerde eerste hijs', () => {
  it('missie 1 heeft de les; stappen volgen de handelingen van de speler', () => {
    const m = getMission('m01')!;
    expect(m.lesson).toBe('firstLift');
    const sim = new Simulation({ mission: m });
    const ls = new LessonRunner('firstLift', (a) => `[${a}]`);
    const texts: string[] = [];
    const run = (input: Partial<ReturnType<typeof emptyInput>>, until: () => boolean, max = 6000) => {
      for (let i = 0; i < max && !until(); i++) {
        sim.step({ ...emptyInput(), ...input });
        const t = ls.update(sim, 1 / 60);
        if (t) texts.push(t);
      }
    };
    run({}, () => ls.stepId === 'lower');
    // zonder handmatige LMI wordt die stap overgeslagen
    expect(texts.some((t) => t.includes('[lmi]'))).toBe(false);
    expect(ls.marker(sim)?.kind).toBe('arrow');
    run({ hoist: -1 }, () => ls.stepId === 'rig');
    expect(texts.at(-1)).toContain('[rigging]');
    sim.toggleRigging();
    run({}, () => ls.stepId === 'hoist');
    run({ hoist: 1 }, () => ls.stepId === 'tele');
    expect(ls.marker(sim)?.kind).toBe('ring');
  });

  it('met handmatige begrenzer eerst de LMI-stap', () => {
    const sim = new Simulation({ mission: getMission('m01')!, difficulty: DIFFICULTIES.normal, manualLmi: true });
    const ls = new LessonRunner('firstLift', (a) => `[${a}]`);
    let last = '';
    for (let i = 0; i < 600; i++) {
      sim.step(emptyInput());
      last = ls.update(sim, 1 / 60) ?? last;
    }
    expect(ls.stepId).toBe('lmi');
    expect(last).toContain('[lmi]');
  });
});
