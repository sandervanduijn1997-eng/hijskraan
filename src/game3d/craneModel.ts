import * as THREE from 'three';
import { outriggerPad } from '../cranes/controllers/craneController';
import type { ResolvedCrane } from '../cranes/models/craneSpec';
import type { CraneState } from '../cranes/models/craneState';
import type { CraneGeometry, Segment } from '../cranes/models/kinematics';
import type { TowerBuild } from '../cranes/models/towerErection';
import { TOWER_BALLAST_H, TOWER_BALLAST_W, TOWER_COUNTERJIB_H, TOWER_MAST_SECTIONS, TOWER_ROOT_OFFSET, TOWER_SLEW_UNIT_H } from '../cranes/models/towerErection';
import { beamMesh, box, cylinder, mat, placeBetween, placeCylinderBetween, shadeHex, trussUnit, wheel } from './kit';
import { boomSectionGeometry, brandOf, decal, mesh, profile, warningStripes } from './parts';
import { ballast, glass, paint, steel, surface } from './realism';

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
  private cwSlabs: THREE.Mesh[] = [];
  /** Kragen met slijtstrips aan het eind van elk telescoopdeel. */
  private collars: THREE.Mesh[] = [];
  private boomHead: THREE.Group | null = null;
  private ballast: THREE.Mesh[] = [];
  private mastSections: THREE.Object3D[] = [];
  private trolley: THREE.Mesh | null = null;
  private towerPeak: THREE.Group | null = null;
  private slewUnit: THREE.Group | null = null;
  private climbCage: THREE.Group | null = null;
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
    const glassM = glass(night);
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
        const P = paint(body);
        const D = paint(DARK, { gloss: 0.2 });
        // chassisbalken en assen
        c.add(box(L - 0.8, 0.42, 1.1, D, 0, r * 0.95, 0));
        for (const x of xs) c.add(mesh(cylGeo(0.09, 2.1), steel(0x55595e, 0.5)).translateX(x).translateY(r).rotateX(Math.PI / 2));
        // opbouw: plaatwerk met afgeschuinde koppen
        const y0 = r * 0.95 + 0.2;
        const y1 = h;
        c.add(mesh(profile([[-L / 2, y0 + 0.3], [-L / 2 + 0.4, y0], [L / 2 - 0.4, y0], [L / 2, y0 + 0.3], [L / 2, y1 - 0.12], [L / 2 - 0.12, y1], [-L / 2 + 0.12, y1], [-L / 2, y1 - 0.12]], 2.55, 0.05), P));
        // spatborden boven elke as
        for (const x of xs) {
          for (const z of [-1.28, 1.28]) {
            const arch = mesh(archGeo(r + 0.1), D);
            arch.position.set(x, r, z);
            c.add(arch);
          }
        }
        // stempelkasten voor en achter, met waarschuwingsstrepen
        for (const ox of [-L / 2 + 0.75, L / 2 - 0.75]) {
          c.add(box(1.0, 0.55, 2.7, D, ox, h * 0.62, 0));
          for (const z of [-1.36, 1.36]) c.add(box(0.98, 0.3, 0.02, warningStripes(), ox, h * 0.62, z, false));
        }
        // treden en zijkisten
        for (const z of [-1.3, 1.3]) c.add(box(L * 0.5, 0.35, 0.18, D, 0, y0 + 0.05, z));
        // cabine: geprofileerd met schuine voorruit
        const cabH = cfg.carrier === 'allTerrain' ? 1.15 : 1.7;
        const cx = right ? L / 2 - cabW / 2 : -L / 2 + cabW / 2;
        const cabZ0 = -1.3;
        const cabZ1 = cfg.carrier === 'allTerrain' ? 0.15 : 1.3;
        const cabColor = cfg.carrier === 'knuckleTruck' ? paint(0xe9edf0) : P;
        const dir = right ? 1 : -1;
        const cy0 = h * 0.8;
        const cy1 = h + cabH;
        const f = (x: number) => cx + dir * x;
        const pts: [number, number][] = [[f(-cabW / 2), cy0], [f(cabW / 2), cy0], [f(cabW / 2), cy0 + (cy1 - cy0) * 0.45], [f(cabW / 2 - 0.45), cy1], [f(-cabW / 2), cy1]];
        if (dir < 0) pts.reverse();
        const cab = mesh(profile(pts, cabZ1 - cabZ0, 0.06), cabColor);
        cab.position.z = (cabZ0 + cabZ1) / 2;
        c.add(cab);
        // ruiten: schuine voorruit en zijruiten
        const g1 = glass(night);
        const wsTop = cy1 - 0.05;
        const wsBot = cy0 + (cy1 - cy0) * 0.47;
        const ws = new THREE.Mesh(new THREE.PlaneGeometry(Math.hypot(0.45, wsTop - wsBot), (cabZ1 - cabZ0) * 0.86), g1);
        ws.position.set(f(cabW / 2 - 0.2) + dir * 0.03, (wsTop + wsBot) / 2, (cabZ0 + cabZ1) / 2);
        ws.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        ws.rotateX(-Math.atan2(0.45, wsTop - wsBot));
        c.add(ws);
        for (const z of [cabZ0 - 0.011, cabZ1 + 0.011]) {
          const sw = new THREE.Mesh(new THREE.PlaneGeometry(cabW * 0.55, (cy1 - cy0) * 0.42), g1);
          sw.position.set(f(0.05), cy1 - (cy1 - cy0) * 0.28, z);
          if (z < 0) sw.rotation.y = Math.PI;
          c.add(sw);
        }
        // spiegels
        for (const z of [cabZ0 - 0.25, cabZ1 + 0.25]) c.add(box(0.06, 0.35, 0.22, D, f(cabW / 2 - 0.2), cy1 - 0.45, z));
        // uitlaat
        const ex = mesh(cylGeo(0.09, 1.1), steel(0x8a8f94, 0.45));
        ex.position.set(f(-cabW / 2 - 0.15), h + 0.4, cabZ0 + 0.2);
        c.add(ex);
        if (cfg.carrier === 'knuckleTruck') {
          const bx0 = right ? -L / 2 : -L / 2 + cabW + 0.3;
          const bx1 = right ? L / 2 - cabW - 0.3 : L / 2;
          c.add(box(bx1 - bx0, 0.15, 2.5, surfaceDeck(), (bx0 + bx1) / 2, h - 0.075, 0));
        }
        // belettering op de flanken
        const { brand, model } = brandOf(cfg.name);
        for (const side of [-1, 1]) {
          const d = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(5, L * 0.32), Math.min(5, L * 0.32) / 4), decal(brand, '#1d2126', model));
          d.position.set(right ? -L * 0.12 : L * 0.12, (y0 + y1) / 2, side * 1.29);
          if (side < 0) d.rotation.y = Math.PI;
          c.add(d);
        }
        break;
      }
      case 'roughTerrain': {
        addWheels([-L / 2 + 2.3, L / 2 - 2.3], vis.wheelRadius, 1.2);
        const yb = vis.wheelRadius * 0.8;
        c.add(mesh(profile([[-L / 2 + 0.6, yb + 0.3], [-L / 2 + 1.0, yb], [L / 2 - 1.0, yb], [L / 2 - 0.6, yb + 0.3], [L / 2 - 0.6, h - 0.1], [L / 2 - 0.7, h], [-L / 2 + 0.7, h], [-L / 2 + 0.6, h - 0.1]], 2.5, 0.05), paint(body)));
        for (const ox of [-L / 2 + 0.7, L / 2 - 0.7]) {
          c.add(box(1, h * 0.4, 2.6, paint(DARK, { gloss: 0.2 }), ox, h * 0.7, 0));
          for (const z of [-1.31, 1.31]) c.add(box(0.98, h * 0.25, 0.02, warningStripes(), ox, h * 0.7, z, false));
        }
        for (const x of [-L / 2 + 2.3, L / 2 - 2.3]) for (const z of [-1.3, 1.3]) c.add(mesh(archGeo(vis.wheelRadius + 0.1), paint(DARK, { gloss: 0.2 })).translateX(x).translateY(vis.wheelRadius).translateZ(z));
        break;
      }
      case 'carryDeck': {
        addWheels([-L / 2 + 1.1, L / 2 - 1.1], vis.wheelRadius, 1.0);
        c.add(box(L, h - vis.wheelRadius * 0.7, 2.5, paint(body), 0, (h + vis.wheelRadius * 0.7) / 2, 0));
        c.add(box(L - 2.6, 0.12, 2.4, surfaceDeck(), -1.1, h + 0.06, 0));
        const cab = new THREE.Group();
        cab.add(box(1.7, 1.6, 1.15, paint(shadeHex(body, 0.95)), 0, 0.8, 0));
        cab.add(box(1.3, 0.85, 0.05, glassM, 0, 1.0, 0.6, false));
        cab.position.set(L / 2 - 1.05, h, 0.68);
        c.add(cab);
        break;
      }
      case 'crawler': {
        const tb = this.spec.gb.footprintRetracted.b;
        for (const zc of [-tb + 0.5, tb - 0.5]) {
          // rupsband: zijframe, loop- en spanwielen en losse bodemplaten (schakels)
          c.add(box(L - 1.2, 0.8, 0.5, paint(DARK, { gloss: 0.2 }), 0, 0.62, zc));
          for (let i = 0; i < 6; i++) {
            const rr = i === 0 || i === 5 ? 0.55 : 0.3;
            const r = cylinder(rr, 1.0, steel(0x4a4e53, 0.6));
            r.rotation.x = Math.PI / 2;
            r.position.set(-L / 2 + 0.7 + (i * (L - 1.4)) / 5, i === 0 || i === 5 ? 0.62 : 0.35, zc);
            c.add(r);
          }
          const shoes = Math.round(L / 0.32);
          const shoeGeo = new THREE.BoxGeometry(0.28, 0.08, 1.12);
          const im = new THREE.InstancedMesh(shoeGeo, steel(0x33363a, 0.75), shoes * 2 + 8);
          const m4 = new THREE.Matrix4();
          let k = 0;
          for (let i = 0; i < shoes; i++) {
            const x = -L / 2 + 0.7 + (i / (shoes - 1)) * (L - 1.4);
            im.setMatrixAt(k++, m4.makeTranslation(x, 0.04, zc));
            im.setMatrixAt(k++, m4.makeTranslation(x, 1.21, zc));
          }
          for (const ex of [-1, 1]) {
            for (let i = 1; i <= 4; i++) {
              const a = (i / 5) * Math.PI - Math.PI / 2;
              const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ex * a);
              m4.compose(new THREE.Vector3(ex * (L / 2 - 0.7) + ex * Math.cos(a) * 0.6, 0.62 + Math.sin(a) * 0.6, zc), q, new THREE.Vector3(1, 1, 1));
              im.setMatrixAt(k++, m4);
            }
          }
          im.count = k;
          im.castShadow = true;
          im.receiveShadow = true;
          c.add(im);
        }
        c.add(box(4.8, vis.carrierHeight - 0.9, (tb - 1) * 2, paint(shadeHex(body, 0.8)), 0, (vis.carrierHeight + 0.9) / 2, 0));
        break;
      }
      case 'towerBase': {
        // betonfundering met ankers en kruisonderstel
        c.add(box(8, 0.8, 8, surfaceConcrete(), 0, 0.2, 0));
        c.add(box(6, 0.9, 1.2, paint(DARK, { gloss: 0.2 }), 0, 1.05, 0));
        c.add(box(1.2, 0.9, 6, paint(DARK, { gloss: 0.2 }), 0, 1.05, 0));
        for (const bx of [-1.9, 1.9]) c.add(box(1, 1.2, 6, ballast(), bx, 1.2, 0));
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
      const beam = beamMesh(warningStripes());
      const jack = cylinder(0.12, 1, steel(0xd9dde1, 0.18));
      const pad = cylinder(0.55, 0.14, steel(0x3a3f45, 0.7));
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
    const glassM = glass(night);
    if (cfg.kind === 'tower') {
      const H = gb.towerHeight ?? 30;
      const color = this.liv.boom;
      if (cfg.carrier === 'towerBase') {
        // mast in secties (zichtbaar tijdens montage en klimmen)
        const secH = (H - TOWER_SLEW_UNIT_H) / TOWER_MAST_SECTIONS;
        for (let i = 0; i < TOWER_MAST_SECTIONS; i++) {
          const t = trussUnit(color, 3, 0.1, 0.05);
          placeBetween(t, { x: 0, y: h + i * secH, z: 0 }, { x: 0, y: h + (i + 1) * secH, z: 0 }, 1.6, 1.6);
          this.carrier.add(t);
          this.mastSections.push(t);
        }
        // draaikrans met platform (draait mee met de giek)
        const su = new THREE.Group();
        su.add(box(2.4, TOWER_SLEW_UNIT_H * 0.35, 2.4, DARK, 0, -TOWER_SLEW_UNIT_H + TOWER_SLEW_UNIT_H * 0.175, 0), box(2.2, TOWER_SLEW_UNIT_H * 0.6, 2.2, color, 0, -TOWER_SLEW_UNIT_H * 0.35, 0));
        s.add(su);
        this.slewUnit = su;
        // klimkooi rond de bovenste mastsectie (alleen tijdens het klimmen)
        const cage = new THREE.Group();
        const ct = trussUnit(0xd35400, 3, 0.09, 0.05);
        placeBetween(ct, { x: 0, y: 0, z: 0 }, { x: 0, y: secH * 1.15, z: 0 }, 2.3, 2.3);
        cage.add(ct);
        this.carrier.add(cage);
        this.climbCage = cage;
      }
      for (const kind of ['jib', 'counterJib', ...(cfg.carrier === 'selfErecting' ? ['mast'] : [])]) {
        const t = trussUnit(color, kind === 'mast' ? 10 : 14, 0.12, 0.05);
        s.add(t);
        this.trusses.set(kind, t);
      }
      const cab = new THREE.Group();
      cab.add(box(2, 2.4, 1.8, 0xe9edf0, 0, 0, 0), box(0.05, 1.4, 1.5, glassM, 1.02, 0.2, 0, false));
      s.add(cab);
      this.cab = cab;
      this.trolley = box(1.4, 0.6, 1.4, DARK);
      s.add(this.trolley);
      // torenkop (A-bok): vier stijlen die naar de top samenkomen
      const peakH = cfg.carrier === 'selfErecting' ? 3 : 7;
      const peak = new THREE.Group();
      if (cfg.carrier === 'selfErecting') {
        const pm = beamMesh(color);
        placeBetween(pm, { x: 0, y: 0, z: 0 }, { x: 0, y: peakH, z: 0 }, 0.5, 0.5);
        peak.add(pm);
      } else {
        for (const sx of [-0.6, 0.6]) {
          for (const sz of [-0.6, 0.6]) {
            const leg = box(1, 1, 1, color);
            placeBetween(leg, { x: sx, y: 0, z: sz }, { x: 0, y: peakH - 0.3, z: 0 }, 0.14, 0.14);
            peak.add(leg);
          }
        }
        peak.add(box(0.5, 0.6, 0.5, DARK, 0, peakH - 0.3, 0));
      }
      s.add(peak);
      this.towerPeak = peak;
      for (let i = 0; i < 2; i++) {
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x1d1f22 }));
        s.add(l);
        this.pendants.push(l);
      }
      for (let i = 0; i < (cfg.carrier === 'selfErecting' ? 2 : 3); i++) {
        const b = cfg.carrier === 'selfErecting' ? box(1, 2, 1.6, 0x8c9096) : box(TOWER_BALLAST_W, TOWER_BALLAST_H, 2.2, 0x8c9096);
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
    const P = paint(body);
    const D = paint(DARK, { gloss: 0.2 });
    // draaikrans
    s.add(mesh(cylGeo(1.25, 0.32), D).translateY(h + 0.16));
    // bovenwagen: plaatwerk met afgeschuinde achterkant en motorruimte
    const xa = -houseLen;
    const xb = 1.6;
    s.add(mesh(profile([[xa, h + 0.45], [xa + 0.45, h + 0.3], [xb, h + 0.3], [xb, top - 0.25], [xb - 0.35, top], [xa + 0.3, top], [xa, top - 0.3]], 2.6, 0.06), P));
    s.add(box(houseLen - 1.6, 0.5, 2.3, paint(shadeHex(body, 0.85)), (-houseLen + 0.4 - 1.2) / 2, top + 0.25, 0));
    // ventilatierooster van de motor
    for (let i = 0; i < 6; i++) s.add(box(0.06, (top - h) * 0.45, 0.02, D, xa + 0.8 + i * 0.18, (h + top) / 2, -1.31, false));
    // cabine met grote ruiten
    const cab = new THREE.Group();
    cab.add(mesh(profile([[-1.2, -1], [1.0, -1], [1.25, -0.15], [1.05, 1], [-1.2, 1]], 0.95, 0.05), paint(shadeHex(body, 1.05))));
    cab.add(box(1.6, 1.05, 0.02, glassM, 0.15, 0.3, 0.49, false), box(0.02, 1.0, 0.82, glassM, 1.16, 0.4, 0, false));
    cab.add(box(0.5, 0.12, 0.12, D, -0.6, 1.05, 0.2));
    cab.position.set(0.8, h + 1.2, 1.83);
    s.add(cab);
    this.cab = cab;
    // contragewicht: losse platen die er per stuk bij komen
    for (let i = 0; i < 6; i++) {
      const slab = box(1.6, 0.36, 2.8, ballast());
      s.add(slab);
      this.cwSlabs.push(slab);
    }
    // belettering op de bovenwagen
    const { brand } = brandOf(cfg.name);
    const dcl = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), decal(brand));
    dcl.position.set(xa + 1.6, (h + top) / 2 + 0.1, 1.31);
    s.add(dcl);
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
      // ovale telescoopdelen; binnendelen iets lichter (minder slijtage)
      for (let i = 0; i < Math.max(1, gb.telescopeSections); i++) {
        const m = mesh(boomSectionGeometry(), paint(i === 0 ? this.liv.boom : shadeHex(this.liv.boom, 1 + i * 0.03), { gloss: 0.7 }));
        s.add(m);
        this.sections.push(m);
        const col = mesh(boomSectionGeometry(), paint(shadeHex(this.liv.boom, 0.82), { gloss: 0.4 }));
        s.add(col);
        this.collars.push(col);
      }
      // giekkop met kabelschijven
      const head = new THREE.Group();
      head.add(box(1.4, 0.9, 0.9, P, -0.5, 0, 0));
      for (const z of [-0.28, 0, 0.28]) head.add(mesh(cylGeo(0.42, 0.12), steel(0x9aa0a6, 0.35)).rotateX(Math.PI / 2).translateY(z));
      for (const z of [-0.42, 0.42]) head.add(box(1.0, 1.0, 0.06, P, 0, 0, z));
      s.add(head);
      this.boomHead = head;
      // hefcilinder: geverfde cilinderbuis en blanke zuigerstang
      const c0 = cylinder(1, 1, paint(DARK, { gloss: 0.5, worn: false }));
      const c1 = cylinder(1, 1, steel(0xe6e9ec, 0.08));
      s.add(c0, c1);
      this.cylinders.push(c0, c1);
    }
  }

  // ------------------------------------------------------------------ bijwerken

  /** Werk het model bij. `build` = torenkraan in aanbouw (alleen de gemonteerde delen tonen). */
  update(s: CraneState, g: CraneGeometry, time: number, build?: TowerBuild): void {
    const cfg = this.spec.cfg;
    const gb = this.spec.gb;
    const h = cfg.visual.carrierHeight;
    this.carrier.position.set(s.baseX, 0, s.baseZ);
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
      const pz = pad.z - s.baseZ;
      const jack = s.outriggerJack[i] ?? 0;
      const zIn = pz > 0 ? 1.1 : -1.1;
      const beamY = cfg.carrier === 'selfErecting' ? 0.6 : 0.75 + lift;
      placeBetween(o.beam, { x: lx, y: beamY, z: zIn }, { x: lx, y: beamY, z: pz + (pz > 0 ? 0.25 : -0.25) }, 0.4, 0.5);
      const padY = (1 - jack) * 0.45;
      placeCylinderBetween(o.jack, { x: lx, y: padY + 0.1, z: pz }, { x: lx, y: beamY + 0.05, z: pz }, 0.12);
      o.pad.position.set(lx, padY + 0.06, pz);
    }
    this.slew.rotation.y = -s.slew;
    this.sheave.position.set(g.tipU, g.tipY + 0.4, 0);
    this.sheave.visible = cfg.kind !== 'tower' && !this.boomHead;
    if (this.boomHead) {
      this.boomHead.position.set(g.tipU, g.tipY + 0.1, 0);
      this.boomHead.rotation.z = g.displayBoomAngle;
    }
    const blink = Math.sin(time * 0.012) > 0;
    (this.beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = blink ? 1.4 : 0.15;
    this.beaconLight.intensity = blink ? 6 : 0;

    if (cfg.kind === 'tower') return this.updateTower(s, g, build);
    if (cfg.kind === 'knuckle') return this.updateKnuckle(g);

    // contragewicht
    const cw = this.spec.counterweights[s.counterweightIndex];
    const cwT = (cw?.massT ?? 0) + s.extraCounterweightT;
    if (this.cwSlabs.length) {
      // aantal platen naar verhouding van het gemonteerde contragewicht (zoals een echte plaatstapel)
      const maxT = Math.max(1, ...this.spec.counterweights.map((c) => c.massT)) + Math.max(0, s.extraCounterweightT);
      const n = cwT <= 0.05 ? 0 : Math.max(1, Math.round((cwT / maxT) * this.cwSlabs.length));
      const r = cw?.radius ?? 3;
      const slabH = Math.min(0.55, 0.22 + Math.sqrt(maxT) * 0.03);
      this.cwSlabs.forEach((m, i) => {
        m.visible = i < n;
        m.scale.set(1.6, slabH - 0.03, 2.8);
        m.position.set(-r - 0.1, h + 0.3 + slabH * (i + 0.5), 0);
      });
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
      // kraag aan het buiteneinde (iets dikker, 35 cm lang)
      const col = this.collars[k - 1];
      if (col) {
        const L = Math.hypot(seg.u1 - seg.u0, seg.y1 - seg.y0) || 1;
        const t = Math.max(0, 1 - 0.35 / L);
        col.visible = true;
        placeBetween(col, { x: seg.u0 + (seg.u1 - seg.u0) * t, y: seg.y0 + (seg.y1 - seg.y0) * t, z: 0 }, { x: seg.u1, y: seg.y1, z: 0 }, seg.width * 1.06, seg.width * 0.85 * 1.06);
      }
    }
    for (let j = k; j < this.sections.length; j++) {
      this.sections[j].visible = false;
      if (this.collars[j]) this.collars[j].visible = false;
    }
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

  private updateTower(s: CraneState, g: CraneGeometry, build?: TowerBuild): void {
    const gb = this.spec.gb;
    const cfg = this.spec.cfg;
    const segs = g.segments;
    const mast = segs.find((x) => x.kind === 'mast')!;
    const jib = segs.find((x) => x.kind === 'jib');
    const cj = segs.find((x) => x.kind === 'counterJib');
    const topY = mast.y1;
    const topU = mast.u1;
    const tower = cfg.carrier === 'towerBase';
    const H = gb.towerHeight ?? 30;
    const secH = (H - TOWER_SLEW_UNIT_H) / TOWER_MAST_SECTIONS;
    // mastsecties: tijdens het klimmen staat de bovenkant in de klimkooi
    const sectionsF = tower ? (build ? build.sections : (topY - TOWER_SLEW_UNIT_H - mast.y0) / secH) : 0;
    const climbing = tower && !build && gb.setupType === 'towerAssembly' && s.setupProgress < 1;
    if (this.mastSections.length) this.mastSections.forEach((m, i) => (m.visible = i < Math.floor(sectionsF + 1e-6)));
    if (this.climbCage) {
      this.climbCage.visible = climbing;
      this.climbCage.position.set(0, topY - TOWER_SLEW_UNIT_H - secH * 1.15, 0);
    }
    const suOn = !build || build.slewingUnit;
    const headOn = !build || build.towerHead;
    const cjOn = !!cj && (!build || build.counterJib);
    const jibOn = !!jib && (!build || build.jib);
    if (this.slewUnit) {
      this.slewUnit.visible = suOn;
      this.slewUnit.position.set(topU, topY, 0);
    }
    const tm = this.trusses.get('mast');
    if (tm) placeSeg(tm, mast, 1.4);
    const tj = this.trusses.get('jib')!;
    const jibLen = jib ? Math.hypot(jib.u1 - jib.u0, jib.y1 - jib.y0) : 0;
    tj.visible = jibOn && jibLen > 0.3;
    // giek en tegengiek beginnen naast de draaikrans
    const root = tower ? TOWER_ROOT_OFFSET : 0;
    const along = (seg: { u0: number; y0: number; u1: number; y1: number }, d: number) => {
      const L = Math.hypot(seg.u1 - seg.u0, seg.y1 - seg.y0) || 1;
      return { u: seg.u0 + ((seg.u1 - seg.u0) * d) / L, y: seg.y0 + ((seg.y1 - seg.y0) * d) / L };
    };
    if (jib && tj.visible) {
      const a = along(jib, root);
      placeBetween(tj, { x: a.u, y: a.y, z: 0 }, { x: jib.u1, y: jib.y1, z: 0 }, 1.3, 1.3);
    }
    const tc = this.trusses.get('counterJib')!;
    tc.visible = cjOn;
    if (cj && cjOn) {
      const a = along(cj, root);
      placeBetween(tc, { x: a.u, y: a.y, z: 0 }, { x: cj.u1, y: cj.y1, z: 0 }, tower ? TOWER_COUNTERJIB_H : 1.1, 1.1);
    }
    if (this.cab) {
      this.cab.visible = suOn;
      this.cab.position.set(topU + 1.6, topY - 1.4, 1.7);
    }
    if (this.trolley) {
      this.trolley.visible = jibOn && jibLen > 0.3 && g.jibUnfold >= 1;
      this.trolley.position.set(g.tipU, g.tipY + 0.6, 0);
    }
    const peakH = cfg.carrier === 'selfErecting' ? 3 : 7;
    if (this.towerPeak) {
      this.towerPeak.visible = headOn && g.jibUnfold >= 1;
      this.towerPeak.position.set(topU, topY, 0);
    }
    // trekstangen van de torenkop naar giek en tegengiek
    const peak = new THREE.Vector3(topU, topY + peakH, 0);
    const showPend = headOn && g.jibUnfold >= 1;
    this.pendants[0].visible = showPend && jibOn && jibLen > 1;
    this.pendants[1].visible = showPend && cjOn;
    if (jib) setLine(this.pendants[0], peak, new THREE.Vector3(topU + (jib.u1 - jib.u0) * 0.65, jib.y0, 0));
    if (cj) setLine(this.pendants[1], peak, new THREE.Vector3(cj.u1, cj.y1, 0));
    // ballast: zelfopbouw op de onderwagen, torenkraan bovenop de tegengiek
    if (cfg.carrier === 'selfErecting') {
      const on = Math.round(Math.min(1, Math.max(0, (s.setupProgress - 0.2) / 0.2)) * this.ballast.length);
      this.ballast.forEach((b, i) => (b.visible = i < on));
      return;
    }
    const dirCj = cj && cj.u1 < cj.u0 ? -1 : 1;
    const slewC = Math.cos(s.slew) >= 0 ? 1 : -1;
    this.ballast.forEach((b, i) => {
      if (build) {
        const bl = build.ballast[i];
        b.visible = !!bl && cjOn;
        // wereld-x → afstand langs de tegengiek (de giek staat tijdens de montage langs x)
        if (bl && cj) b.position.set((bl.x - g.slewX) * slewC, cj.y1 + TOWER_COUNTERJIB_H / 2 + TOWER_BALLAST_H / 2, 0);
        return;
      }
      b.visible = cjOn;
      if (cj) b.position.set(cj.u1 - dirCj * (0.7 + i * 1.4), cj.y1 + TOWER_COUNTERJIB_H / 2 + TOWER_BALLAST_H / 2, 0);
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

const geoCache = new Map<string, THREE.BufferGeometry>();
function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    g.userData.shared = true;
    geoCache.set(key, g);
  }
  return g;
}

/** Cilinder met as langs y. */
const cylGeo = (r: number, len: number) => cachedGeo(`cyl|${r}|${len}`, () => new THREE.CylinderGeometry(r, r, len, 16));

/** Spatbord: halve ring boven het wiel, 0,55 m breed. */
const archGeo = (r: number) =>
  cachedGeo(`arch|${r}`, () => {
    const s = new THREE.Shape();
    s.absarc(0, 0, r + 0.06, 0, Math.PI, false);
    s.absarc(0, 0, r, Math.PI, 0, true);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.55, bevelEnabled: false, curveSegments: 18 });
    g.translate(0, 0, -0.275);
    return g;
  });

const surfaceDeck = () => paint(0x6f6a63, { gloss: 0.1 });
const surfaceConcrete = () => surface('concrete', 0xd0cdc6);
