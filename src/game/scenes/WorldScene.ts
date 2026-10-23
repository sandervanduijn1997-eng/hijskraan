import Phaser from 'phaser';
import { audio } from '../../audio/audioEngine';
import type { CraneInput } from '../../cranes/controllers/craneInput';
import { emptyInput } from '../../cranes/controllers/craneInput';
import type { MissionDef } from '../../missions/data/types';
import { getLoad } from '../../missions/data/loads';
import { FIXED_DT, MAX_FRAME_DELTA, MAX_STEPS_PER_FRAME } from '../../physics/constants';
import { apexWorld } from '../../physics/load/rigidBody';
import type { SimEvent, SimOptions } from '../../sim/simulation';
import { Simulation } from '../../sim/simulation';
import { lerp } from '../../utils/math';
import { CameraDirector } from '../camera/cameraDirector';
import type { FramePoint } from '../camera/cameraDirector';
import type { EdgeAction, InputManager } from '../input/inputManager';
import { Background } from '../render/background';
import { LIVERIES, drawCrane } from '../render/craneRenderer';
import { Effects } from '../render/effects';
import { ENVIRONMENTS, SKIES } from '../render/palette';
import { drawGround, drawHook, drawLoad, drawLoadShadow, drawObstacle, drawRope, drawZone } from '../render/worldRenderer';

export type SessionMode = 'career' | 'practice' | 'challenge' | 'demo';

export interface SessionConfig {
  mode: SessionMode;
  sim: SimOptions;
  livery: string;
  challengeId?: string;
}

export interface SceneHooks {
  input: InputManager;
  onFrame(sim: Simulation, scene: WorldScene): void;
  onEvents(sim: Simulation, events: SimEvent[]): void;
  onEdge(action: EdgeAction, sim: Simulation): void;
  settings(): { cameraShake: boolean; particles: boolean };
}

const WATER: Record<string, [number, number][]> = {
  m23: [[9.5, 35]],
  m32: [[26.5, 120]],
  m38: [[14.5, 47.5]],
  m40: [[20, 120]],
};

/** Demo-besturing voor de menu-achtergrond: rustige, doorlopende bewegingen. */
function demoInput(t: number): CraneInput {
  const i = emptyInput();
  i.slew = Math.sin(t * 0.07) * 0.25;
  i.luff = Math.sin(t * 0.11 + 1) * 0.2;
  i.hoist = Math.sin(t * 0.17) * 0.3;
  return i;
}

export class WorldScene extends Phaser.Scene {
  sim!: Simulation;
  cfg!: SessionConfig;
  hooks!: SceneHooks;
  paused = false;
  private acc = 0;
  private bg!: Background;
  private staticG!: Phaser.GameObjects.Graphics;
  private craneG!: Phaser.GameObjects.Graphics;
  private dynG!: Phaser.GameObjects.Graphics;
  private zoneG!: Phaser.GameObjects.Graphics;
  private fxG!: Phaser.GameObjects.Graphics;
  private fx!: Effects;
  private camDir!: CameraDirector;
  private skyCam!: Phaser.Cameras.Scene2D.Camera;
  private zoneLabels: Phaser.GameObjects.Text[] = [];
  private demoT = 0;
  private dustTimer = 0;
  private overviewPts: FramePoint[] = [];

  constructor() {
    super('world');
  }

  init(data: { cfg: SessionConfig; hooks: SceneHooks }): void {
    this.cfg = data.cfg;
    this.hooks = data.hooks;
    this.paused = false;
    this.acc = 0;
    this.zoneLabels = [];
  }

  create(): void {
    const m = this.cfg.sim.mission;
    this.sim = new Simulation(this.cfg.sim);
    const pal = ENVIRONMENTS[m.environment];
    document.body.style.setProperty('--sky', Background.skyCss(m.timeOfDay, pal.indoor));
    this.bg = new Background(this, m.environment, m.timeOfDay, m.weather, m.id);
    // aparte camera zonder zoom voor de lucht
    this.skyCam = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'sky');
    // luchtcamera eerst renderen (achter de wereld)
    const cams = this.cameras.cameras;
    cams.unshift(cams.splice(cams.indexOf(this.skyCam), 1)[0]);
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');
    this.staticG = this.add.graphics().setDepth(0);
    this.zoneG = this.add.graphics().setDepth(5);
    this.craneG = this.add.graphics().setDepth(10);
    this.dynG = this.add.graphics().setDepth(20);
    this.fxG = this.add.graphics().setDepth(30);
    this.fx = new Effects(this.fxG);
    this.drawStatic(m);
    for (const z of m.zones) {
      const t = this.add.text(0, 0, z.label, { fontFamily: 'Barlow, Arial, sans-serif', fontSize: '15px', color: '#ffffff', backgroundColor: 'rgba(20,22,26,0.7)', padding: { x: 6, y: 3 } }).setOrigin(0.5, 1).setDepth(40);
      this.zoneLabels.push(t);
    }
    const sky = this.children.list.filter((o) => (o as Phaser.GameObjects.Graphics).scrollFactorX === 0);
    this.cameras.main.ignore(sky);
    this.skyCam.ignore(this.children.list.filter((o) => !sky.includes(o)));
    this.camDir = new CameraDirector(this.cameras.main);
    this.computeOverview(m);
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.onResize, this);
      this.bg.destroy();
    });
    audio.setMachineActive(this.cfg.mode !== 'demo', pal.indoor ? 0.3 : 0.7);
  }

  private onResize(size: Phaser.Structs.Size): void {
    this.skyCam.setSize(size.width, size.height);
  }

  private computeOverview(m: MissionDef): void {
    const pts: FramePoint[] = [{ x: m.crane.x - 12, y: 0 }, { x: m.crane.x + 12, y: 0 }];
    for (const o of m.obstacles) if (o.kind !== 'ceiling') pts.push({ x: o.x, y: o.y + o.h }, { x: o.x + o.w, y: 0 });
    for (const z of m.zones) pts.push({ x: z.x, y: z.y + 4 });
    for (const l of m.loads) pts.push({ x: l.x, y: l.y + 3 });
    const g = this.sim.geom;
    pts.push({ x: g.tip.x, y: g.tip.y + 3 });
    this.overviewPts = pts;
  }

  private drawStatic(m: MissionDef): void {
    const g = this.staticG;
    g.clear();
    const pal = ENVIRONMENTS[m.environment];
    drawGround(g, m, pal, WATER[m.id] ?? []);
    const light = SKIES[m.timeOfDay].light;
    const sorted = [...m.obstacles].sort((a, b) => (a.z0 ?? -40) - (b.z0 ?? -40) || (a.kind === 'ceiling' ? 1 : 0) - (b.kind === 'ceiling' ? 1 : 0));
    for (const o of sorted) drawObstacle(g, o, light);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    audio.setMachineActive(!p && this.cfg.mode !== 'demo');
  }

  update(time: number, deltaMs: number): void {
    const sim = this.sim;
    const dt = Math.min(MAX_FRAME_DELTA, deltaMs / 1000);
    const input = this.hooks.input;
    for (const e of input.consumeEdges()) {
      if (e === 'zoomIn') this.camDir.zoomBy(-1);
      else if (e === 'zoomOut') this.camDir.zoomBy(1);
      else if (e === 'overview') this.camDir.overview = !this.camDir.overview;
      else if (e === 'cameraReset') this.camDir.reset();
      else this.hooks.onEdge(e, sim);
    }
    const wheel = input.consumeWheel();
    if (wheel) this.camDir.zoomBy(wheel);

    if (!this.paused) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        let inp: CraneInput;
        if (this.cfg.mode === 'demo') {
          this.demoT += FIXED_DT;
          inp = demoInput(this.demoT);
        } else inp = input.readCrane(sim.spec.cfg.kind);
        sim.step(inp);
        this.acc -= FIXED_DT;
        steps++;
      }
      // bij grote vertraging: tijd gecontroleerd laten vallen (geen teleport)
      if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0;
      const ev = sim.drainEvents();
      if (ev.length) {
        this.handleFx(ev);
        this.hooks.onEvents(sim, ev);
      }
    }
    const alpha = this.paused ? 1 : Math.min(1, this.acc / FIXED_DT);
    this.render(time, dt, alpha);
    this.hooks.onFrame(sim, this);
  }

  private handleFx(ev: SimEvent[]): void {
    const st = this.hooks.settings();
    this.fx.enabled = st.particles;
    this.camDir.shakeEnabled = st.cameraShake;
    for (const e of ev) {
      if (e.type === 'impact') {
        const heavy = Math.min(1, e.mass / 50000);
        if (e.speed > 0.15) this.fx.dust(e.x, e.y, 0.5, Math.round(3 + e.speed * 6 + heavy * 8));
        if (e.obstacle && e.speed > 0.3) this.fx.debris(e.x, e.y, 0.5, 6);
        if (e.speed > 0.2) this.camDir.shake(Math.min(8, e.speed * 2 + heavy * 4));
      } else if (e.type === 'boomHit') {
        this.fx.sparks(e.x, e.y, 0, 14);
        this.camDir.shake(5);
      }
    }
  }

  private render(time: number, dt: number, alpha: number): void {
    const sim = this.sim;
    const m = sim.mission;
    const light = SKIES[m.timeOfDay].light;
    const night = m.timeOfDay === 'night' || m.timeOfDay === 'dusk';
    const cam = this.cameras.main;
    this.bg.update(time, dt, sim.wind.x, cam.scrollX);

    // kraan
    const livDef = LIVERIES[this.cfg.livery] ?? LIVERIES.standard;
    const liv = livDef.make(sim.spec.cfg.visual.bodyColor, sim.spec.cfg.visual.accentColor);
    const info = drawCrane(this.craneG, sim.spec, sim.crane, sim.geom, liv, time, night);

    // effecten van de machine
    const st = this.hooks.settings();
    if (!this.paused && st.particles) {
      this.fx.smoke(info.exhaust.x, info.exhaust.y, 0, sim.crane.engine, sim.wind.x);
      this.dustTimer += dt;
      if (Math.abs(sim.crane.vel.drive) > 0.2 && this.dustTimer > 0.08) {
        this.dustTimer = 0;
        for (const c of info.groundContacts.slice(0, 3)) this.fx.dust(c.x, 0, c.z, 1);
      }
    }
    this.fx.update(this.paused ? 0 : dt, sim.wind.x);

    // zones
    const zg = this.zoneG;
    zg.clear();
    const t = time / 1000;
    m.zones.forEach((z, i) => {
      const task = sim.tasks.find((tk) => tk.def.type === 'deliver' && tk.def.zoneId === z.id && tk.status !== 'done') ?? sim.tasks.find((tk) => tk.def.type === 'deliver' && tk.def.zoneId === z.id);
      const lt = task && task.def.type === 'deliver' ? sim.loads.find((l) => l.id === (task.def as { loadId: string }).loadId)?.type : undefined;
      const active = task?.status === 'active';
      const done = !!task && task.status === 'done';
      const halfW = (lt?.width ?? 1) / 2;
      drawZone(zg, z.x, z.y, halfW, z.tolerance, active, done, t, lt ? { w: lt.width, h: lt.height } : undefined);
      const label = this.zoneLabels[i];
      const p = { x: z.x * 24, y: -(z.y + (lt?.height ?? 1) + 1.2) * 24 };
      label.setPosition(p.x, p.y).setAlpha(done ? 0.5 : active ? 1 : 0.6).setScale(1 / Math.max(0.4, cam.zoom));
    });

    // lasten, haak, kabel
    const g = this.dynG;
    g.clear();
    const lerpBody = (id: string, b: { pos: { x: number; y: number; z: number }; angle: number }) => {
      const p = sim.prevSnap.get(id);
      if (!p) return { x: b.pos.x, y: b.pos.y, z: b.pos.z, angle: b.angle };
      return { x: lerp(p.x, b.pos.x, alpha), y: lerp(p.y, b.pos.y, alpha), z: lerp(p.z, b.pos.z, alpha), angle: lerp(p.angle, b.angle, alpha) };
    };
    const surfaceBelow = (x: number, y: number) => {
      let best = 0;
      for (const c of sim.colliders) if (c.landable && x >= c.minX && x <= c.maxX && c.maxY <= y + 0.05 && c.maxY > best) best = c.maxY;
      return best;
    };
    // schaduwen eerst
    for (const l of sim.loads) {
      if (l.status === 'consumed') continue;
      const b = l.cb.body;
      const by = b.pos.y - b.halfH;
      const sy = surfaceBelow(b.pos.x, by);
      if (by - sy > 0.05) drawLoadShadow(g, b, sy, by - sy);
    }
    const candidate = sim.attachCandidate();
    const sorted = [...sim.loads].filter((l) => l.status !== 'consumed').sort((a, b) => a.cb.body.pos.z - b.cb.body.pos.z);
    for (const l of sorted) {
      const p = lerpBody(l.id, l.cb.body);
      drawLoad(g, l.type, l.cb.body, p.x, p.y, p.z, p.angle, l.damage, l === candidate);
    }
    // kabel + haak
    const tip = sim.geom.tip;
    const prevTip = sim.prevTip;
    const tipI = { x: lerp(prevTip.x, tip.x, alpha), y: lerp(prevTip.y, tip.y, alpha), z: lerp(prevTip.z, tip.z, alpha) };
    const falls = sim.hookMassKg > 3000 ? 4 : sim.hookMassKg > 400 ? 2 : 1;
    if (sim.attached) {
      const b = sim.attached.cb.body;
      const p = lerpBody(sim.attached.id, b);
      const dx = p.x - b.pos.x;
      const dy = p.y - b.pos.y;
      const ap = apexWorld(b);
      const apex = { x: ap.x + dx, y: ap.y + dy, z: p.z };
      drawRope(g, tipI, apex, falls, sim.rope.slack);
      drawHook(g, apex.x, apex.y, apex.z, sim.hookW, sim.hookH, p.angle);
      // stroppen
      const lt = sim.attached.type;
      const hp = { x: apex.x + Math.sin(p.angle) * sim.hookH, y: apex.y - Math.cos(p.angle) * sim.hookH };
      const c = Math.cos(p.angle);
      const s = Math.sin(p.angle);
      const topY = b.boxOffset.y + b.halfH;
      for (const lx of [-b.halfW * 0.8, b.halfW * 0.8]) {
        const wx = p.x + (b.boxOffset.x + lx) * c - topY * s;
        const wy = p.y + (b.boxOffset.x + lx) * s + topY * c;
        const a0 = { x: hp.x * 24 - p.z * 0.32 * 24, y: -hp.y * 24 + p.z * 0.22 * 24 };
        const a1 = { x: wx * 24 - p.z * 0.32 * 24, y: -wy * 24 + p.z * 0.22 * 24 };
        g.lineStyle(Math.max(1, 1.6), lt.massKg > 20000 ? 0x2b2f36 : 0x2e86c1, 1);
        g.lineBetween(a0.x, a0.y, a1.x, a1.y);
      }
    } else if (sim.hookBody) {
      const b = sim.hookBody.body;
      const p = lerpBody(sim.hookBody.id, b);
      const ap = apexWorld(b);
      drawRope(g, tipI, { x: ap.x + (p.x - b.pos.x), y: ap.y + (p.y - b.pos.y), z: p.z }, falls, sim.rope.slack);
      drawHook(g, p.x - Math.sin(p.angle) * 0, p.y + b.halfH, p.z, sim.hookW, sim.hookH, p.angle);
    }
    void light;

    // camera
    const focus: FramePoint[] = [
      { x: sim.crane.baseX - sim.spec.cfg.visual.carrierLength / 2 - 2, y: 0 },
      { x: sim.crane.baseX + sim.spec.cfg.visual.carrierLength / 2 + 2, y: 0 },
      { x: tip.x, y: tip.y + 2, z: tip.z },
    ];
    const hp = sim.hookPoint();
    focus.push({ x: hp.x, y: hp.y - 2, z: hp.z });
    for (const tk of sim.tasks) {
      if (tk.status !== 'active') continue;
      if (tk.def.type === 'deliver') {
        const z = m.zones.find((zz) => zz.id === (tk.def as { zoneId: string }).zoneId);
        if (z) focus.push({ x: z.x, y: z.y }, { x: z.x, y: z.y + 3 });
        const ld = sim.loads.find((l) => l.id === (tk.def as { loadId: string }).loadId);
        if (ld && ld !== sim.attached && ld.status !== 'consumed') focus.push({ x: ld.cb.body.pos.x, y: ld.cb.body.pos.y });
      } else if (tk.def.type === 'drive') focus.push({ x: tk.def.x0, y: 0 }, { x: tk.def.x1, y: 0 });
    }
    this.camDir.update(dt, focus, this.overviewPts);
    this.bg.layout(cam, -14 * 0.22 * 24);
  }

  get overviewActive(): boolean {
    return this.camDir.overview;
  }

  /** Laadnaam (voor UI). */
  loadName(id: string): string {
    const l = this.sim.mission.loads.find((x) => x.id === id);
    return l ? getLoad(l.type).name : id;
  }
}
