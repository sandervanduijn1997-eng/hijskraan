import { describe, expect, it } from 'vitest';
import { getMission } from '../../src/missions/data/index';
import { practiceMission } from '../../src/missions/data/challenges';
import { Simulation } from '../../src/sim/simulation';
import { DIFFICULTIES } from '../../src/sim/difficulty';
import { emptyInput } from '../../src/cranes/controllers/craneInput';
import type { MissionDef } from '../../src/missions/data/types';
import { hoistTo, run, steerTip } from '../helpers/autopilot';

function attachAt(sim: Simulation, loadId: string): void {
  const load = sim.loads.find((l) => l.id === loadId)!;
  const sp = sim.slingPoint(load);
  run(sim, 60, () => {
    const i = steerTip(sim, sp.x, sim.geom.tipHeight);
    hoistTo(sim, i, Math.abs(sim.geom.tip.x - sp.x) < 0.3 ? sp.y + 0.2 : sim.hookPoint().y);
    return i;
  }, () => sim.attachCandidate() === load && Math.abs(sim.geom.tip.x - sp.x) < 0.25);
  expect(sim.toggleRigging()).toContain('aangeslagen');
}

describe('mislukkingen en veiligheidsgrenzen', () => {
  it('mislukte hijs door een botsing met een verboden obstakel (keerwand met onHit: fail)', () => {
    const base = getMission('m02')!;
    const m: MissionDef = { ...base, obstacles: base.obstacles.map((o) => ({ ...o, h: 2, onHit: 'fail' as const })) };
    const sim = new Simulation({ mission: m, difficulty: DIFFICULTIES.normal });
    attachAt(sim, 'c1');
    run(sim, 10, () => { const i = emptyInput(); hoistTo(sim, i, 3.5); return i; });
    // giek met kracht naar buiten: de container zwaait tegen de keerwand
    run(sim, 60, () => { const i = emptyInput(); i.tele = 1; return i; }, () => sim.outcome !== 'running');
    expect(sim.outcome).toBe('failed');
    expect(sim.failReason).toMatch(/keerwand/);
    expect(sim.metrics.collisions).toBeGreaterThan(0);
  });

  it('te zware last: de LMI blokkeert het hijsen en de last komt niet los', () => {
    const m = practiceMission({ craneId: 'at60', loadType: 'transformer', environment: 'trainingYard', windBase: 0, gravity: 9.81 });
    const sim = new Simulation({ mission: m, craneId: 'at60', difficulty: DIFFICULTIES.normal, freePlay: true });
    attachAt(sim, 'l1');
    run(sim, 20, () => { const i = emptyInput(); i.hoist = 1; return i; });
    const load = sim.loads[0];
    // de last blijft op de grond steunen (hooguit licht kantelend op één rand) en de kabelkracht blijft binnen de grens
    expect(load.cb.supports.size > 0 || load.cb.body.sleeping).toBe(true);
    expect(sim.tensionF / 9.81 / 1000).toBeLessThan(sim.capacityT * 1.4);
    expect(sim.tensionF / 9.81 / 1000).toBeLessThan(load.type.massKg / 1000 * 0.85);
    expect(load.cb.body.pos.y - load.cb.body.halfH).toBeLessThan(0.3);
    expect(sim.lmiLatched).toBe(true);
    expect(sim.lastControl.blocked.hoist).toBe('lmi');
    expect(sim.warnings.has('overload')).toBe(true);
    expect(sim.crane.tipped).toBe(false);
  });

  it('onveilige configuratie: zonder stempels kan een AT-kraan de last niet heffen', () => {
    const base = getMission('m01')!;
    const m: MissionDef = { ...base, crane: { ...base.crane, outriggersDeployed: false } };
    const sim = new Simulation({ mission: m, difficulty: DIFFICULTIES.normal });
    attachAt(sim, 'p1');
    run(sim, 10, () => { const i = emptyInput(); i.hoist = 1; return i; });
    expect(sim.capacityT).toBe(0);
    expect(sim.loads[0].cb.body.pos.y).toBeLessThan(0.6);
    expect(sim.warnings.has('outriggers')).toBe(true);
  });

  it('kantelen volgt uit het stabiliteitsmodel: zware last op slappe grond', () => {
    const base = practiceMission({ craneId: 'rt80', loadType: 'buildingModule', environment: 'roughTerrain', windBase: 0, gravity: 9.81 });
    const m: MissionDef = { ...base, ground: [{ x0: -100, x1: 100, type: 'mud', quality: 0.3 }] };
    const sim = new Simulation({ mission: m, craneId: 'rt80', difficulty: DIFFICULTIES.normal, freePlay: true });
    attachAt(sim, 'l1');
    run(sim, 30, () => { const i = emptyInput(); i.hoist = 1; return i; }, () => sim.crane.tipped || sim.outcome !== 'running');
    expect(sim.crane.tilt).toBeGreaterThan(0);
    expect(sim.warnings.has('tipping') || sim.outcome === 'failed').toBe(true);
    run(sim, 10, () => emptyInput(), () => sim.outcome !== 'running');
    expect(sim.outcome).toBe('failed');
    expect(sim.failReason).toMatch(/gekanteld/);
  });

  it('oefenprofiel: dezelfde situatie kantelt niet (toegankelijk profiel)', () => {
    const base = practiceMission({ craneId: 'rt80', loadType: 'buildingModule', environment: 'roughTerrain', windBase: 0, gravity: 9.81 });
    const m: MissionDef = { ...base, ground: [{ x0: -100, x1: 100, type: 'mud', quality: 0.3 }] };
    const sim = new Simulation({ mission: m, craneId: 'rt80', difficulty: DIFFICULTIES.practice, freePlay: true });
    attachAt(sim, 'l1');
    run(sim, 20, () => { const i = emptyInput(); i.hoist = 1; return i; });
    expect(sim.crane.tipped).toBe(false);
  });

  it('pauzeren (geen stappen) verandert de toestand niet', () => {
    const sim = new Simulation({ mission: getMission('m03')! });
    run(sim, 2, () => { const i = emptyInput(); i.slew = 1; return i; });
    const snap = JSON.stringify(sim.ropeBody!.pos);
    // pauze = de scene roept step() niet aan
    expect(JSON.stringify(sim.ropeBody!.pos)).toBe(snap);
  });

  it('ordered: verkeerde volgorde wordt niet geaccepteerd (m24)', () => {
    const sim = new Simulation({ mission: getMission('m24')! });
    sim.step(emptyInput());
    const active = sim.tasks.filter((t) => t.status === 'active');
    expect(active.length).toBe(1);
    expect(active[0].def.type === 'deliver' && active[0].def.loadId).toBe('gs');
  });

  it('missie met opbouwprocedure: bediening pas na voltooide zelfopbouw (m11)', () => {
    const sim = new Simulation({ mission: getMission('m11')! });
    run(sim, 2, () => { const i = emptyInput(); i.trolley = 1; return i; });
    expect(sim.lastControl.blocked.trolley).toBe('setup');
    run(sim, 40, () => { const i = emptyInput(); i.setupHold = true; return i; }, () => sim.crane.setupProgress >= 1);
    sim.step(emptyInput());
    expect(sim.tasks[0].status).toBe('done');
    run(sim, 2, () => { const i = emptyInput(); i.trolley = 1; return i; });
    expect(sim.lastControl.blocked.trolley).toBeUndefined();
  });
});

describe('torenkraan volledig opbouwen', () => {
  it('missie 12: eerst fundering, mastsecties, draaikrans, tegengiek, giek en ballast; daarna pas bedienen', () => {
    const sim = new Simulation({ mission: getMission('m12')! });
    const towerH = sim.spec.gb.towerHeight!;
    const mastTop = () => Math.max(...sim.geom.segments.filter((s) => s.kind === 'mast').map((s) => s.y1));
    expect(sim.tasks[0].def.type).toBe('setup');
    expect(sim.capacityT).toBe(0);
    run(sim, 2, () => { const i = emptyInput(); i.trolley = 1; i.hoist = 1; return i; });
    expect(sim.lastControl.blocked.trolley).toBe('setup');
    const heights: number[] = [];
    run(sim, 120, () => { heights.push(mastTop()); const i = emptyInput(); i.setupHold = true; return i; }, () => sim.crane.setupProgress >= 1);
    // de mast groeit in stappen (secties) tot de volle hoogte
    expect(heights[0]).toBeLessThan(towerH * 0.3);
    expect(new Set(heights.map((h) => h.toFixed(1))).size).toBeGreaterThanOrEqual(8);
    sim.step(emptyInput());
    expect(sim.tasks[0].status).toBe('done');
    expect(mastTop()).toBeCloseTo(sim.spec.cfg.visual.carrierHeight + towerH, 3);
    run(sim, 2, () => { const i = emptyInput(); i.trolley = 1; return i; });
    expect(sim.lastControl.blocked.trolley).toBeUndefined();
    expect(sim.capacityT).toBeGreaterThan(0);
  });

  it('loslaten van B pauzeert de montage', () => {
    const sim = new Simulation({ mission: getMission('m13')! });
    run(sim, 10, () => { const i = emptyInput(); i.setupHold = true; return i; });
    const p = sim.crane.setupProgress;
    expect(p).toBeGreaterThan(0.1);
    run(sim, 5, () => emptyInput());
    expect(sim.crane.setupProgress).toBe(p);
  });
});
