import type { CraneInput } from '../../src/cranes/controllers/craneInput';
import { emptyInput } from '../../src/cranes/controllers/craneInput';
import { solveBoomIK } from '../../src/cranes/models/kinematics';
import type { Simulation } from '../../src/sim/simulation';
import { clamp, wrapAngle } from '../../src/utils/math';

/** Eenvoudige servo-autopilot voor integratietests: stuurt de tip naar (x, y) en de haak naar een hoogte. */
export function steerTip(sim: Simulation, x: number, y: number, maxCmd = 0.45, z = 0): CraneInput {
  const inp = emptyInput();
  const spec = sim.spec;
  const g = sim.geom;
  const desired = Math.atan2(z - g.slewZ, x - g.slewX);
  const err = wrapAngle(desired - sim.crane.slew);
  inp.slew = clamp(err * 1.5, -maxCmd, maxCmd);
  if (Math.abs(err) > 0.02) return inp;
  const u = Math.hypot(x - g.slewX, z - g.slewZ);
  if (spec.cfg.kind === 'tower') {
    inp.trolley = clamp((u - sim.crane.trolley) * 0.8, -maxCmd, maxCmd);
    return inp;
  }
  const ik = solveBoomIK(spec, u, y);
  inp.luff = clamp((ik.angle - sim.crane.boomAngle) * 6, -maxCmd, maxCmd);
  inp.tele = clamp((ik.length - sim.crane.boomLength) * 0.6, -maxCmd, maxCmd);
  return inp;
}

/** Zet de kabellengte zo dat het haakpunt op hoogte y komt. */
export function hoistTo(sim: Simulation, inp: CraneInput, hookY: number): void {
  const hp = sim.hookPoint();
  inp.hoist = clamp((hookY - hp.y) * 1.2, -1, 1);
}

export function run(sim: Simulation, seconds: number, f: (t: number) => CraneInput, until?: () => boolean): boolean {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    sim.step(f(i / 60));
    if (until && until()) return true;
  }
  return false;
}

/** Volledige eenvoudige hijs: aanslaan, hijsen, verplaatsen, uitslingeren, neerzetten. */
export function performLift(sim: Simulation, loadId: string, zoneX0: number, _zoneY: number, clearY: number): void {
  const load = sim.loads.find((l) => l.id === loadId)!;
  const sp = sim.slingPoint(load);
  // de zone volgt uit de taak (missies zijn rondom ingedeeld); zoneX0 alleen als terugval
  const task = sim.tasks.find((t) => t.def.type === 'deliver' && t.def.loadId === loadId);
  const zone = task && task.def.type === 'deliver' ? sim.mission.zones.find((zz) => zz.id === (task.def as { zoneId: string }).zoneId) : undefined;
  const zoneX = zone?.x ?? zoneX0;
  const zoneZ = zone?.z ?? 0;
  const off = (px: number, pz: number) => Math.hypot(sim.geom.tip.x - px, sim.geom.tip.z - pz);
  run(sim, 90, () => {
    const i = steerTip(sim, sp.x, sim.geom.tipHeight, 0.45, sp.z);
    hoistTo(sim, i, off(sp.x, sp.z) < 0.3 ? sp.y + 0.2 : sim.hookPoint().y);
    return i;
  }, () => sim.attachCandidate() === load && off(sp.x, sp.z) < 0.25);
  const msg = sim.toggleRigging();
  if (!msg.includes('aangeslagen')) throw new Error('Aanslaan mislukt: ' + msg);
  const hookClear = clearY + load.type.height + load.type.slingHeight + 1.0;
  run(sim, 60, () => { const i = emptyInput(); hoistTo(sim, i, hookClear); return i; }, () => sim.hookPoint().y > hookClear - 0.3);
  let settled = 0;
  run(sim, 150, () => { const i = steerTip(sim, zoneX, sim.geom.tipHeight, 0.3, zoneZ); hoistTo(sim, i, hookClear); return i; }, () => {
    const near = off(zoneX, zoneZ) < 0.08 && sim.swayDeg < 0.6;
    settled = near ? settled + 1 : 0;
    return settled > 60;
  });
  const done = () => sim.outcome !== 'running' || sim.tasks.some((t) => t.def.type === 'deliver' && t.def.loadId === loadId && t.status === 'done');
  run(sim, 90, () => { const i = steerTip(sim, zoneX, sim.geom.tipHeight, 0.2, zoneZ); i.precision = true; i.hoist = -1; return i; }, done);
}

