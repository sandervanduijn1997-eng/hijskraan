import { getCrane } from '../cranes/config/cranes';
import type { CraneId, UpgradeId } from '../cranes/config/types';
import type { CraneInput } from '../cranes/controllers/craneInput';
import { emptyInput } from '../cranes/controllers/craneInput';
import type { ControlResult } from '../cranes/controllers/craneController';
import { outriggerPad, updateCrane, updateTilt } from '../cranes/controllers/craneController';
import type { SupportState } from '../cranes/models/capacity';
import { allowedCapacityT, stabilityMasses, supportState } from '../cranes/models/capacity';
import type { ResolvedCrane } from '../cranes/models/craneSpec';
import { resolveCrane } from '../cranes/models/craneSpec';
import type { CraneState } from '../cranes/models/craneState';
import { createCraneState } from '../cranes/models/craneState';
import type { CraneGeometry } from '../cranes/models/kinematics';
import { computeGeometry } from '../cranes/models/kinematics';
import type { LoadType } from '../missions/data/loads';
import { getLoad } from '../missions/data/loads';
import type { MissionDef, PlaceEffect, TaskDef, ZoneDef } from '../missions/data/types';
import { buildColliders } from '../missions/runtime/buildWorld';
import type { ScoreBreakdown, ScoreMetrics } from '../missions/runtime/scoring';
import { computeScore, emptyMetrics } from '../missions/runtime/scoring';
import type { PlacementCheck } from '../missions/validation/placement';
import { checkPlacement } from '../missions/validation/placement';
import { createRope, ropeAngles } from '../physics/cable/rope';
import type { RopeState } from '../physics/cable/rope';
import type { Collider } from '../physics/collision/colliders';
import type { ContactBody } from '../physics/collision/contacts';
import { rangesOverlap, segmentIntersectsRect, quadBounds } from '../physics/collision/geometry';
import { AIR_DENSITY, FIXED_DT, GRAVITY, SUBSTEPS } from '../physics/constants';
import { groundFactorFor } from '../physics/ground';
import type { RigidBody } from '../physics/load/rigidBody';
import { apexWorld, bodyQuad, createBoxBody, setBodyMass, wakeBody } from '../physics/load/rigidBody';
import type { StabilityResult } from '../physics/stability/stability';
import { computeStability } from '../physics/stability/stability';
import { loadPercent } from '../physics/stability/loadChart';
import { sampleWind } from '../physics/wind';
import type { WindSample } from '../physics/wind';
import { PhysicsWorld, defaultPhysicsParams } from '../physics/world';
import type { Vec3 } from '../utils/math';
import { DEG, RAD, clamp, hashString } from '../utils/math';
import type { DifficultyProfile } from './difficulty';
import { DIFFICULTIES } from './difficulty';
import type { Warning } from './warnings';
import { WarningTracker } from './warnings';

export type LoadStatus = 'resting' | 'attached' | 'placed' | 'consumed';

export interface LoadRuntime {
  id: string;
  type: LoadType;
  cb: ContactBody;
  status: LoadStatus;
  damage: number;
}

export type TaskStatus = 'pending' | 'active' | 'done';

export interface TaskRuntime {
  def: TaskDef;
  status: TaskStatus;
  hold: number;
  label: string;
}

export type SimEvent =
  | { type: 'impact'; x: number; y: number; speed: number; mass: number; landing: boolean; obstacle: boolean }
  | { type: 'attach' }
  | { type: 'detach' }
  | { type: 'placed'; loadId: string }
  | { type: 'boomHit'; x: number; y: number }
  | { type: 'taskComplete'; index: number }
  | { type: 'success' }
  | { type: 'fail'; reason: string }
  | { type: 'lmiCutoff' }
  | { type: 'warning'; warning: Warning };

export interface SimOptions {
  mission: MissionDef;
  craneId?: CraneId;
  upgrades?: UpgradeId[];
  difficulty?: DifficultyProfile;
  condition?: number;
  counterweightIndex?: number;
  boomOptionIndex?: number;
  jibIndex?: number;
  gravity?: number;
  freePlay?: boolean;
}

export type MissionOutcome = 'running' | 'success' | 'failed';

/** Snapshot voor render-interpolatie. */
export interface BodySnapshot {
  x: number;
  y: number;
  z: number;
  angle: number;
}

const HOOK_ID = '__hook__';
const ATTACH_DIST = 1.1;

export class Simulation {
  readonly mission: MissionDef;
  readonly spec: ResolvedCrane;
  readonly difficulty: DifficultyProfile;
  readonly crane: CraneState;
  geom: CraneGeometry;
  readonly world: PhysicsWorld;
  readonly rope: RopeState;
  colliders: Collider[];
  readonly missionColliders: Collider[];
  private craneCollKey = '';
  readonly loads: LoadRuntime[] = [];
  readonly tasks: TaskRuntime[];
  readonly warnings = new WarningTracker();
  readonly events: SimEvent[] = [];
  readonly metrics: ScoreMetrics;
  readonly freePlay: boolean;
  readonly seed: number;
  hookBody: ContactBody | null = null;
  attached: LoadRuntime | null = null;
  readonly hookMassKg: number;
  readonly hookH: number;
  readonly hookW: number;
  time = 0;
  wind: WindSample = { x: 0, z: 0, speed: 0 };
  tensionF = 0;
  loadPct = 0;
  capacityT = 0;
  stability: StabilityResult | null = null;
  support: SupportState;
  groundFactor = 1;
  outcome: MissionOutcome = 'running';
  failReason = '';
  score: ScoreBreakdown | null = null;
  lastControl: ControlResult = { blocked: {}, boomHit: null, outriggerBlocked: false, outriggerObstacle: false };
  swayDeg = 0;
  /** Verwachte slingerrichting (−1/0/1 langs x). */
  swayDir = 0;
  placementHint: PlacementCheck | null = null;
  condition: number;
  readonly outriggerAuto = { outriggerAuto: 'none' as 'none' | 'deploy' | 'retract' };
  private overloadTimer = 0;
  private liftViolationLatched = false;
  private groundViolationLatched = false;
  private ropeContactLatched = false;
  private boomHitLatched = false;
  private liftSettle = 0;
  prevSnap = new Map<string, BodySnapshot>();
  prevTip: Vec3;

  constructor(opt: SimOptions) {
    this.mission = opt.mission;
    this.freePlay = opt.freePlay ?? false;
    const craneId = opt.craneId ?? opt.mission.craneOptions[0];
    this.spec = resolveCrane(getCrane(craneId), opt.upgrades ?? []);
    this.difficulty = opt.difficulty ?? DIFFICULTIES.normal;
    this.condition = opt.condition ?? 1;
    this.seed = hashString(opt.mission.id);
    const start = { ...opt.mission.crane };
    if (opt.counterweightIndex !== undefined) start.counterweightIndex = opt.counterweightIndex;
    if (opt.boomOptionIndex !== undefined) start.boomOptionIndex = opt.boomOptionIndex;
    if (opt.jibIndex !== undefined) start.jibIndex = opt.jibIndex;
    this.crane = createCraneState(this.spec, start);
    this.geom = computeGeometry(this.spec, this.crane);
    this.prevTip = { ...this.geom.tip };

    const params = defaultPhysicsParams();
    params.gravity = opt.gravity ?? GRAVITY;
    params.swayDamping = this.difficulty.swayDamping + this.spec.effects.extraSwayDamping;
    this.world = new PhysicsWorld(params);
    this.missionColliders = buildColliders(opt.mission.obstacles);
    this.colliders = this.missionColliders;
    this.refreshCraneColliders();

    this.hookMassKg = this.spec.gb.hookMassKg;
    this.hookW = 0.35 + 0.12 * Math.cbrt(this.hookMassKg / 100);
    this.hookH = this.hookW * 1.4;
    this.rope = createRope(this.geom.tip, this.crane.ropeLength, this.spec.gb.ropeMin, this.spec.gb.ropeMax);

    for (const sp of opt.mission.loads) {
      const type = getLoad(sp.type);
      const body = createBoxBody({
        mass: type.massKg,
        width: type.width,
        height: type.height,
        depth: type.depth,
        x: sp.x,
        y: sp.y,
        z: sp.z ?? 0,
        angle: (sp.angleDeg ?? 0) * DEG,
        comOffsetX: type.comOffsetX,
        apexHeight: type.slingHeight,
        dragCoeff: type.dragCoeff,
      });
      const cb = this.world.addBody(sp.id, body);
      this.loads.push({ id: sp.id, type, cb, status: 'resting', damage: 0 });
    }

    const startAttached = opt.mission.loads.find((l) => l.attached);
    if (startAttached) {
      const lr = this.loads.find((l) => l.id === startAttached.id)!;
      this.attachLoad(lr, true);
    } else {
      this.spawnHook();
    }

    this.tasks = opt.mission.tasks.map((t) => ({ def: t, status: 'pending' as TaskStatus, hold: 0, label: taskLabel(t, opt.mission) }));
    this.metrics = emptyMetrics(opt.mission.parTime, (this.spec.gb.fuelRate * opt.mission.parTime) / 3600 * 0.45);
    this.support = supportState(this.spec, this.crane);
    this.updateTasks(0);
    this.snapshot();
  }

  // ---------------------------------------------------------------- eigen kraandelen als botsingsobject

  /** Onderwagen (landbaar dek) en, voor torenkranen, de mast. */
  craneOwnColliders(): Collider[] {
    const cfg = this.spec.cfg;
    const gb = this.spec.gb;
    const x = this.crane.baseX;
    const half = cfg.visual.carrierLength / 2;
    const out: Collider[] = [];
    const mk = (id: string, minX: number, maxX: number, minY: number, maxY: number, z: number, landable: boolean): Collider => ({
      id, kind: 'crane', minX, maxX, minY, maxY, minZ: -z, maxZ: z, onHit: 'damage', landable, label: 'de eigen kraan',
    });
    if (cfg.carrier === 'towerBase') {
      out.push(mk('own-mast', x - 1, x + 1, 0, (gb.towerHeight ?? 30) - 3, 1, false));
    } else if (cfg.carrier === 'selfErecting') {
      out.push(mk('own-base', x - half, x + half, 0, cfg.visual.carrierHeight, 2.2, false));
      if (this.crane.setupProgress >= 1) out.push(mk('own-mast', x - 0.7, x + 0.7, cfg.visual.carrierHeight, (gb.towerHeight ?? 20) - 2, 0.7, false));
    } else {
      out.push(mk('own-carrier', x - half, x + half, 0, cfg.visual.carrierHeight, 1.3, true));
    }
    return out;
  }

  private refreshCraneColliders(): void {
    const key = `${this.crane.baseX.toFixed(3)}|${this.crane.setupProgress >= 1}`;
    if (key === this.craneCollKey) return;
    this.craneCollKey = key;
    this.colliders = [...this.missionColliders, ...this.craneOwnColliders()];
    this.world.setColliders(this.colliders);
  }

  // ---------------------------------------------------------------- haak & lasten

  private spawnHook(at?: { x: number; y: number; z: number }): void {
    const tip = this.geom.tip;
    let topY = at ? at.y : tip.y - this.rope.length;
    if (topY - this.hookH < 0.05) topY = this.hookH + 0.05;
    const x = at ? at.x : tip.x;
    const z = at ? at.z : tip.z;
    const body = createBoxBody({ mass: this.hookMassKg, width: this.hookW, height: this.hookH, depth: this.hookW, x, y: topY - this.hookH, z, apexHeight: 0.02, dragCoeff: 1 });
    this.hookBody = this.world.addBody(HOOK_ID, body);
    this.world.ropeBody = this.hookBody;
    const a = apexWorld(body);
    const d = Math.hypot(a.x - tip.x, a.y - tip.y, a.z - tip.z);
    this.rope.length = clamp(Math.max(this.rope.length, d), this.spec.gb.ropeMin, this.spec.gb.ropeMax);
    this.crane.ropeLength = this.rope.length;
  }

  /** Haakpunt (onderkant haakblok) of het ophangpunt van de aangeslagen last. */
  hookPoint(): Vec3 {
    if (this.attached) {
      const b = this.attached.cb.body;
      const a = apexWorld(b);
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      return { x: a.x + s * this.hookH, y: a.y - c * this.hookH, z: a.z };
    }
    if (this.hookBody) {
      const b = this.hookBody.body;
      const p = { x: b.pos.x + Math.sin(b.angle) * b.halfH, y: b.pos.y - Math.cos(b.angle) * b.halfH, z: b.pos.z };
      return p;
    }
    return { ...this.geom.tip };
  }

  /** Ophangpunt van de kabel op het lichaam (bovenkant haakblok). */
  ropeAttachPoint(): Vec3 {
    const rb = this.world.ropeBody;
    return rb ? apexWorld(rb.body) : { ...this.geom.tip };
  }

  /** Hijspunt (bovenkant stroppen) van een last in wereldcoördinaten. */
  slingPoint(l: LoadRuntime): Vec3 {
    const b = l.cb.body;
    const ly = b.boxOffset.y + b.halfH + l.type.slingHeight;
    const c = Math.cos(b.angle);
    const s = Math.sin(b.angle);
    const lx = b.boxOffset.x;
    return { x: b.pos.x + lx * c - ly * s, y: b.pos.y + lx * s + ly * c, z: b.pos.z };
  }

  /** De dichtstbijzijnde last die aangeslagen kan worden. */
  attachCandidate(): LoadRuntime | null {
    if (this.attached || !this.hookBody) return null;
    const hp = this.hookPoint();
    let best: LoadRuntime | null = null;
    let bestD = Infinity;
    for (const l of this.loads) {
      if (l.status === 'consumed') continue;
      const sp = this.slingPoint(l);
      const dxy = Math.hypot(sp.x - hp.x, sp.y - hp.y);
      if (dxy < ATTACH_DIST && Math.abs(sp.z - hp.z) < 1.4 && dxy < bestD) {
        best = l;
        bestD = dxy;
      }
    }
    return best;
  }

  private attachLoad(l: LoadRuntime, initial = false): void {
    if (this.hookBody) {
      this.world.removeBody(this.hookBody);
      this.hookBody = null;
    }
    const b = l.cb.body;
    b.apex = { x: b.apex.x, y: b.boxOffset.y + b.halfH + l.type.slingHeight + this.hookH };
    setBodyMass(b, l.type.massKg + this.hookMassKg, this.hookMassKg * (b.apex.x * b.apex.x + b.apex.y * b.apex.y));
    l.cb.extraPoints = [{ x: b.apex.x, y: b.apex.y - this.hookH }];
    b.frozen = false;
    wakeBody(b);
    l.status = 'attached';
    this.attached = l;
    this.world.ropeBody = l.cb;
    const a = apexWorld(b);
    const tip = this.geom.tip;
    const d = Math.hypot(a.x - tip.x, a.y - tip.y, a.z - tip.z);
    // kabellengte afstemmen op de werkelijke afstand: geen ruk of sprong bij het aanslaan
    this.rope.length = clamp(initial ? d : Math.max(d, this.spec.gb.ropeMin), this.spec.gb.ropeMin, this.spec.gb.ropeMax);
    this.crane.ropeLength = this.rope.length;
    if (!initial) this.events.push({ type: 'attach' });
  }

  private detachLoad(placed: boolean): void {
    const l = this.attached;
    if (!l) return;
    const b = l.cb.body;
    const hookAt = apexWorld(b);
    b.apex = { x: b.apex.x, y: b.boxOffset.y + b.halfH + l.type.slingHeight };
    setBodyMass(b, l.type.massKg);
    l.cb.extraPoints = [];
    l.status = placed ? 'placed' : 'resting';
    this.attached = null;
    this.world.ropeBody = null;
    this.spawnHook({ x: hookAt.x, y: hookAt.y + 0.15, z: hookAt.z });
    this.events.push({ type: 'detach' });
  }

  /** Aanslaan / afkoppelen (toets T). Geeft een melding terug. */
  toggleRigging(): string {
    if (this.outcome !== 'running') return '';
    if (this.attached) {
      const l = this.attached;
      const supported = l.cb.supports.size > 0 || l.cb.body.sleeping;
      if (!supported || this.tensionF > l.type.massKg * GRAVITY * 0.5) return 'Afkoppelen kan pas als de last veilig staat en de kabel ontlast is.';
      this.detachLoad(false);
      return 'Last afgekoppeld.';
    }
    const c = this.attachCandidate();
    if (!c) return 'Geen last binnen bereik van de haak.';
    if (c.status === 'placed') {
      // geplaatste last mag opnieuw worden opgepakt; de taak gaat dan terug naar actief
      for (const t of this.tasks) if (t.def.type === 'deliver' && t.def.loadId === c.id && t.status === 'done') t.status = 'pending';
    }
    this.attachLoad(c);
    return `${c.type.name} aangeslagen.`;
  }

  // ---------------------------------------------------------------- stap

  snapshot(): void {
    for (const cb of this.world.bodies) {
      const b = cb.body;
      const s = this.prevSnap.get(cb.id);
      if (s) {
        s.x = b.pos.x;
        s.y = b.pos.y;
        s.z = b.pos.z;
        s.angle = b.angle;
      } else this.prevSnap.set(cb.id, { x: b.pos.x, y: b.pos.y, z: b.pos.z, angle: b.angle });
    }
    this.prevTip = { ...this.geom.tip };
  }

  step(input: CraneInput = emptyInput(), dt = FIXED_DT): void {
    this.snapshot();
    if (this.outcome !== 'running' && !this.crane.tipped) {
      // na afloop blijft de wereld nog uitlopen, maar zonder besturing
      input = emptyInput();
    }
    this.time += dt;
    this.warnings.begin();

    // wind
    this.wind = sampleWind(this.mission.wind, this.time, this.seed % 1000, this.difficulty.windScale);
    this.world.wind.x = this.wind.x;
    this.world.wind.z = this.wind.z;

    // kraanbesturing
    const tipStart = { ...this.geom.tip };
    const lengthStart = this.rope.length;
    const hookPos = this.ropeAttachPoint();
    const ctl = updateCrane(this.spec, this.crane, input, {
      dt,
      colliders: this.colliders,
      ground: this.mission.ground ?? [],
      groundFallback: this.mission.groundFallback,
      loadPercent: this.loadPct,
      loadAttached: this.attached !== null,
      hookPos,
      ropeStretch: this.rope.stretch,
      worldMinX: this.mission.bounds.minX,
      worldMaxX: this.mission.bounds.maxX,
      condition: this.condition,
    }, this.outriggerAuto);
    this.lastControl = ctl;
    if (ctl.blocked.hoist === 'lmi' || ctl.blocked.luff === 'lmi' || ctl.blocked.tele === 'lmi' || ctl.blocked.trolley === 'lmi') {
      if (!this.warnings.has('overload')) this.events.push({ type: 'lmiCutoff' });
    }
    this.rope.length = this.crane.ropeLength;
    this.refreshCraneColliders();
    this.geom = computeGeometry(this.spec, this.crane);
    this.rope.tip = { ...this.geom.tip };

    // fysica
    this.world.step(dt, SUBSTEPS, this.rope, tipStart, lengthStart);

    // meten: kabelkracht, belasting, stabiliteit
    const k = 1 - Math.exp(-dt / 0.25);
    this.tensionF += (this.rope.tension - this.tensionF) * k;
    this.support = supportState(this.spec, this.crane);
    this.capacityT = allowedCapacityT(this.spec, this.crane);
    const loadT = this.tensionF / GRAVITY / 1000;
    this.loadPct = Math.min(999, loadPercent(loadT, this.capacityT));
    this.computeStabilityModel();
    updateTilt(this.crane, this.stability?.tippingRatio ?? 0, dt, this.difficulty.tipping && !this.spec.gb.anchored);

    this.processImpacts(ctl);
    this.measure(dt);
    this.evaluateWarnings(ctl);
    for (const w of this.warnings.end(dt)) this.events.push({ type: 'warning', warning: w });
    if (this.warnings.anyCritical() && this.attached) this.metrics.criticalWarningTime += dt;
    this.updateTasks(dt);
    this.checkFailure(dt);
  }

  private computeStabilityModel(): void {
    const gb = this.spec.gb;
    const xs: number[] = [];
    if (this.support.mode !== 'tires' && gb.outriggerCount > 0) {
      for (let i = 0; i < gb.outriggerCount; i++) xs.push(outriggerPad(this.spec, this.crane, i).x);
    } else {
      const half = this.spec.cfg.visual.carrierLength / 2;
      xs.push(this.crane.baseX - half * 0.8, this.crane.baseX + half * 0.8);
    }
    this.groundFactor = groundFactorFor(this.mission.ground ?? [], xs, this.spec.effects.groundBonus, this.mission.groundFallback);
    if (gb.anchored) {
      this.stability = null;
      return;
    }
    const hook = this.ropeAttachPoint();
    const tip = this.geom.tip;
    const c = Math.cos(this.crane.slew);
    const s = Math.sin(this.crane.slew);
    const du = (hook.x - tip.x) * c + (hook.z - tip.z) * s;
    const dy = Math.max(0.1, tip.y - hook.y);
    const windOnBoom = 0.5 * AIR_DENSITY * 1.2 * this.geom.displayBoomLength * 0.9 * this.wind.speed * this.wind.speed * (this.geom.tipHeight / 2);
    this.stability = computeStability({
      masses: stabilityMasses(this.spec, this.crane),
      footprint: this.support.footprint,
      slew: this.crane.slew,
      tipRadius: this.geom.tipU,
      tipHeight: this.geom.tipHeight,
      boomT: this.geom.boomMassT,
      boomCogRadius: this.geom.boomCogRadius,
      ropeTension: this.tensionF,
      ropeOutwardAngle: Math.atan2(du, dy),
      groundFactor: this.groundFactor,
      slope: (this.mission.slopeDeg ?? 0) * DEG,
      windMoment: windOnBoom,
    });
  }

  private loadById(id: string): LoadRuntime | undefined {
    return this.loads.find((l) => l.id === id);
  }

  private processImpacts(ctl: ControlResult): void {
    const ds = this.difficulty.damageScale;
    for (const e of this.world.impacts) {
      if (e.speed < 0.08) continue;
      const isHook = e.bodyId === HOOK_ID;
      const l = isHook ? undefined : this.loadById(e.bodyId);
      const other = this.colliders.find((c) => c.id === e.otherId);
      const otherLoad = this.loadById(e.otherId);
      const mass = l ? l.cb.body.mass : this.hookMassKg;
      const landingSurface = e.otherId === 'ground' || (other?.landable ?? false) || !!otherLoad;
      const isLanding = e.landing && landingSurface;
      this.events.push({ type: 'impact', x: e.x, y: e.y, speed: e.speed, mass, landing: isLanding, obstacle: !!other && !isLanding });
      if (isHook) {
        if (other && !isLanding && e.speed > 0.25) {
          this.metrics.collisions++;
          this.metrics.damage += 0.5 * ds;
          if (other.onHit === 'fail' || this.mission.requirements.noCollision) this.fail(`Haak raakte ${other.label ?? 'een obstakel'}.`);
        }
        continue;
      }
      if (!l) continue;
      if (isLanding) {
        const lim = l.type.landingSpeedLimit;
        if (e.speed > lim) {
          const dmg = (e.speed - lim) * 40 * (0.5 + l.type.fragility) * ds;
          l.damage += dmg;
          this.metrics.damage += dmg;
        }
      } else if (other || otherLoad) {
        if (e.speed > 0.15) {
          this.metrics.collisions++;
          const dmg = (2 + e.speed * 25) * (0.5 + l.type.fragility) * ds;
          l.damage += dmg;
          this.metrics.damage += dmg;
          if (other && (other.onHit === 'fail' || this.mission.requirements.noCollision)) {
            this.fail(`Botsing met ${other.label ?? 'een obstakel'} — deze opdracht staat geen contact toe.`);
          }
        }
      }
    }
    if (ctl.boomHit) {
      if (!this.boomHitLatched) {
        this.boomHitLatched = true;
        this.metrics.collisions++;
        this.metrics.damage += 4 * ds;
        this.events.push({ type: 'boomHit', x: this.geom.tip.x, y: this.geom.tip.y });
        if (ctl.boomHit.onHit === 'fail' || this.mission.requirements.noCollision) this.fail(`De giek raakte ${ctl.boomHit.label ?? 'een obstakel'}.`);
      }
    } else this.boomHitLatched = false;
    this.metrics.damage = Math.round(this.metrics.damage * 100) / 100;
  }

  private loadLifted(): boolean {
    const l = this.attached;
    return !!l && l.cb.supports.size === 0 && this.tensionF > l.type.massKg * GRAVITY * 0.7;
  }

  private measure(dt: number): void {
    const m = this.metrics;
    m.time = this.time;
    m.fuelUsed = this.crane.fuelUsed;
    const tip = this.geom.tip;
    const hook = this.ropeAttachPoint();
    const ang = ropeAngles(tip, hook);
    this.swayDeg = this.rope.slack ? 0 : ang.total * RAD;
    const rb = this.world.ropeBody?.body;
    const rel = rb ? rb.vel.x - (this.geom.tip.x - this.prevTip.x) / dt : 0;
    this.swayDir = Math.abs(rel) < 0.05 ? 0 : Math.sign(rel);
    const lifted = this.loadLifted();
    if (this.attached) {
      m.maxLoadPct = Math.max(m.maxLoadPct, this.loadPct);
      if (this.loadPct > 100) m.overloadTime += dt;
    }
    if (lifted) {
      this.liftSettle += dt;
      if (this.liftSettle > 1.5) {
        m.maxSwayDeg = Math.max(m.maxSwayDeg, this.swayDeg);
        m.peakLiftPct = Math.max(m.peakLiftPct, this.loadPct);
      }
    } else this.liftSettle = 0;
  }

  private evaluateWarnings(ctl: ControlResult): void {
    const W = this.warnings;
    const gb = this.spec.gb;
    const lifted = this.loadLifted();
    const req = this.mission.requirements;
    if (this.crane.tilt > 0.2 * DEG || this.crane.tipped) W.raise('tipping', 'critical', 'KRAAN KANTELT — last direct laten zakken!');
    if (this.attached && this.loadPct >= 100) W.raise('overload', 'critical', `Last te zwaar: ${Math.round(this.loadPct)} % — lastmomentbegrenzer blokkeert`);
    else if (this.attached && this.loadPct >= 90) W.raise('highLoad', 'caution', `Hoge belasting: ${Math.round(this.loadPct)} %`);
    if (this.stability && this.stability.tippingRatio > 0.85 && this.attached) W.raise('stability', 'critical', `Stabiliteitsmarge kritiek (${Math.round((1 - this.stability.tippingRatio) * 100)} %)`);
    const needsOutriggers = gb.outriggerCount > 0 && gb.setupType !== 'selfErect' && (!gb.liftOnTires || req.outriggers);
    if (needsOutriggers && this.support.mode !== 'outriggers' && (this.attached || ctl.blocked.luff === 'outriggers')) {
      W.raise('outriggers', this.attached ? 'critical' : 'caution', this.support.mode === 'partial' ? 'Stempels niet volledig uitgeschoven — beperkt lastdiagram' : 'Stempels niet (volledig) uitgezet');
    }
    if (needsOutriggers && lifted && this.support.mode === 'tires' && req.outriggers && !this.liftViolationLatched) {
      this.liftViolationLatched = true;
      this.metrics.safetyViolations++;
      if (this.difficulty.strictOutriggers) this.fail('Gehesen zonder volledig uitgezette stempels.');
    }
    if (this.attached && !lifted && this.capacityT > 0) {
      const need = (this.attached.type.massKg + this.hookMassKg) / 1000;
      if (need > this.capacityT) W.raise('unsafeRadius', 'caution', `Onveilige werkstraal: hier max. ${this.capacityT.toFixed(1)} t toegestaan`);
    }
    if (this.rope.stretch > 0.25) W.raise('snag', 'critical', 'Last zit vast — kabel staat onder overspanning');
    if (ctl.boomHit) W.raise('boomHit', 'critical', 'Giek raakt een obstakel!');
    // kabel door obstakel
    const tip = this.geom.tip;
    const ap = this.ropeAttachPoint();
    let ropeHit: Collider | null = null;
    for (const c of this.colliders) {
      if (c.kind === 'crane') continue;
      if (!rangesOverlap(Math.min(tip.z, ap.z) - 0.1, Math.max(tip.z, ap.z) + 0.1, c.minZ, c.maxZ)) continue;
      if (segmentIntersectsRect(tip.x, tip.y, ap.x, ap.y + 0.3, c, 0.03)) {
        ropeHit = c;
        break;
      }
    }
    if (ropeHit) {
      W.raise('ropeContact', 'critical', `Kabel raakt ${ropeHit.label ?? 'een obstakel'}`);
      if (!this.ropeContactLatched) {
        this.ropeContactLatched = true;
        this.metrics.collisions++;
        this.metrics.damage += 1 * this.difficulty.damageScale;
      }
    } else this.ropeContactLatched = false;
    // botsingsgevaar
    const rb = this.world.ropeBody;
    if (rb && !this.rope.slack) {
      const b = rb.body;
      const speed = Math.hypot(b.vel.x, b.vel.y);
      const range = this.spec.effects.advancedWarnings ? 2.5 : 1.0;
      if (speed > 0.15) {
        const bb = quadBounds(bodyQuad(b));
        for (const c of this.colliders) {
          if (c.kind === 'crane' || (c.landable && bb.minY >= c.maxY - 0.2)) continue;
          if (!rangesOverlap(b.pos.z - b.depth / 2, b.pos.z + b.depth / 2, c.minZ, c.maxZ)) continue;
          const dx = Math.max(c.minX - bb.maxX, bb.minX - c.maxX, 0);
          const dy = Math.max(c.minY - bb.maxY, bb.minY - c.maxY, 0);
          if (Math.hypot(dx, dy) < range && Math.hypot(dx, dy) > 0.001) {
            W.raise('collisionRisk', 'caution', `Botsingsgevaar: ${c.label ?? 'obstakel'} dichtbij`);
            break;
          }
        }
      }
    }
    const swayLimit = req.maxSwayDeg ?? 6;
    if (lifted && this.swayDeg > swayLimit) W.raise('sway', this.swayDeg > swayLimit * 1.6 ? 'critical' : 'caution', `Te veel slingering: ${this.swayDeg.toFixed(1)}°`);
    if (this.wind.speed > 12) W.raise('wind', this.wind.speed > 16 ? 'critical' : 'caution', `Harde wind: ${this.wind.speed.toFixed(1)} m/s — beperk het lastoppervlak`);
    const minGF = req.minGroundFactor ?? 0.6;
    if ((this.attached || this.support.mode !== 'tires') && this.groundFactor < minGF) {
      W.raise('ground', 'caution', `Ondergrond te zwak (factor ${this.groundFactor.toFixed(2)}) — kies een stevigere plek`);
      if (lifted && req.minGroundFactor && !this.groundViolationLatched) {
        this.groundViolationLatched = true;
        this.metrics.safetyViolations++;
      }
    }
    if (ctl.outriggerObstacle) W.raise('outriggerObstacle', 'caution', 'Stempel raakt een obstakel — kan niet verder uitschuiven');
    if (ctl.blocked.drive === 'outriggers') W.raise('driveBlocked', 'info', 'Rijden kan pas met volledig ingehaalde stempels');
    else if (ctl.blocked.drive === 'driveLoad') W.raise('driveBlocked', 'info', 'Rijden met deze last is niet toegestaan');
    else if (ctl.blocked.drive === 'driveObstacle') W.raise('driveBlocked', 'info', 'Obstakel of wereldgrens: kan niet verder rijden');
    if (this.crane.setupProgress < 1 && (gb.setupType === 'selfErect' || gb.setupType === 'boomAssembly')) {
      W.raise('setup', 'info', gb.setupType === 'selfErect' ? 'Kraan nog niet opgebouwd — houd B ingedrukt om de opbouwprocedure uit te voeren' : 'Giek nog niet gemonteerd — houd B ingedrukt voor de giekmontage');
    }
    if (this.placementHint && !this.placementHint.valid && this.attached && !lifted && this.rope.slack) {
      W.raise('landing', 'caution', `Onjuiste landingspositie: ${this.placementHint.reasons[0]}`);
    }
  }

  /** Actieve taken bepalen en voortgang controleren. */
  private updateTasks(dt: number): void {
    if (this.outcome !== 'running') return;
    // actieve set bepalen
    let firstOpen = this.tasks.findIndex((t) => t.status !== 'done');
    for (const t of this.tasks) if (t.status === 'active') t.status = 'pending';
    if (firstOpen < 0) {
      this.succeed();
      return;
    }
    const ordered = this.mission.requirements.ordered ?? false;
    const active: TaskRuntime[] = [];
    if (this.tasks[firstOpen].def.type !== 'deliver') active.push(this.tasks[firstOpen]);
    else {
      for (let i = firstOpen; i < this.tasks.length; i++) {
        const t = this.tasks[i];
        if (t.def.type !== 'deliver') break;
        if (t.status === 'done') continue;
        active.push(t);
        if (ordered) break;
      }
    }
    for (const t of active) t.status = 'active';
    this.placementHint = null;

    for (const t of active) {
      const d = t.def;
      let ok = false;
      switch (d.type) {
        case 'drive':
          ok = this.crane.baseX >= d.x0 && this.crane.baseX <= d.x1 && Math.abs(this.crane.vel.drive) < 0.05;
          break;
        case 'outriggers':
          ok = this.support.mode === 'outriggers';
          break;
        case 'setup':
          ok = this.crane.setupProgress >= 1;
          break;
        case 'stow': {
          const gb = this.spec.gb;
          if (this.spec.cfg.kind === 'tower') ok = this.crane.trolley <= (gb.trolleyMin ?? 0) + 1 && this.crane.ropeLength <= gb.ropeMin + 2;
          else ok = this.crane.boomAngle <= (gb.boomAngleMinDeg + 4) * DEG && this.crane.ropeLength <= gb.ropeMin + 3 && !this.attached && (this.spec.cfg.kind !== 'telescopic' || this.crane.boomLength <= gb.boomMin + 0.5);
          break;
        }
        case 'deliver': {
          const l = this.loadById(d.loadId);
          const zone = this.mission.zones.find((z) => z.id === d.zoneId);
          if (!l || !zone || l.status === 'consumed') break;
          const supported = l.cb.supports.size > 0 || l.cb.body.sleeping;
          const pc = checkPlacement(l.cb.body, zone, supported && this.validSupport(l, zone));
          const slackEnough = l !== this.attached || this.tensionF < l.type.massKg * GRAVITY * 0.15;
          if (!slackEnough && pc.valid) pc.reasons.push('kabel nog belast — vier de kabel');
          const valid = pc.valid && slackEnough;
          if (l === this.attached || this.placementHint === null) this.placementHint = { ...pc, valid };
          if (valid) {
            t.hold += dt;
            if (t.hold >= 1.5) {
              ok = true;
              this.metrics.placementErrors.push(pc.error);
              if (l === this.attached) this.detachLoad(true);
              l.status = 'placed';
              this.applyEffect(l, d.effect);
              this.events.push({ type: 'placed', loadId: l.id });
            }
          } else t.hold = 0;
          break;
        }
      }
      if (ok) {
        t.status = 'done';
        this.events.push({ type: 'taskComplete', index: this.tasks.indexOf(t) });
      }
    }
    // als er een taak buiten de volgorde is geplaatst: melding
    if (ordered) {
      for (const t of this.tasks) {
        if (t.def.type !== 'deliver' || t.status !== 'pending') continue;
        const l = this.loadById(t.def.loadId);
        const zone = this.mission.zones.find((z) => z.id === (t.def as { zoneId: string }).zoneId);
        if (l && zone && l.status !== 'consumed' && l.cb.supports.size > 0 && Math.abs(l.cb.body.pos.x - zone.x) < zone.tolerance + 0.5) {
          this.warnings.raise('order', 'caution', 'Verkeerde volgorde — deze last is nog niet aan de beurt');
        }
      }
    }
    firstOpen = this.tasks.findIndex((t) => t.status !== 'done');
    if (firstOpen < 0) this.succeed();
  }

  /** De last mag niet "door" het doelvlak zijn geduwd: hij moet op de grond, een landbaar vlak of een andere last steunen. */
  private validSupport(l: LoadRuntime, zone: ZoneDef): boolean {
    if (l.cb.body.sleeping) return true;
    for (const sid of l.cb.supports) {
      if (sid === 'ground' && zone.y < 0.2) return true;
      const c = this.colliders.find((cc) => cc.id === sid);
      if (c && c.landable && Math.abs(c.maxY - zone.y) < 0.25) return true;
      if (this.loadById(sid)) return true;
    }
    return false;
  }

  private applyEffect(l: LoadRuntime, effect: PlaceEffect | undefined): void {
    if (!effect) return;
    if (effect.type === 'addCounterweight') this.crane.extraCounterweightT += effect.massT;
    if (effect.type === 'consume' || (effect.type === 'addCounterweight' && effect.consume)) {
      l.status = 'consumed';
      this.world.removeBody(l.cb);
    }
  }

  private checkFailure(dt: number): void {
    if (this.outcome !== 'running') return;
    if (this.crane.tipped) return this.fail('De kraan is gekanteld. Het stabiliteitsmodel liet geen marge meer over.');
    if (this.metrics.damage >= this.mission.maxDamage) return this.fail(`Te veel schade (${this.metrics.damage.toFixed(0)} %).`);
    if (this.mission.timeLimit && this.difficulty.timer && !this.freePlay && this.time > this.mission.timeLimit) return this.fail('De tijd is verstreken.');
    if (this.spec.gb.anchored && this.attached && this.loadPct > 140) return this.fail('Constructieve overbelasting van de torenkraan.');
    if (this.attached && this.loadPct > 110 && this.difficulty.overloadFail) {
      this.overloadTimer += dt;
      if (this.overloadTimer > 1.5) return this.fail('Veiligheidsovertreding: aanhoudende overbelasting.');
    } else this.overloadTimer = 0;
    const maxLoad = this.mission.requirements.maxLoadPercent;
    if (maxLoad && this.attached && this.loadPct > maxLoad + 15 && this.loadLifted()) {
      this.overloadTimer += dt;
      if (this.overloadTimer > 2) return this.fail(`Belasting boven het hijsplan (${maxLoad} %).`);
    }
  }

  private succeed(): void {
    if (this.outcome !== 'running') return;
    this.outcome = 'success';
    this.score = computeScore(this.metrics, true);
    this.events.push({ type: 'success' });
  }

  fail(reason: string): void {
    if (this.outcome !== 'running') return;
    this.outcome = 'failed';
    this.failReason = reason;
    this.score = computeScore(this.metrics, false);
    this.events.push({ type: 'fail', reason });
  }

  /** Neem en wis gebeurtenissen (voor geluid, effecten en UI). */
  drainEvents(): SimEvent[] {
    const e = this.events.slice();
    this.events.length = 0;
    return e;
  }

  /** Huidige gemeten last aan de haak (t). */
  measuredLoadT(): number {
    return this.tensionF / GRAVITY / 1000;
  }

  /** Massa van de aangeslagen last (t), zonder haak. */
  attachedMassT(): number {
    return this.attached ? this.attached.type.massKg / 1000 : 0;
  }

  get ropeBody(): RigidBody | null {
    return this.world.ropeBody?.body ?? null;
  }
}

export function taskLabel(t: TaskDef, m: MissionDef): string {
  switch (t.type) {
    case 'deliver': {
      if (t.label) return t.label;
      const ld = m.loads.find((l) => l.id === t.loadId);
      const z = m.zones.find((zz) => zz.id === t.zoneId);
      const name = ld ? getLoad(ld.type).name : t.loadId;
      return `${name} → ${z?.label ?? t.zoneId}`;
    }
    case 'drive':
      return t.label;
    case 'outriggers':
      return t.label ?? 'Stempels volledig uitzetten';
    case 'setup':
      return t.label ?? 'Opbouwprocedure voltooien';
    case 'stow':
      return t.label ?? 'Kraan in transportstand zetten';
  }
}
