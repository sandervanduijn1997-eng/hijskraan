import { describe, expect, it } from 'vitest';
import { CHART_TIPPING_FRACTION, computeStability, tippingDistance, tippingLoadT } from '../../src/physics/stability/stability';
import { chartCapacity, loadPercent } from '../../src/physics/stability/loadChart';
import { GRAVITY } from '../../src/physics/constants';
import { updateTilt } from '../../src/cranes/controllers/craneController';
import { createCraneState } from '../../src/cranes/models/craneState';
import { resolveCrane } from '../../src/cranes/models/craneSpec';
import { getCrane } from '../../src/cranes/config/cranes';

const masses = { carrierT: 30, superT: 10, superBehind: 1, counterweightT: 10, cwRadius: 4 };
const fp = { a: 3.5, b: 3 };

describe('stabiliteitsmodel', () => {
  it('kantellijn hangt af van de draaihoek', () => {
    expect(tippingDistance(fp, 0)).toBeCloseTo(3.5);
    expect(tippingDistance(fp, Math.PI / 2)).toBeCloseTo(3);
    expect(tippingDistance(fp, Math.PI / 4)).toBeCloseTo(Math.min(3.5 / Math.SQRT1_2, 3 / Math.SQRT1_2));
  });

  it('bij de kantellast is de kantelfactor precies 1', () => {
    const R = 12;
    const tip = tippingLoadT(masses, fp, 0, R, 5, 6);
    const res = computeStability({ masses, footprint: fp, slew: 0, tipRadius: R, tipHeight: 15, boomT: 5, boomCogRadius: 6, ropeTension: tip * 1000 * GRAVITY, ropeOutwardAngle: 0, groundFactor: 1, slope: 0, windMoment: 0 });
    expect(res.tippingRatio).toBeCloseTo(1, 6);
  });

  it('lastdiagram ligt op 75 % van de kantellast', () => {
    expect(CHART_TIPPING_FRACTION).toBe(0.75);
  });

  it('naar buiten slingerende last, zachte ondergrond en helling verhogen het kantelrisico', () => {
    const base = { masses, footprint: fp, slew: 0, tipRadius: 12, tipHeight: 15, boomT: 5, boomCogRadius: 6, ropeTension: 4e4, ropeOutwardAngle: 0, groundFactor: 1, slope: 0, windMoment: 0 };
    const k0 = computeStability(base).tippingRatio;
    expect(computeStability({ ...base, ropeOutwardAngle: 0.1 }).tippingRatio).toBeGreaterThan(k0);
    expect(computeStability({ ...base, groundFactor: 0.5 }).tippingRatio).toBeGreaterThan(k0);
    expect(computeStability({ ...base, slope: 0.06 }).tippingRatio).toBeGreaterThan(k0);
  });

  it('kantelen volgt uit het model: onder de grens geen kanteling, erboven onomkeerbaar', () => {
    const spec = resolveCrane(getCrane('at60'));
    const s = createCraneState(spec, { x: 0 });
    for (let i = 0; i < 600; i++) updateTilt(s, 0.95, 1 / 60, true);
    expect(s.tilt).toBe(0);
    for (let i = 0; i < 600 && !s.tipped; i++) updateTilt(s, 1.3, 1 / 60, true);
    expect(s.tipped).toBe(true);
    const s2 = createCraneState(spec, { x: 0 });
    for (let i = 0; i < 600; i++) updateTilt(s2, 1.5, 1 / 60, false);
    expect(s2.tipped).toBe(false);
  });
});

describe('lastdiagram en belastingpercentage', () => {
  const chart = { boomLengths: [10, 20], radii: [3, 6, 9, 12], capacity: [[20, 12, 8, null], [15, 10, 7, 5]] };
  it('interpoleert tussen stralen', () => {
    expect(chartCapacity(chart, 10, 4.5)).toBeCloseTo(16);
    expect(chartCapacity(chart, 20, 10.5)).toBeCloseTo(6);
  });
  it('conservatief tussen gieklengtes en 0 buiten bereik', () => {
    expect(chartCapacity(chart, 15, 6)).toBeCloseTo(10);
    expect(chartCapacity(chart, 10, 12)).toBe(0);
    expect(chartCapacity(chart, 20, 14)).toBe(0);
  });
  it('belastingpercentage', () => {
    expect(loadPercent(5, 10)).toBe(50);
    expect(loadPercent(11, 10)).toBeCloseTo(110);
    expect(loadPercent(1, 0)).toBe(999);
  });
});
