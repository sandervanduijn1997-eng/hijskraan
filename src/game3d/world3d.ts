import * as THREE from 'three';
import { audio } from '../audio/audioEngine';
import type { CraneInput } from '../cranes/controllers/craneInput';
import type { CraneState } from '../cranes/models/craneState';
import type { CraneGeometry } from '../cranes/models/kinematics';
import { computeGeometry } from '../cranes/models/kinematics';
import { emptyInput } from '../cranes/controllers/craneInput';
import type { MissionDef } from '../missions/data/types';
import { FIXED_DT, MAX_FRAME_DELTA, MAX_STEPS_PER_FRAME } from '../physics/constants';
import type { RigidBody } from '../physics/load/rigidBody';
import type { SimEvent, SimOptions } from '../sim/simulation';
import { Simulation, hookWidth } from '../sim/simulation';
import { lerp } from '../utils/math';
import type { EdgeAction, InputManager } from '../game/input/inputManager';
import { ENVIRONMENTS, SKIES } from '../game/render/palette';
import { CameraRig } from './cameraRig';
import { disposeGroup } from './kit';
import type { FramePoint } from './cameraRig';
import { CraneModel, LIVERIES } from './craneModel';
import { Effects3D } from './effects3d';
import { buildHook, buildLoad } from './loadModel';
import { WorldModel, ZoneMarker } from './worldModel';
import { loadSky, realismEnabled, skyFor } from './realism';

export type SessionMode = 'career' | 'practice' | 'challenge' | 'demo';

export interface SessionConfig {
  mode: SessionMode;
  sim: SimOptions;
  livery: string;
  challengeId?: string;
}

export interface SceneHooks {
  input: InputManager;
  onFrame(sim: Simulation, scene: World3D): void;
  onEvents(sim: Simulation, events: SimEvent[]): void;
  onEdge(action: EdgeAction, sim: Simulation): void;
  settings(): { cameraShake: boolean; particles: boolean };
}

/** Demo-besturing voor de menu-achtergrond. */
function demoInput(t: number): CraneInput {
  const i = emptyInput();
  i.slew = Math.sin(t * 0.07) * 0.35;
  i.luff = Math.sin(t * 0.11 + 1) * 0.25;
  i.hoist = Math.sin(t * 0.17) * 0.3;
  return i;
}

const hexCss = (s: string) => new THREE.Color(s);

/**
 * Eén 3D-spelsessie: simulatie met vaste tijdstap, invoer, events en het opbouwen/bijwerken van de scène.
 * Vervangt de vroegere 2D-Phaser-scene; de interface naar de UI is gelijk gebleven.
 */
export class World3D {
  readonly sim: Simulation;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  paused = false;
  private acc = 0;
  private demoT = 0;
  private crane: CraneModel;
  /** Torenkraan in aanbouw (wordt na het overstappen de bediende kraan). */
  private tower: CraneModel | null = null;
  private erection: { state: CraneState; geom: CraneGeometry } | null = null;
  /** Geparkeerde hulpkraan met haak en kabel. */
  private parked: { model: CraneModel; hook: THREE.Group; rope: THREE.Line } | null = null;
  private world: WorldModel;
  private loads = new Map<string, { group: THREE.Group; inner: THREE.Group }>();
  private hook: THREE.Group;
  private ropes: THREE.Line[] = [];
  private slings: THREE.LineSegments;
  private zones: ZoneMarker[] = [];
  private labels: HTMLElement[] = [];
  private fx = new Effects3D();
  private sun: THREE.DirectionalLight;
  private overviewPts: FramePoint[] = [];
  private dustTimer = 0;
  private time = 0;
  private dome: THREE.Mesh;
  private hemi: THREE.HemisphereLight;
  /** Richting naar de zon (uit de HDRI zodra die geladen is). */
  private sunDir = new THREE.Vector3(0.45, 0.75, 0.5).normalize();
  private disposed = false;

  constructor(readonly cfg: SessionConfig, readonly hooks: SceneHooks, renderer: THREE.WebGLRenderer, labelRoot: HTMLElement) {
    const dom = renderer.domElement;
    const m = cfg.sim.mission;
    this.sim = new Simulation(cfg.sim);
    const pal = ENVIRONMENTS[m.environment];
    const sky = SKIES[m.timeOfDay];
    const night = m.timeOfDay === 'night' || m.timeOfDay === 'dusk';
    // lucht, mist en licht
    const top = pal.indoor ? new THREE.Color(0x1d2126) : hexCss(sky.top);
    const bottom = pal.indoor ? new THREE.Color(0x2b3036) : hexCss(sky.bottom);
    this.scene.background = bottom.clone().lerp(top, 0.35);
    this.dome = skyDome(top, bottom);
    this.scene.add(this.dome);
    this.scene.fog = new THREE.Fog(bottom.getHex(), pal.indoor ? 60 : 180, pal.indoor ? 220 : m.weather === 'fog' ? 260 : 900);
    const hemi = new THREE.HemisphereLight(top.getHex(), pal.indoor ? 0x30343a : 0x6b5a48, pal.indoor ? 0.9 : 1.1 * sky.light);
    this.hemi = hemi;
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(sky.sun, pal.indoor ? 0.6 : 2.4 * sky.light);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new THREE.AmbientLight(0xffffff, night ? 0.25 : 0.15));

    // fotorealistische lucht: HDRI als achtergrond én als omgevingslicht; de zon staat waar hij in de foto staat
    if (realismEnabled()) {
      const setup = skyFor(m.timeOfDay, m.weather);
      loadSky(renderer, setup.file).then((ls) => {
        if (this.disposed) return;
        this.scene.environment = ls.environment;
        this.scene.environmentIntensity = setup.environment * (pal.indoor ? 0.45 : 1);
        if (!pal.indoor) {
          this.scene.background = ls.background;
          this.scene.backgroundIntensity = setup.background;
          this.dome.visible = false;
          // luchtperspectief: lichte nevel in de tint van de horizon, pas op grote afstand
          const fog = new THREE.Color().setRGB(ls.horizon.r * 0.7, ls.horizon.g * 0.72, ls.horizon.b * 0.78, THREE.LinearSRGBColorSpace);
          this.scene.fog = m.weather === 'fog' ? new THREE.Fog(fog.getHex(), 40, 320) : new THREE.Fog(fog.getHex(), 300, 2600);
          this.sunDir.copy(ls.sunDir);
        }
        this.hemi.intensity = pal.indoor ? 0.5 : 0.12;
        this.sun.intensity = pal.indoor ? 0.5 : setup.sun;
        this.sun.color.setHex(setup.sunColor);
        renderer.toneMappingExposure = setup.exposure;
      }).catch(() => { /* zonder HDRI blijft de eenvoudige lucht staan */ });
    }

    this.world = new WorldModel(m, pal, sky);
    this.scene.add(this.world.root);

    const livDef = LIVERIES[cfg.livery] ?? LIVERIES.standard;
    const ms = this.sim.missionSpec;
    const missionModel = new CraneModel(ms, livDef.make(ms.cfg.visual.bodyColor, ms.cfg.visual.accentColor), night);
    this.scene.add(missionModel.root);
    if (this.sim.assisting) {
      // eerst bedien je de hulpkraan; de torenkraan groeit mee met de montage
      this.tower = missionModel;
      const as = this.sim.spec;
      this.crane = new CraneModel(as, LIVERIES.standard.make(as.cfg.visual.bodyColor, as.cfg.visual.accentColor), night);
      this.scene.add(this.crane.root);
      const st = this.sim.erectionState()!;
      this.erection = { state: st, geom: computeGeometry(ms, st) };
    } else this.crane = missionModel;

    for (const l of this.sim.loads) {
      const group = new THREE.Group();
      const inner = buildLoad(l.type);
      inner.position.set(l.cb.body.boxOffset.x, l.cb.body.boxOffset.y, 0);
      group.add(inner);
      this.scene.add(group);
      this.loads.set(l.id, { group, inner });
    }
    this.hook = this.buildHookMeshes();
    this.slings = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 8 }, () => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: 0x2e86c1 }));
    this.slings.frustumCulled = false;
    this.scene.add(this.slings);
    this.scene.add(this.fx.root);

    for (const z of m.zones) {
      const task = this.sim.tasks.find((t) => t.def.type === 'deliver' && t.def.zoneId === z.id);
      const lt = task && task.def.type === 'deliver' ? this.sim.loads.find((l) => l.id === (task.def as { loadId: string }).loadId)?.type : undefined;
      const marker = new ZoneMarker(z.x, z.y, (lt?.width ?? 1) / 2, z.tolerance, z.zTolerance ?? 1, lt ? { w: lt.width, h: lt.height, d: Math.min(lt.depth, 6) } : undefined, z.z ?? 0);
      this.zones.push(marker);
      this.scene.add(marker.root);
      const el = document.createElement('div');
      el.className = 'zone-label';
      el.textContent = z.label;
      labelRoot.append(el);
      this.labels.push(el);
    }

    this.rig = new CameraRig(dom);
    if (cfg.mode === 'demo') {
      this.rig.autoOrbit = 0.03;
      this.rig.pitch = 0.22;
      this.rig.userZoom = 0.8;
    }
    this.computeOverview(m);
    audio.setMachineActive(cfg.mode !== 'demo', pal.indoor ? 0.3 : 0.7);
  }

  /** Haakblok en kabelparten voor de bediende kraan. */
  private buildHookMeshes(): THREE.Group {
    for (const r of this.ropes) {
      this.scene.remove(r);
      r.geometry.dispose();
    }
    this.ropes = [];
    const hook = buildHook(this.sim.hookW, this.sim.hookH);
    this.scene.add(hook);
    const falls = this.sim.hookMassKg > 3000 ? 4 : this.sim.hookMassKg > 400 ? 2 : 1;
    for (let i = 0; i < falls; i++) {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x1d1f22 }));
      l.frustumCulled = false;
      this.ropes.push(l);
      this.scene.add(l);
    }
    return hook;
  }

  /** Overstappen: de torenkraan wordt de bediende kraan, de hulpkraan blijft geparkeerd staan. */
  private onCraneSwitch(): void {
    const sim = this.sim;
    const p = sim.parked;
    if (!this.tower || !p) return;
    const hw = hookWidth(p.spec.gb.hookMassKg);
    const hook = buildHook(hw, hw * 1.4);
    const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x1d1f22 }));
    rope.frustumCulled = false;
    this.scene.add(hook, rope);
    this.parked = { model: this.crane, hook, rope };
    this.crane = this.tower;
    this.tower = null;
    this.erection = null;
    this.scene.remove(this.hook);
    disposeGroup(this.hook);
    this.hook = this.buildHookMeshes();
  }

  /** Resolutie van de zonneschaduw (kwaliteitsinstelling). */
  setShadowMapSize(n: number): void {
    if (this.sun.shadow.mapSize.x === n) return;
    this.sun.shadow.mapSize.set(n, n);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  dispose(): void {
    this.disposed = true;
    this.rig.dispose();
    for (const l of this.labels) l.remove();
    disposeGroup(this.scene);
  }

  private computeOverview(m: MissionDef): void {
    const pts: FramePoint[] = [{ x: m.crane.x - 12, y: 0 }, { x: m.crane.x + 12, y: 0 }];
    for (const o of m.obstacles) if (o.kind !== 'ceiling') pts.push({ x: o.x, y: o.y + o.h }, { x: o.x + o.w, y: 0 });
    for (const z of m.zones) pts.push({ x: z.x, y: z.y + 4 });
    for (const l of m.loads) pts.push({ x: l.x, y: l.y + 3 });
    pts.push({ x: this.sim.geom.tip.x, y: this.sim.geom.tip.y + 3 });
    this.overviewPts = pts;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    audio.setMachineActive(!p && this.cfg.mode !== 'demo');
  }

  get overviewActive(): boolean {
    return this.rig.mode === 'overview';
  }

  /** Eén frame: invoer, vaste simulatiestappen, scène bijwerken. */
  frame(deltaMs: number, timeMs: number): void {
    const sim = this.sim;
    const dt = Math.min(MAX_FRAME_DELTA, deltaMs / 1000);
    this.time = timeMs;
    const input = this.hooks.input;
    for (const e of input.consumeEdges()) {
      if (e === 'zoomIn') this.rig.zoomBy(-1);
      else if (e === 'zoomOut') this.rig.zoomBy(1);
      else if (e === 'overview') this.rig.mode = this.rig.mode === 'overview' ? 'follow' : 'overview';
      else if (e === 'cameraReset') this.rig.reset();
      else if (e === 'cameraMode') this.rig.cycleMode();
      else this.hooks.onEdge(e, sim);
    }
    const wheel = input.consumeWheel();
    if (wheel) this.rig.zoomBy(wheel);

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
      if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0;
      const ev = sim.drainEvents();
      if (ev.some((e) => e.type === 'craneSwitch')) this.onCraneSwitch();
      if (ev.length) {
        this.handleFx(ev);
        this.hooks.onEvents(sim, ev);
      }
    }
    const alpha = this.paused ? 1 : Math.min(1, this.acc / FIXED_DT);
    this.updateScene(dt, alpha);
    this.hooks.onFrame(sim, this);
  }

  private handleFx(ev: SimEvent[]): void {
    const st = this.hooks.settings();
    this.fx.enabled = st.particles;
    this.rig.shakeEnabled = st.cameraShake;
    for (const e of ev) {
      if (e.type === 'impact') {
        const heavy = Math.min(1, e.mass / 50000);
        if (e.speed > 0.15) this.fx.dust(e.x, e.y, 0.5, Math.round(3 + e.speed * 6 + heavy * 8));
        if (e.obstacle && e.speed > 0.3) this.fx.debris(e.x, e.y, 0.5, 6);
        if (e.speed > 0.2) this.rig.shake(Math.min(0.6, e.speed * 0.15 + heavy * 0.3));
      } else if (e.type === 'boomHit') {
        this.fx.sparks(e.x, e.y, 0, 14);
        this.rig.shake(0.4);
      }
    }
  }

  private updateScene(dt: number, alpha: number): void {
    const sim = this.sim;
    const t = this.time / 1000;
    const cfg = sim.spec.cfg;
    this.crane.update(sim.crane, sim.geom, this.time);
    if (this.tower && this.erection && sim.assembly) this.tower.update(this.erection.state, this.erection.geom, this.time, sim.assembly.build);
    if (this.parked && sim.parked) {
      const pk = sim.parked;
      this.parked.model.update(pk.crane, pk.geom, this.time);
      const tp = pk.geom.tip;
      const hh = this.parked.hook.position;
      hh.set(tp.x, tp.y - pk.crane.ropeLength, tp.z);
      const rp = this.parked.rope.geometry.getAttribute('position') as THREE.BufferAttribute;
      rp.setXYZ(0, tp.x, tp.y, tp.z);
      rp.setXYZ(1, tp.x, hh.y + 0.3, tp.z);
      rp.needsUpdate = true;
    }
    this.world.update(t, sim.wind.x);

    // motorrook en stof bij rijden
    const st = this.hooks.settings();
    if (!this.paused && st.particles) {
      const exX = sim.geom.slewX - Math.cos(sim.crane.slew) * 2;
      const exZ = sim.crane.baseZ - Math.sin(sim.crane.slew) * 2;
      this.fx.smoke(exX, cfg.visual.carrierHeight + 2.4, exZ, sim.crane.engine, sim.wind.x);
      this.dustTimer += dt;
      if (Math.abs(sim.crane.vel.drive) > 0.2 && this.dustTimer > 0.08) {
        this.dustTimer = 0;
        this.fx.dust(sim.crane.baseX - Math.sign(sim.crane.vel.drive) * cfg.visual.carrierLength * 0.4, 0, sim.crane.baseZ + 1.2, 2);
      }
    }
    this.fx.update(this.paused ? 0 : dt, sim.wind.x, this.rig.camera);

    // lasten: positie lineair, oriëntatie met slerp tussen de vorige en huidige vaste stap
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    const lerpBody = (id: string, b: RigidBody) => {
      const p = sim.prevSnap.get(id);
      qb.set(b.q.x, b.q.y, b.q.z, b.q.w);
      if (!p) return { pos: new THREE.Vector3(b.pos.x, b.pos.y, b.pos.z), q: qb.clone() };
      qa.set(p.qx, p.qy, p.qz, p.qw);
      return { pos: new THREE.Vector3(lerp(p.x, b.pos.x, alpha), lerp(p.y, b.pos.y, alpha), lerp(p.z, b.pos.z, alpha)), q: qa.clone().slerp(qb, alpha) };
    };
    /** Lichaamspunt → wereld met de geïnterpoleerde pose. */
    const toWorld = (pose: { pos: THREE.Vector3; q: THREE.Quaternion }, lx: number, ly: number, lz = 0) => new THREE.Vector3(lx, ly, lz).applyQuaternion(pose.q).add(pose.pos);
    for (const l of sim.loads) {
      const v = this.loads.get(l.id)!;
      v.group.visible = l.status !== 'consumed';
      if (!v.group.visible) continue;
      const p = lerpBody(l.id, l.cb.body);
      v.group.position.copy(p.pos);
      v.group.quaternion.copy(p.q);
    }

    // haak, kabel en stroppen
    const tip = sim.geom.tip;
    const pt = sim.prevTip;
    const tipI = new THREE.Vector3(lerp(pt.x, tip.x, alpha), lerp(pt.y, tip.y, alpha), lerp(pt.z, tip.z, alpha));
    let apex: THREE.Vector3;
    const slingPos = this.slings.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (sim.attached) {
      const b = sim.attached.cb.body;
      const p = lerpBody(sim.attached.id, b);
      apex = toWorld(p, b.apex.x, b.apex.y);
      this.hook.position.copy(toWorld(p, b.apex.x, b.apex.y - sim.hookH * 0.5));
      this.hook.quaternion.copy(p.q);
      const hp = toWorld(p, b.apex.x, b.apex.y - sim.hookH);
      const topY = b.boxOffset.y + b.halfH;
      const dz = Math.min(b.depth, 6) * 0.4;
      let k = 0;
      for (const lx of [-b.halfW * 0.8, b.halfW * 0.8]) {
        for (const z of [-dz, dz]) {
          const w = toWorld(p, b.boxOffset.x + lx, topY, z);
          slingPos.setXYZ(k++, hp.x, hp.y, hp.z);
          slingPos.setXYZ(k++, w.x, w.y, w.z);
        }
      }
      this.slings.visible = true;
    } else {
      const hb = sim.hookBody!.body;
      const p = lerpBody(sim.hookBody!.id, hb);
      apex = toWorld(p, hb.apex.x, hb.apex.y);
      this.hook.position.copy(p.pos);
      this.hook.quaternion.copy(p.q);
      this.slings.visible = false;
    }
    slingPos.needsUpdate = true;
    const n = this.ropes.length;
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * 0.09;
      const pos = this.ropes[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, tipI.x + o, tipI.y, tipI.z);
      pos.setXYZ(1, apex.x + o, apex.y, apex.z);
      pos.needsUpdate = true;
    }

    // zones + labels
    const cam = this.rig.camera;
    const W = window.innerWidth;
    const H = window.innerHeight;
    sim.mission.zones.forEach((z, i) => {
      const task = sim.tasks.find((tk) => tk.def.type === 'deliver' && tk.def.zoneId === z.id && tk.status !== 'done') ?? sim.tasks.find((tk) => tk.def.type === 'deliver' && tk.def.zoneId === z.id);
      const active = task?.status === 'active';
      const done = !!task && task.status === 'done';
      // montagestappen: alleen de huidige stap tonen
      const stepOnly = task?.def.type === 'deliver' && !!task.def.inOrder;
      this.zones[i].root.visible = !stepOnly || active;
      this.zones[i].setState(active, done, t);
      const lt = task && task.def.type === 'deliver' ? sim.loads.find((l) => l.id === (task.def as { loadId: string }).loadId)?.type : undefined;
      const v = new THREE.Vector3(z.x, z.y + (lt?.height ?? 1) + 1.2, z.z ?? 0).project(cam);
      const el = this.labels[i];
      const visible = v.z < 1 && this.cfg.mode !== 'demo' && (!stepOnly || active);
      el.style.display = visible ? '' : 'none';
      if (visible) {
        el.style.transform = `translate(${((v.x + 1) / 2) * W}px, ${((1 - v.y) / 2) * H}px) translate(-50%, -100%)`;
        el.style.opacity = done ? '0.5' : active ? '1' : '0.65';
      }
    });

    // camera
    const focus: FramePoint[] = [
      { x: sim.crane.baseX - cfg.visual.carrierLength / 2 - 2, y: 0, z: sim.crane.baseZ },
      { x: sim.crane.baseX + cfg.visual.carrierLength / 2 + 2, y: 0, z: sim.crane.baseZ },
      { x: tip.x, y: tip.y + 2, z: tip.z },
    ];
    const hp = sim.hookPoint();
    focus.push({ x: hp.x, y: hp.y - 2, z: hp.z });
    for (const tk of sim.tasks) {
      if (tk.status !== 'active') continue;
      if (tk.def.type === 'deliver') {
        const z = sim.mission.zones.find((zz) => zz.id === (tk.def as { zoneId: string }).zoneId);
        if (z) focus.push({ x: z.x, y: z.y }, { x: z.x, y: z.y + 3 });
        const ld = sim.loads.find((l) => l.id === (tk.def as { loadId: string }).loadId);
        if (ld && ld !== sim.attached && ld.status !== 'consumed') focus.push({ x: ld.cb.body.pos.x, y: ld.cb.body.pos.y, z: ld.cb.body.pos.z });
      } else if (tk.def.type === 'drive') focus.push({ x: tk.def.x0, y: 0 }, { x: tk.def.x1, y: 0 });
    }
    // cabinezicht: vanuit de cabine naar de haak kijken
    const c = Math.cos(sim.crane.slew);
    const s = Math.sin(sim.crane.slew);
    const cu = cfg.kind === 'tower' ? 1.6 : 0.8;
    const cy = cfg.kind === 'tower' ? (sim.geom.segments.find((x) => x.kind === 'mast')?.y1 ?? 20) - 1.2 : cfg.visual.carrierHeight + 1.8;
    const cw = cfg.kind === 'tower' ? 1.7 : 1.85;
    const cabPos = { x: sim.geom.slewX + cu * c - cw * s, y: cy, z: sim.geom.slewZ + cu * s + cw * c };
    const yawOff = this.rig.yaw - 0.42;
    this.rig.setCab(cabPos, { x: hp.x + Math.sin(yawOff) * 5, y: hp.y, z: hp.z + Math.cos(yawOff) * 0 });
    this.rig.update(dt, focus, this.overviewPts);
    this.dome.position.copy(this.rig.camera.position);

    // schaduwcamera volgt het brandpunt
    const ft = this.rig.focusTarget;
    const r = Math.min(220, Math.max(30, this.rig.distance * 0.8));
    this.sun.position.set(ft.x + this.sunDir.x * r * 1.6, ft.y + this.sunDir.y * r * 1.6, ft.z + this.sunDir.z * r * 1.6);
    this.sun.target.position.copy(ft);
    const sc = this.sun.shadow.camera;
    sc.left = -r;
    sc.right = r;
    sc.top = r;
    sc.bottom = -r;
    sc.near = 1;
    sc.far = r * 4;
    sc.updateProjectionMatrix();
  }
}

/** Grote koepel met verloop van horizon naar zenit. */
function skyDome(top: THREE.Color, bottom: THREE.Color): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1200, 16, 10);
  const colors: number[] = [];
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 1200;
    const c = bottom.clone().lerp(top, Math.min(1, Math.max(0, y * 1.6)));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -1;
  return m;
}
