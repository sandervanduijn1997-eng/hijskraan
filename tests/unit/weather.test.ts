import { describe, expect, it } from 'vitest';
import { getLoad } from '../../src/missions/data/loads';
import { rainGroundFactor, visibility, windLimitFor } from '../../src/sim/weather';
import { Simulation } from '../../src/sim/simulation';
import { getMission, MISSIONS } from '../../src/missions/data/index';
import { emptyInput } from '../../src/cranes/controllers/craneInput';

describe('weer en nacht', () => {
  it('windstop: lasten met veel windvang mogen bij minder wind gehesen worden', () => {
    expect(windLimitFor(getLoad('facadePanel'), 'tower')).toBeLessThan(windLimitFor(getLoad('concreteBlock'), 'tower'));
    expect(windLimitFor(getLoad('concreteBlock'), 'telescopic')).toBe(14);
    expect(windLimitFor(getLoad('concreteBlock'), 'tower')).toBe(20);
  });

  it('regen maakt onverharde grond slapper, beton niet; mist en nacht beperken het zicht', () => {
    expect(rainGroundFactor('rain', 'sand')).toBeLessThan(1);
    expect(rainGroundFactor('rain', 'concrete')).toBe(1);
    expect(visibility('fog', 'day')).toBeLessThan(visibility('rain', 'day'));
    expect(visibility('clear', 'night')).toBeLessThan(Infinity);
  });

  it('er zijn missies met regen, mist en nacht', () => {
    expect(MISSIONS.some((m) => m.weather === 'rain')).toBe(true);
    expect(MISSIONS.some((m) => m.weather === 'fog')).toBe(true);
    expect(MISSIONS.some((m) => m.timeOfDay === 'night')).toBe(true);
  });

  it('boven de windlimiet: windstop-waarschuwing', () => {
    const m = getMission('m01')!;
    const sim = new Simulation({ mission: { ...m, wind: { base: 18, gust: 0, direction: 1 } } });
    for (let i = 0; i < 30; i++) sim.step(emptyInput());
    expect(sim.windStop).toBe(true);
    expect(sim.warnings.top(5).some((w) => w.id === 'windStop')).toBe(true);
  });
});
