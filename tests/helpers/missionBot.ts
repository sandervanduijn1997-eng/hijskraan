import type { CraneInput } from '../../src/cranes/controllers/craneInput';
import { emptyInput } from '../../src/cranes/controllers/craneInput';
import { axisMaxSpeed, rampTime } from '../../src/cranes/controllers/craneController';
import type { Axis } from '../../src/cranes/models/craneState';
import { cloneCraneState } from '../../src/cranes/models/craneState';
import { computeGeometry, solveBoomIK } from '../../src/cranes/models/kinematics';
import { staticDeflection } from '../../src/cranes/models/boomFlex';
import { allowedCapacityT } from '../../src/cranes/models/capacity';
import type { MissionDef, TaskDef } from '../../src/missions/data/types';
import { validateMission } from '../../src/missions/validation/validateMission';
import { loadBottomCenter } from '../../src/missions/validation/placement';
import type { DifficultyProfile } from '../../src/sim/difficulty';
import type { LoadRuntime } from '../../src/sim/simulation';
import { Simulation } from '../../src/sim/simulation';
import { DEG, clamp, wrapAngle } from '../../src/utils/math';

/**
 * Speelt een complete missie met dezelfde besturingsinvoer als een speler (geen spiekfuncties):
 * plannen, rijden, stempels/opbouw, over obstakels hijsen, uitslingeren en precies neerzetten.
 * Bedoeld om te vinden welke missies niet (of nauwelijks) uitvoerbaar zijn.
 */
export interface BotReport {
  id: string;
  title: string;
  outcome: string;
  reason: string;
  time: number;
  timeLimit?: number;
  stars: number;
  score: number;
  damage: number;
  collisions: number;
  maxSway: number;
  stuck: string;
  craneId: string;
}

type Targets = Partial<Record<'boomAngle' | 'boomLength' | 'trolley' | 'knuckle' | 'knuckleTele' | 'boomAngleK', number>>;

const FOLLOW = 0.5;

export class Bot {
  readonly sim: Simulation;
  phase = 'start';
  private kneeCache = new Map<string, Targets | null>();

  constructor(sim: Simulation) {
    this.sim = sim;
  }

  private get gb() {
    return this.sim.spec.gb;
  }

  /** Servo met remweg: stuur op een snelheid die op tijd kan afremmen. */
  private servo(axis: Axis, err: number, maxCmd = 1, deadband = 0.003): number {
    const vmax = axisMaxSpeed(this.sim.spec, axis);
    if (vmax <= 0) return 0;
    if (Math.abs(err) < deadband) return 0;
    const a = (vmax / rampTime(this.sim.spec, axis)) * 1.3;
    const v = Math.sign(err) * Math.min(vmax, Math.sqrt(2 * a * Math.abs(err)) * 0.75);
    return clamp(v / vmax, -maxCmd, maxCmd);
  }

  private ceilingY(): number {
    let y = Infinity;
    for (const o of this.sim.mission.obstacles) if (o.kind === 'ceiling') y = Math.min(y, o.y);
    return y;
  }

  /** Verwachte statische doorbuiging (m) in kraanstand st met de huidige kabelkracht. */
  private predictDeflection(st: ReturnType<typeof cloneCraneState>): number {
    const kind = this.sim.spec.cfg.kind;
    if (kind !== 'telescopic' && kind !== 'lattice') return 0;
    const L = kind === 'telescopic' ? st.boomLength : st.boomLength + (this.sim.spec.jibOptions[st.jibIndex] ?? 0);
    return staticDeflection(L, this.sim.tensionF / 9.81 / 1000, allowedCapacityT(this.sim.spec, st), st.boomAngle);
  }

  /** Gewenste kraanstand voor tip op straal u met minimale tiphoogte yMin. */
  private solve(u: number, yMin: number): Targets | null {
    const spec = this.sim.spec;
    const gb = this.gb;
    const s = this.sim.crane;
    const ceil = this.ceilingY() - 1.0;
    switch (spec.cfg.kind) {
      case 'tower':
        if (u < (gb.trolleyMin ?? 0) || u > (gb.jibLength ?? 0)) return null;
        return { trolley: u };
      case 'telescopic': {
        const yCap = Math.min(ceil, gb.pivotHeight + gb.boomMax);
        for (let y = Math.max(yMin, gb.pivotHeight + 1); y <= yCap; y += 0.5) {
          // plannen met de verwachte doorbuiging in die stand (zoals een machinist hoger aanhoudt)
          let ik = solveBoomIK(spec, u, y);
          const st = cloneCraneState(s);
          st.slew = 0;
          st.tilt = 0;
          for (let it = 0; it < 2; it++) {
            st.boomAngle = ik.angle;
            st.boomLength = ik.length;
            const d = this.predictDeflection(st);
            ik = solveBoomIK(spec, u - d * Math.sin(ik.angle), y + d * Math.cos(ik.angle));
          }
          st.boomAngle = ik.angle;
          st.boomLength = ik.length;
          st.boomDeflect = this.predictDeflection(st);
          const g = computeGeometry(spec, st);
          if (Math.abs(g.tipU - u) < 0.15 && g.tipHeight >= yMin - 0.05 && g.tipHeight <= ceil + 0.5) return { boomAngle: ik.angle, boomLength: ik.length };
        }
        return null;
      }
      case 'lattice': {
        let lo = gb.boomAngleMinDeg * DEG;
        let hi = gb.boomAngleMaxDeg * DEG;
        const st = cloneCraneState(s);
        st.slew = 0;
        st.tilt = 0;
        const tipAt = (a: number) => {
          st.boomAngle = a;
          st.boomDeflect = this.predictDeflection(st);
          return computeGeometry(spec, st);
        };
        if (tipAt(lo).tipU < u || tipAt(hi).tipU > u) return null;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          if (tipAt(mid).tipU > u) lo = mid;
          else hi = mid;
        }
        const g = tipAt((lo + hi) / 2);
        if (g.tipHeight < yMin - 0.05) return null;
        return { boomAngle: (lo + hi) / 2 };
      }
      case 'knuckle': {
        const key = `${u.toFixed(1)}|${yMin.toFixed(1)}`;
        if (this.kneeCache.has(key)) return this.kneeCache.get(key)!;
        let best: Targets | null = null;
        let bestScore = Infinity;
        const st = cloneCraneState(s);
        st.slew = 0;
        for (let a1 = gb.boomAngleMinDeg; a1 <= gb.boomAngleMaxDeg; a1 += 1.5) {
          for (let a2 = gb.knuckleMinDeg ?? -165; a2 <= (gb.knuckleMaxDeg ?? 20); a2 += 2) {
            for (let t = 0; t <= (gb.knuckleTeleMax ?? 0) + 1e-6; t += 0.25) {
              st.boomAngle = a1 * DEG;
              st.knuckle = a2 * DEG;
              st.knuckleTele = t;
              const g = computeGeometry(spec, st);
              const du = Math.abs(g.tipU - u);
              if (du > 0.12 || g.tipHeight < yMin || g.tipHeight > ceil) continue;
              // voorkeur: lage tip (korte kabel), weinig telescoop, armen boven het obstakel
              const score = (g.tipHeight - yMin) * 2 + t * 0.2 + du * 10;
              if (score < bestScore) {
                bestScore = score;
                best = { boomAngleK: a1 * DEG, knuckle: a2 * DEG, knuckleTele: t };
              }
            }
          }
        }
        this.kneeCache.set(key, best);
        return best;
      }
    }
  }

  /** Stuur alle assen naar de doelstand; geeft true als die bereikt is. */
  private drive(t: Targets, inp: CraneInput, maxCmd = 1): boolean {
    const s = this.sim.crane;
    let done = true;
    const set = (axis: Axis, err: number, tol: number) => {
      const c = this.servo(axis, err, maxCmd, tol * 0.5);
      (inp as unknown as Record<string, number>)[axis] = c;
      if (Math.abs(err) > tol || Math.abs(s.vel[axis]) > axisMaxSpeed(this.sim.spec, axis) * 0.05) done = false;
    };
    if (t.boomAngle !== undefined) set('luff', t.boomAngle - s.boomAngle, Math.min(0.002, 0.05 / Math.max(10, this.sim.geom.displayBoomLength)));
    if (t.boomAngleK !== undefined) set('luff', t.boomAngleK - s.boomAngle, 0.004);
    if (t.boomLength !== undefined) set('tele', t.boomLength - s.boomLength, 0.02);
    if (t.trolley !== undefined) set('trolley', t.trolley - s.trolley, 0.02);
    if (t.knuckle !== undefined) set('knuckle', t.knuckle - s.knuckle, 0.004);
    if (t.knuckleTele !== undefined) set('knuckleTele', t.knuckleTele - s.knuckleTele, 0.02);
    return done;
  }

  /** Werkrichting (rad): de bot werkt langs deze straal; x-waarden in de 2D-logica zijn posities langs deze lijn. */
  private aim = 0;

  /** Positie langs de werkrichting (als x-coördinaat: draaias + afstand langs de straal). */
  private along(p: { x: number; z?: number }): number {
    const g = this.sim.geom;
    return g.slewX + (p.x - g.slewX) * Math.cos(this.aim) + ((p.z ?? 0) - g.slewZ) * Math.sin(this.aim);
  }

  /** Richting vanaf de draaias naar een punt; ligt het punt vlak bij de as, dan de huidige richting. */
  private angleTo(p: { x: number; z?: number }): number {
    const g = this.sim.geom;
    const dx = p.x - g.slewX;
    const dz = (p.z ?? 0) - g.slewZ;
    return Math.hypot(dx, dz) < 0.5 ? this.aim : Math.atan2(dz, dx);
  }

  private slewTo(x: number, inp: CraneInput): boolean {
    const desired = x >= this.sim.geom.slewX ? this.aim : this.aim + Math.PI;
    const err = wrapAngle(desired - this.sim.crane.slew);
    inp.slew = this.servo('slew', err, 1, 0.0005);
    return Math.abs(err) < 0.002 && Math.abs(this.sim.crane.vel.slew) < 0.003;
  }

  private hoistTo(y: number, inp: CraneInput, maxCmd = 1): boolean {
    const err = y - this.sim.hookPoint().y;
    inp.hoist = this.servo('hoist', err, maxCmd, 0.02);
    return Math.abs(err) < 0.08;
  }

  /**
   * Hoogste obstakel (bovenkant) in het gebied dat de last doorloopt: van positie x0 langs richting a0
   * naar x1 langs richting a1 (een cirkelsector rond de draaias; zonder richtingen: de werklijn).
   */
  travelTop(x0: number, x1: number, pad: number, a0 = this.aim, a1 = this.aim): number {
    const g = this.sim.geom;
    const v0 = x0 - g.slewX;
    let v1 = x1 - g.slewX;
    let da = wrapAngle(a1 - a0);
    // tegenover elkaar op één lijn door de draaias: de werklijn zelf (zoals de 2D-missies)
    if (Math.abs(da) > Math.PI - 0.05) {
      v1 = -v1;
      da = 0;
    } else if (Math.abs(da) < 0.05) da = 0;
    const lo = Math.min(v0, v1) - pad;
    const hi = Math.max(v0, v1) + pad;
    const nA = Math.max(1, Math.ceil(Math.abs(da) * Math.max(Math.abs(lo), Math.abs(hi)) / 1.0));
    const nR = Math.max(2, Math.ceil((hi - lo) / 0.5));
    const pts: [number, number][] = [];
    for (let i = 0; i <= nA; i++) {
      const a = a0 + (da * i) / nA;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      for (let j = 0; j <= nR; j++) {
        const v = lo + ((hi - lo) * j) / nR;
        pts.push([g.slewX + v * c, g.slewZ + v * sn]);
      }
    }
    const zp = Math.max(1, pad);
    const hit = (minX: number, maxX: number, minZ: number, maxZ: number) => pts.some(([x, z]) => x > minX - 0.25 && x < maxX + 0.25 && z > minZ - zp && z < maxZ + zp);
    let top = 0;
    for (const c of this.sim.colliders) {
      if (c.kind === 'ceiling') continue;
      if (c.maxY <= top || !hit(c.minX, c.maxX, c.minZ, c.maxZ)) continue;
      top = c.maxY;
    }
    for (const l of this.sim.loads) {
      if (l === this.sim.attached || l.status === 'consumed') continue;
      const b = l.cb.body;
      if (b.pos.y + b.halfH <= top || !hit(b.pos.x - b.halfW, b.pos.x + b.halfW, b.pos.z - b.depth / 2, b.pos.z + b.depth / 2)) continue;
      top = b.pos.y + b.halfH;
    }
    return top;
  }

  /** Pick-and-carry: rijpositie zodat x binnen comfortabel bereik ligt. */
  private carryBase(x: number): number | null {
    const sim = this.sim;
    const half = sim.spec.cfg.visual.carrierLength / 2;
    const h = sim.spec.cfg.visual.carrierHeight + 1.2;
    const free = (bx: number) =>
      bx - half >= sim.mission.bounds.minX &&
      bx + half <= sim.mission.bounds.maxX &&
      !sim.colliders.some((c) => c.kind !== 'crane' && c.minY <= h && c.minZ < 1.6 && c.maxZ > -1.6 && bx + half > c.minX && bx - half < c.maxX);
    // voorkeur: straal rond 1,1 × de kortste giek (veel capaciteit), anders verder reiken; korte rit telt licht mee
    let best: number | null = null;
    let bestScore = Infinity;
    const ideal = this.gb.boomMin * 1.1;
    for (let bx = sim.mission.bounds.minX; bx <= sim.mission.bounds.maxX; bx += 0.25) {
      if (!free(bx)) continue;
      const u = Math.abs(x - (bx + this.gb.slewOffsetX));
      if (u < this.gb.boomMin * 0.6 || u > this.gb.boomMax * 0.9) continue;
      const score = Math.abs(u - ideal) * 3 + Math.abs(bx - sim.crane.baseX) * 0.1;
      if (score < bestScore) {
        bestScore = score;
        best = bx;
      }
    }
    return best;
  }

  private driveBase(x: number, inp: CraneInput): boolean {
    const err = x - this.sim.crane.baseX;
    inp.drive = this.servo('drive', err, 1, 0.03);
    return Math.abs(err) < 0.1 && Math.abs(this.sim.crane.vel.drive) < 0.03;
  }

  // ------------------------------------------------------------------ gedrag

  *run(cfg: { baseX: number } | undefined): Generator<CraneInput, void, void> {
    const sim = this.sim;
    const m = sim.mission;
    const needOutriggers = () => this.gb.outriggerCount > 0 && this.gb.setupType !== 'selfErect' && sim.spec.cfg.carrier !== 'carryDeck';
    for (const task of m.tasks) {
      const idx = m.tasks.indexOf(task);
      if (sim.tasks[idx].status === 'done') continue;
      if (task.type === 'setup') {
        this.phase = 'opbouw';
        while (sim.crane.setupProgress < 1) {
          const i = emptyInput();
          i.setupHold = true;
          yield i;
        }
      } else if (task.type === 'drive') {
        yield* this.stowOutriggers();
        this.phase = 'rijden naar werkpositie';
        const x = (task.x0 + task.x1) / 2;
        while (!this.driveBase(x, (this.tmp = emptyInput()))) yield this.tmp;
        for (let k = 0; k < 30; k++) yield emptyInput();
      } else if (task.type === 'outriggers') {
        if (cfg && Math.abs(cfg.baseX - sim.crane.baseX) > 0.3 && m.requirements.minGroundFactor) {
          yield* this.stowOutriggers();
          this.phase = 'rijden naar stevige ondergrond';
          while (!this.driveBase(cfg.baseX, (this.tmp = emptyInput()))) yield this.tmp;
        }
        yield* this.deployOutriggers();
      } else if (task.type === 'deliver') {
        if (needOutriggers() && sim.support.mode !== 'outriggers') yield* this.deployOutriggers();
        if (task.effect?.type === 'towerPart') yield* this.mount3D(task);
        else yield* this.deliver(task);
      } else if (task.type === 'switchCrane') {
        this.phase = 'overstappen';
        while ((sim.tasks[idx].status as string) !== 'done') yield emptyInput();
      } else if (task.type === 'stow') {
        this.phase = 'transportstand';
        // hulpkraan bij een torenmontage: eerst van de toren weg naar voren zwenken, dan pas de giek laten zakken
        if (sim.assisting) {
          for (let k = 0; k < 60 * 120; k++) {
            const i = emptyInput();
            const err = wrapAngle(0 - sim.crane.slew);
            i.slew = this.servo('slew', err, 0.7, 0.0005);
            this.hoistTo(sim.geom.tipHeight - this.gb.ropeMin - sim.hookH - 0.5, i);
            if (Math.abs(err) < 0.003 && Math.abs(sim.crane.vel.slew) < 0.003) break;
            yield i;
          }
        }
        for (;;) {
          const i = emptyInput();
          const t: Targets = sim.spec.cfg.kind === 'tower' ? { trolley: this.gb.trolleyMin ?? 0 } : { boomAngle: this.gb.boomAngleMinDeg * DEG + 0.01 };
          if (sim.spec.cfg.kind === 'telescopic') t.boomLength = this.gb.boomMin;
          const a = this.drive(t, i);
          // haak tot vlak onder de giekkop: nooit een doel onder de grond kiezen (dan viert de lier juist)
          const b = this.hoistTo(Math.max(0.3, sim.geom.tipHeight - this.gb.ropeMin - sim.hookH - 0.2), i);
          if ((sim.tasks[idx].status as string) === 'done') break;
          yield i;
          void a;
          void b;
        }
      }
    }
    for (;;) yield emptyInput();
  }

  private tmp: CraneInput = emptyInput();

  private *giveUp(reason: string): Generator<CraneInput> {
    this.phase = `FOUT: ${reason}`;
    for (;;) yield emptyInput();
  }

  private *stowOutriggers(): Generator<CraneInput> {
    const s = this.sim.crane;
    if (s.outriggerJack.some((j) => j > 0) || s.outriggerBeam.some((b) => b > 0)) {
      this.phase = 'stempels inhalen';
      this.sim.outriggerAuto.outriggerAuto = 'retract';
      while (s.outriggerJack.some((j) => j > 0) || s.outriggerBeam.some((b) => b > 0)) yield emptyInput();
    }
  }

  private *deployOutriggers(): Generator<CraneInput> {
    this.phase = 'stempels uitzetten';
    let t = 0;
    while (this.sim.support.mode !== 'outriggers' && t < 60 * 40) {
      if (this.sim.outriggerAuto.outriggerAuto === 'none') this.sim.outriggerAuto.outriggerAuto = 'deploy';
      t++;
      yield emptyInput();
    }
  }

  private *deliver(task: Extract<TaskDef, { type: 'deliver' }>): Generator<CraneInput> {
    const sim = this.sim;
    const load = sim.loads.find((l) => l.id === task.loadId)!;
    let zone = sim.mission.zones.find((z) => z.id === task.zoneId)!;
    const idx = sim.tasks.findIndex((t) => t.def === task);
    const carry = sim.spec.gb.driveWithLoadMaxPct >= 100;
    const lt = load.type;
    const ropeMin = this.gb.ropeMin;
    const hookH = sim.hookH;

    // wacht tot de taak actief is (volgorde)
    while (sim.tasks[idx].status === 'pending') yield emptyInput();

    // 1. lege haak omhoog (werkrichting: eerst naar de last, daarna naar de zone)
    const sp = sim.slingPoint(load);
    const aFrom = this.angleTo(sim.hookPoint());
    const aLoad = this.angleTo(sp);
    let aZone = this.angleTo(zone);
    this.aim = aFrom;
    const hookAlong = this.along(sim.hookPoint());
    this.aim = aLoad;
    const hookTravel = Math.max(sp.y + 0.6, this.travelTop(hookAlong, this.along(sp), 1.5, aFrom, aLoad) + 2.0);
    this.phase = 'haak omhoog';
    for (let k = 0; k < 60 * 40; k++) {
      const i = emptyInput();
      if (this.hoistTo(Math.min(hookTravel, sim.geom.tipHeight - ropeMin - hookH - 0.3), i)) break;
      yield i;
    }

    // 2. tip boven het hijspunt
    this.phase = 'naar de last';
    yield* this.moveTipTo(this.along(sp), hookTravel + hookH + ropeMin + 0.5, () => sim.hookPoint().y < hookTravel - 0.5 ? hookTravel : undefined, carry);
    this.aim = this.angleTo(sim.slingPoint(load));

    // 3. haak laten zakken en aanslaan
    this.phase = 'aanslaan';
    const lowerSecs = 60 + Math.abs(sim.hookPoint().y - sp.y) / (this.gb.hoistSpeed * 0.4);
    for (let k = 0; k < 60 * lowerSecs && !sim.attached; k++) {
      const i = emptyInput();
      const p = sim.slingPoint(load);
      this.keepTipOver(this.along(p), i);
      this.hoistTo(p.y + 0.15, i, 0.6);
      if (sim.attachCandidate() === load && Math.abs(this.along(sim.geom.tip) - this.along(p)) < 0.3) {
        sim.toggleRigging();
        break;
      }
      yield i;
    }
    if (!sim.attached) {
      yield* this.giveUp('kon de last niet aanslaan');
      return;
    }

    // de opdrachtgever kan bij het aanslaan een andere afzetplek opgeven
    const cur = sim.tasks[idx].def;
    if (cur.type === 'deliver' && cur.zoneId !== zone.id) {
      zone = sim.mission.zones.find((z) => z.id === cur.zoneId)!;
      aZone = this.angleTo(zone);
    }

    // 4. heffen tot boven alle obstakels tussen hier en de zone
    // marge boven obstakels: ruim waar het kan, maar binnen wat de kraan op beide stralen (en onder een dak) haalt
    const loadAlong = this.along(load.cb.body.pos);
    this.aim = aZone;
    const zoneAlong = this.along(zone);
    this.aim = aLoad;
    const top = this.travelTop(loadAlong, zoneAlong, lt.width / 2 + 0.1, aLoad, aZone);
    const reachTop = Math.min(this.maxTipHeight(this.polar(load.cb.body.pos.x, load.cb.body.pos.z).u), this.maxTipHeight(this.polar(zone.x, zone.z ?? 0).u), this.ceilingY() - 1.0);
    const maxBottom = reachTop - 0.45 - ropeMin - hookH - lt.slingHeight - lt.height;
    const clear = Math.max(top + 0.3, Math.min(top + 2.5, maxBottom));
    const hookY = clear + lt.height + lt.slingHeight;
    this.phase = 'heffen';
    // recht omhoog: eerst de lier; staat de kabel op zijn kortst, dan de giekpunt verticaal optillen (zelfde straal)
    const u0 = Math.abs(sim.geom.tipU);
    const x0 = this.along(sim.geom.tip);
    const liftSecs = 120 + Math.abs(hookY - sim.hookPoint().y) / (this.gb.hoistSpeed * 0.25);
    for (let k = 0; k < 60 * liftSecs; k++) {
      const i = emptyInput();
      if (sim.outcome !== 'running') return;
      const hookOk = this.hoistTo(hookY, i);
      if (hookOk) break;
      const ropeShort = sim.rope.length <= ropeMin + 0.15;
      if (ropeShort || sim.geom.tipHeight < hookY + hookH + ropeMin + 0.2) {
        const t = this.solve(u0, sim.geom.tipHeight + 0.5);
        if (t) this.drive(t, i, 0.35);
      } else this.keepTipOver(x0, i);
      yield i;
    }
    if (sim.hookPoint().y < hookY - 0.6) {
      yield* this.giveUp(`kon niet hoog genoeg heffen (haak ${sim.hookPoint().y.toFixed(1)} m, nodig ${hookY.toFixed(1)} m)`);
      return;
    }

    // 5. naar de zone: bij de zone hoeft de tip alleen hoog genoeg te zijn voor de obstakels daar
    this.phase = 'naar de zone';
    const cur2 = sim.tasks[idx].def;
    if (cur2.type === 'deliver' && cur2.zoneId !== zone.id) {
      zone = sim.mission.zones.find((z) => z.id === cur2.zoneId)!;
      aZone = this.angleTo(zone);
    }
    this.aim = aZone;
    let zx = this.along(zone);
    const nearTop = Math.max(zone.y, this.travelTop(zx, zx, lt.width / 2 + 0.1));
    const destY = Math.min(hookY, nearTop + 0.5 + lt.height + lt.slingHeight);
    // liefst op transporthoogte naar de zone; alleen als dat daar niet kan, op de (lagere) hoogte die de zone vraagt
    const transitTip = hookY + hookH + ropeMin + 0.4;
    const uZone = Math.abs(zx - sim.geom.slewX);
    const yTarget = this.solve(uZone, transitTip) ? transitTip : destY + hookH + ropeMin + 0.4;
    yield* this.moveTipTo(zx, yTarget, () => Math.min(hookY, sim.geom.tipHeight - ropeMin - hookH - 0.2), carry);
    // na eventueel rijden: werkrichting en zonepositie opnieuw
    this.aim = this.angleTo(zone);
    zx = this.along(zone);

    // 6. uitslingeren
    this.phase = 'uitslingeren';
    for (let k = 0; k < 60 * 60; k++) {
      const i = emptyInput();
      this.keepTipOver(this.tipTargetFor(load, zx), i);
      this.hoistTo(hookY, i);
      if (sim.swayDeg < 0.4 && Math.abs(load.cb.body.vel.x * Math.cos(this.aim) + load.cb.body.vel.z * Math.sin(this.aim)) < 0.03) break;
      yield i;
    }

    // 7. neerzetten met correctie; staat de last naast de zone, dan iets optillen en opnieuw
    this.phase = 'neerzetten';
    let retries = 0;
    for (let k = 0; k < 60 * 240; k++) {
      if (sim.tasks[idx].status === 'done' || sim.outcome !== 'running') return;
      const i = emptyInput();
      const bc = loadBottomCenter(load.cb.body);
      const resting = load.cb.supports.size > 0 || load.cb.body.sleeping;
      if (resting && Math.abs(this.along(bc) - zx) > zone.tolerance * 0.85 && retries < 4) {
        retries++;
        this.phase = `neerzetten (correctie ${retries})`;
        const up = sim.hookPoint().y + 0.8;
        for (let q = 0; q < 60 * 30; q++) {
          const j = emptyInput();
          if (this.hoistTo(up, j)) break;
          yield j;
        }
        this.offF = this.along(loadBottomCenter(load.cb.body)) - this.along(sim.geom.tip);
        for (let q = 0; q < 60 * 40; q++) {
          const j = emptyInput();
          this.keepTipOver(this.tipTargetFor(load, zx), j);
          this.hoistTo(up, j);
          if (q > 120 && sim.swayDeg < 0.3 && Math.abs(this.along(loadBottomCenter(load.cb.body)) - zx) < zone.tolerance * 0.4) break;
          yield j;
        }
        continue;
      }
      this.keepTipOver(this.tipTargetFor(load, zx), i);
      const above = bc.y - zone.y;
      const settled = sim.swayDeg < 0.6;
      // de laatste meters (en vlak boven obstakels bij de zone) pas zakken als de last stil hangt en uitgelijnd is
      const sideTop = Math.max(zone.y, this.travelTop(zx, zx, lt.width / 2 + 1.5));
      const aboveSide = bc.y - sideTop;
      // afzetplek nog niet vrij: last vasthouden, ruim boven de plek en de obstakels ernaast
      if (sim.time < sim.zoneReadyAt && !resting) {
        i.hoist = this.servo('hoist', Math.max(1.5 - above, 1.2 - aboveSide), 0.5, 0.02);
        yield i;
        continue;
      }
      const aligned = Math.abs(this.along(bc) - zx) < Math.min(zone.tolerance * 0.6, 0.25) && sim.swayDeg < 1.0;
      const resting0 = load.cb.supports.size > 0 || load.cb.body.sleeping;
      if (!resting0 && !aligned && (aboveSide < 1.2 || above < 1.2)) {
        i.hoist = aboveSide < 0.6 ? this.servo('hoist', 0.6 - aboveSide, 0.4, 0.02) : 0;
        yield i;
        continue;
      }
      // zoals een speler: grof tot ~1 m boven het vlak, daarna precisie (Shift) met volle toets
      if (load.cb.supports.size > 0 || load.cb.body.sleeping) {
        i.precision = true;
        i.hoist = -1;
      } else if (!settled && above < 1.0) i.hoist = 0;
      else if (above > 1.5 && aboveSide > 1.2) i.hoist = this.servo('hoist', -Math.min(above - 0.9, aboveSide - 0.8), 1, 0.02);
      else {
        i.precision = true;
        i.hoist = -1;
      }
      yield i;
    }
  }

  private offF = 0;

  // ------------------------------------------------------------------ montage in 3D (hulpkraan)

  /** Straal en draaihoek vanaf de draaias naar (x, z). */
  private polar(x: number, z: number): { u: number; a: number } {
    const g = this.sim.geom;
    return { u: Math.hypot(x - g.slewX, z - g.slewZ), a: Math.atan2(z - g.slewZ, x - g.slewX) };
  }

  /** Tip naar boven (x, z) op hoogte tipY (telescoopkraan). Geeft true als de stand bereikt is. */
  private tipTo3D(x: number, z: number, tipY: number, inp: CraneInput, maxCmd = 0.7): boolean {
    const p = this.polar(x, z);
    const ik = this.ikDeflected(p.u, tipY);
    let err = wrapAngle(p.a - this.sim.crane.slew);
    // niet met de giek over de toren in aanbouw zwenken: dan de andere kant om (achterlangs)
    const asm = this.sim.assembly;
    if (asm && !asm.switched) {
      const aT = this.polar(asm.layout.x, asm.layout.z).a;
      const rel = wrapAngle(aT - this.sim.crane.slew);
      const crosses = Math.sign(rel) === Math.sign(err) && Math.abs(rel) < Math.abs(err) - 0.2 && Math.abs(rel) > 0.2;
      if (crosses) err -= Math.sign(err) * Math.PI * 2;
    }
    inp.slew = this.servo('slew', err, maxCmd, 0.0004);
    const slewOk = Math.abs(err) < 0.0015 && Math.abs(this.sim.crane.vel.slew) < 0.003;
    const boomOk = this.drive({ boomAngle: ik.angle, boomLength: ik.length }, inp, maxCmd);
    return slewOk && boomOk;
  }

  /** Hoogste bovenkant van obstakels en lasten in het gebied tussen twee punten (x, z). */
  private top3D(x0: number, z0: number, x1: number, z1: number, hw: number, hd: number, skip: LoadRuntime): number {
    const lx = Math.min(x0, x1) - hw - 0.3;
    const hx = Math.max(x0, x1) + hw + 0.3;
    const lz = Math.min(z0, z1) - hd - 0.3;
    const hz = Math.max(z0, z1) + hd + 0.3;
    let top = 0;
    for (const c of this.sim.colliders) {
      if (c.kind === 'ceiling' || c.kind === 'crane') continue;
      if (c.maxX < lx || c.minX > hx || c.maxZ < lz || c.minZ > hz) continue;
      top = Math.max(top, c.maxY);
    }
    for (const l of this.sim.loads) {
      if (l === skip || l.status === 'consumed') continue;
      const b = l.cb.body;
      if (b.pos.x + b.halfW < lx || b.pos.x - b.halfW > hx || b.pos.z + b.depth / 2 < lz || b.pos.z - b.depth / 2 > hz) continue;
      top = Math.max(top, b.pos.y + b.halfH);
    }
    return top;
  }

  /** Torenkraandeel oppakken en monteren met de hulpkraan, zoals een machinist: hoog genoeg, uitslingeren, precies plaatsen. */
  private *mount3D(task: Extract<TaskDef, { type: 'deliver' }>): Generator<CraneInput> {
    const sim = this.sim;
    const load = sim.loads.find((l) => l.id === task.loadId)!;
    const zone = sim.mission.zones.find((z) => z.id === task.zoneId)!;
    const zz = zone.z ?? 0;
    const idx = sim.tasks.findIndex((t) => t.def === task);
    const lt = load.type;
    const ropeMin = this.gb.ropeMin;
    const hookH = sim.hookH;
    const done = () => (sim.tasks[idx].status as string) === 'done' || sim.outcome !== 'running';
    while (sim.tasks[idx].status === 'pending') yield emptyInput();

    // 1. lege haak omhoog en boven het hijspunt
    const sp = sim.slingPoint(load);
    const hp0 = sim.hookPoint();
    const emptyClear = Math.max(sp.y + 0.8, this.top3D(hp0.x, hp0.z, sp.x, sp.z, 0.5, 0.5, load) + 1.5);
    this.phase = `${load.id}: naar de last`;
    for (let k = 0; k < 60 * 120; k++) {
      const i = emptyInput();
      const tipY = emptyClear + hookH + ropeMin + 1;
      const hookOk = this.hoistTo(Math.min(emptyClear, sim.geom.tipHeight - ropeMin - hookH - 0.3), i);
      const high = sim.hookPoint().y > emptyClear - 0.6;
      const at = high ? this.tipTo3D(sp.x, sp.z, tipY, i) : this.tipTo3D(sim.geom.tip.x, sim.geom.tip.z, Math.max(tipY, sim.geom.tipHeight), i);
      if (at && hookOk && high && sim.swayDeg < 1) break;
      yield i;
    }
    // 2. zakken en aanslaan
    this.phase = `${load.id}: aanslaan`;
    for (let k = 0; k < 60 * 120 && !sim.attached; k++) {
      const i = emptyInput();
      const p = sim.slingPoint(load);
      this.tipTo3D(p.x, p.z, sim.geom.tipHeight, i, 0.4);
      this.hoistTo(p.y + 0.15, i, 0.6);
      if (sim.attachCandidate() === load) {
        sim.toggleRigging();
        break;
      }
      yield i;
    }
    if (!sim.attached) {
      yield* this.giveUp(`${load.id}: kon niet aanslaan`);
      return;
    }
    // 3. heffen tot boven alles tussen hier en de montagepositie
    const b = load.cb.body;
    const clear = this.top3D(b.pos.x, b.pos.z, zone.x, zz, b.halfW, b.depth / 2, load) + 0.6;
    const carryBottom = Math.max(clear, zone.y + (task.hold ? 1.6 : 0.6));
    const hookY = carryBottom + lt.height + lt.slingHeight;
    const tipY = hookY + hookH + ropeMin + 0.6;
    this.phase = `${load.id}: heffen`;
    for (let k = 0; k < 60 * 180; k++) {
      const i = emptyInput();
      if (sim.outcome !== 'running') return;
      const ok = this.hoistTo(hookY, i);
      this.tipTo3D(b.pos.x, b.pos.z, Math.max(tipY, sim.geom.tipHeight), i, 0.35);
      if (ok) break;
      yield i;
    }
    // 4. naar de montagepositie; giek en tegengiek eerst iets buiten hun plek (van de toren af) laten aankomen
    const tx = sim.assembly?.layout.x ?? zone.x;
    const ax = task.hold ? zone.x + Math.sign(zone.x - tx) * 4 : zone.x;
    this.phase = `${load.id}: naar montagepositie`;
    for (let k = 0; k < 60 * 240; k++) {
      const i = emptyInput();
      if (sim.outcome !== 'running') return;
      this.hoistTo(hookY, i);
      if (this.tipTo3D(ax, zz, tipY, i, task.hold ? 0.3 : 0.5)) break;
      yield i;
    }
    // uitslingeren buiten de plek, dan langzaam inschuiven
    for (let k = 0; k < 60 * 60 && task.hold; k++) {
      const i = emptyInput();
      this.hoistTo(hookY, i);
      this.tipTo3D(ax, zz, tipY, i, 0.3);
      if (sim.swayDeg < 0.3) break;
      yield i;
    }
    // 5. uitslingeren en fijn uitlijnen (vaste afwijking compenseren)
    this.phase = `${load.id}: uitlijnen`;
    let offX = 0;
    let offZ = 0;
    // vanaf het aanlooppunt langzaam (0,25 m/s) naar binnen schuiven, zodat de last niet doorslingert
    let gx = ax;
    for (let k = 0; k < 60 * 120; k++) {
      const i = emptyInput();
      const bc = loadBottomCenter(b);
      const ex = bc.x - zone.x;
      const ez = bc.z - zz;
      gx += Math.sign(zone.x - gx) * Math.min(Math.abs(zone.x - gx), 0.25 / 60);
      const arrived = Math.abs(gx - zone.x) < 1e-3;
      if (arrived && sim.swayDeg < 0.5 && load.cb.touching.size === 0) {
        offX += ex * (1 / 60 / 1.5);
        offZ += ez * (1 / 60 / 1.5);
      }
      this.hoistTo(hookY, i);
      this.tipTo3D(gx - offX, zz - offZ, tipY, i, 0.3);
      if (arrived && k > 180 && sim.swayDeg < 0.25 && Math.abs(ex) < zone.tolerance * 0.35 && Math.abs(ez) < (zone.zTolerance ?? 1) * 0.35) break;
      yield i;
    }
    // 6. plaatsen: neerzetten op het vlak, of in de lucht stil houden tot de monteurs klaar zijn
    this.phase = `${load.id}: ${task.hold ? 'vasthouden' : 'neerzetten'}`;
    for (let k = 0; k < 60 * 240; k++) {
      if (done()) return;
      const i = emptyInput();
      const bc = loadBottomCenter(b);
      this.tipTo3D(zone.x - offX, zz - offZ, sim.geom.tipHeight, i, 0.25);
      const above = bc.y - zone.y;
      if (task.hold) {
        i.precision = Math.abs(above) < 0.6;
        i.hoist = this.servo('hoist', -above, i.precision ? 1 : 0.6, 0.01);
        if (Math.abs(above) < 0.05) i.hoist = 0;
      } else if (load.cb.supports.size > 0 || b.sleeping) {
        i.precision = true;
        i.hoist = -1;
      } else if (above > 1.2) i.hoist = this.servo('hoist', -(above - 0.9), 1, 0.02);
      else if (sim.swayDeg < 0.6) {
        i.precision = true;
        i.hoist = -1;
      }
      yield i;
    }
    if (!done()) yield* this.giveUp(`${load.id}: niet geplaatst (${sim.placementHint?.reasons.join(', ')})`);
  }

  /**
   * Doel-x voor de giekpunt zodat de last boven x komt te staan:
   * een langzaam gefilterde vaste afwijking (excentrisch zwaartepunt) wordt gecompenseerd, en de tip
   * beweegt licht mee mét de slinger, wat de slinger dempt (zoals een machinist doet).
   */
  private tipTargetFor(load: LoadRuntime, x: number): number {
    const b = load.cb.body;
    const off = this.along(loadBottomCenter(b)) - this.along(this.sim.geom.tip);
    // filtertijd minstens één slingerperiode, anders volgt de schatting de slinger zelf
    const tip = this.sim.geom.tip;
    const period = 2 * Math.PI * Math.sqrt(Math.max(1, tip.y - loadBottomCenter(b).y) / 9.81);
    this.offF += (off - this.offF) * (1 / 60 / Math.max(2.5, period));
    return x - this.offF + FOLLOW * (off - this.offF);
  }

  offFValue(): number {
    return this.offF;
  }

  private keepTipOver(x: number, inp: CraneInput): void {
    const sim = this.sim;
    if (!this.slewTo(x, inp)) return;
    const u = Math.abs(x - sim.geom.slewX);
    const t = this.solveNear(u);
    if (t) this.drive(t, inp, 0.5);
  }

  /** Hoogst haalbare tip op straal u (voor het kiezen van een veilige transporthoogte). */
  maxTipHeight(u: number): number {
    const spec = this.sim.spec;
    const gb = this.gb;
    const st = cloneCraneState(this.sim.crane);
    st.slew = 0;
    st.tilt = 0;
    let best = -Infinity;
    if (spec.cfg.kind === 'tower') return computeGeometry(spec, st).tipHeight;
    if (spec.cfg.kind === 'lattice') {
      const t = this.solve(u, 0);
      if (!t) return -Infinity;
      st.boomAngle = t.boomAngle!;
      return computeGeometry(spec, st).tipHeight;
    }
    if (spec.cfg.kind === 'telescopic') {
      for (let L = gb.boomMin; L <= gb.boomMax + 1e-6; L += 0.5) {
        const c = (u - gb.pivotU) / L;
        if (c > 1 || c < Math.cos(gb.boomAngleMaxDeg * DEG)) continue;
        // minus de verwachte doorbuiging met de huidige last in die stand
        st.boomLength = L;
        st.boomAngle = Math.acos(c);
        const d = this.predictDeflection(st);
        best = Math.max(best, gb.pivotHeight + L * Math.sqrt(1 - c * c) - d * c - d * 0.5);
      }
      return best;
    }
    for (let a1 = gb.boomAngleMinDeg; a1 <= gb.boomAngleMaxDeg; a1 += 2) {
      for (let a2 = gb.knuckleMinDeg ?? -165; a2 <= (gb.knuckleMaxDeg ?? 20); a2 += 3) {
        for (let t = 0; t <= (gb.knuckleTeleMax ?? 0) + 1e-6; t += 0.5) {
          st.boomAngle = a1 * DEG;
          st.knuckle = a2 * DEG;
          st.knuckleTele = t;
          const g = computeGeometry(spec, st);
          if (Math.abs(g.tipU - u) < 0.2) best = Math.max(best, g.tipHeight);
        }
      }
    }
    return best;
  }

  /** Inverse kinematica met compensatie voor de huidige doorbuiging van de giek (zoals een machinist bijstuurt). */
  private ikDeflected(u: number, y: number): { angle: number; length: number } {
    const d = this.sim.crane.boomDeflect;
    const th = this.sim.geom.displayBoomAngle;
    return solveBoomIK(this.sim.spec, u - d * Math.sin(th), y + d * Math.cos(th));
  }

  /** Doelstand op straal u met behoud van de huidige tiphoogte (fijncorrectie). */
  private solveNear(u: number): Targets | null {
    const sim = this.sim;
    const kind = sim.spec.cfg.kind;
    if (kind === 'tower') return this.solve(u, 0);
    if (kind === 'lattice') return this.solve(u, 0);
    if (kind === 'telescopic') {
      const ik = this.ikDeflected(u, sim.geom.tipHeight);
      return { boomAngle: ik.angle, boomLength: ik.length };
    }
    return this.solve(u, Math.max(0, sim.geom.tipHeight - 0.6));
  }

  /** Verplaats de tip naar boven x met minimale tiphoogte; rijdt eerst indien nodig (pick-and-carry). */
  private *moveTipTo(x0: number, yMin: number, hookHold: () => number | undefined, carry: boolean): Generator<CraneInput> {
    const sim = this.sim;
    let x = x0;
    let u = Math.abs(x - sim.geom.slewX);
    let target = this.solve(u, yMin);
    if ((!target || carry) && sim.spec.gb.driveSpeed > 0 && carry) {
      // rijden gaat langs x: positie langs de werkrichting terug naar een wereldpunt
      const wx = sim.geom.slewX + (x - sim.geom.slewX) * Math.cos(this.aim);
      const wz = sim.geom.slewZ + (x - sim.geom.slewX) * Math.sin(this.aim);
      const bx = this.carryBase(wx);
      if (bx !== null && Math.abs(bx - sim.crane.baseX) > 0.2) {
        const prev = this.phase;
        this.phase = `${prev} (rijden)`;
        for (let k = 0; k < 60 * 120; k++) {
          const i = emptyInput();
          const hh = hookHold();
          if (hh !== undefined) this.hoistTo(hh, i);
          if (this.driveBase(bx, i)) break;
          yield i;
        }
        this.phase = prev;
        // na het rijden: werkrichting en positie opnieuw bepalen
        this.aim = this.angleTo({ x: wx, z: wz });
        x = this.along({ x: wx, z: wz });
        u = Math.abs(x - sim.geom.slewX);
        target = this.solve(u, yMin);
      }
    }
    if (!target) target = this.solve(u, Math.min(yMin, sim.geom.tipHeight));
    // terugval: stapsgewijs lager zoeken (de last hangt dan lager, maar alleen vlak bij het doel)
    for (let y = yMin - 0.25; !target && y > yMin - 2.5; y -= 0.25) target = this.solve(u, y);
    if (!target) {
      yield* this.giveUp(`geen kraanstand voor straal ${u.toFixed(1)} m en hoogte ${yMin.toFixed(1)} m`);
      return;
    }
    // zwenken op de kleinste van huidige en doelstraal (meeste capaciteit); daarna pas naar de doelstraal
    const uNow = Math.abs(sim.geom.tipU);
    let slewTarget = u < uNow ? target : this.solve(uNow, Math.min(yMin, sim.geom.tipHeight)) ?? target;
    let boost = 0;
    for (let k = 0; k < 60 * 240; k++) {
      const i = emptyInput();
      // giek raakt een obstakel: kies een hogere giekstand (zoals een speler de giek verder opheft)
      if (sim.lastControl.boomHit && boost < 6) {
        boost += 0.5;
        target = this.solve(u, yMin + boost) ?? target;
        slewTarget = this.solve(Math.min(u, uNow), Math.min(yMin, sim.geom.tipHeight) + boost) ?? slewTarget;
      }
      const hh = hookHold();
      if (hh !== undefined) this.hoistTo(hh, i);
      const slewed = this.slewTo(x, i);
      let goal = slewed ? target : slewTarget;
      // met last naar buiten: eerst uitschuiven, dan pas de giek laten zakken (de last zakt dan niet tussendoor)
      if (sim.attached && goal.boomLength !== undefined && goal.boomAngle !== undefined && goal.boomLength > sim.crane.boomLength + 0.3 && goal.boomAngle < sim.crane.boomAngle) {
        goal = { ...goal, boomAngle: sim.crane.boomAngle };
      }
      const reached = this.drive(goal, i, slewed ? 0.7 : 0.5) && goal === (slewed ? target : slewTarget);
      if (slewed && reached) return;
      if (sim.outcome !== 'running') return;
      yield i;
    }
    if (Math.abs(this.along(sim.geom.tip) - x) > 0.5) yield* this.giveUp(`kon de giekpunt niet boven x = ${x.toFixed(1)} krijgen (begrenzer: ${JSON.stringify(sim.lastControl.blocked)})`);
  }
}

export function playMission(m: MissionDef, difficulty: DifficultyProfile, maxSeconds = 1800, trace?: (line: string) => void): BotReport {
  const v = validateMission(m);
  const f = v.feasibility.find((x) => x.feasible) ?? v.feasibility[0];
  const cfg = f?.config;
  const sim = new Simulation({ mission: m, craneId: f?.craneId, difficulty, counterweightIndex: cfg?.cw, boomOptionIndex: cfg?.boom, jibIndex: cfg?.jib });
  const bot = new Bot(sim);
  const gen = bot.run(cfg);
  const steps = Math.round(maxSeconds * 60);
  let lastPhase = '';
  let lastDmg = 0;
  for (let k = 0; k < steps && sim.outcome === 'running'; k++) {
    const r = gen.next();
    sim.step(r.value ?? emptyInput());
    if (trace && (bot.phase !== lastPhase || sim.metrics.damage !== lastDmg || k % 120 === 0)) {
      const hp = sim.hookPoint();
      const l = sim.attached ? loadBottomCenter(sim.attached.cb.body) : null;
      const imp = sim.world.impacts.map((e) => `${e.bodyId}->${e.otherId}@${e.speed.toFixed(2)}`).join(' ');
      trace(`${sim.time.toFixed(1)} [${bot.phase}] tip=(${sim.geom.tip.x.toFixed(2)},${sim.geom.tip.y.toFixed(2)}) hook=(${hp.x.toFixed(2)},${hp.y.toFixed(2)}) load=${l ? `(${l.x.toFixed(2)},${l.y.toFixed(2)})` : '-'} sway=${sim.swayDeg.toFixed(1)} dmg=${sim.metrics.damage} pct=${sim.loadPct.toFixed(0)} blk=${JSON.stringify(sim.lastControl.blocked)} boom=${(sim.crane.boomAngle * 57.3).toFixed(1)}/${sim.crane.boomLength.toFixed(1)} rope=${sim.rope.length.toFixed(1)}/${sim.crane.ropeLength.toFixed(1)} vH=${sim.crane.vel.hoist.toFixed(2)} slack=${sim.rope.slack} stretch=${sim.rope.stretch.toFixed(2)} defl=${sim.crane.boomDeflect.toFixed(3)} offF=${bot.offFValue().toFixed(2)} ${imp}`);
      lastPhase = bot.phase;
      lastDmg = sim.metrics.damage;
    }
  }
  return {
    id: m.id,
    title: m.title,
    outcome: sim.outcome,
    reason: sim.outcome === 'running' ? `vastgelopen in fase "${bot.phase}"` : sim.failReason,
    time: Math.round(sim.time),
    timeLimit: m.timeLimit,
    stars: sim.score?.stars ?? 0,
    score: sim.score?.total ?? 0,
    damage: Math.round(sim.metrics.damage * 10) / 10,
    collisions: sim.metrics.collisions,
    maxSway: Math.round(sim.metrics.maxSwayDeg * 10) / 10,
    stuck: bot.phase,
    craneId: sim.missionSpec.cfg.id,
  };
}
