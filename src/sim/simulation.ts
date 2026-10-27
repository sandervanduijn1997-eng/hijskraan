import { getCrane } from '../cranes/config/cranes';
import type { CraneId, UpgradeId } from '../cranes/config/types';
import type { CraneInput } from '../cranes/controllers/craneInput';
import { emptyInput } from '../cranes/controllers/craneInput';
import type { ControlResult } from '../cranes/controllers/craneController';
import { outriggerPad, updateCrane, updateTilt } from '../cranes/controllers/craneController';
import type { SupportState } from '../cranes/models/capacity';
import { allowedCapacityT, stabilityMasses, supportState } from '../cranes/models/capacity';
import { boomFrequency, staticDeflection } from '../cranes/models/boomFlex';
import type { ResolvedCrane } from '../cranes/models/craneSpec';
import { resolveCrane } from '../cranes/models/craneSpec';
import type { CraneState } from '../cranes/models/craneState';
import { createCraneState } from '../cranes/models/craneState';
import type { CraneGeometry } from '../cranes/models/kinematics';
import { computeGeometry, hasSetupProcedure, setupStageLabel } from '../cranes/models/kinematics';
import type { LmiConfig } from '../cranes/models/lmi';
import { autoLmi, hasLmiSetup, lmiCapacityT, lmiMismatch, maxParts } from '../cranes/models/lmi';
import type { ErectionLayout, TowerBuild } from '../cranes/models/towerErection';
import { TOWER_BALLAST_H, TOWER_BALLAST_W, TOWER_ERECTION_SECTIONS, TOWER_HEAD_H, TOWER_SLEW_UNIT_H, emptyTowerBuild, erectionLayout } from '../cranes/models/towerErection';
import type { CraneStartConfig } from '../cranes/models/craneState';
import type { LoadType } from '../missions/data/loads';
import { getLoad } from '../missions/data/loads';
import type { MissionDef, PlaceEffect, TaskDef, TowerAssemblyDef, TowerPartKind, ZoneDef } from '../missions/data/types';
import { buildColliders } from '../missions/runtime/buildWorld';
import type { ScoreBreakdown, ScoreMetrics } from '../missions/runtime/scoring';
import { computeScore, emptyMetrics } from '../missions/runtime/scoring';
import type { PlacementCheck } from '../missions/validation/placement';
import { checkPlacement, loadBottomCenter } from '../missions/validation/placement';
import { createRope, ropeAngles } from '../physics/cable/rope';
import type { RopeState } from '../physics/cable/rope';
import type { Collider } from '../physics/collision/colliders';
import type { ContactBody } from '../physics/collision/contacts';
import { rangesOverlap, segmentIntersectsRect } from '../physics/collision/geometry';
import { AIR_DENSITY, FIXED_DT, GRAVITY, SUBSTEPS } from '../physics/constants';
import { GROUND_LABEL, groundAt, groundFactorFor } from '../physics/ground';
import type { MatId } from '../physics/stability/groundPressure';
import { MATS, allowedPressure, bearingArea, matLabel, matSide, padLoadsT } from '../physics/stability/groundPressure';
import type { RigidBody } from '../physics/load/rigidBody';
import { apexWorld, bodyBounds, bodyTilt, createBoxBody, localToWorld, setBodyMass, wakeBody } from '../physics/load/rigidBody';
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
import type { Rig, RigChoice } from './rigging';
import { SiteLife, WORKERS_BY_ENV } from './site';
import type { Danger } from './site';
import { BREAK_FACTOR, MAX_SLING_ANGLE, buildRig, legLoadT, rigUtilisation, standardRig } from './rigging';
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
  | { type: 'slingBreak' }
  | { type: 'overPeople' }
  | { type: 'surprise'; text: string }
  | { type: 'towerPart'; part: TowerPartKind }
  | { type: 'craneSwitch' }
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
  /** De speler stelt de lastmomentbegrenzer zelf in (anders: automatisch correct). */
  manualLmi?: boolean;
  /** Aanslaan als vaardigheid: zelf gereedschap en hijspunten kiezen (anders de standaard aanslag). */
  manualRigging?: boolean;
}

export type MissionOutcome = 'running' | 'success' | 'failed';

/** Snapshot voor render-interpolatie. */
export interface BodySnapshot {
  x: number;
  y: number;
  z: number;
  angle: number;
  /** Oriëntatie (quaternion) voor de weergave. */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

const HOOK_ID = '__hook__';
const ATTACH_DIST = 1.1;
/** Toelaatbaar mastmoment tijdens de montage (tm): zonder het eerste ballastblok vóór de giek wordt dit overschreden. */
export const ERECTION_MOMENT_LIMIT_TM = 320;

/** Toestand van de torenkraanmontage met een hulpkraan. */
export interface AssemblyRuntime {
  def: TowerAssemblyDef;
  layout: ErectionLayout;
  build: TowerBuild;
  /** Na het overstappen is de toren de bediende kraan en de hulpkraan geparkeerd. */
  switched: boolean;
}

/** Een geparkeerde (niet meer bediende) kraan, bijvoorbeeld de hulpkraan na de montage. */
export interface ParkedCrane {
  spec: ResolvedCrane;
  crane: CraneState;
  geom: CraneGeometry;
}

export class Simulation {
  readonly mission: MissionDef;
  /** De bediende kraan (tijdens een montage eerst de hulpkraan). */
  spec: ResolvedCrane;
  /** De kraan waarmee de opdracht wordt uitgevoerd (gehuurd/eigen). */
  readonly missionSpec: ResolvedCrane;
  readonly difficulty: DifficultyProfile;
  crane: CraneState;
  geom: CraneGeometry;
  readonly world: PhysicsWorld;
  rope: RopeState;
  readonly assembly: AssemblyRuntime | null;
  parked: ParkedCrane | null = null;
  private readonly missionStart: CraneStartConfig;
  private readonly missionCondition: number;
  private fuelOffset = 0;
  /** Instelling van de lastmomentbegrenzer en het werkelijke schijvenstel (aantal kabelparten). */
  lmi: LmiConfig;
  parts: number;
  readonly manualLmi: boolean;
  readonly manualRigging: boolean;
  /** Aanslag van de huidige (of laatst aangeslagen) last. */
  rig: Rig | null = null;
  /** Benutting van het hijsgereedschap (1 = op de werklast). */
  rigPct = 0;
  /** Bouwvakkers en vrachtwagen (null = lege omgeving). */
  site: SiteLife | null = null;
  private lmiViolationLatched = false;
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
  hookMassKg: number;
  hookH: number;
  hookW: number;
  time = 0;
  wind: WindSample = { x: 0, z: 0, speed: 0 };
  /** Kabelkracht, gefilterd voor weergave en beoordeling (τ = 0,25 s). */
  tensionF = 0;
  /** Snelle kabelkracht voor de lastmomentbegrenzer (τ = 0,04 s). */
  tensionFast = 0;
  /** Belasting voor HUD, waarschuwingen en score. */
  loadPct = 0;
  /** Belasting zoals de lastmomentbegrenzer hem gebruikt om bewegingen te blokkeren. */
  lmiPct = 0;
  /** LMI-afschakeling blijft actief tot de belasting duidelijk onder de grens zakt (hysterese). */
  lmiLatched = false;
  capacityT = 0;
  stability: StabilityResult | null = null;
  support: SupportState;
  groundFactor = 1;
  /** Kraanmatten onder de stempels, en per stempel: druk, toelaatbare druk (t/m²) en wegzakken (m). */
  mats: MatId = 'timber';
  padPressure: number[] = [];
  padAllowed: number[] = [];
  private sinkLatched = false;
  /** Verrassing: afgegaan, extra wind tot een tijdstip, afzetplek pas vrij vanaf, en verborgen zones. */
  private surpriseFired = false;
  private gust: { speed: number; until: number } | null = null;
  zoneReadyAt = 0;
  readonly hiddenZones = new Set<string>();
  private liftedSince = -1;
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
    this.missionSpec = resolveCrane(getCrane(craneId), opt.upgrades ?? []);
    const asm = opt.mission.assembly;
    // bij een montage bedien je eerst de hulpkraan (geleverd door de missie, zonder upgrades en in nieuwstaat)
    this.spec = asm ? resolveCrane(getCrane(asm.assistCrane), []) : this.missionSpec;
    this.difficulty = opt.difficulty ?? DIFFICULTIES.normal;
    this.missionCondition = opt.condition ?? 1;
    this.condition = asm ? 1 : this.missionCondition;
    this.seed = hashString(opt.mission.id);
    const start = { ...opt.mission.crane };
    if (opt.counterweightIndex !== undefined) start.counterweightIndex = opt.counterweightIndex;
    if (opt.boomOptionIndex !== undefined) start.boomOptionIndex = opt.boomOptionIndex;
    if (opt.jibIndex !== undefined) start.jibIndex = opt.jibIndex;
    this.missionStart = start;
    this.assembly = asm
      ? { def: asm, layout: erectionLayout(this.missionSpec.cfg, start.x, 0, asm.erectSlewDeg), build: emptyTowerBuild(asm.preinstalledSections), switched: false }
      : null;
    this.crane = createCraneState(this.spec, asm ? asm.assist : start);
    this.geom = computeGeometry(this.spec, this.crane);
    this.manualLmi = (opt.manualLmi ?? false) && hasLmiSetup(this.spec);
    this.parts = maxParts(this.spec);
    this.manualRigging = opt.manualRigging ?? false;
    // standaard liggen houten kraanmatten onder de stempels (zoals elke kraan ze meeneemt)
    this.mats = opt.mission.mats ?? 'timber';
    this.crane.matSide = this.spec.gb.outriggerCount === 4 ? matSide(this.spec.gb.maxCapacityT, this.mats) : 0;
    this.lmi = this.manualLmi ? { ...autoLmi(this.spec, this.crane, this.parts), configured: false } : autoLmi(this.spec, this.crane, this.parts);
    this.prevTip = { ...this.geom.tip };

    const params = defaultPhysicsParams();
    params.gravity = opt.gravity ?? GRAVITY;
    this.world = new PhysicsWorld(params);
    this.applyCraneParams();
    this.missionColliders = buildColliders(opt.mission.obstacles);
    this.colliders = this.missionColliders;
    this.refreshCraneColliders();

    this.hookMassKg = this.spec.gb.hookMassKg;
    this.hookW = hookWidth(this.hookMassKg);
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

    this.site = this.buildSite(opt.mission.site?.workers);
    const sp = opt.mission.surprise;
    if (sp?.type === 'change') this.hiddenZones.add(sp.toZone);

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

  /** Kabel- en slingerparameters die van de bediende kraan afhangen. */
  private applyCraneParams(): void {
    const p = this.world.params;
    p.swayDamping = this.difficulty.swayDamping + this.spec.effects.extraSwayDamping;
    // ca. 15 cm rek (kabel + giekdoorbuiging) bij de nominale capaciteit van de kraan
    p.ropeCompliance = 0.15 / (this.spec.gb.maxCapacityT * 1000 * GRAVITY);
  }

  /** Bedien je nu de hulpkraan van een torenkraanmontage? */
  get assisting(): boolean {
    return !!this.assembly && !this.assembly.switched;
  }

  // ---------------------------------------------------------------- torenkraanmontage

  /** Botsingsobjecten van de torenkraan in aanbouw (alleen zolang de hulpkraan wordt bediend). */
  towerStructureColliders(): Collider[] {
    const a = this.assembly;
    if (!a || a.switched) return [];
    const L = a.layout;
    const b = a.build;
    const { x, z } = L;
    const mk = (id: string, minX: number, maxX: number, minY: number, maxY: number, hz: number, landable: boolean): Collider => ({
      id, kind: 'tower', minX, maxX, minY, maxY, minZ: z - hz, maxZ: z + hz, onHit: 'damage', landable, label: 'de torenkraan in aanbouw',
    });
    const out: Collider[] = [mk('tw-base', x - 4, x + 4, 0, L.baseH, 4, false), mk('tw-mast', x - 0.8, x + 0.8, L.baseH, L.mastTop(b.sections), 0.8, true)];
    const top = L.mastTop(TOWER_ERECTION_SECTIONS);
    if (b.slewingUnit) out.push(mk('tw-su', x - 1.2, x + 1.2, top, top + TOWER_SLEW_UNIT_H, 1.2, true));
    if (b.towerHead) out.push(mk('tw-th', x - 0.7, x + 0.7, L.deckY, L.deckY + TOWER_HEAD_H, 0.7, false));
    if (b.counterJib) out.push(mk('tw-cj', L.counterJib.x0, L.counterJib.x1, L.counterJib.y0, L.counterJib.y1, 0.9, true));
    if (b.jib) out.push(mk('tw-jib', L.jib.x0, L.jib.x1, L.jib.y0, L.jib.y1, 0.75, false));
    b.ballast.forEach((bl, i) => out.push(mk(`tw-bal${i}`, bl.x - TOWER_BALLAST_W / 2, bl.x + TOWER_BALLAST_W / 2, L.counterJib.y1, L.counterJib.y1 + TOWER_BALLAST_H, 1.1, false)));
    return out;
  }

  /**
   * Moment op de mast door de gemonteerde delen (tm, positief = naar de tegengiek).
   * De juiste ballastvolgorde houdt dit tijdens de hele montage binnen de grens.
   */
  towerMomentTm(): number {
    const a = this.assembly;
    if (!a) return 0;
    const L = a.layout;
    const b = a.build;
    let m = 0;
    if (b.counterJib) m += (getLoad('towerCounterJib').massKg / 1000) * ((L.counterJib.x0 + L.counterJib.x1) / 2 - L.x);
    if (b.jib) m += (getLoad('towerJib').massKg / 1000) * ((L.jib.x0 + L.jib.x1) / 2 - L.x);
    for (const bl of b.ballast) m += bl.massT * (bl.x - L.x);
    // de tegengiek wijst tegen de giekrichting in
    return m * -L.jibDir;
  }

  /** Synthetische kraantoestand van de torenkraan in aanbouw (voor de weergave). */
  erectionState(): CraneState | null {
    const a = this.assembly;
    if (!a || a.switched) return null;
    const st = createCraneState(this.missionSpec, { ...this.missionStart, slewDeg: a.def.erectSlewDeg, ropeLength: this.missionSpec.gb.ropeMin });
    st.setupProgress = 0;
    return st;
  }

  /** Van de hulpkraan overstappen naar de gemonteerde torenkraan. */
  private switchToMissionCrane(): void {
    const a = this.assembly;
    if (!a || a.switched) return;
    this.parked = { spec: this.spec, crane: this.crane, geom: this.geom };
    this.fuelOffset += this.crane.fuelUsed;
    if (this.attached) this.detachLoad(false);
    if (this.hookBody) {
      this.world.removeBody(this.hookBody);
      this.prevSnap.delete(HOOK_ID);
      this.hookBody = null;
    }
    this.world.ropeBody = null;
    a.switched = true;
    this.spec = this.missionSpec;
    this.condition = this.missionCondition;
    this.crane = createCraneState(this.spec, this.missionStart);
    this.geom = computeGeometry(this.spec, this.crane);
    this.prevTip = { ...this.geom.tip };
    this.applyCraneParams();
    this.hookMassKg = this.spec.gb.hookMassKg;
    this.hookW = hookWidth(this.hookMassKg);
    this.hookH = this.hookW * 1.4;
    this.rope = createRope(this.geom.tip, this.crane.ropeLength, this.spec.gb.ropeMin, this.spec.gb.ropeMax);
    this.craneCollKey = '';
    this.refreshCraneColliders();
    this.spawnHook();
    this.tensionF = 0;
    this.tensionFast = 0;
    this.lmiLatched = false;
    this.outriggerAuto.outriggerAuto = 'none';
    this.support = supportState(this.spec, this.crane);
    this.events.push({ type: 'craneSwitch' });
  }

  /** Geparkeerde kraan: alleen de onderwagen blijft als obstakel staan. */
  private parkedColliders(): Collider[] {
    const p = this.parked;
    if (!p) return [];
    const half = p.spec.cfg.visual.carrierLength / 2;
    const c = p.crane;
    return [{ id: 'parked-carrier', kind: 'machine', minX: c.baseX - half, maxX: c.baseX + half, minY: 0, maxY: p.spec.cfg.visual.carrierHeight + 1.5, minZ: c.baseZ - 1.4, maxZ: c.baseZ + 1.4, onHit: 'damage', landable: false, label: 'de geparkeerde hulpkraan' }];
  }

  // ---------------------------------------------------------------- eigen kraandelen als botsingsobject

  /** Onderwagen (landbaar dek) en, voor torenkranen, de mast. */
  craneOwnColliders(): Collider[] {
    const cfg = this.spec.cfg;
    const gb = this.spec.gb;
    const x = this.crane.baseX;
    const bz = this.crane.baseZ;
    const half = cfg.visual.carrierLength / 2;
    const out: Collider[] = [];
    const mk = (id: string, minX: number, maxX: number, minY: number, maxY: number, z: number, landable: boolean): Collider => ({
      id, kind: 'crane', minX, maxX, minY, maxY, minZ: bz - z, maxZ: bz + z, onHit: 'damage', landable, label: 'de eigen kraan',
    });
    if (cfg.carrier === 'towerBase') {
      // de mast groeit mee tijdens de montage
      const mast = this.geom?.segments.find((sg) => sg.kind === 'mast');
      const top = mast ? Math.max(mast.y0, mast.y1) : gb.towerHeight ?? 30;
      out.push(mk('own-mast', x - 1, x + 1, 0, Math.max(1, top - 3), 1, false));
    } else if (cfg.carrier === 'selfErecting') {
      out.push(mk('own-base', x - half, x + half, 0, cfg.visual.carrierHeight, 2.2, false));
      if (this.crane.setupProgress >= 1) out.push(mk('own-mast', x - 0.7, x + 0.7, cfg.visual.carrierHeight, (gb.towerHeight ?? 20) - 2, 0.7, false));
    } else {
      out.push(mk('own-carrier', x - half, x + half, 0, cfg.visual.carrierHeight, 1.3, true));
    }
    return out;
  }

  private refreshCraneColliders(): void {
    const b = this.assembly?.build;
    const buildKey = b && !this.assembly!.switched ? `${b.sections}${+b.slewingUnit}${+b.towerHead}${+b.counterJib}${+b.jib}${b.ballast.length}` : '';
    const key = `${this.crane.baseX.toFixed(3)}|${Math.round(this.crane.setupProgress * 40)}|${buildKey}|${this.parked ? 1 : 0}`;
    if (key === this.craneCollKey) return;
    this.craneCollKey = key;
    this.colliders = [...this.missionColliders, ...this.towerStructureColliders(), ...this.parkedColliders(), ...this.craneOwnColliders()];
    this.world.setColliders(this.colliders);
  }

  // ---------------------------------------------------------------- haak & lasten

  private spawnHook(at?: { x: number; y: number; z: number }): void {
    const tip = this.geom.tip;
    let topY = at ? at.y : tip.y - this.rope.length;
    const x = at ? at.x : tip.x;
    const z = at ? at.z : tip.z;
    // nooit in een obstakel of last verschijnen: boven het hoogste oppervlak onder de haak blijven
    let floor = 0;
    const hw = this.hookW / 2 + 0.05;
    for (const c of this.colliders) {
      if (c.kind === 'ceiling' || c.minY >= tip.y) continue;
      if (x + hw > c.minX && x - hw < c.maxX && z + hw > c.minZ && z - hw < c.maxZ) floor = Math.max(floor, c.maxY);
    }
    for (const l of this.loads) {
      const b = l.cb.body;
      if (l.status === 'consumed' || b.pos.y - b.halfH >= tip.y) continue;
      if (Math.abs(x - b.pos.x) < b.halfW + hw && Math.abs(z - b.pos.z) < b.depth / 2 + hw) floor = Math.max(floor, b.pos.y + b.halfH);
    }
    // (de kabel mag dan slap hangen; de haak komt nooit onder de grond of in een obstakel)
    if (topY - this.hookH < floor + 0.05) topY = floor + this.hookH + 0.05;
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
      return localToWorld(b, b.apex.x, b.apex.y - this.hookH);
    }
    if (this.hookBody) {
      const b = this.hookBody.body;
      return localToWorld(b, 0, -b.halfH);
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
    return localToWorld(b, b.boxOffset.x, b.boxOffset.y + b.halfH + l.type.slingHeight);
  }

  /** Stel de lastmomentbegrenzer in (vanuit de cabine). */
  configureLmi(cfg: Omit<LmiConfig, 'configured'>): void {
    this.lmi = { ...cfg, configured: true };
  }

  /** Afwijkingen tussen de LMI-invoer en de werkelijke opstelling. */
  lmiMismatch(): string[] {
    return this.manualLmi ? lmiMismatch(this.spec, this.crane, this.lmi, this.parts) : [];
  }

  /**
   * Hoogste oppervlak onder een rechthoek (x, z ± halve maten) dat lager ligt dan fromY:
   * obstakels en andere lasten (voor de dieptehulp). Zonder iets eronder: de grond (0).
   */
  surfaceBelow(x: number, z: number, hw: number, hd: number, fromY: number, exclude?: LoadRuntime): { y: number; id: string } {
    let best = { y: 0, id: 'ground' };
    for (const c of this.colliders) {
      if (c.kind === 'ceiling' || c.maxY > fromY + 0.05) continue;
      if (x + hw <= c.minX || x - hw >= c.maxX || z + hd <= c.minZ || z - hd >= c.maxZ) continue;
      if (c.maxY > best.y) best = { y: c.maxY, id: c.id };
    }
    for (const l of this.loads) {
      if (l === exclude || l.status === 'consumed') continue;
      const bb = bodyBounds(l.cb.body);
      if (bb.maxY > fromY + 0.05) continue;
      if (x + hw <= bb.minX || x - hw >= bb.maxX || z + hd <= bb.minZ || z - hd >= bb.maxZ) continue;
      if (bb.maxY > best.y) best = { y: bb.maxY, id: l.id };
    }
    return best;
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

  private attachLoad(l: LoadRuntime, initial = false, rig: Rig = standardRig(l.type)): void {
    if (this.hookBody) {
      this.world.removeBody(this.hookBody);
      this.hookBody = null;
    }
    const b = l.cb.body;
    this.rig = rig;
    b.apex = { x: b.boxOffset.x + rig.apexX, y: b.boxOffset.y + b.halfH + rig.height + this.hookH };
    setBodyMass(b, l.type.massKg + this.hookMassKg, { mass: this.hookMassKg, x: b.apex.x, y: b.apex.y });
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
    b.apex = { x: b.boxOffset.x, y: b.boxOffset.y + b.halfH + l.type.slingHeight };
    setBodyMass(b, l.type.massKg);
    this.rigPct = 0;
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
    if (this.manualRigging) return 'choose';
    this.attachLoad(c);
    return `${c.type.name} aangeslagen.`;
  }

  /** Aanslaan met een zelf gekozen aanslag (na het aanslagpaneel). */
  attachWith(choice: RigChoice): string {
    if (this.outcome !== 'running' || this.attached) return '';
    const c = this.attachCandidate();
    if (!c) return 'Geen last binnen bereik van de haak.';
    if (c.status === 'placed') for (const t of this.tasks) if (t.def.type === 'deliver' && t.def.loadId === c.id && t.status === 'done') t.status = 'pending';
    const rig = buildRig(c.type, choice);
    this.attachLoad(c, false, rig);
    if (rig.angle > MAX_SLING_ANGLE) this.metrics.safetyViolations++;
    return `${c.type.name} aangeslagen: ${rig.label}.`;
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
        s.qx = b.q.x;
        s.qy = b.q.y;
        s.qz = b.q.z;
        s.qw = b.q.w;
      } else this.prevSnap.set(cb.id, { x: b.pos.x, y: b.pos.y, z: b.pos.z, angle: b.angle, qx: b.q.x, qy: b.q.y, qz: b.q.z, qw: b.q.w });
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
    if (this.gust && this.time < this.gust.until) {
      // windvlaag: zwelt aan en neemt weer af, in de richting van de missiewind
      const k = Math.sin(Math.PI * Math.min(1, Math.max(0, 1 - (this.gust.until - this.time) / 18)));
      const extra = Math.max(0, this.gust.speed - this.wind.speed) * k * this.difficulty.windScale;
      const dir = this.mission.wind.direction >= 0 ? 1 : -1;
      this.wind = { ...this.wind, x: this.wind.x + dir * extra, speed: this.wind.speed + extra };
    }
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
      loadPercent: this.lmiLatched ? Math.max(100, this.loadPct, this.lmiPct) : Math.max(this.loadPct, this.lmiPct),
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
    this.refreshCraneColliders();
    this.updateBoomDeflection(dt);
    this.geom = computeGeometry(this.spec, this.crane);
    if (this.crane.setupProgress < 1 && hasSetupProcedure(this.spec)) {
      // tijdens montage/opbouw viert de lier automatisch mee met de beweging van de giekpunt:
      // de haak wordt niet over de grond meegesleept en blijft hangen waar hij hing
      const a = hookPos;
      const t = this.geom.tip;
      const d = Math.hypot(a.x - t.x, a.y - t.y, a.z - t.z);
      const d0 = Math.hypot(a.x - tipStart.x, a.y - tipStart.y, a.z - tipStart.z);
      if (d > d0) this.crane.ropeLength = clamp(this.crane.ropeLength + (d - d0), this.spec.gb.ropeMin, this.spec.gb.ropeMax);
    }
    this.rope.length = this.crane.ropeLength;
    this.rope.tip = { ...this.geom.tip };

    // fysica
    this.world.step(dt, SUBSTEPS, this.rope, tipStart, lengthStart);

    // meten: kabelkracht, belasting, stabiliteit
    const k = 1 - Math.exp(-dt / 0.25);
    this.tensionF += (this.rope.tension - this.tensionF) * k;
    this.tensionFast += (this.rope.tension - this.tensionFast) * (1 - Math.exp(-dt / 0.04));
    this.support = supportState(this.spec, this.crane);
    // de begrenzer rekent met de invoer van de machinist; zonder handmatige instelling met de werkelijkheid
    this.capacityT = this.manualLmi ? lmiCapacityT(this.spec, this.crane, this.lmi) : allowedCapacityT(this.spec, this.crane);
    const loadT = this.tensionF / GRAVITY / 1000;
    this.loadPct = Math.min(999, loadPercent(loadT, this.capacityT));
    this.lmiPct = Math.min(999, loadPercent(this.tensionFast / GRAVITY / 1000, this.capacityT));
    const rawPct = loadPercent(this.rope.tension / GRAVITY / 1000, this.capacityT);
    if (!this.attached) this.lmiLatched = false;
    // afschakelen bij aanhoudend ≥ 100 % of een duidelijke piek; vrijgeven pas onder 97 %
    else if (this.lmiPct >= 101 || rawPct >= 112 || this.loadPct >= 100) this.lmiLatched = true;
    else if (this.loadPct < 97 && this.lmiPct < 99) this.lmiLatched = false;
    this.computeStabilityModel();
    this.updateGroundPressure(dt);
    updateTilt(this.crane, this.stability?.tippingRatio ?? 0, dt, this.difficulty.tipping && !this.spec.gb.anchored);

    this.processImpacts(ctl);
    this.updateSite(dt);
    this.updateSurprise();
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
      // een giek die nog gemonteerd wordt ligt op de grond/opleggers en geeft geen kantelmoment
      boomT: this.crane.setupProgress < 1 && this.spec.gb.setupType === 'boomAssembly' ? 0 : this.geom.boomMassT,
      boomCogRadius: this.geom.boomCogRadius,
      ropeTension: this.tensionF,
      ropeOutwardAngle: Math.atan2(du, dy),
      groundFactor: this.groundFactor,
      slope: (this.mission.slopeDeg ?? 0) * DEG,
      windMoment: windOnBoom,
    });
  }

  /**
   * Bodemdruk per stempel. Boven de toelaatbare druk zakt de stempel weg (sneller naarmate de
   * overschrijding groter is). Op Normaal en Realistisch is 30 cm wegzakken het einde van de hijs.
   */
  private updateGroundPressure(dt: number): void {
    const gb = this.spec.gb;
    if (gb.outriggerCount !== 4 || this.support.mode === 'tires' || gb.anchored) {
      this.padPressure = [];
      this.padAllowed = [];
      return;
    }
    const fp = this.support.footprint;
    const loadT = this.attached ? Math.max(0, this.tensionF / GRAVITY / 1000) : this.hookMassKg / 1000;
    const loads = padLoadsT({
      masses: stabilityMasses(this.spec, this.crane),
      slew: this.crane.slew,
      boomT: this.geom.boomMassT,
      boomCogRadius: this.geom.boomCogRadius,
      loadT,
      tipRadius: this.geom.tipU,
      a: fp.a,
      b: fp.b,
    });
    const area = bearingArea(gb.maxCapacityT, this.mats);
    this.padPressure = loads.map((f) => f / area);
    this.padAllowed = loads.map((_, i) => {
      const g = groundAt(this.mission.ground ?? [], outriggerPad(this.spec, this.crane, i).x, this.mission.groundFallback);
      return allowedPressure(g.type, Math.min(1, g.quality + this.spec.effects.groundBonus));
    });
    for (let i = 0; i < 4; i++) {
      const ratio = this.padPressure[i] / this.padAllowed[i];
      if (ratio > 1) this.crane.padSink[i] = Math.min(0.5, this.crane.padSink[i] + 0.04 * (ratio - 1) * dt);
    }
    const worst = Math.max(...this.padSink);
    if (worst > 0.3 && !this.sinkLatched) {
      this.sinkLatched = true;
      this.metrics.safetyViolations++;
      const i = this.padSink.indexOf(worst);
      const g = groundAt(this.mission.ground ?? [], outriggerPad(this.spec, this.crane, i).x, this.mission.groundFallback);
      if (this.difficulty.id !== 'practice') this.fail(`Stempel ${i + 1} zakte ${Math.round(worst * 100)} cm weg in de ${GROUND_LABEL[g.type]} — bodemdruk te hoog, gebruik kraanmatten.`);
    }
  }

  get padSink(): number[] {
    return this.crane.padSink;
  }

  /** Kraanmatten leggen of wisselen (alleen met de vijzels omhoog). */
  cycleMats(): string {
    if (this.spec.gb.outriggerCount !== 4) return 'Deze kraan staat niet op stempels.';
    if (this.crane.outriggerJack.some((j) => j > 0.05)) return 'Eerst de vijzels omhoog — dan kunnen de matten eronder.';
    const i = MATS.findIndex((m) => m.id === this.mats);
    this.mats = MATS[(i + 1) % MATS.length].id;
    this.crane.matSide = matSide(this.spec.gb.maxCapacityT, this.mats);
    this.crane.padSink = [0, 0, 0, 0];
    this.sinkLatched = false;
    return `Onder de stempels: ${matLabel(this.spec.gb.maxCapacityT, this.mats)}`;
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
    m.fuelUsed = this.crane.fuelUsed + this.fuelOffset;
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
      this.checkSlings();
    }
    if (lifted) {
      this.liftSettle += dt;
      if (this.liftSettle > 1.5) {
        m.maxSwayDeg = Math.max(m.maxSwayDeg, this.swayDeg);
        m.peakLiftPct = Math.max(m.peakLiftPct, this.loadPct);
      }
    } else this.liftSettle = 0;
  }

  /**
   * Doorbuiging en trillen van de giek: een veer-dempersysteem met de kabelkracht als belasting.
   * Statische doorbuiging ≈ 1 % van de gieklengte × (L/30 m) bij een last op de grens van het lastdiagram;
   * eigenfrequentie daalt met de lengte (lange giek = traag en ver doorbuigen). Weinig demping, zodat
   * een ruk of het neerzetten van een last zichtbaar natrilt.
   */
  private updateBoomDeflection(dt: number): void {
    const s = this.crane;
    const kind = this.spec.cfg.kind;
    if (kind !== 'telescopic' && kind !== 'lattice') return;
    const tensionT = this.rope.slack ? 0 : this.rope.tension / GRAVITY / 1000;
    const target = staticDeflection(this.geom.displayBoomLength, tensionT, allowedCapacityT(this.spec, s), this.geom.displayBoomAngle);
    const w = 2 * Math.PI * boomFrequency(this.geom.displayBoomLength);
    const zeta = 0.3;
    const acc = w * w * (target - s.boomDeflect) - 2 * zeta * w * s.boomDeflectVel;
    s.boomDeflectVel += acc * dt;
    s.boomDeflect += s.boomDeflectVel * dt;
  }

  /** Bouwplaats opzetten: werkring rond de kraan, vrije plekken en een vrije rijstrook. */
  private buildSite(workers?: number): SiteLife | null {
    const count = workers ?? WORKERS_BY_ENV[this.mission.environment] ?? 0;
    if (count <= 0) return null;
    const cx = this.geom.slewX;
    const cz = this.geom.slewZ;
    const cw = this.spec.counterweights[this.crane.counterweightIndex];
    // afgezette draaicirkel: buiten de staart (contragewicht) én buiten de stempelplaten
    const fp = this.spec.gb.footprintOutriggers ?? this.spec.gb.footprintRetracted;
    const tail = this.spec.cfg.kind === 'tower' ? 3 : (cw?.radius ?? 3) + 2.5;
    const rMin = Math.max(6, tail, Math.hypot(fp.a, fp.b) + 2);
    const rMax = Math.max(rMin + 8, Math.min(30, this.spec.gb.boomMax * 0.8));
    const blocked = (x: number, z: number, pad: number): boolean => {
      for (const c of this.missionColliders) {
        if (c.kind === 'ceiling' || c.maxY < 0.3 || c.minY > 2.4) continue;
        if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
      }
      for (const l of this.loads) {
        const b = bodyBounds(l.cb.body);
        if (x > b.minX - pad - 0.4 && x < b.maxX + pad + 0.4 && z > b.minZ - pad - 0.4 && z < b.maxZ + pad + 0.4) return true;
      }
      for (const zn of this.mission.zones) if (zn.y < 1 && Math.hypot(x - zn.x, z - (zn.z ?? 0)) < zn.tolerance + 2 + pad) return true;
      return false;
    };
    const free = (x: number, z: number): boolean => Math.hypot(x - cx, z - cz) > rMin && !blocked(x, z, 0.3);
    let laneZ: number | null = null;
    for (const off of [rMin + 8, -(rMin + 8), rMin + 14, -(rMin + 14), rMin + 20, -(rMin + 20)]) {
      let ok = true;
      for (let x = cx - 70; x <= cx + 70 && ok; x += 2) if (blocked(x, cz + off, 2)) ok = false;
      if (ok) {
        laneZ = cz + off;
        break;
      }
    }
    return new SiteLife({ seed: this.seed, count, cx, cz, rMin, rMax, free, laneZ });
  }

  /** Mensen en vrachtwagen bijwerken; een last boven personen is een overtreding. */
  private updateSite(dt: number): void {
    if (!this.site) return;
    let danger: Danger | null = null;
    const l = this.attached;
    if (l && this.loadLifted()) {
      const bc = loadBottomCenter(l.cb.body);
      danger = { x: bc.x, z: bc.z, half: Math.hypot(l.cb.body.halfW, l.cb.body.depth / 2), bottom: bc.y };
    }
    const v = this.site.update(dt, danger);
    if (v > 0) {
      this.metrics.safetyViolations += v;
      this.events.push({ type: 'overPeople' });
      if (this.difficulty.strictOutriggers) this.fail('Last boven personen gedraaid — het werk is stilgelegd.');
    }
  }

  /**
   * Verrassing onderweg. Windvlaag: 8 s nadat de last vrij hangt. Afzetplek niet vrij: als de last
   * binnen 8 m van de zone komt. Wijziging: bij het aanslaan krijgt de taak een nieuwe afzetplek.
   */
  private updateSurprise(): void {
    const sp = this.mission.surprise;
    if (!sp || this.surpriseFired || this.freePlay) return;
    const l = this.attached;
    const task = l ? this.tasks.find((t) => t.def.type === 'deliver' && t.def.loadId === l.id && t.status === 'active') : undefined;
    if (!l || !task || task.def.type !== 'deliver') return;
    const fire = () => {
      this.surpriseFired = true;
      this.events.push({ type: 'surprise', text: sp.text });
    };
    if (sp.type === 'change') {
      if (task.def.zoneId !== sp.fromZone) return;
      task.def = { ...task.def, zoneId: sp.toZone };
      this.hiddenZones.delete(sp.toZone);
      this.hiddenZones.add(sp.fromZone);
      fire();
      return;
    }
    const lifted = this.loadLifted();
    if (lifted && this.liftedSince < 0) this.liftedSince = this.time;
    if (sp.type === 'gust' && this.liftedSince >= 0 && this.time - this.liftedSince > 8) {
      this.gust = { speed: sp.speed, until: this.time + sp.duration };
      fire();
    }
    if (sp.type === 'delay' && lifted) {
      const zone = this.mission.zones.find((z) => z.id === (task.def as { zoneId: string }).zoneId);
      const bc = loadBottomCenter(l.cb.body);
      if (zone && Math.hypot(bc.x - zone.x, bc.z - (zone.z ?? 0)) < 8) {
        this.zoneReadyAt = this.time + sp.seconds;
        fire();
      }
    }
  }

  /** Belasting van het hijsgereedschap; boven de breukgrens breekt een strop en valt de last. */
  private checkSlings(): void {
    const l = this.attached;
    const rig = this.rig;
    if (!l || !rig || !Number.isFinite(rig.wll)) {
      this.rigPct = 0;
      return;
    }
    const loadT = Math.max(0, this.tensionFast / GRAVITY - this.hookMassKg) / 1000;
    this.rigPct = rigUtilisation(rig, loadT) * 100;
    const kind = rig.choice?.gear.kind ?? 'round';
    if (this.rigPct / 100 > BREAK_FACTOR[kind]) {
      const leg = legLoadT(rig, loadT);
      this.detachLoad(false);
      l.damage = Math.max(l.damage, 0.5);
      this.events.push({ type: 'slingBreak' });
      this.fail(`${kind === 'beam' ? 'De hijsbalk bezweek' : 'Een strop brak'}: ${leg.toFixed(1).replace('.', ',')} t op gereedschap met ${String(rig.wll).replace('.', ',')} t werklast.`);
    }
  }

  private evaluateWarnings(ctl: ControlResult): void {
    const W = this.warnings;
    const gb = this.spec.gb;
    const lifted = this.loadLifted();
    const req = this.mission.requirements;
    if (this.crane.tilt > 0.2 * DEG || this.crane.tipped) W.raise('tipping', 'critical', 'KRAAN KANTELT — last direct laten zakken!');
    if (this.attached && (this.loadPct >= 100 || this.lmiLatched)) W.raise('overload', 'critical', `Last te zwaar: ${Math.round(Math.max(this.loadPct, this.lmiPct))} % — lastmomentbegrenzer blokkeert`);
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
        const bb = bodyBounds(b);
        for (const c of this.colliders) {
          if (c.kind === 'crane' || (c.landable && bb.minY >= c.maxY - 0.2)) continue;
          if (!rangesOverlap(bb.minZ, bb.maxZ, c.minZ, c.maxZ)) continue;
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
    if (this.padPressure.length) {
      let worst = 0;
      let wi = 0;
      for (let i = 0; i < this.padPressure.length; i++) {
        const r = this.padPressure[i] / this.padAllowed[i];
        if (r > worst) {
          worst = r;
          wi = i;
        }
      }
      if (worst > 1) W.raise('groundPressure', 'critical', `Bodemdruk stempel ${wi + 1}: ${Math.round(this.padPressure[wi])} t/m² (toegestaan ${Math.round(this.padAllowed[wi])}) — stempel zakt weg`);
      else if (worst > 0.85) W.raise('groundPressure', 'caution', `Bodemdruk stempel ${wi + 1} hoog: ${Math.round(worst * 100)} % van toegestaan`);
    }
    if (this.site?.peopleUnderLoad) W.raise('overPeople', 'critical', 'Last boven personen — stop!');
    if (this.time < this.zoneReadyAt) W.raise('zoneHold', 'info', `Afzetplek nog niet vrij — wachten (nog ${Math.ceil(this.zoneReadyAt - this.time)} s)`);
    if (this.attached && this.rig?.choice) {
      const rig = this.rig;
      if (this.rigPct > 100) W.raise('slingOverload', 'critical', `Hijsgereedschap overbelast: ${Math.round(this.rigPct)} % van de werklast`);
      else if (this.rigPct > 90) W.raise('slingOverload', 'caution', `Hijsgereedschap zwaar belast: ${Math.round(this.rigPct)} %`);
      if (rig.angle > MAX_SLING_ANGLE) W.raise('slingAngle', 'caution', `Stropshoek ${Math.round(rig.angle * RAD)}° — te plat (max. 60°)`);
      if (lifted) {
        const tilt = Math.abs(bodyTilt(this.attached.cb.body).roll) * RAD;
        if (tilt > 4) W.raise('rigTilt', 'info', `Last hangt ${Math.round(tilt)}° scheef — hijspunten niet boven het zwaartepunt`);
      }
    }
    if (this.manualLmi && !this.lmi.configured) W.raise('lmiSetup', this.attached ? 'caution' : 'info', 'Lastmomentbegrenzer niet ingesteld — druk L om de opstelling in te voeren');
    const mm = this.lmiMismatch();
    if (mm.length && (this.attached || lifted)) {
      W.raise('lmiMismatch', 'critical', `LMI-instelling klopt niet: ${mm[0]}`);
      if (lifted && !this.lmiViolationLatched) {
        this.lmiViolationLatched = true;
        this.metrics.safetyViolations++;
      }
    }
    if (ctl.climbBlocked) W.raise('setup', 'caution', 'Klimmen kan alleen zonder last aan de haak — zet de last eerst neer');
    if (ctl.outriggerObstacle) W.raise('outriggerObstacle', 'caution', 'Stempel raakt een obstakel — kan niet verder uitschuiven');
    if (ctl.blocked.drive === 'outriggers') W.raise('driveBlocked', 'info', 'Rijden kan pas met volledig ingehaalde stempels');
    else if (ctl.blocked.drive === 'driveLoad') W.raise('driveBlocked', 'info', 'Rijden met deze last is niet toegestaan');
    else if (ctl.blocked.drive === 'driveObstacle') W.raise('driveBlocked', 'info', 'Obstakel of wereldgrens: kan niet verder rijden');
    if (this.crane.setupProgress < 1 && hasSetupProcedure(this.spec)) {
      W.raise('setup', 'info', gb.setupType !== 'boomAssembly' ? `Kraan nog niet opgebouwd — houd B ingedrukt (${setupStageLabel(this.spec, this.crane.setupProgress)})` : 'Giek nog niet gemonteerd — houd B ingedrukt voor de giekmontage');
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
        if (ordered || t.def.inOrder) break;
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
        case 'switchCrane':
          if (!this.attached) {
            this.switchToMissionCrane();
            ok = true;
          }
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
          if (d.hold) {
            // in de lucht stil houden tot de monteurs het deel hebben vastgezet: de kraan draagt het gewicht
            const held = l === this.attached && this.tensionF > l.type.massKg * GRAVITY * 0.6;
            const pc = checkPlacement(l.cb.body, zone, held, 0.12, true);
            if (l === this.attached || this.placementHint === null) this.placementHint = pc;
            if (pc.valid) {
              t.hold += dt;
              if (t.hold >= d.hold) {
                ok = true;
                this.metrics.placementErrors.push(pc.error);
                this.detachLoad(true);
                l.status = 'placed';
                this.applyEffect(l, d.effect);
                this.events.push({ type: 'placed', loadId: l.id });
              }
            } else t.hold = 0;
            break;
          }
          const supported = l.cb.supports.size > 0 || l.cb.body.sleeping;
          const pc = checkPlacement(l.cb.body, zone, supported && this.validSupport(l, zone));
          const slackEnough = l !== this.attached || this.tensionF < l.type.massKg * GRAVITY * 0.15;
          if (!slackEnough && pc.valid) pc.reasons.push('kabel nog belast — vier de kabel');
          const ready = this.time >= this.zoneReadyAt;
          if (!ready && pc.valid) pc.reasons.push(`afzetplek nog niet vrij (nog ${Math.ceil(this.zoneReadyAt - this.time)} s)`);
          const valid = pc.valid && slackEnough && ready;
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
    if (ordered || this.tasks.some((t) => t.def.type === 'deliver' && t.def.inOrder)) {
      for (const t of this.tasks) {
        if (t.def.type !== 'deliver' || t.status !== 'pending' || !(ordered || t.def.inOrder)) continue;
        const l = this.loadById(t.def.loadId);
        const zone = this.mission.zones.find((z) => z.id === (t.def as { zoneId: string }).zoneId);
        if (l && zone && l.status !== 'consumed' && l.cb.supports.size > 0 && Math.abs(l.cb.body.pos.x - zone.x) < zone.tolerance + 0.5) {
          this.warnings.raise('order', 'caution', t.def.inOrder ? 'Verkeerde montagevolgorde — dit deel is nog niet aan de beurt' : 'Verkeerde volgorde — deze last is nog niet aan de beurt');
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
    if (effect.type === 'towerPart' && this.assembly) {
      const b = this.assembly.build;
      switch (effect.part) {
        case 'mast':
          b.sections++;
          break;
        case 'slewingUnit':
          b.slewingUnit = true;
          break;
        case 'towerHead':
          b.towerHead = true;
          break;
        case 'counterJib':
          b.counterJib = true;
          break;
        case 'jib':
          b.jib = true;
          break;
        case 'ballast':
          b.ballast.push({ x: l.cb.body.pos.x, massT: l.type.massKg / 1000 });
          break;
      }
      this.events.push({ type: 'towerPart', part: effect.part });
    }
    if (effect.type === 'consume' || effect.type === 'towerPart' || (effect.type === 'addCounterweight' && effect.consume)) {
      l.status = 'consumed';
      this.world.removeBody(l.cb);
      this.prevSnap.delete(l.id);
    }
    this.refreshCraneColliders();
  }

  private checkFailure(dt: number): void {
    if (this.outcome !== 'running') return;
    if (this.crane.tipped) return this.fail('De kraan is gekanteld. Het stabiliteitsmodel liet geen marge meer over.');
    if (this.metrics.damage >= this.mission.maxDamage) return this.fail(`Te veel schade (${this.metrics.damage.toFixed(0)} %).`);
    if (this.mission.timeLimit && this.difficulty.timer && !this.freePlay && this.time > this.mission.timeLimit) return this.fail('De tijd is verstreken.');
    if (this.spec.gb.anchored && this.attached && this.loadPct > 140) return this.fail('Constructieve overbelasting van de torenkraan.');
    if (this.assisting && Math.abs(this.towerMomentTm()) > ERECTION_MOMENT_LIMIT_TM) return this.fail('De torenkraan in aanbouw is uit balans: verkeerde ballastvolgorde.');
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

/** Breedte van het haakblok bij een bepaalde haakmassa. */
export const hookWidth = (massKg: number): number => 0.35 + 0.12 * Math.cbrt(massKg / 100);

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
    case 'switchCrane':
      return t.label ?? 'Overstappen naar de missiekraan';
  }
}
