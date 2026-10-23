import type { Collider } from '../../physics/collision/colliders';
import { rangesOverlap, segmentIntersectsRect } from '../../physics/collision/geometry';
import type { GroundZone } from '../../physics/ground';
import { groundAt } from '../../physics/ground';
import type { Vec3 } from '../../utils/math';
import { DEG, approach, clamp, dist3 } from '../../utils/math';
import type { ResolvedCrane } from '../models/craneSpec';
import type { Axis, CraneState } from '../models/craneState';
import { cloneCraneState } from '../models/craneState';
import { allowedCapacityT, supportState } from '../models/capacity';
import type { CraneGeometry } from '../models/kinematics';
import { computeGeometry, segmentToWorld } from '../models/kinematics';
import type { CraneInput } from './craneInput';

export interface ControlContext {
  dt: number;
  colliders: readonly Collider[];
  ground: readonly GroundZone[];
  groundFallback?: GroundZone['type'];
  /** Gefilterd belastingpercentage van de lastmomentbegrenzer. */
  loadPercent: number;
  /** Hangt er een last aan de haak (aangeslagen)? */
  loadAttached: boolean;
  /** Ophangpunt van de haak/last (voor kabelhaak-detectie). */
  hookPos: Vec3;
  /** Rek van de kabel (m): > 0 betekent dat de last vastzit achter een obstakel. */
  ropeStretch: number;
  worldMinX: number;
  worldMaxX: number;
  /** Conditie van de machine 0..1 (onderhoud). */
  condition: number;
}

export type BlockReason = 'lmi' | 'limit' | 'boomCollision' | 'snag' | 'outriggers' | 'setup' | 'driveLoad' | 'driveObstacle' | 'tipped';

export interface ControlResult {
  /** Assen die deze stap geblokkeerd zijn, met reden. */
  blocked: Partial<Record<Axis, BlockReason>>;
  boomHit: Collider | null;
  outriggerBlocked: boolean;
  /** Stempel raakt obstakel bij uitschuiven. */
  outriggerObstacle: boolean;
}

/**
 * Aanlooptijd (s) tot volle snelheid per as: [kleine kraan, zware kraan].
 * Echte kranen versnellen rustig; vooral zwenken met een lange giek geeft anders onrealistisch veel slinger.
 */
const RAMP_TIMES: Record<Axis, [number, number]> = {
  slew: [2.5, 5.5],
  luff: [1.4, 3.0],
  tele: [1.0, 2.0],
  hoist: [0.7, 1.4],
  trolley: [2.0, 3.0],
  knuckle: [0.9, 1.4],
  knuckleTele: [0.8, 1.2],
  drive: [2.0, 4.5],
};
/** Afremmen gaat iets sneller dan optrekken (hydrauliek sluit), maar nooit abrupt. */
const BRAKE_FACTOR = 1.3;

/** Aanlooptijd voor deze kraan: schaalt logaritmisch met de capaciteit (1 t → klein, 600 t → zwaar). */
export function rampTime(spec: ResolvedCrane, axis: Axis): number {
  const [lo, hi] = RAMP_TIMES[axis];
  const size = clamp(Math.log10(Math.max(1, spec.gb.maxCapacityT)) / Math.log10(600), 0, 1);
  return (lo + (hi - lo) * size) * (2 - spec.effects.rampFactor);
}

function axisApplies(spec: ResolvedCrane, axis: Axis): boolean {
  const k = spec.cfg.kind;
  const gb = spec.gb;
  switch (axis) {
    case 'luff':
      return k !== 'tower';
    case 'tele':
      return k === 'telescopic';
    case 'trolley':
      return k === 'tower';
    case 'knuckle':
    case 'knuckleTele':
      return k === 'knuckle';
    case 'drive':
      return gb.driveSpeed > 0;
    default:
      return true;
  }
}

export function axisMaxSpeed(spec: ResolvedCrane, axis: Axis): number {
  const gb = spec.gb;
  switch (axis) {
    case 'luff':
      return (spec.cfg.kind === 'knuckle' ? gb.knuckleSpeedDeg : gb.luffSpeedDeg) * DEG;
    case 'slew':
      return gb.slewSpeedDeg * DEG;
    case 'hoist':
      return gb.hoistSpeed;
    case 'tele':
      return gb.teleSpeed;
    case 'trolley':
      return gb.trolleySpeed;
    case 'knuckle':
      return gb.knuckleSpeedDeg * DEG;
    case 'knuckleTele':
      return gb.teleSpeed;
    case 'drive':
      return gb.driveSpeed;
  }
}

/** Pas een asbeweging toe op een (kopie van de) toestand, met eindstanden. Geeft true als de eindstand is bereikt. */
function applyAxis(spec: ResolvedCrane, s: CraneState, axis: Axis, delta: number): boolean {
  const gb = spec.gb;
  switch (axis) {
    case 'luff': {
      const lo = gb.boomAngleMinDeg * DEG;
      const hi = gb.boomAngleMaxDeg * DEG;
      const v = clamp(s.boomAngle + delta, lo, hi);
      const hit = v !== s.boomAngle + delta;
      s.boomAngle = v;
      return hit;
    }
    case 'slew':
      s.slew += delta;
      if (s.slew > Math.PI) s.slew -= Math.PI * 2;
      if (s.slew < -Math.PI) s.slew += Math.PI * 2;
      return false;
    case 'hoist': {
      const v = clamp(s.ropeLength - delta, gb.ropeMin, gb.ropeMax);
      const hit = v !== s.ropeLength - delta;
      s.ropeLength = v;
      return hit;
    }
    case 'tele': {
      const v = clamp(s.boomLength + delta, gb.boomMin, gb.boomMax);
      const hit = v !== s.boomLength + delta;
      s.boomLength = v;
      return hit;
    }
    case 'trolley': {
      const v = clamp(s.trolley + delta, gb.trolleyMin ?? 0, gb.jibLength ?? 0);
      const hit = v !== s.trolley + delta;
      s.trolley = v;
      return hit;
    }
    case 'knuckle': {
      const v = clamp(s.knuckle + delta, (gb.knuckleMinDeg ?? -170) * DEG, (gb.knuckleMaxDeg ?? 20) * DEG);
      const hit = v !== s.knuckle + delta;
      s.knuckle = v;
      return hit;
    }
    case 'knuckleTele': {
      const v = clamp(s.knuckleTele + delta, 0, gb.knuckleTeleMax ?? 0);
      const hit = v !== s.knuckleTele + delta;
      s.knuckleTele = v;
      return hit;
    }
    case 'drive':
      s.baseX += delta;
      return false;
  }
}

/** Raakt een bewegend kraandeel (giek, hulpgiek, armen) een obstakel? */
export function boomCollision(spec: ResolvedCrane, s: CraneState, g: CraneGeometry, colliders: readonly Collider[]): Collider | null {
  for (const seg of g.segments) {
    if (seg.kind === 'mast' && spec.cfg.kind === 'tower' && spec.gb.setupType !== 'selfErect') continue;
    if (seg.kind === 'column') continue;
    const w = segmentToWorld(g, s.slew, seg);
    const zmin = Math.min(w.z0, w.z1) - seg.width / 2;
    const zmax = Math.max(w.z0, w.z1) + seg.width / 2;
    for (const c of colliders) {
      if (c.kind === 'ground' || c.kind === 'crane') continue;
      if (!rangesOverlap(zmin, zmax, c.minZ, c.maxZ)) continue;
      if (segmentIntersectsRect(w.x0, w.y0, w.x1, w.y1, c, seg.width / 2)) {
        // bij grote z-variatie (dwars gedraaid) alleen botsen als het snijpunt ook in z overlapt
        if (Math.abs(w.z1 - w.z0) > 1) {
          const zc = (w.z0 + w.z1) / 2;
          if (!rangesOverlap(zc - Math.abs(w.z1 - w.z0) / 2, zc + Math.abs(w.z1 - w.z0) / 2, c.minZ, c.maxZ)) continue;
        }
        return c;
      }
    }
  }
  return null;
}

/** Botst het onderstel bij rijden met een obstakel? */
function carrierCollision(spec: ResolvedCrane, baseX: number, colliders: readonly Collider[]): Collider | null {
  const half = spec.cfg.visual.carrierLength / 2;
  const h = spec.cfg.visual.carrierHeight + 1.2;
  for (const c of colliders) {
    if (c.kind === 'crane') continue;
    if (!rangesOverlap(-1.6, 1.6, c.minZ, c.maxZ)) continue;
    if (c.minY > h) continue;
    if (baseX + half > c.minX && baseX - half < c.maxX) return c;
  }
  return null;
}

/** Wereldpositie van een stempelplaat (x, z). */
export function outriggerPad(spec: ResolvedCrane, s: CraneState, i: number): { x: number; z: number } {
  const gb = spec.gb;
  const full = gb.footprintOutriggers ?? gb.footprintRetracted;
  const ret = gb.footprintRetracted;
  const slewX = s.baseX + gb.slewOffsetX;
  const front = i < 2 ? 1 : -1;
  const side = i % 2 === 0 ? -1 : 1;
  const b = ret.b + (full.b - ret.b) * (s.outriggerBeam[i] ?? 0);
  return { x: slewX + front * full.a, z: side * b };
}

function padBlocked(spec: ResolvedCrane, s: CraneState, i: number, colliders: readonly Collider[]): boolean {
  const p = outriggerPad(spec, s, i);
  for (const c of colliders) {
    if (c.kind === 'crane' || c.minY > 0.8) continue;
    if (p.x > c.minX - 0.4 && p.x < c.maxX + 0.4 && p.z > c.minZ - 0.3 && p.z < c.maxZ + 0.3) return true;
  }
  return false;
}

function outriggersStowed(s: CraneState): boolean {
  return s.outriggerBeam.every((b) => b <= 0.001) && s.outriggerJack.every((j) => j <= 0.001);
}

/**
 * Pas de besturing toe op de kraan voor één vaste stap. Muteert `s`.
 * Bevat hydraulische hellingen, eindstanden, lastmomentbegrenzer, giekbotsing en rijregels.
 */
export function updateCrane(spec: ResolvedCrane, s: CraneState, input: CraneInput, ctx: ControlContext, autoState: { outriggerAuto: 'none' | 'deploy' | 'retract' }): ControlResult {
  const gb = spec.gb;
  const res: ControlResult = { blocked: {}, boomHit: null, outriggerBlocked: false, outriggerObstacle: false };
  const dt = ctx.dt;
  const condF = 0.8 + 0.2 * clamp(ctx.condition, 0, 1);

  if (s.tipped) {
    for (const k of Object.keys(s.vel) as Axis[]) s.vel[k] = 0;
    return res;
  }

  // --- opbouwprocedure ---
  const setupDone = s.setupProgress >= 1;
  if (!setupDone && (gb.setupType === 'selfErect' || gb.setupType === 'boomAssembly')) {
    if (input.setupHold) {
      s.setupProgress = Math.min(1, s.setupProgress + dt / Math.max(1, gb.setupTime));
      s.engine = approach(s.engine, 0.6, dt * 2);
    }
    if (gb.setupType === 'selfErect') {
      const o = clamp(s.setupProgress / 0.2, 0, 1);
      for (let i = 0; i < s.outriggerBeam.length; i++) {
        s.outriggerBeam[i] = clamp(o / 0.6, 0, 1);
        s.outriggerJack[i] = clamp((o - 0.6) / 0.4, 0, 1);
      }
    }
  }

  // --- stempels ---
  const lifting = ctx.loadAttached && ctx.loadPercent > 5;
  if (gb.outriggerCount > 0 && gb.setupType !== 'selfErect') {
    const beamRate = 1 / Math.max(0.5, gb.outriggerTime * 0.6);
    const jackRate = 1 / Math.max(0.5, gb.outriggerTime * 0.4);
    if (input.outriggerAuto) {
      autoState.outriggerAuto = s.outriggerJack.every((j) => j >= 0.999) ? 'retract' : 'deploy';
    }
    const wantsChange = autoState.outriggerAuto !== 'none' || (input.outriggerTarget !== null && (input.outriggerBeam !== 0 || input.outriggerJack !== 0));
    const drivingNow = Math.abs(s.vel.drive) > 0.01;
    if (wantsChange && (lifting || drivingNow)) {
      res.outriggerBlocked = true;
      autoState.outriggerAuto = 'none';
    } else if (autoState.outriggerAuto === 'deploy') {
      let busy = false;
      for (let i = 0; i < s.outriggerBeam.length; i++) {
        if (s.outriggerBeam[i] < 1) {
          const prev = s.outriggerBeam[i];
          s.outriggerBeam[i] = Math.min(1, prev + beamRate * dt);
          if (padBlocked(spec, s, i, ctx.colliders)) {
            s.outriggerBeam[i] = prev;
            res.outriggerObstacle = true;
          } else busy = true;
        }
      }
      if (!busy) {
        for (let i = 0; i < s.outriggerJack.length; i++) {
          if (s.outriggerJack[i] < 1) {
            s.outriggerJack[i] = Math.min(1, s.outriggerJack[i] + jackRate * dt);
            busy = true;
          }
        }
      }
      if (!busy) autoState.outriggerAuto = 'none';
      s.engine = approach(s.engine, 0.55, dt * 2);
    } else if (autoState.outriggerAuto === 'retract') {
      let busy = false;
      for (let i = 0; i < s.outriggerJack.length; i++) {
        if (s.outriggerJack[i] > 0) {
          s.outriggerJack[i] = Math.max(0, s.outriggerJack[i] - jackRate * dt);
          busy = true;
        }
      }
      if (!busy) {
        for (let i = 0; i < s.outriggerBeam.length; i++) {
          if (s.outriggerBeam[i] > 0) {
            s.outriggerBeam[i] = Math.max(0, s.outriggerBeam[i] - beamRate * dt);
            busy = true;
          }
        }
      }
      if (!busy) autoState.outriggerAuto = 'none';
      s.engine = approach(s.engine, 0.55, dt * 2);
    } else if (input.outriggerTarget !== null) {
      const targets = input.outriggerTarget < 0 ? s.outriggerBeam.map((_, i) => i) : [input.outriggerTarget];
      for (const i of targets) {
        if (i >= s.outriggerBeam.length) continue;
        if (input.outriggerBeam !== 0) {
          // uitschuiven kan alleen met opgetrokken vijzel
          if (s.outriggerJack[i] > 0.001) res.outriggerBlocked = true;
          else {
            const prev = s.outriggerBeam[i];
            s.outriggerBeam[i] = clamp(prev + input.outriggerBeam * beamRate * dt, 0, 1);
            if (s.outriggerBeam[i] > prev && padBlocked(spec, s, i, ctx.colliders)) {
              s.outriggerBeam[i] = prev;
              res.outriggerObstacle = true;
            }
          }
        }
        if (input.outriggerJack !== 0) s.outriggerJack[i] = clamp(s.outriggerJack[i] + input.outriggerJack * jackRate * dt, 0, 1);
      }
    }
  }

  // --- assen ---
  const before = cloneCraneState(s);
  const g0 = computeGeometry(spec, s);
  const cap0 = ctx.loadAttached ? allowedCapacityT(spec, s) : 0;
  const lmiActive = ctx.loadAttached && ctx.loadPercent >= 100;
  const snagged = ctx.ropeStretch > 0.25;
  const precision = input.precision ? spec.effects.precisionFactor : 1;
  const sup = supportState(spec, s);
  const commands: Record<Axis, number> = {
    luff: input.luff,
    slew: input.slew,
    hoist: input.hoist,
    tele: input.tele,
    trolley: input.trolley,
    knuckle: input.knuckle,
    knuckleTele: input.knuckleTele,
    drive: input.drive,
  };
  const loadF = 1 - 0.45 * clamp(ctx.loadPercent / 100, 0, 1);

  for (const axis of Object.keys(commands) as Axis[]) {
    let cmd = clamp(commands[axis], -1, 1);
    if (!axisApplies(spec, axis)) cmd = 0;
    if (cmd !== 0 && !setupDone && axis !== 'drive') {
      res.blocked[axis] = 'setup';
      cmd = 0;
    }
    if (axis === 'drive' && cmd !== 0) {
      if (gb.outriggerCount > 0 && gb.setupType !== 'selfErect' && !outriggersStowed(s)) {
        res.blocked.drive = 'outriggers';
        cmd = 0;
      } else if (!setupDone) {
        res.blocked.drive = 'setup';
        cmd = 0;
      } else if (ctx.loadAttached && (gb.driveWithLoadMaxPct <= 0 || ctx.loadPercent > gb.driveWithLoadMaxPct)) {
        res.blocked.drive = 'driveLoad';
        cmd = 0;
      }
    }
    // precisiemodus: de lier krijgt een echte kruipsnelheid (voor kwetsbare landingen), overige assen 25 %
    const prec = input.precision ? (axis === 'hoist' ? Math.min(precision, 0.1) * (spec.effects.precisionFactor < 0.25 ? 0.7 : 1) : precision) : 1;
    let maxV = axisMaxSpeed(spec, axis) * condF * prec;
    if (axis === 'hoist' && cmd > 0) maxV *= loadF;
    if (axis === 'drive') {
      const gi = groundAt(ctx.ground, s.baseX, ctx.groundFallback);
      const rough = spec.cfg.carrier === 'roughTerrain' || spec.cfg.carrier === 'crawler';
      maxV *= rough ? 0.5 + 0.5 * gi.driveFactor : gi.driveFactor;
      if (ctx.loadAttached) maxV *= 0.4;
    }
    // LMI / haak vast: beweging die het moment of de kabelkracht verhoogt blokkeren
    if (cmd !== 0 && (lmiActive || snagged)) {
      const cand = cloneCraneState(s);
      applyAxis(spec, cand, axis, Math.sign(cmd) * 0.05);
      const g1 = computeGeometry(spec, cand);
      let increases = false;
      if (axis === 'hoist') increases = cmd > 0;
      else if (lmiActive && axis === 'slew') increases = allowedCapacityT(spec, cand) < cap0 - 1e-6;
      if (!increases && lmiActive && axis !== 'slew') increases = g1.radius > g0.radius + 1e-6;
      if (!increases && snagged) increases = dist3(g1.tip, ctx.hookPos) > dist3(g0.tip, ctx.hookPos) + 1e-6;
      if (increases) {
        res.blocked[axis] = snagged ? 'snag' : 'lmi';
        cmd = 0;
      }
    }
    if (axis !== 'drive' && axis !== 'hoist' && cmd !== 0 && sup.mode === 'tires' && !gb.liftOnTires && ctx.loadAttached) {
      res.blocked[axis] = 'outriggers';
      cmd = 0;
    }
    const target = cmd * maxV;
    const accel = axisMaxSpeed(spec, axis) / rampTime(spec, axis);
    // bij nul-commando sneller afremmen (hydrauliek sluit), maar niet abrupt
    const rate = target === 0 || Math.sign(target) !== Math.sign(s.vel[axis]) ? accel * BRAKE_FACTOR : accel;
    s.vel[axis] = approach(s.vel[axis], target, rate * dt);
    if (res.blocked[axis] === 'lmi' || res.blocked[axis] === 'snag') {
      // LMI schakelt direct af in de gevaarlijke richting
      if (Math.sign(s.vel[axis]) === Math.sign(commands[axis])) s.vel[axis] = 0;
    }
    if (s.vel[axis] !== 0) {
      const hitLimit = applyAxis(spec, s, axis, s.vel[axis] * dt);
      if (hitLimit) {
        s.vel[axis] = 0;
        if (cmd !== 0) res.blocked[axis] = 'limit';
      }
    }
  }

  // rijden: grenzen en obstakels
  if (s.baseX !== before.baseX) {
    const half = spec.cfg.visual.carrierLength / 2;
    if (s.baseX - half < ctx.worldMinX || s.baseX + half > ctx.worldMaxX || carrierCollision(spec, s.baseX, ctx.colliders)) {
      s.baseX = before.baseX;
      s.vel.drive = 0;
      res.blocked.drive = 'driveObstacle';
    }
    s.wheelRot += (s.baseX - before.baseX) / Math.max(0.2, spec.cfg.visual.wheelRadius);
  }

  // giekbotsing: nieuwe botsing → beweging terugdraaien
  const g1 = computeGeometry(spec, s);
  const hitNow = setupDone ? boomCollision(spec, s, g1, ctx.colliders) : null;
  if (hitNow) {
    const hitBefore = boomCollision(spec, before, g0, ctx.colliders);
    if (!hitBefore) {
      const keepRope = s.ropeLength;
      Object.assign(s, { ...before, ropeLength: keepRope, outriggerBeam: s.outriggerBeam, outriggerJack: s.outriggerJack, vel: s.vel });
      for (const k of Object.keys(s.vel) as Axis[]) if (k !== 'hoist') s.vel[k] = 0;
      res.boomHit = hitNow;
    }
  }

  // motorbelasting en brandstof
  let activity = 0;
  for (const k of Object.keys(s.vel) as Axis[]) {
    const m = axisMaxSpeed(spec, k);
    if (m > 0) activity += Math.abs(s.vel[k]) / m;
  }
  const targetEngine = clamp(0.12 + activity * 0.35 + (ctx.loadPercent / 100) * 0.25 * (Math.abs(s.vel.hoist) > 0.01 ? 1 : 0.2), 0, 1);
  s.engine = approach(s.engine, targetEngine, dt * 1.5);
  s.fuelUsed += (gb.fuelRate * (0.15 + 0.85 * s.engine) * dt) / 3600;
  return res;
}

/**
 * Kantelgedrag uit het stabiliteitsmodel: boven K = 1 begint de kraan te kantelen;
 * onder de grens veert een kleine kanteling terug. Voorbij 3° is kantelen onomkeerbaar.
 */
export function updateTilt(s: CraneState, tippingRatio: number, dt: number, tippingEnabled: boolean): void {
  const IRREVERSIBLE = 3 * DEG;
  if (!tippingEnabled) {
    s.tilt = approach(s.tilt, 0, dt * 0.2);
    s.tiltVel = 0;
    return;
  }
  if (s.tipped || s.tilt > IRREVERSIBLE) {
    s.tipped = true;
    s.tiltVel += (0.6 + s.tilt * 3) * dt;
    s.tilt = Math.min(s.tilt + s.tiltVel * dt, 28 * DEG);
    return;
  }
  if (tippingRatio > 1) {
    s.tiltVel += (tippingRatio - 1) * 1.8 * dt;
  } else {
    s.tiltVel -= (1 - tippingRatio) * 0.8 * dt + s.tiltVel * 3 * dt;
  }
  s.tilt = Math.max(0, s.tilt + s.tiltVel * dt);
  if (s.tilt === 0) s.tiltVel = Math.max(0, s.tiltVel);
}
