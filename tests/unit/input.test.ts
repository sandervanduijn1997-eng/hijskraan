import { describe, expect, it } from 'vitest';
import { KEY_MIN, applyDeadzone, defaultAnalog, keyRampLevel, shape, stickToCommand } from '../../src/game/input/analog';

describe('analoge bediening', () => {
  it('dode zone: kleine uitslagen doen niets, daarbuiten begint de uitslag weer bij 0', () => {
    expect(applyDeadzone(0.1, 0.12)).toBe(0);
    expect(applyDeadzone(-0.12, 0.12)).toBe(0);
    expect(applyDeadzone(0.13, 0.12)).toBeGreaterThan(0);
    expect(applyDeadzone(0.13, 0.12)).toBeLessThan(0.02);
    expect(applyDeadzone(1, 0.12)).toBeCloseTo(1, 6);
    expect(applyDeadzone(-1, 0.12)).toBeCloseTo(-1, 6);
  });

  it('responscurve: fijn rond het midden, vol aan het eind, teken blijft', () => {
    expect(shape(0.5, 2)).toBeCloseTo(0.25, 6);
    expect(shape(-0.5, 2)).toBeCloseTo(-0.25, 6);
    expect(shape(1, 3)).toBe(1);
    expect(shape(0.5, 1)).toBe(0.5);
  });

  it('stick naar commando: een kwart uitslag geeft een kruipsnelheid', () => {
    const s = defaultAnalog();
    const v = stickToCommand(0.25, s);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(0.05);
    expect(stickToCommand(1, s)).toBeCloseTo(1, 6);
  });

  it('oplopende toets: kort tikken geeft de minimale snelheid, na de ingestelde tijd vol', () => {
    expect(keyRampLevel(0, 1)).toBeCloseTo(KEY_MIN, 6);
    expect(keyRampLevel(0.5, 1)).toBeGreaterThan(KEY_MIN);
    expect(keyRampLevel(0.5, 1)).toBeLessThan(1);
    expect(keyRampLevel(1, 1)).toBeCloseTo(1, 6);
    expect(keyRampLevel(3, 1)).toBeCloseTo(1, 6);
    // 0 s = direct vol (oude gedrag)
    expect(keyRampLevel(0, 0)).toBe(1);
    // monotoon oplopend
    let prev = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      const v = keyRampLevel(t, 1);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
