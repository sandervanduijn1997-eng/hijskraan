import { CRANE_IDS, getCrane } from '../../src/cranes/config/cranes';
import { UPGRADES } from '../../src/cranes/config/upgrades';
import type { UpgradeId } from '../../src/cranes/config/types';
import { boomFrequency, staticDeflection } from '../../src/cranes/models/boomFlex';
import { allowedCapacityT, generateLoadChart, stabilityMasses, structuralCapacityT, supportState } from '../../src/cranes/models/capacity';
import { resolveCrane } from '../../src/cranes/models/craneSpec';
import type { ResolvedCrane } from '../../src/cranes/models/craneSpec';
import type { CraneState } from '../../src/cranes/models/craneState';
import { createCraneState } from '../../src/cranes/models/craneState';
import { computeGeometry, solveBoomIK } from '../../src/cranes/models/kinematics';
import { actualCapacityT, actualSetup, autoLmi, lmiCapacityT, maxParts, partOptions, reevingCapacityT } from '../../src/cranes/models/lmi';
import { flowScale, hydraulicDemand, pumpFlow, stepRpm, systemPressure, targetRpm } from '../../src/cranes/models/powertrain';
import { MISSIONS } from '../../src/missions/data/index';
import { createRope } from '../../src/physics/cable/rope';
import type { Collider } from '../../src/physics/collision/colliders';
import { FIXED_DT, GRAVITY, SUBSTEPS } from '../../src/physics/constants';
import type { GroundType } from '../../src/physics/ground';
import { apexWorld, createBoxBody, qFromAxisAngle } from '../../src/physics/load/rigidBody';
import type { BodyInit, RigidBody } from '../../src/physics/load/rigidBody';
import { BEARING, MATS, allowedPressure, bearingArea, padLoadsT } from '../../src/physics/stability/groundPressure';
import { chartCapacity } from '../../src/physics/stability/loadChart';
import { computeStability, tippingDistance, tippingLoadT } from '../../src/physics/stability/stability';
import type { StabilityInput } from '../../src/physics/stability/stability';
import { sampleWind } from '../../src/physics/wind';
import { PhysicsWorld, defaultPhysicsParams } from '../../src/physics/world';
import type { PhysicsParams } from '../../src/physics/world';
import { DEG } from '../../src/utils/math';
import { writeRef } from './common';

/**
 * Functietabellen (invoer → uitvoer) en korte fysicascenario's. Hiermee wordt de C++-port per module
 * gecontroleerd, lang voordat de hele simulatie draait. Functietabellen zijn niet chaotisch en moeten
 * vrijwel exact kloppen; de fysicascenario's zijn kort genoeg om stap voor stap te vergelijken.
 */

/** Vaste pseudo-random reeks (mulberry32) zodat elke export dezelfde steekproef trekt. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const STATES_PER_CRANE = 64;

/** Steekproef van kraanstanden binnen de grenzen van de kraan. */
function sampleStates(spec: ResolvedCrane, r: () => number): CraneState[] {
  const gb = spec.gb;
  const out: CraneState[] = [];
  for (let i = 0; i < STATES_PER_CRANE; i++) {
    const s = createCraneState(spec, { x: 0, outriggersDeployed: i % 4 !== 3, preassembled: true });
    s.slew = (r() * 2 - 1) * Math.PI;
    s.boomAngle = lerp(gb.boomAngleMinDeg, gb.boomAngleMaxDeg, r()) * DEG;
    if (spec.cfg.kind === 'lattice') {
      s.boomOptionIndex = Math.floor(r() * spec.boomOptions.length);
      s.boomLength = spec.boomOptions[s.boomOptionIndex];
    } else s.boomLength = lerp(gb.boomMin, gb.boomMax, r());
    s.jibIndex = Math.floor(r() * spec.jibOptions.length);
    if (gb.jibLength) s.trolley = lerp(gb.trolleyMin ?? 0, gb.jibLength, r());
    if (spec.cfg.kind === 'knuckle') {
      s.knuckle = lerp(gb.knuckleMinDeg ?? -170, gb.knuckleMaxDeg ?? 20, r()) * DEG;
      s.knuckleTele = (gb.knuckleTeleMax ?? 0) * r();
    }
    s.counterweightIndex = Math.floor(r() * spec.counterweights.length);
    s.ropeLength = lerp(gb.ropeMin, gb.ropeMax, r());
    out.push(s);
  }
  return out;
}

function craneTables(): unknown {
  const r = rng(0xc2a7e);
  const allUpgrades = Object.keys(UPGRADES) as UpgradeId[];
  return CRANE_IDS.map((id) => {
    const cfg = getCrane(id);
    const spec = resolveCrane(cfg, []);
    const states = sampleStates(spec, r).map((s) => {
      const g = computeGeometry(spec, s);
      const parts = maxParts(spec);
      const lmi = autoLmi(spec, s, parts);
      const tensionT = r() * spec.gb.maxCapacityT;
      return {
        state: s,
        geometry: g,
        support: supportState(spec, s),
        masses: stabilityMasses(spec, s),
        allowedT: allowedCapacityT(spec, s),
        structuralT: structuralCapacityT(spec, g.tipU, s.boomLength),
        setup: actualSetup(spec, s),
        lmi,
        lmiT: lmiCapacityT(spec, s, lmi),
        actualT: actualCapacityT(spec, s, parts),
        deflection: { tensionT, value: staticDeflection(s.boomLength, tensionT, allowedCapacityT(spec, s), s.boomAngle) },
        boomFrequency: boomFrequency(s.boomLength),
      };
    });
    const base = createCraneState(spec, { x: 0, outriggersDeployed: true, preassembled: true });
    const charts = [];
    for (let cw = 0; cw < spec.counterweights.length; cw++)
      for (const support of ['outriggers', 'tires'] as const) {
        const chart = generateLoadChart(spec, base, { counterweightIndex: cw, support });
        const lookups = Array.from({ length: 16 }, () => {
          const L = lerp(spec.gb.boomMin, spec.gb.boomMax, r());
          const rad = lerp(1, spec.gb.boomMax, r());
          return { boomLength: L, radius: rad, conservative: chartCapacity(chart, L, rad, true), interpolated: chartCapacity(chart, L, rad, false) };
        });
        charts.push({ counterweightIndex: cw, support, chart, lookups });
      }
    const ik =
      cfg.kind === 'telescopic'
        ? Array.from({ length: 24 }, () => {
            const u = lerp(2, spec.gb.boomMax * 0.9, r());
            const y = lerp(spec.gb.pivotHeight, spec.gb.pivotHeight + spec.gb.boomMax, r());
            return { u, y, out: solveBoomIK(spec, u, y) };
          })
        : [];
    return {
      id,
      resolved: spec,
      resolvedAllUpgrades: resolveCrane(cfg, allUpgrades),
      maxParts: maxParts(spec),
      partOptions: partOptions(spec),
      reeving: partOptions(spec).map((p) => ({ parts: p, capacityT: reevingCapacityT(spec, p) })),
      states,
      charts,
      ik,
    };
  });
}

function stabilityTables(): unknown {
  const r = rng(0x57ab1e);
  const masses = () => ({ carrierT: lerp(10, 200, r()), superT: lerp(5, 120, r()), superBehind: lerp(0, 3, r()), counterweightT: lerp(0, 160, r()), cwRadius: lerp(2, 9, r()) });
  const stability = Array.from({ length: 200 }, () => {
    const inp: StabilityInput = {
      masses: masses(),
      footprint: { a: lerp(2, 8, r()), b: lerp(1.5, 7, r()) },
      slew: (r() * 2 - 1) * Math.PI,
      tipRadius: lerp(2, 60, r()),
      tipHeight: lerp(5, 80, r()),
      boomT: lerp(2, 60, r()),
      boomCogRadius: lerp(1, 30, r()),
      ropeTension: lerp(0, 1.5e6, r()),
      ropeOutwardAngle: (r() * 2 - 1) * 0.3,
      groundFactor: lerp(0.4, 1, r()),
      slope: (r() * 2 - 1) * 0.05,
      windMoment: lerp(0, 4e5, r()),
    };
    return {
      input: inp,
      result: computeStability(inp),
      tippingDistance: tippingDistance(inp.footprint, inp.slew),
      tippingLoadT: tippingLoadT(inp.masses, inp.footprint, inp.slew, inp.tipRadius, inp.boomT, inp.boomCogRadius),
    };
  });
  const padLoads = Array.from({ length: 100 }, () => {
    const inp = { masses: masses(), slew: (r() * 2 - 1) * Math.PI, boomT: lerp(2, 60, r()), boomCogRadius: lerp(1, 30, r()), loadT: lerp(0, 100, r()), tipRadius: lerp(2, 60, r()), a: lerp(2, 8, r()), b: lerp(1.5, 7, r()) };
    return { input: inp, padsT: padLoadsT(inp) };
  });
  const grounds = Object.keys(BEARING) as GroundType[];
  const pressure = grounds.flatMap((g) => [0.2, 0.5, 0.8, 1].map((q) => ({ ground: g, quality: q, allowed: allowedPressure(g, q) })));
  const area = [10, 60, 250, 600].flatMap((cap) => MATS.map((m) => ({ maxCapacityT: cap, mat: m.id, area: bearingArea(cap, m.id) })));
  return { stability, padLoads, pressure, area };
}

function powertrainTables(): unknown {
  const r = rng(0x9a5);
  const axes = ['hoist', 'luff', 'tele', 'slew', 'knuckle', 'knuckleTele'] as const;
  return Array.from({ length: 200 }, () => {
    const commands: Record<string, number> = {};
    for (const a of axes) if (r() < 0.6) commands[a] = r() * 2 - 1;
    const demand = hydraulicDemand(commands);
    const rpm = lerp(750, 1900, r());
    const loadPct = r() * 120;
    const hoisting = r() < 0.5;
    const working = r() < 0.5;
    const target = targetRpm(demand, loadPct, hoisting, working);
    return { commands, demand, rpm, loadPct, hoisting, working, pumpFlow: pumpFlow(rpm), targetRpm: target, stepRpm: stepRpm(rpm, target, FIXED_DT), flowScale: flowScale(demand, rpm), pressure: systemPressure(loadPct, demand, hoisting) };
  });
}

function windTables(): unknown {
  // elke unieke windinstelling uit de missies, 60 s bemonsterd
  const seen = new Map<string, (typeof MISSIONS)[number]['wind']>();
  for (const m of MISSIONS) seen.set(JSON.stringify(m.wind), m.wind);
  return [...seen.values()].map((def, i) => ({
    def,
    seed: 100 + i * 37,
    samples: Array.from({ length: 121 }, (_, k) => ({ t: k * 0.5, ...sampleWind(def, k * 0.5, 100 + i * 37, 1) })),
  }));
}

// ------------------------------------------------------------------ fysicascenario's

const box = (id: string, minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number): Collider => ({ id, kind: 'building', minX, maxX, minY, maxY, minZ, maxZ, onHit: 'damage', landable: true });

interface Scenario {
  id: string;
  description: string;
  params: Partial<PhysicsParams>;
  colliders: Collider[];
  body: BodyInit;
  /**
   * Lichaam aan de kabel, met tip en kabellengte (en optioneel kabelinkorting per stap).
   * 'taut' = precies de afstand tip → hijsoog: geen ruk bij de start, die elk klein verschil zou opblazen.
   */
  rope?: { tip: { x: number; y: number; z: number }; length: number | 'taut'; min: number; max: number; hoistPerStep?: number };
  /** Beginrotatie om de verticaal (rad) en beginsnelheid. */
  yaw?: number;
  vel?: { x: number; y: number; z: number };
  steps: number;
}

const SCENARIOS: Scenario[] = [
  { id: 'rest-sleep', description: 'Rustende last kruipt niet weg en valt in slaap', params: {}, colliders: [box('bed', -4, 4, 0, 1.3, -1.25, 1.25)], body: { mass: 500, width: 1.2, height: 1, depth: 1, x: 2, y: 1.3, apexHeight: 1 }, steps: 600 },
  { id: 'ledge-tip', description: 'Last over een rand in z kantelt zijwaarts en valt', params: {}, colliders: [box('richel', -3, 3, 0, 2, -3, 0)], body: { mass: 800, width: 1.2, height: 0.8, depth: 1, x: 0, y: 2, z: 0.3, apexHeight: 1 }, steps: 240 },
  { id: 'pendulum-3d', description: 'Uit het lood gehangen last slingert in 3D, zonder demping', params: { swayDamping: 0 }, colliders: [], body: { mass: 1000, width: 1, height: 1, depth: 1, x: 0, y: 8.5, z: 1.5, apexHeight: 0.5 }, rope: { tip: { x: 0, y: 20, z: 0 }, length: 'taut', min: 1, max: 50 }, steps: 480 },
  { id: 'torsion', description: 'Verdraaide ligger draait terug naar de neutrale stand', params: { swayDamping: 0.3 }, colliders: [], body: { mass: 3000, width: 6, height: 0.5, depth: 0.5, x: 0, y: 8, apexHeight: 1.5 }, rope: { tip: { x: 0, y: 20, z: 0 }, length: 'taut', min: 1, max: 50 }, yaw: 30 * DEG, steps: 600 },
  { id: 'corner-slide', description: 'Last schuift diagonaal tegen de hoek van een obstakel', params: { gravity: 0 }, colliders: [box('hoek', 2, 6, 0, 6, 2, 6)], body: { mass: 1000, width: 1, height: 1, depth: 1, x: 0, y: 2, z: 0, apexHeight: 0.5 }, vel: { x: 2, y: 0, z: 2 }, steps: 180 },
  // kabelrek zoals Simulation hem zet voor een kraan van 20 t (0,15 m bij de nominale last)
  { id: 'lift-off', description: 'Kabel wordt ingekort tot de last van de grond komt (geleidelijke overname)', params: { ropeCompliance: 0.15 / (20 * 1000 * GRAVITY) }, colliders: [box('grond', -10, 10, -1, 0, -10, 10)], body: { mass: 5000, width: 2, height: 1, depth: 2, x: 0, y: 0, apexHeight: 1 }, rope: { tip: { x: 0, y: 12, z: 0 }, length: 10.2, min: 1, max: 50, hoistPerStep: 0.004 }, steps: 360 },
  { id: 'eccentric-hang', description: 'Excentrisch zwaartepunt: last hangt scheef', params: {}, colliders: [], body: { mass: 2000, width: 4, height: 0.6, depth: 1, x: 0, y: 9, comOffsetX: 0.8, apexHeight: 1 }, rope: { tip: { x: 0, y: 20, z: 0 }, length: 'taut', min: 1, max: 50 }, steps: 600 },
  { id: 'drop', description: 'Vrije val op de grond en uitstuiteren', params: {}, colliders: [box('grond', -10, 10, -1, 0, -10, 10)], body: { mass: 1500, width: 1.5, height: 1, depth: 1.2, x: 0, y: 3, angle: 0.3, apexHeight: 0.5 }, steps: 300 },
];

/** Kopie (geen verwijzing): de simulatie muteert pos/q/vel in place. */
const bodyState = (b: RigidBody) => structuredClone({ pos: b.pos, q: b.q, vel: b.vel, omega: b.omega, sleeping: b.sleeping });

function runScenario(sc: Scenario): unknown {
  const world = new PhysicsWorld({ ...defaultPhysicsParams(), ...sc.params });
  world.setColliders(sc.colliders);
  const b = createBoxBody(sc.body);
  if (sc.yaw) {
    b.q = qFromAxisAngle(0, 1, 0, sc.yaw);
    b.prevQ = { ...b.q };
  }
  if (sc.vel) b.vel = { ...sc.vel };
  const cb = world.addBody('l', b);
  const rp = sc.rope ?? { tip: { x: 0, y: 100, z: 0 }, length: 1, min: 1, max: 1 };
  if (sc.rope) world.ropeBody = cb;
  const a = apexWorld(b);
  const length = rp.length === 'taut' ? Math.hypot(rp.tip.x - a.x, rp.tip.y - a.y, rp.tip.z - a.z) : rp.length;
  const rope = createRope({ ...rp.tip }, length, rp.min, rp.max);
  const initial = { body: bodyState(b), ropeLength: length, derived: structuredClone({ inertiaBody: b.inertiaBody, samples: b.samples, apex: b.apex, boxOffset: b.boxOffset, dragAreaX: b.dragAreaX, dragAreaZ: b.dragAreaZ }) };
  const frames = [];
  for (let i = 0; i < sc.steps; i++) {
    const lengthStart = rope.length;
    if (sc.rope?.hoistPerStep) rope.length = Math.max(rope.minLength, rope.length - sc.rope.hoistPerStep);
    world.step(FIXED_DT, SUBSTEPS, rope, { ...rp.tip }, lengthStart);
    frames.push({ ...bodyState(b), tension: rope.tension, stretch: rope.stretch, slack: rope.slack, ropeLength: rope.length });
  }
  return { ...sc, physicsParams: world.params, initial, frames };
}

export function exportUnits(): string[] {
  return [
    writeRef('units/cranes', craneTables(), true),
    writeRef('units/stability', stabilityTables()),
    writeRef('units/powertrain', powertrainTables()),
    writeRef('units/wind', windTables()),
    writeRef('units/physics-scenarios', { fixedDt: FIXED_DT, substeps: SUBSTEPS, scenarios: SCENARIOS.map(runScenario) }, true),
  ];
}
