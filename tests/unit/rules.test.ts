import { describe, expect, it } from 'vitest';
import { pointPenetration, rectQuad, segmentIntersectsRect } from '../../src/physics/collision/geometry';
import { createBoxBody } from '../../src/physics/load/rigidBody';
import { checkPlacement } from '../../src/missions/validation/placement';
import { computeScore, emptyMetrics } from '../../src/missions/runtime/scoring';
import { DEG } from '../../src/utils/math';

describe('botsingsdetectie', () => {
  const q = rectQuad({ minX: 0, minY: 0, maxX: 2, maxY: 0.2 });
  it('kiest de rand waardoor een punt binnenkwam (geen doorschieten door dunne objecten)', () => {
    // punt komt van boven en zit al bijna onderin een dunne plaat
    const p = pointPenetration(q, { x: 1, y: 0.02 }, { x: 1, y: 0.3 });
    expect(p).not.toBeNull();
    expect(p!.ny).toBeCloseTo(1);
    expect(p!.depth).toBeCloseTo(0.18);
  });
  it('geen penetratie buiten de vorm', () => {
    expect(pointPenetration(q, { x: 3, y: 0.1 }, null)).toBeNull();
  });
  it('lijnstuk tegen rechthoek', () => {
    const r = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    expect(segmentIntersectsRect(-1, 0.5, 2, 0.5, r)).toBe(true);
    expect(segmentIntersectsRect(-1, 2, 2, 2, r)).toBe(false);
    expect(segmentIntersectsRect(0.5, 5, 0.5, 1.01, r, 0.02)).toBe(true);
  });
});

describe('doelzonevalidatie', () => {
  const zone = { id: 'z', label: 'z', x: 10, y: 0, tolerance: 0.3 };
  const body = (x: number, y: number, angle = 0) => {
    const b = createBoxBody({ mass: 1000, width: 2, height: 1, depth: 1, x, y, angle, apexHeight: 1 });
    return b;
  };
  it('geldig: binnen tolerantie, op het vlak, recht, ondersteund en stil', () => {
    const r = checkPlacement(body(10.1, 0), zone, true);
    expect(r.valid).toBe(true);
    expect(r.error).toBeCloseTo(0.1 / 0.3, 2);
  });
  it('alleen aanraken telt niet: hangend boven de zone of buiten de tolerantie', () => {
    expect(checkPlacement(body(10, 0.5), zone, false).valid).toBe(false);
    expect(checkPlacement(body(10.5, 0), zone, true).reasons).toContain('buiten de zone');
  });
  it('onder het doelvlak (door de grond of een gebouw) is ongeldig', () => {
    const r = checkPlacement(body(10, -0.5), zone, true);
    expect(r.valid).toBe(false);
    expect(r.reasons[0]).toMatch(/te laag/);
  });
  it('scheef geplaatst en in beweging is ongeldig', () => {
    expect(checkPlacement(body(10, 0, 10 * DEG), zone, true).reasons).toContain('scheef geplaatst');
    const b = body(10, 0);
    b.vel.x = 0.3;
    expect(checkPlacement(b, zone, true).reasons).toContain('nog in beweging');
  });
});

describe('scoreberekening', () => {
  const good = () => ({ ...emptyMetrics(100, 1), time: 90, maxLoadPct: 70, placementErrors: [0.1], maxSwayDeg: 1.5, peakLiftPct: 75, fuelUsed: 0.8 });
  it('veilige, precieze uitvoering met weinig slinger = 3 sterren', () => {
    expect(computeScore(good(), true).stars).toBe(3);
  });
  it('een botsing kost de derde ster', () => {
    expect(computeScore({ ...good(), collisions: 1 }, true).stars).toBeLessThan(3);
  });
  it('mislukt = 0 sterren', () => {
    expect(computeScore(good(), false).stars).toBe(0);
  });
  it('snelheid levert geen punten op bij onveilig werken', () => {
    const fastUnsafe = computeScore({ ...good(), time: 30, overloadTime: 5, safetyViolations: 1 }, true);
    const fastSafe = computeScore({ ...good(), time: 30 }, true);
    expect(fastUnsafe.time).toBeLessThan(fastSafe.time * 0.2);
    expect(fastUnsafe.stars).toBeLessThanOrEqual(1);
  });
  it('overgedimensioneerde configuratie scoort lager op configuratiekeuze', () => {
    expect(computeScore({ ...good(), peakLiftPct: 20 }, true).config).toBeLessThan(computeScore(good(), true).config);
  });
});
