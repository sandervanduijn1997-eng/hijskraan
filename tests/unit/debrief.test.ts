import { describe, expect, it } from 'vitest';
import { concreteTip, keyMoment } from '../../src/sim/debrief';
import type { Recording } from '../../src/sim/recorder';
import { emptyMetrics } from '../../src/missions/runtime/scoring';
import type { ScoreBreakdown } from '../../src/missions/runtime/scoring';

const rec = (markers: Recording['markers']): Recording => ({ inputs: [], actions: [], samples: [], markers, steps: 6000 });

describe('nabespreking', () => {
  it('bij een mislukking: het moment vlak voor het einde dat de oorzaak was', () => {
    const r = rec([
      { t: 10, step: 600, kind: 'warning', text: 'vroeg', bad: true },
      { t: 70, step: 4200, kind: 'impact', text: 'Botsing (1.2 m/s)', bad: true },
      { t: 75, step: 4500, kind: 'fail', text: 'Te veel schade', bad: true },
    ]);
    expect(keyMoment(r, true)?.text).toContain('Botsing');
  });

  it('één concrete tip op het onderdeel met het meeste puntenverlies', () => {
    const m = { ...emptyMetrics(100, 1), maxSwayDeg: 14 };
    const score = { safety: 100, precision: 95, time: 90, sway: 10, collisions: 100, damage: 100, config: 90, efficiency: 90, total: 80, stars: 2 } as ScoreBreakdown;
    expect(concreteTip(score, m, '')).toContain('slingerde');
    expect(concreteTip(null, m, 'De kraan is gekanteld.')).toContain('kantelde');
    expect(concreteTip(null, m, 'Een strop brak: 3 t')).toContain('strop');
  });
});
