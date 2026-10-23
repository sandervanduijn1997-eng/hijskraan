import { describe, expect, it } from 'vitest';
import { CRANES, CRANE_IDS, getCrane } from '../../src/cranes/config/cranes';
import { resolveCrane } from '../../src/cranes/models/craneSpec';
import { createCraneState } from '../../src/cranes/models/craneState';
import { computeGeometry, solveBoomIK } from '../../src/cranes/models/kinematics';
import { allowedCapacityT, generateLoadChart, supportState } from '../../src/cranes/models/capacity';
import { updateCrane } from '../../src/cranes/controllers/craneController';
import { emptyInput } from '../../src/cranes/controllers/craneInput';
import { DEG } from '../../src/utils/math';

const ctx = (over: Partial<Parameters<typeof updateCrane>[3]> = {}) => ({
  dt: 1 / 60,
  colliders: [],
  ground: [],
  loadPercent: 0,
  loadAttached: false,
  hookPos: { x: 0, y: 0, z: 0 },
  ropeStretch: 0,
  worldMinX: -200,
  worldMaxX: 200,
  condition: 1,
  ...over,
});

describe('kraanconfiguraties', () => {
  it('tien verschillende kraanklassen met volledige configuratie', () => {
    expect(CRANE_IDS.length).toBe(10);
    expect(new Set(CRANE_IDS.map((c) => CRANES[c].craneClass)).size).toBe(10);
    for (const id of CRANE_IDS) {
      const c = CRANES[id];
      expect(c.name).toBeTruthy();
      expect(c.gameBalance.maxCapacityT).toBeGreaterThan(0);
      expect(c.gameBalance.hoistSpeed).toBeGreaterThan(0);
      expect(c.gameBalance.slewSpeedDeg).toBeGreaterThan(0);
      expect(c.economy.buyPrice).toBeGreaterThan(0);
      expect(c.upgrades.length).toBeGreaterThan(3);
      expect(c.reference.note).toMatch(/gameBalance/);
      expect(c.suitableMissions.length).toBeGreaterThan(0);
    }
  });

  it('upgrades verschillen per kraan', () => {
    const sets = new Set(CRANE_IDS.map((c) => CRANES[c].upgrades.join(',')));
    expect(sets.size).toBeGreaterThan(6);
  });
});

describe('giekgeometrie en haakpositie', () => {
  it('telescoopgiek: tip = draaipunt + L·(cos θ, sin θ)', () => {
    const spec = resolveCrane(getCrane('at60'));
    const s = createCraneState(spec, { x: 0, boomAngleDeg: 40, boomLength: 20 });
    const g = computeGeometry(spec, s);
    const gb = spec.gb;
    expect(g.tipU).toBeCloseTo(gb.pivotU + 20 * Math.cos(40 * DEG), 6);
    expect(g.tipHeight).toBeCloseTo(gb.pivotHeight + 20 * Math.sin(40 * DEG), 6);
    expect(g.tip.x).toBeCloseTo(gb.slewOffsetX + g.tipU, 6);
    expect(g.radius).toBeCloseTo(Math.abs(g.tipU), 6);
  });

  it('draaien projecteert de tip in de diepte (z)', () => {
    const spec = resolveCrane(getCrane('at60'));
    const s = createCraneState(spec, { x: 0, boomAngleDeg: 40, boomLength: 20, slewDeg: 90 });
    const g = computeGeometry(spec, s);
    expect(g.tip.x).toBeCloseTo(g.slewX, 4);
    expect(g.tip.z).toBeCloseTo(g.tipU, 4);
  });

  it('torenkraan: haak hangt onder de loopkat op torenhoogte', () => {
    const spec = resolveCrane(getCrane('tc160'));
    const s = createCraneState(spec, { x: 5, trolley: 30 });
    const g = computeGeometry(spec, s);
    expect(g.tip.x).toBeCloseTo(35, 4);
    expect(g.tipHeight).toBeCloseTo(spec.cfg.visual.carrierHeight + (spec.gb.towerHeight ?? 0) - 0.9, 4);
  });

  it('knikarm: eindpositie uit hoek en lengte van elk segment', () => {
    const spec = resolveCrane(getCrane('kb22'));
    const s = createCraneState(spec, { x: 0, boomAngleDeg: 60, knuckleDeg: -90, knuckleTele: 2 });
    const g = computeGeometry(spec, s);
    const gb = spec.gb;
    const a1 = 60 * DEG;
    const a2 = a1 - 90 * DEG;
    const u = gb.arm1Length! * Math.cos(a1) + (gb.arm2Length! + 2) * Math.cos(a2);
    const y = gb.columnHeight! + gb.arm1Length! * Math.sin(a1) + (gb.arm2Length! + 2) * Math.sin(a2);
    expect(g.tipU).toBeCloseTo(u, 6);
    expect(g.tipHeight).toBeCloseTo(y, 6);
  });

  it('inverse kinematica levert de gevraagde tippositie', () => {
    const spec = resolveCrane(getCrane('at500'));
    const ik = solveBoomIK(spec, 25, 30);
    const s = createCraneState(spec, { x: 0, boomLength: ik.length, boomAngleDeg: ik.angle / DEG });
    const g = computeGeometry(spec, s);
    expect(g.tipU).toBeCloseTo(25, 3);
    expect(g.tipHeight).toBeCloseTo(30, 3);
  });
});

describe('besturing', () => {
  it('kabellengte: hijsen verkort, vieren verlengt, binnen de eindstanden', () => {
    const spec = resolveCrane(getCrane('at60'));
    const s = createCraneState(spec, { x: 0, ropeLength: 10, outriggersDeployed: true });
    const auto = { outriggerAuto: 'none' as const };
    for (let i = 0; i < 120; i++) updateCrane(spec, s, { ...emptyInput(), hoist: 1 }, ctx(), auto);
    expect(s.ropeLength).toBeLessThan(10);
    for (let i = 0; i < 60 * 60; i++) updateCrane(spec, s, { ...emptyInput(), hoist: 1 }, ctx(), auto);
    expect(s.ropeLength).toBeCloseTo(spec.gb.ropeMin, 6);
    for (let i = 0; i < 60; i++) updateCrane(spec, s, { ...emptyInput(), hoist: -1 }, ctx(), auto);
    expect(s.ropeLength).toBeGreaterThan(spec.gb.ropeMin);
  });

  it('hydraulische aanloop: snelheid bouwt geleidelijk op', () => {
    const spec = resolveCrane(getCrane('at60'));
    const s = createCraneState(spec, { x: 0, outriggersDeployed: true });
    const auto = { outriggerAuto: 'none' as const };
    updateCrane(spec, s, { ...emptyInput(), slew: 1 }, ctx(), auto);
    expect(Math.abs(s.vel.slew)).toBeLessThan(spec.gb.slewSpeedDeg * DEG * 0.1);
    for (let i = 0; i < 90; i++) updateCrane(spec, s, { ...emptyInput(), slew: 1 }, ctx(), auto);
    expect(s.vel.slew).toBeCloseTo(spec.gb.slewSpeedDeg * DEG, 4);
  });

  it('precisiemodus verlaagt de snelheid', () => {
    const spec = resolveCrane(getCrane('at60'));
    const s = createCraneState(spec, { x: 0, outriggersDeployed: true });
    const auto = { outriggerAuto: 'none' as const };
    for (let i = 0; i < 120; i++) updateCrane(spec, s, { ...emptyInput(), slew: 1, precision: true }, ctx(), auto);
    expect(s.vel.slew).toBeCloseTo(spec.gb.slewSpeedDeg * DEG * 0.25, 4);
  });

  it('LMI blokkeert hijsen en straal vergroten boven 100 %', () => {
    const spec = resolveCrane(getCrane('at60'));
    const s = createCraneState(spec, { x: 0, ropeLength: 10, boomAngleDeg: 45, outriggersDeployed: true });
    const auto = { outriggerAuto: 'none' as const };
    const before = { rope: s.ropeLength, angle: s.boomAngle };
    let r = updateCrane(spec, s, { ...emptyInput(), hoist: 1 }, ctx({ loadPercent: 105, loadAttached: true }), auto);
    expect(r.blocked.hoist).toBe('lmi');
    r = updateCrane(spec, s, { ...emptyInput(), luff: -1 }, ctx({ loadPercent: 105, loadAttached: true }), auto);
    expect(r.blocked.luff).toBe('lmi');
    expect(s.ropeLength).toBe(before.rope);
    expect(s.boomAngle).toBe(before.angle);
    // veilige richting blijft vrij: vieren en giek omhoog
    r = updateCrane(spec, s, { ...emptyInput(), hoist: -1, luff: 1 }, ctx({ loadPercent: 105, loadAttached: true }), auto);
    expect(r.blocked.hoist).toBeUndefined();
    expect(r.blocked.luff).toBeUndefined();
  });

  it('rijden kan alleen met ingehaalde stempels', () => {
    const spec = resolveCrane(getCrane('at60'));
    const s = createCraneState(spec, { x: 0, outriggersDeployed: true });
    const auto = { outriggerAuto: 'none' as const };
    const r = updateCrane(spec, s, { ...emptyInput(), drive: 1 }, ctx(), auto);
    expect(r.blocked.drive).toBe('outriggers');
    expect(s.baseX).toBe(0);
  });

  it('automatische stempelprocedure zet alle stempels volledig uit', () => {
    const spec = resolveCrane(getCrane('at60'));
    const s = createCraneState(spec, { x: 0, outriggersDeployed: false });
    const auto = { outriggerAuto: 'none' as 'none' | 'deploy' | 'retract' };
    expect(supportState(spec, s).mode).toBe('tires');
    updateCrane(spec, s, { ...emptyInput(), outriggerAuto: true }, ctx(), auto);
    for (let i = 0; i < 60 * 20; i++) updateCrane(spec, s, emptyInput(), ctx(), auto);
    expect(supportState(spec, s).mode).toBe('outriggers');
  });

  it('stempels kunnen niet worden ingehaald terwijl een last hangt', () => {
    const spec = resolveCrane(getCrane('at60'));
    const s = createCraneState(spec, { x: 0, outriggersDeployed: true });
    const auto = { outriggerAuto: 'none' as 'none' | 'deploy' | 'retract' };
    const r = updateCrane(spec, s, { ...emptyInput(), outriggerAuto: true }, ctx({ loadAttached: true, loadPercent: 40 }), auto);
    expect(r.outriggerBlocked).toBe(true);
    expect(supportState(spec, s).mode).toBe('outriggers');
  });

  it('giek kan niet door een obstakel bewegen', () => {
    const spec = resolveCrane(getCrane('at60'));
    const s = createCraneState(spec, { x: 0, boomAngleDeg: 60, boomLength: 12, outriggersDeployed: true });
    const wall = { id: 'w', kind: 'building' as const, minX: 4, maxX: 10, minY: 0, maxY: 9, minZ: -40, maxZ: 40, onHit: 'damage' as const, landable: true };
    const auto = { outriggerAuto: 'none' as const };
    let hit = false;
    for (let i = 0; i < 60 * 30; i++) {
      const r = updateCrane(spec, s, { ...emptyInput(), luff: -1 }, ctx({ colliders: [wall] }), auto);
      if (r.boomHit) hit = true;
    }
    expect(hit).toBe(true);
    expect(s.boomAngle).toBeGreaterThan(20 * DEG);
  });
});

describe('belastingpercentage en stabiliteit', () => {
  it('capaciteit daalt met de straal en stijgt met contragewicht', () => {
    const spec = resolveCrane(getCrane('at500'));
    const base = createCraneState(spec, { x: 0, boomLength: 30, outriggersDeployed: true });
    const lo = allowedCapacityT(spec, { ...base, counterweightIndex: 1 }, 25);
    const hi = allowedCapacityT(spec, { ...base, counterweightIndex: 4 }, 25);
    const far = allowedCapacityT(spec, { ...base, counterweightIndex: 4 }, 35);
    expect(hi).toBeGreaterThan(lo);
    expect(far).toBeLessThan(hi);
  });

  it('zonder stempels mag een AT-kraan niet hijsen, een RT-kraan beperkt wel', () => {
    const at = resolveCrane(getCrane('at60'));
    const rt = resolveCrane(getCrane('rt80'));
    expect(allowedCapacityT(at, createCraneState(at, { x: 0, outriggersDeployed: false }))).toBe(0);
    const rtTires = allowedCapacityT(rt, createCraneState(rt, { x: 0, outriggersDeployed: false }));
    const rtOut = allowedCapacityT(rt, createCraneState(rt, { x: 0, outriggersDeployed: true }));
    expect(rtTires).toBeGreaterThan(0);
    expect(rtTires).toBeLessThan(rtOut);
  });

  it('gedeeltelijk uitgeschoven stempels: tussenliggend lastdiagram', () => {
    const spec = resolveCrane(getCrane('at60'));
    const full = createCraneState(spec, { x: 0, boomLength: 20, outriggersDeployed: true, slewDeg: 90 });
    const half = { ...full, outriggerBeam: full.outriggerBeam.map(() => 0.5) };
    expect(supportState(spec, half).mode).toBe('partial');
    expect(allowedCapacityT(spec, half)).toBeLessThan(allowedCapacityT(spec, full));
  });

  it('lastdiagram (tabel) is consistent met de begrenzer', () => {
    const spec = resolveCrane(getCrane('at60'));
    const base = createCraneState(spec, { x: 0, outriggersDeployed: true });
    const chart = generateLoadChart(spec, base, { counterweightIndex: 2, support: 'outriggers' });
    expect(chart.capacity.length).toBe(chart.boomLengths.length);
    // capaciteit per rij neemt af met de straal
    for (const row of chart.capacity) {
      const vals = row.filter((v): v is number => v !== null);
      for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeLessThanOrEqual(vals[i - 1] + 1e-6);
    }
  });
});
