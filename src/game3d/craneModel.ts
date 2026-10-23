import * as THREE from 'three';
import { outriggerPad } from '../cranes/controllers/craneController';
import type { ResolvedCrane } from '../cranes/models/craneSpec';
import type { CraneState } from '../cranes/models/craneState';
import type { CraneGeometry, Segment } from '../cranes/models/kinematics';
import { TOWER_MAST_SECTIONS } from '../cranes/models/kinematics';
import { beamMesh, box, cylinder, mat, placeBetween, placeCylinderBetween, shadeHex, trussUnit, wheel } from './kit';

export interface Livery {
  body: number;
  accent: number;
  boom: number;
}

export const LIVERIES: Record<string, { label: string; make: (base: number, accent: number) => Livery }> = {
  standard: { label: 'Standaard', make: (b, a) => ({ body: b, accent: a, boom: b }) },
  heritage: { label: 'Heritage (eindcertificaat)', make: () => ({ body: 0x13294b, accent: 0xd4af37, boom: 0xd4af37 }) },
};

const DARK = 0x2b2f36;
const STEEL = 0x8d949b;
const GLASS = 0x6f97b8;

interface Outrigger {
  beam: THREE.Mesh;
  jack: THREE.Mesh;
  pad: THREE.Mesh;
}

/**
 * Low-poly 3D-model van een kraan. Wordt één keer opgebouwd en per frame bijgewerkt
 * vanuit de kraantoestand en -geometrie van de simulatie.
 */
export class CraneModel {
  readonly root = new THREE.Group();
  private tiltPivot = new THREE.Group();
  private tiltInner = new THREE.Group();
  private carrier = new THREE.Group();
  private slew = new THREE.Group();
  private wheels: THREE.Group[] = [];
  private outriggers: Outrigger[] = [];
  private sections: THREE.Mesh[] = [];
  private trusses = new Map<string, THREE.Group>();
  private beams = new Map<string, THREE.Mesh>();
  private cylinders: THREE.Mesh[] = [];
  private cwMesh: THREE.Mesh | null = null;
  private ballast: THREE.Mesh[] = [];
  private mastSections: THREE.Object3D[] = [];
  private trolley: THREE.Mesh | null = null;
  private towerPeak: THREE.Mesh | null = null;
  private pendants: THREE.Line[] = [];
  private beacon: THREE.Mesh;
  private beaconLight: THREE.PointLight;
  private sheave: THREE.Mesh;
  private cab: THREE.Group | null = null;
  readonly liv: Livery;

  constructor(private spec: ResolvedCrane, livery: Livery, night: boolean) {
    this.liv = livery;
    this.root.add(this.tiltPivot);
    this.tiltPivot.add(this.tiltInner);
    this.tiltInner.add(this.carrier);
    this.carrier.add(this.slew);
    this.slew.position.x = spec.gb.slewOffsetX;
    this.buildCarrier(night);
    this.buildUpper(night);
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 4), mat(0xff8c00, { emissive: 0xff7a00 }));
    this.beaconLight = new THREE.PointLight(0xff8c00, 0, 12);
    this.beacon.add(this.beaconLight);
    this.sheave = cylinder(0.45, 0.4, DARK);
    this.sheave.rotation.x = Math.PI / 2;
    this.slew.add(this.sheave);
    if (spec.cfg.kind !== 'tower') {
      this.beacon.position.set(0.6, spec.cfg.visual.carrierHeight + 2.45, 1.8);
      this.slew.add(this.beacon);
    }
  }

  // ------------------------------------------------------------------ onderwagen

  private buildCarrier(night: boolean): void {
    const cfg = this.spec.cfg;
    const vis = cfg.visual;
    const L = vis.carrierLength;
    const h = vis.carrierHeight;
    const body = this.liv.body;
    const c = this.carrier;
    const glass = mat(GLASS, { rough: 0.2, metal: 0.4, emissive: night ? 0x7a6a3a : 0 });
    const addWheels = (xs: number[], r: number, track: number) => {
      for (const x of xs) {
        for (const z of [-track, track]) {
          const w = wheel(r, 0.55);
          w.position.set(x, r, z);
          c.add(w);
          this.wheels.push(w);
        }
      }
    };
    switch (cfg.carrier) {
      case 'allTerrain':
      case 'truck':
      case 'knuckleTruck': {
        const r = vis.wheelRadius;
        const cabW = cfg.carrier === 'allTerrain' ? 2.6 : 2.4;
        const right = vis.cabFront;
        const span0 = right ? -L / 2 + 1.4 : -L / 2 + cabW + 1;
        const span1 = right ? L / 2 - cabW - 0.6 : L / 2 - 1.4;
        const xs = Array.from({ length: vis.axles }, (_, i) => (vis.axles === 1 ? (span0 + span1) / 2 : span0 + ((span1 - span0) * i) / (vis.axles - 1)));
        if (right) xs[xs.length - 1] = L / 2 - 1.6;
        else xs[0] = -L / 2 + 1.6;
        addWheels(xs, r, 1.05);
        c.add(box(L - 0.4, h * 0.35, 2.2, DARK, 0, r * 0.9 + h * 0.18, 0));
        c.add(box(L, h * 0.45, 2.6, body, 0, h * 0.775, 0));
        for (const ox of [-L / 2 + 0.9, L / 2 - 0.9]) c.add(box(0.9, h * 0.4, 2.64, shadeHex(body, 0.8), ox, h * 0.6, 0));
        const cabH = cfg.carrier === 'allTerrain' ? 1.0 : 1.6;
        const cx = right ? L / 2 - cabW / 2 : -L / 2 + cabW / 2;
        const cabZ0 = cfg.carrier === 'allTerrain' ? -1.3 : -1.3;
        const cabZ1 = cfg.carrier === 'allTerrain' ? 0.2 : 1.3;
        const cabColor = cfg.carrier === 'knuckleTruck' ? 0xe9edf0 : body;
        c.add(box(cabW, h * 0.2 + cabH, cabZ1 - cabZ0, cabColor, cx, h * 0.8 + (h * 0.2 + cabH) / 2, (cabZ0 + cabZ1) / 2));
        c.add(box(cabW * 0.6, cabH * 0.6, 0.05, glass, cx + (right ? 0.3 : -0.3), h + cabH * 0.55, cabZ1 + 0.02, false));
        c.add(box(0.05, cabH * 0.6, (cabZ1 - cabZ0) * 0.8, glass, right ? L / 2 + 0.02 : -L / 2 - 0.02, h + cabH * 0.55, (cabZ0 + cabZ1) / 2, false));
        if (cfg.carrier === 'knuckleTruck') {
          const bx0 = right ? -L / 2 : -L / 2 + cabW + 0.3;
          const bx1 = right ? L / 2 - cabW - 0.3 : L / 2;
          c.add(box(bx1 - bx0, 0.15, 2.5, 0x7d6a55, (bx0 + bx1) / 2, h - 0.075, 0));
        }
        break;
      }
      case 'roughTerrain': {
        addWheels([-L / 2 + 2.3, L / 2 - 2.3], vis.wheelRadius, 1.2);
        c.add(box(L - 1.2, h - vis.wheelRadius * 0.8, 2.5, body, 0, (h + vis.wheelRadius * 0.8) / 2, 0));
        for (const ox of [-L / 2 + 0.7, L / 2 - 0.7]) c.add(box(1, h * 0.4, 2.6, shadeHex(body, 0.8), ox, h * 0.7, 0));
        break;
      }
      case 'carryDeck': {
        addWheels([-L / 2 + 1.1, L / 2 - 1.1], vis.wheelRadius, 1.0);
        c.add(box(L, h - vis.wheelRadius * 0.7, 2.5, body, 0, (h + vis.wheelRadius * 0.7) / 2, 0));
        c.add(box(L - 2.6, 0.12, 2.4, 0x6b6f74, -1.1, h + 0.06, 0));
        const cab = new THREE.Group();
        cab.add(box(1.7, 1.6, 1.15, shadeHex(body, 0.95), 0, 0.8, 0));
        cab.add(box(1.3, 0.85, 0.05, glass, 0, 1.0, 0.6, false));
        cab.position.set(L / 2 - 1.05, h, 0.68);
        c.add(cab);
        break;
      }
      case 'crawler': {
        const tb = this.spec.gb.footprintRetracted.b;
        for (const zc of [-tb + 0.5, tb - 0.5]) {
          c.add(box(L, 1.25, 1.1, 0x2a2d31, 0, 0.625, zc));
          for (let i = 0; i < 6; i++) {
            const rr = i === 0 || i === 5 ? 0.55 : 0.3;
            const r = cylinder(rr, 1.14, STEEL);
            r.rotation.x = Math.PI / 2;
            r.position.set(-L / 2 + 0.7 + (i * (L - 1.4)) / 5, 0.62, zc);
            c.add(r);
          }
        }
        c.add(box(4.8, vis.carrierHeight - 0.9, (tb - 1) * 2, shadeHex(body, 0.8), 0, (vis.carrierHeight + 0.9) / 2, 0));
        break;
      }
      case 'towerBase': {
        c.add(box(8, 0.8, 8, 0x8c8f92, 0, 0.2, 0));
        c.add(box(6, 0.9, 1.2, DARK, 0, 1.05, 0));
        c.add(box(1.2, 0.9, 6, DARK, 0, 1.05, 0));
        for (const bx of [-1.9, 1.9]) c.add(box(1, 1.2, 6, 0x9aa0a6, bx, 1.2, 0));
        break;
      }
      case 'selfErecting': {
        c.add(box(L, vis.carrierHeight - 0.25, 2.2, shadeHex(this.liv.body, 0.85), 0, (vis.carrierHeight + 0.25) / 2, 0));
        for (let i = 0; i < 4; i++) {
          const b = box(1.6, 0.8, 0.8, 0x9aa0a6, -1.25 + i * 0.85, vis.carrierHeight + 0.4, 0);
          b.scale.x = 0.7;
          c.add(b);
          this.ballast.push(b);
        }
        break;
      }
    }
    // stempels
    const gb = this.spec.gb;
    const n = cfg.carrier === 'selfErecting' ? 4 : gb.outriggerCount;
    for (let i = 0; i < n; i++) {
      const beam = beamMesh(cfg.carrier === 'selfErecting' ? DARK : 0x3a3f45);
      const jack = cylinder(0.12, 1, 0xb8bec4);
      const pad = box(1, 0.12, 1, 0x2f343a);
      c.add(beam, jack, pad);
      this.outriggers.push({ beam, jack, pad });
    }
  }

  // ------------------------------------------------------------------ bovenwagen

  private buildUpper(night: boolean): void {
    const cfg = this.spec.cfg;
    const gb = this.spec.gb;
    const h = cfg.visual.carrierHeight;
    const s = this.slew;
    const body = this.liv.body;
    const glass = mat(GLASS, { rough: 0.2, metal: 0.4, emissive: night ? 0x7a6a3a : 0 });
    if (cfg.kind === 'tower') {
      const H = gb.towerHeight ?? 30;
      const color = this.liv.boom;
      if (cfg.carrier === 'towerBase') {
        // mast in secties (zichtbaar tijdens de montage)
        const secH = H / TOWER_MAST_SECTIONS;
        for (let i = 0; i < TOWER_MAST_SECTIONS; i++) {
          const t = trussUnit(color, 3, 0.1, 0.05);
          placeBetween(t, { x: 0, y: h + i * secH, z: 0 }, { x: 0, y: h + (i + 1) * secH, z: 0 }, 1.6, 1.6);
          this.carrier.add(t);
          this.mastSections.push(t);
        }
      }
      for (const kind of ['jib', 'counterJib', ...(cfg.carrier === 'selfErecting' ? ['mast'] : [])]) {
        const t = trussUnit(color, kind === 'mast' ? 10 : 14, 0.12, 0.05);
        s.add(t);
        this.trusses.set(kind, t);
      }
      const cab = new THREE.Group();
      cab.add(box(2, 2.4, 1.8, 0xe9edf0, 0, 0, 0), box(0.05, 1.4, 1.5, glass, 1.02, 0.2, 0, false));
      s.add(cab);
      this.cab = cab;
      this.trolley = box(1.4, 0.6, 1.4, DARK);
      s.add(this.trolley);
      this.towerPeak = beamMesh(color);
      s.add(this.towerPeak);
      for (let i = 0; i < 2; i++) {
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x1d1f22 }));
        s.add(l);
        this.pendants.push(l);
      }
      for (let i = 0; i < (cfg.carrier === 'selfErecting' ? 2 : 4); i++) {
        const b = box(1, 2, 1.6, 0x8c9096);
        s.add(b);
        this.ballast.push(b);
      }
      return;
    }
    if (cfg.kind === 'knuckle') {
      s.add(box(1.2, 0.6, 1.2, DARK, 0, h + 0.3, 0));
      for (const k of ['column', 'arm1', 'arm2', 'tele']) {
        const m = beamMesh(k === 'column' ? DARK : k === 'tele' ? shadeHex(this.liv.boom, 1.12) : this.liv.boom);
        s.add(m);
        this.beams.set(k, m);
      }
      for (let i = 0; i < 2; i++) {
        const c = cylinder(1, 1, 0xd5dbe0);
        s.add(c);
        this.cylinders.push(c);
      }
      return;
    }
    // draaikrans + bovenwagen + cabine
    const cw = this.spec.counterweights[this.spec.counterweights.length - 1];
    const cwR = cw?.radius ?? 3;
    const houseLen = Math.max(3, Math.min(8, cwR + 1.2));
    const top = h + (cfg.kind === 'lattice' ? 2.6 : 1.5);
    s.add(box(houseLen + 1.6, top - h, 2.6, shadeHex(body, 0.95), (1.6 - houseLen) / 2, (h + top) / 2, 0));
    s.add(box(houseLen - 1.6, 0.5, 2.3, shadeHex(body, 0.8), (-houseLen + 0.4 - 1.2) / 2, top + 0.25, 0));
    const cab = new THREE.Group();
    cab.add(box(2.4, 2, 0.95, shadeHex(body, 1.05), 0, 0, 0), box(1.1, 0.9, 0.04, glass, 0.5, 0.35, 0.49, false), box(0.04, 0.9, 0.8, glass, 1.22, 0.35, 0, false));
    cab.position.set(0.8, h + 1.2, 1.83);
    s.add(cab);
    this.cab = cab;
    this.cwMesh = box(1.6, 1, 2.8, 0x3b3f45);
    s.add(this.cwMesh);
    if (cfg.kind === 'lattice') {
      for (const kind of ['boom', 'jib']) {
        const t = trussUnit(this.liv.boom, 24, 0.07, 0.035);
        s.add(t);
        this.trusses.set(kind, t);
      }
      // A-bok
      const a = beamMesh(DARK);
      placeBetween(a, { x: -1.2, y: h + 2.6, z: 0 }, { x: -2.2, y: gb.pivotHeight + 6, z: 0 }, 0.4, 2);
      s.add(a);
      for (let i = 0; i < 2; i++) {
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x1d1f22 }));
        s.add(l);
        this.pendants.push(l);
      }
    } else {
      for (let i = 0; i < Math.max(1, gb.telescopeSections); i++) {
        const m = beamMesh(i === 0 ? this.liv.boom : shadeHex(this.liv.boom, 1 + i * 0.03));
        s.add(m);
        this.sections.push(m);
      }
      for (let i = 0; i < 2; i++) {
        const c = cylinder(1, 1, i === 0 ? DARK : 0xd5dbe0);
        s.add(c);
        this.cylinders.push(c);
      }
    }
  }

  // ------------------------------------------------------------------ bijwerken

  update(s: CraneState, g: CraneGeometry, time: number): void {
    const cfg = this.spec.cfg;
    const gb = this.spec.gb;
    const h = cfg.visual.carrierHeight;
    this.carrier.position.set(s.baseX, 0, 0);
    // kanteling om de kantellijn in de richting van de giek
    const dir = Math.cos(s.slew) >= 0 ? 1 : -1;
    this.tiltPivot.position.set(g.tiltPivotX, 0, 0);
    this.tiltInner.position.set(-g.tiltPivotX, 0, 0);
    this.tiltPivot.rotation.z = -dir * s.tilt;
    const minJack = s.outriggerJack.length ? Math.min(...s.outriggerJack) : 0;
    const lift = cfg.carrier === 'selfErecting' || cfg.carrier === 'towerBase' ? 0 : minJack * 0.15;
    for (const w of this.wheels) w.rotation.z = -s.wheelRot;
    this.slew.position.y = lift;
    // stempels
    for (let i = 0; i < this.outriggers.length; i++) {
      const o = this.outriggers[i];
      const pad = outriggerPad(this.spec, s, i);
      const lx = pad.x - s.baseX;
      const jack = s.outriggerJack[i] ?? 0;
      const zIn = pad.z > 0 ? 1.1 : -1.1;
      const beamY = cfg.carrier === 'selfErecting' ? 0.6 : 0.75 + lift;
      placeBetween(o.beam, { x: lx, y: beamY, z: zIn }, { x: lx, y: beamY, z: pad.z + (pad.z > 0 ? 0.25 : -0.25) }, 0.4, 0.5);
      const padY = (1 - jack) * 0.45;
      placeCylinderBetween(o.jack, { x: lx, y: padY + 0.1, z: pad.z }, { x: lx, y: beamY + 0.05, z: pad.z }, 0.12);
      o.pad.position.set(lx, padY + 0.06, pad.z);
    }
    this.slew.rotation.y = -s.slew;
    this.sheave.position.set(g.tipU, g.tipY + 0.4, 0);
    this.sheave.visible = cfg.kind !== 'tower';
    const blink = Math.sin(time * 0.012) > 0;
    (this.beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = blink ? 1.4 : 0.15;
    this.beaconLight.intensity = blink ? 6 : 0;

    if (cfg.kind === 'tower') return this.updateTower(s, g);
    if (cfg.kind === 'knuckle') return this.updateKnuckle(g);

    // contragewicht
    const cw = this.spec.counterweights[s.counterweightIndex];
    const cwT = (cw?.massT ?? 0) + s.extraCounterweightT;
    if (this.cwMesh) {
      this.cwMesh.visible = cwT > 0.05;
      const cwH = Math.min(3.2, 0.5 + Math.sqrt(cwT) * 0.22);
      const r = cw?.radius ?? 3;
      this.cwMesh.scale.set(1.6, cwH, 2.8);
      this.cwMesh.position.set(-r - 0.1, h + 0.3 + cwH / 2, 0);
    }
    const segs = g.segments;
    if (cfg.kind === 'lattice') {
      const boom = segs.find((x) => x.kind === 'boom');
      const jib = segs.find((x) => x.kind === 'jib');
      const tb = this.trusses.get('boom')!;
      const tj = this.trusses.get('jib')!;
      if (boom) placeSeg(tb, boom, 1.6);
      tj.visible = !!jib;
      if (jib) placeSeg(tj, jib, 0.9);
      if (boom) {
        const aTop = new THREE.Vector3(-2.2, gb.pivotHeight + 6, 0);
        setLine(this.pendants[0], aTop, new THREE.Vector3(boom.u1, boom.y1, 0));
        const cwr = this.spec.counterweights[s.counterweightIndex]?.radius ?? 3;
        setLine(this.pendants[1], aTop, new THREE.Vector3(-cwr, h + 2.6, 0));
      }
      return;
    }
    // telescoop
    let k = 0;
    for (const seg of segs) {
      if (seg.kind !== 'boom' && seg.kind !== 'boomSection') continue;
      const m = this.sections[k++];
      if (!m) break;
      m.visible = true;
      placeBetween(m, { x: seg.u0, y: seg.y0, z: 0 }, { x: seg.u1, y: seg.y1, z: 0 }, seg.width, seg.width * 0.85);
    }
    for (; k < this.sections.length; k++) this.sections[k].visible = false;
    // hefcilinder
    const th = g.displayBoomAngle;
    const base = { x: gb.pivotU + 1.6, y: h + 0.2, z: 0 };
    const at = 0.42 * gb.boomMin;
    const tgt = { x: gb.pivotU + at * Math.cos(th), y: gb.pivotHeight + at * Math.sin(th) - 0.4, z: 0 };
    const mid = { x: base.x + (tgt.x - base.x) * 0.55, y: base.y + (tgt.y - base.y) * 0.55, z: 0 };
    placeCylinderBetween(this.cylinders[0], base, mid, 0.2);
    placeCylinderBetween(this.cylinders[1], mid, tgt, 0.11);
  }

  private updateKnuckle(g: CraneGeometry): void {
    const segs = g.segments;
    for (const k of ['column', 'arm1', 'arm2', 'tele']) {
      const m = this.beams.get(k)!;
      const seg = segs.find((x) => x.kind === k);
      m.visible = !!seg;
      if (seg) placeBetween(m, { x: seg.u0, y: seg.y0, z: 0 }, { x: seg.u1, y: seg.y1, z: 0 }, seg.width, seg.width * 0.9);
    }
    const a1 = segs.find((x) => x.kind === 'arm1');
    const a2 = segs.find((x) => x.kind === 'arm2');
    if (a1) placeCylinderBetween(this.cylinders[0], { x: 0.5, y: a1.y0 - 1.5, z: 0.35 }, { x: lerpN(a1.u0, a1.u1, 0.45), y: lerpN(a1.y0, a1.y1, 0.45), z: 0.35 }, 0.11);
    if (a1 && a2) placeCylinderBetween(this.cylinders[1], { x: lerpN(a1.u0, a1.u1, 0.6), y: lerpN(a1.y0, a1.y1, 0.6) + 0.3, z: 0.3 }, { x: lerpN(a2.u0, a2.u1, 0.35), y: lerpN(a2.y0, a2.y1, 0.35) + 0.3, z: 0.3 }, 0.09);
  }

  private updateTower(s: CraneState, g: CraneGeometry): void {
    const gb = this.spec.gb;
    const cfg = this.spec.cfg;
    const segs = g.segments;
    const mast = segs.find((x) => x.kind === 'mast')!;
    const jib = segs.find((x) => x.kind === 'jib');
    const cj = segs.find((x) => x.kind === 'counterJib');
    const topY = mast.y1;
    const topU = mast.u1;
    // mastsecties tonen tot de huidige hoogte
    if (this.mastSections.length) {
      const H = gb.towerHeight ?? 30;
      const built = Math.round(((topY - mast.y0) / H) * TOWER_MAST_SECTIONS);
      this.mastSections.forEach((m, i) => (m.visible = i < built));
    }
    const tm = this.trusses.get('mast');
    if (tm) placeSeg(tm, mast, 1.4);
    const tj = this.trusses.get('jib')!;
    const jibLen = jib ? Math.hypot(jib.u1 - jib.u0, jib.y1 - jib.y0) : 0;
    tj.visible = jibLen > 0.3;
    if (jib && tj.visible) placeSeg(tj, jib, 1.3);
    const tc = this.trusses.get('counterJib')!;
    tc.visible = !!cj;
    if (cj) placeSeg(tc, cj, 1.1);
    const assembling = gb.setupType === 'towerAssembly' && s.setupProgress < 1;
    const headOn = !assembling || s.setupProgress >= 0.5;
    if (this.cab) {
      this.cab.visible = headOn;
      this.cab.position.set(topU + 1.6, topY - 1.4, 1.7);
    }
    if (this.trolley) {
      this.trolley.visible = jibLen > 0.3 && g.jibUnfold >= 1;
      this.trolley.position.set(g.tipU, g.tipY + 0.6, 0);
    }
    const peakH = cfg.carrier === 'selfErecting' ? 3 : 7;
    if (this.towerPeak) {
      this.towerPeak.visible = headOn && g.jibUnfold >= 1;
      placeBetween(this.towerPeak, { x: topU, y: topY, z: 0 }, { x: topU, y: topY + peakH, z: 0 }, 0.5, 0.5);
    }
    const peak = new THREE.Vector3(topU, topY + peakH, 0);
    const showPend = headOn && g.jibUnfold >= 1;
    this.pendants[0].visible = showPend && jibLen > 1;
    this.pendants[1].visible = showPend && !!cj;
    if (jib) setLine(this.pendants[0], peak, new THREE.Vector3(topU + (jib.u1 - jib.u0) * 0.65, jib.y0, 0));
    if (cj) setLine(this.pendants[1], peak, new THREE.Vector3(cj.u1, cj.y1, 0));
    // ballast: zelfopbouw op de onderwagen, torenkraan op de tegengiek
    const ballastOn = cfg.carrier === 'selfErecting' ? Math.round(Math.min(1, Math.max(0, (s.setupProgress - 0.2) / 0.2)) * this.ballast.length) : assembling ? (s.setupProgress >= 0.9 ? Math.round(((s.setupProgress - 0.9) / 0.1) * this.ballast.length) : 0) : this.ballast.length;
    this.ballast.forEach((b, i) => {
      b.visible = i < ballastOn;
      if (cfg.carrier !== 'selfErecting' && cj) b.position.set(cj.u1 + 0.6 + i * 1.1, cj.y1 - 1.2, 0);
    });
  }
}

function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function placeSeg(obj: THREE.Object3D, seg: Segment, w: number): void {
  placeBetween(obj, { x: seg.u0, y: seg.y0, z: 0 }, { x: seg.u1, y: seg.y1, z: 0 }, w, w);
}

function setLine(l: THREE.Line, a: THREE.Vector3, b: THREE.Vector3): void {
  const pos = l.geometry.getAttribute('position') as THREE.BufferAttribute;
  pos.setXYZ(0, a.x, a.y, a.z);
  pos.setXYZ(1, b.x, b.y, b.z);
  pos.needsUpdate = true;
  l.geometry.computeBoundingSphere();
}
