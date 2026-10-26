import { describe, expect, it } from 'vitest';
import { getMission } from '../../src/missions/data/index';
import { practiceMission } from '../../src/missions/data/challenges';
import { ERECTION_MOMENT_LIMIT_TM, Simulation } from '../../src/sim/simulation';
import { DEG } from '../../src/utils/math';
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
    // zwakke ondergrond voor de stabiliteit, maar met grote matten (de stempels zakken niet eerst weg)
    const m: MissionDef = { ...base, mats: 'large', ground: [{ x0: -100, x1: 100, type: 'concrete', quality: 0.3 }] };
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

describe('torenkraan monteren met een hulpkraan', () => {
  const finishAssembly = (sim: Simulation) => {
    // alle montagedelen als geplaatst markeren (de bot-test speelt ze echt)
    const b = sim.assembly!.build;
    Object.assign(b, { sections: 3, slewingUnit: true, towerHead: true, counterJib: true, jib: true, ballast: [{ x: 17.3, massT: 6 }, { x: 15.9, massT: 9 }, { x: 14.5, massT: 9 }] });
    for (const t of sim.tasks) if (t.def.type === 'outriggers' || (t.def.type === 'deliver' && t.def.inOrder)) t.status = 'done';
    for (const l of sim.loads) if (l.id.startsWith('tw-')) { l.status = 'consumed'; sim.world.removeBody(l.cb); }
    const gb = sim.spec.gb;
    Object.assign(sim.crane, { boomAngle: gb.boomAngleMinDeg * DEG, boomLength: gb.boomMin, ropeLength: gb.ropeMin });
  };

  it('missie 12 begint met de mobiele hulpkraan en een toren met alleen de voetsectie', () => {
    const sim = new Simulation({ mission: getMission('m12')! });
    expect(sim.spec.cfg.id).toBe('at500');
    expect(sim.missionSpec.cfg.id).toBe('tc160');
    expect(sim.assisting).toBe(true);
    expect(sim.tasks[0].def.type).toBe('outriggers');
    expect(sim.assembly!.build.sections).toBe(1);
    expect(sim.colliders.some((c) => c.id === 'tw-mast')).toBe(true);
    expect(sim.colliders.some((c) => c.id === 'tw-jib')).toBe(false);
    // de hulpkraan staat naast de toren in de diepte
    expect(sim.crane.baseZ).toBeLessThan(-10);
  });

  it('vaste montagevolgorde: alleen het volgende deel is actief', () => {
    const sim = new Simulation({ mission: getMission('m12')! });
    sim.outriggerAuto.outriggerAuto = 'deploy';
    run(sim, 60, () => emptyInput(), () => sim.tasks[0].status === 'done');
    sim.step(emptyInput());
    const active = sim.tasks.filter((t) => t.status === 'active');
    expect(active).toHaveLength(1);
    expect(active[0].def.type === 'deliver' && active[0].def.loadId).toBe('tw-m2');
    const order = sim.tasks.filter((t) => t.def.type === 'deliver' && t.def.inOrder).map((t) => (t.def as { loadId: string }).loadId);
    expect(order).toEqual(['tw-m2', 'tw-m3', 'tw-su', 'tw-th', 'tw-cj', 'tw-b1', 'tw-jb', 'tw-b2', 'tw-b3']);
  });

  it('ballastvolgorde: één blok vóór de giek houdt de toren binnen de momentgrens', () => {
    const sim = new Simulation({ mission: getMission('m12')! });
    const b = sim.assembly!.build;
    const M = () => Math.abs(sim.towerMomentTm());
    Object.assign(b, { sections: 3, slewingUnit: true, towerHead: true, counterJib: true });
    const steps: number[] = [M()];
    b.ballast.push({ x: 17.3, massT: 6 });
    steps.push(M());
    b.jib = true;
    steps.push(M());
    b.ballast.push({ x: 15.9, massT: 9 }, { x: 14.5, massT: 9 });
    steps.push(M());
    for (const m of steps) expect(m).toBeLessThan(ERECTION_MOMENT_LIMIT_TM);
    expect(steps[3]).toBeLessThan(30); // in balans na de laatste ballast
    // fout: giek zonder ballast, of alle ballast vóór de giek
    b.ballast = [];
    expect(M()).toBeGreaterThan(ERECTION_MOMENT_LIMIT_TM);
    b.jib = false;
    b.ballast = [{ x: 17.3, massT: 6 }, { x: 15.9, massT: 9 }, { x: 14.5, massT: 9 }];
    expect(M()).toBeGreaterThan(ERECTION_MOMENT_LIMIT_TM);
  });

  it('na transportstand overstappen naar de torenkraan; die klimt met B naar werkhoogte', () => {
    const sim = new Simulation({ mission: getMission('m12')! });
    finishAssembly(sim);
    const events: string[] = [];
    run(sim, 3, () => emptyInput(), () => { events.push(...sim.drainEvents().map((e) => e.type)); return sim.spec.cfg.id === 'tc160'; });
    events.push(...sim.drainEvents().map((e) => e.type));
    expect(events).toContain('craneSwitch');
    expect(sim.parked?.spec.cfg.id).toBe('at500');
    expect(sim.colliders.some((c) => c.id === 'parked-carrier')).toBe(true);
    expect(sim.colliders.some((c) => c.id.startsWith('tw-'))).toBe(false);
    const mastTop = () => sim.geom.segments.find((s) => s.kind === 'mast')!.y1;
    const towerH = sim.spec.gb.towerHeight!;
    const h0 = mastTop();
    expect(h0).toBeLessThan(towerH * 0.5);
    // tijdens het klimmen geen kraanbewegingen
    run(sim, 1, () => { const i = emptyInput(); i.trolley = 1; return i; });
    expect(sim.lastControl.blocked.trolley).toBe('setup');
    const hookY = sim.hookPoint().y;
    run(sim, 120, () => { const i = emptyInput(); i.setupHold = true; return i; }, () => sim.crane.setupProgress >= 1);
    expect(mastTop()).toBeCloseTo(sim.spec.cfg.visual.carrierHeight + towerH, 3);
    // de lier viert mee: de haak blijft ongeveer op dezelfde hoogte
    expect(Math.abs(sim.hookPoint().y - hookY)).toBeLessThan(1.5);
    sim.step(emptyInput());
    run(sim, 2, () => { const i = emptyInput(); i.trolley = 1; return i; });
    expect(sim.lastControl.blocked.trolley).toBeUndefined();
    expect(sim.capacityT).toBeGreaterThan(0);
  });

  it('loslaten van B pauzeert het klimmen', () => {
    const sim = new Simulation({ mission: getMission('m13')! });
    finishAssembly(sim);
    run(sim, 3, () => emptyInput(), () => sim.spec.cfg.id === 'tc160');
    run(sim, 10, () => { const i = emptyInput(); i.setupHold = true; return i; });
    const p = sim.crane.setupProgress;
    expect(p).toBeGreaterThan(0.1);
    run(sim, 5, () => emptyInput());
    expect(sim.crane.setupProgress).toBe(p);
  });
});

describe('torenkraanmontage gespeeld met besturingsinvoer', () => {
  it('missie 12: hulpkraan monteert de toren, daarna klimt hij en levert de kubel af', async () => {
    const { playMission } = await import('../helpers/missionBot');
    const r = playMission(getMission('m12')!, DIFFICULTIES.practice, 1800);
    expect(r.reason).toBe('');
    expect(r.outcome).toBe('success');
    expect(r.damage).toBeLessThan(5);
  }, 60000);
});
