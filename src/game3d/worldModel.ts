import * as THREE from 'three';
import type { MissionDef, ObstacleDef } from '../missions/data/types';
import { obstacleZ } from '../missions/runtime/buildWorld';
import { hashString, makeRng } from '../utils/math';
import { box, boxMinMax, cylinder, mat, placeBetween, placeCylinderBetween, shadeHex, trussUnit } from './kit';
import type { EnvPalette, SkyPalette } from '../game/render/palette';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FacadeKind } from './realism';
import { GROUND_SURFACE, GROUND_TYPE_SURFACE, facade, glass, paint, rubber, steel, surface } from './realism';

/** Waterpartijen per missie (alleen visueel; de bodem is vlak). */
export const WATER: Record<string, [number, number][]> = {
  m23: [[9.5, 35]],
  m32: [[26.5, 140]],
  m38: [[14.5, 47.5]],
  m40: [[20, 140]],
};

interface Animated {
  update(t: number, wind: number): void;
}

/** Statische 3D-wereld van een missie plus levende achtergronddetails. */
export class WorldModel {
  readonly root = new THREE.Group();
  private animated: Animated[] = [];
  private water: THREE.Mesh[] = [];

  constructor(m: MissionDef, pal: EnvPalette, sky: SkyPalette) {
    const rng = makeRng(hashString(m.id + m.environment));
    this.buildGround(m, pal, rng);
    for (const o of m.obstacles) this.root.add(buildObstacle(o, m.timeOfDay === 'night' || m.timeOfDay === 'dusk'));
    if (pal.indoor) this.buildHall(m, rng);
    else this.buildScenery(m, pal, sky, rng);
  }

  private buildGround(m: MissionDef, pal: EnvPalette, rng: () => number): void {
    const x0 = m.bounds.minX - 40;
    const x1 = m.bounds.maxX + 40;
    const base = GROUND_TYPE_SURFACE[m.groundFallback ?? ''] ?? [GROUND_SURFACE[m.environment], 0xffffff];
    // bouwterrein: één vlak met gescande ondergrond in wereldmaat
    const site = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 60).rotateX(-Math.PI / 2), surface(base[0], base[1]));
    site.position.set((x0 + x1) / 2, 0, -5);
    site.receiveShadow = true;
    this.root.add(site);
    // ondergrondzones (modder, rijplaten, grind) als eigen vlakken erbovenop
    for (const z of m.ground ?? []) {
      const [kind, tint] = GROUND_TYPE_SURFACE[z.type] ?? ['gravel', 0xffffff];
      const zx0 = Math.max(x0, z.x0);
      const zx1 = Math.min(x1, z.x1);
      if (zx1 <= zx0) continue;
      const g = new THREE.Mesh(new THREE.PlaneGeometry(zx1 - zx0, 44).rotateX(-Math.PI / 2), surface(kind, tint));
      g.position.set((zx0 + zx1) / 2, 0.006, -2);
      g.receiveShadow = true;
      this.root.add(g);
    }
    // water
    for (const [w0, w1] of m.water ?? WATER[m.id] ?? []) {
      const geo = new THREE.PlaneGeometry(w1 - w0, 120, Math.ceil((w1 - w0) / 3), 30);
      geo.rotateX(-Math.PI / 2);
      const wm = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: 0x1d3b4a, roughness: 0.06, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.94 }));
      wm.position.set((w0 + w1) / 2, 0.03, -30);
      wm.receiveShadow = true;
      this.root.add(wm);
      this.water.push(wm);
    }
    // omgeving rond het speelveld: terrein met lichte hoogteverschillen (gras/grond)
    const outer = new THREE.PlaneGeometry(900, 700, 90, 70);
    outer.rotateX(-Math.PI / 2);
    const pos = outer.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + (x0 + x1) / 2;
      const z = pos.getZ(i) - 120;
      const inPlay = x > x0 - 5 && x < x1 + 5 && z > -38 && z < 28;
      // heuvels pas voorbij de stadsrand, zodat gebouwen op vlak terrein staan
      const far = Math.min(1, Math.max(0, (Math.abs(z + 20) - 440) / 200));
      pos.setY(i, inPlay ? -0.05 : -0.05 + (rng() * 0.6 + far * 18 * (0.5 + 0.5 * Math.sin(x * 0.02 + z * 0.015))) * (pal.indoor ? 0 : 1));
    }
    outer.computeVertexNormals();
    const om = new THREE.Mesh(outer, pal.indoor ? surface('concrete', 0x9a9ea2) : surface(m.environment === 'roughTerrain' ? 'mud' : 'grass', 0xa8c48a));
    om.position.set((x0 + x1) / 2, 0, -120);
    om.receiveShadow = true;
    this.root.add(om);
  }

  private buildScenery(m: MissionDef, pal: EnvPalette, _sky: SkyPalette, rng: () => number): void {
    const cx = (m.bounds.minX + m.bounds.maxX) / 2;
    const night = m.timeOfDay === 'night' || m.timeOfDay === 'dusk';
    // stadsrand: stratenraster met bouwblokken (instanced per gevelsoort: weinig draw calls)
    if (pal.label !== 'Windpark') {
      const tall = pal.label === 'Binnenstad' || pal.label === 'Hoogbouwproject';
      const industrial = pal.label === 'Haven' || pal.label === 'Industrieterrein';
      const kindsLow: FacadeKind[] = industrial ? ['industrial', 'industrial', 'concrete'] : ['brick', 'concrete', 'brick', 'office'];
      const kindsHigh: FacadeKind[] = industrial ? ['concrete', 'industrial'] : ['office', 'office', 'concrete'];
      const groups = new Map<string, THREE.Matrix4[]>();
      const roofs: THREE.Matrix4[] = [];
      const units: THREE.Matrix4[] = [];
      const add = (key: string, mtx: THREE.Matrix4) => {
        const l = groups.get(key) ?? [];
        l.push(mtx);
        groups.set(key, l);
      };
      const m4 = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
      const BLOCK = 64;
      const STREET = 14;
      const roads: THREE.Matrix4[] = [];
      const walks: THREE.Matrix4[] = [];
      for (let bz = -2; bz >= -6; bz--) {
        for (let bx = -7; bx <= 7; bx++) {
          const x0 = cx + bx * BLOCK;
          const z0 = -46 + bz * BLOCK + BLOCK / 2;
          if (rng() < 0.12) continue; // park of braakliggend terrein
          // bebouwing langs de randen van het blok
          const n = 2 + Math.floor(rng() * 3);
          for (let k = 0; k < n; k++) {
            const wid = 14 + rng() * 22;
            const dep = 12 + rng() * 16;
            const far = -bz;
            const hgt = tall ? 12 + rng() * (30 + far * 18) : 9 + rng() * (14 + far * 4);
            const x = x0 + (rng() - 0.5) * (BLOCK - STREET - wid);
            const z = z0 + (rng() - 0.5) * (BLOCK - STREET - dep);
            const kinds = hgt > 35 ? kindsHigh : kindsLow;
            const kind = kinds[Math.floor(rng() * kinds.length)];
            add(`${kind}|${Math.floor(rng() * 4)}`, m4(x, hgt / 2, z, wid, hgt, dep));
            roofs.push(m4(x, hgt + 0.25, z, wid + 0.4, 0.5, dep + 0.4));
            if (rng() < 0.6) units.push(m4(x + wid * 0.15, hgt + 1.4, z - dep * 0.1, wid * 0.25, 2.2, dep * 0.25));
          }
          // straten en stoepen rond het blok
          roads.push(m4(x0, 0.02, z0 + BLOCK / 2, BLOCK, 0.04, STREET - 4), m4(x0 + BLOCK / 2, 0.021, z0, STREET - 4, 0.04, BLOCK));
          walks.push(m4(x0, 0.06, z0 + BLOCK / 2 - STREET / 2 + 1, BLOCK, 0.12, 2), m4(x0, 0.06, z0 + BLOCK / 2 + STREET / 2 - 1, BLOCK, 0.12, 2));
        }
      }
      const unit = new THREE.BoxGeometry(1, 1, 1);
      const inst = (mats: THREE.Matrix4[], material: THREE.Material, shadow = true) => {
        if (!mats.length) return;
        const im = new THREE.InstancedMesh(unit, material, mats.length);
        mats.forEach((mm, i) => im.setMatrixAt(i, mm));
        im.castShadow = shadow;
        im.receiveShadow = true;
        this.root.add(im);
      };
      for (const [key, mats] of groups) {
        const [kind, seed] = key.split('|');
        inst(mats, facade(kind as FacadeKind, night, Number(seed)));
      }
      inst(roofs, surface('concrete', 0xa8a49c));
      inst(units, steel(0x9aa0a6, 0.5));
      inst(roads, surface('asphalt', 0xcfcfcf), false);
      inst(walks, surface('concrete', 0xd8d6d0), false);
    }
    // gebouwen in aanbouw met bouwkranen
    for (let i = 0; i < 6; i++) {
      const x = cx - 200 + rng() * 400;
      const z = -45 - rng() * 60;
      const floors = 3 + Math.floor(rng() * 8);
      const g = new THREE.Group();
      for (let f = 0; f <= floors; f++) g.add(box(18, 0.35, 14, 0xa9a59c, 0, f * 3.4, 0));
      for (const px of [-8.5, -3, 3, 8.5]) for (const pz of [-6.5, 6.5]) g.add(box(0.5, floors * 3.4, 0.5, 0x9a968d, px, (floors * 3.4) / 2, pz));
      g.position.set(x, 0, z);
      this.root.add(g);
      const crane = new THREE.Group();
      const mast = trussUnit(pal.accent, 12, 0.12, 0.05);
      const mh = floors * 3.4 + 18;
      placeBetween(mast, { x: 0, y: 0, z: 0 }, { x: 0, y: mh, z: 0 }, 1.6, 1.6);
      const top = new THREE.Group();
      const jib = trussUnit(pal.accent, 16, 0.12, 0.05);
      placeBetween(jib, { x: -10, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }, 1.3, 1.3);
      top.add(jib, box(4, 2.5, 2, 0x8c9096, -9, -1.2, 0));
      top.position.y = mh;
      crane.add(mast, top);
      crane.position.set(x + 12, 0, z + 10);
      this.root.add(crane);
      const phase = rng() * 6;
      const speed = 0.03 + rng() * 0.06;
      this.animated.push({ update: (t) => (top.rotation.y = Math.sin(t * speed + phase) * 1.4) });
    }
    // bomen: stam met takken en een kruin uit onregelmatige bladclusters, samengevoegd tot één mesh
    const leafParts: THREE.BufferGeometry[] = [];
    const barkParts: THREE.BufferGeometry[] = [];
    const leafCol = new THREE.Color();
    for (let i = 0; i < 90; i++) {
      const x = cx - 300 + rng() * 600;
      const z = rng() < 0.5 ? -30 - rng() * 60 : 28 + rng() * 40;
      const h = 6 + rng() * 8;
      const trunk = new THREE.CylinderGeometry(0.12 + h * 0.012, 0.2 + h * 0.02, h * 0.55, 7);
      trunk.translate(x, h * 0.275, z);
      barkParts.push(trunk.toNonIndexed());
      const conifer = rng() < 0.35;
      const clumps = conifer ? 4 : 6 + Math.floor(rng() * 4);
      const base = conifer ? 0x2f4a2a : rng() < 0.5 ? 0x4a6b33 : 0x3e5f2e;
      for (let k = 0; k < clumps; k++) {
        const t = k / clumps;
        const rr = conifer ? h * (0.32 - t * 0.22) : h * (0.16 + rng() * 0.12);
        const g = conifer ? new THREE.ConeGeometry(rr, h * 0.32, 9) : new THREE.IcosahedronGeometry(rr, 1);
        const pos = g.getAttribute('position') as THREE.BufferAttribute;
        for (let v = 0; v < pos.count; v++) {
          const j = 1 + (rng() - 0.5) * 0.28;
          pos.setXYZ(v, pos.getX(v) * j, pos.getY(v) * (conifer ? 1 : 0.85 * j), pos.getZ(v) * j);
        }
        const ox = conifer ? 0 : (rng() - 0.5) * h * 0.3;
        const oz = conifer ? 0 : (rng() - 0.5) * h * 0.3;
        const oy = conifer ? h * (0.35 + t * 0.5) : h * (0.55 + rng() * 0.3);
        g.translate(x + ox, oy, z + oz);
        const ng = g.toNonIndexed();
        leafCol.setHex(base).offsetHSL((rng() - 0.5) * 0.03, 0, (rng() - 0.5) * 0.08);
        const cols = new Float32Array(ng.getAttribute('position').count * 3);
        for (let v = 0; v < cols.length; v += 3) {
          const shade = 0.82 + rng() * 0.3;
          cols[v] = leafCol.r * shade;
          cols[v + 1] = leafCol.g * shade;
          cols[v + 2] = leafCol.b * shade;
        }
        ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        ng.deleteAttribute('uv');
        leafParts.push(ng);
      }
    }
    if (leafParts.length) {
      const leaves = new THREE.Mesh(mergeGeometries(leafParts)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true }));
      leaves.castShadow = true;
      leaves.receiveShadow = true;
      const bark = new THREE.Mesh(mergeGeometries(barkParts)!, new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 1 }));
      bark.castShadow = true;
      this.root.add(leaves, bark);
      this.animated.push({ update: (t, wind) => (leaves.position.x = Math.sin(t * 1.1) * 0.03 * (1 + Math.abs(wind) * 0.3)) });
    }
    // windturbines op de horizon (windpark)
    if (pal.label === 'Windpark') {
      for (let i = 0; i < 9; i++) {
        const t = new THREE.Group();
        const tw = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 90, 8), mat(0xeef1f3));
        tw.position.y = 45;
        const hub = new THREE.Group();
        hub.position.set(0, 90, 3);
        for (let b = 0; b < 3; b++) {
          const blade = box(2, 40, 0.4, 0xf4f6f7, 0, 20, 0);
          const piv = new THREE.Group();
          piv.rotation.z = (b * Math.PI * 2) / 3;
          piv.add(blade);
          hub.add(piv);
        }
        t.add(tw, hub, box(10, 4, 4, 0xeef1f3, 0, 90, 0));
        t.position.set(cx - 400 + i * 100 + rng() * 40, 0, -160 - rng() * 120);
        this.root.add(t);
        const sp = 0.4 + rng() * 0.4;
        this.animated.push({ update: (tt) => (hub.rotation.z = tt * sp) });
      }
    }
    // hekken langs de bouwplaats
    for (let x = m.bounds.minX - 10; x < m.bounds.maxX + 10; x += 3.5) {
      if (rng() < 0.3) continue;
      // bouwhek: gaaspaneel met buisframe op betonnen voet
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2), fenceMesh());
      panel.position.set(x, 1.05, -22);
      this.root.add(panel);
      this.root.add(box(0.12, 0.25, 0.6, surface('concrete', 0xb5b1a9), x - 1.7, 0.12, -22));
    }
  }

  private buildHall(m: MissionDef, rng: () => number): void {
    const cx = (m.bounds.minX + m.bounds.maxX) / 2;
    const len = m.bounds.maxX - m.bounds.minX + 60;
    // achterwand met lichtstraten en kolommen
    this.root.add(box(len, 22, 0.6, 0x3b4148, cx, 11, -26));
    for (let x = cx - len / 2; x < cx + len / 2; x += 10) {
      this.root.add(box(0.8, 22, 0.8, 0x30353b, x, 11, -25.4));
      this.root.add(box(6, 4, 0.1, mat(0x9fb4c8, { emissive: 0x334455 }), x + 5, 15, -25.6, false));
    }
    // machines op de hallenvloer
    for (let i = 0; i < 18; i++) {
      const x = cx - len / 2 + rng() * len;
      const z = rng() < 0.5 ? -18 + rng() * 6 : 14 + rng() * 6;
      const hh = 1 + rng() * 3;
      this.root.add(box(2 + rng() * 4, hh, 2 + rng() * 3, shadeHex(0x56606a, 0.9 + rng() * 0.2), x, hh / 2, z));
    }
    // geel looppad
    this.root.add(box(len, 0.02, 0.15, 0xf2b705, cx, 0.01, 6, false), box(len, 0.02, 0.15, 0xf2b705, cx, 0.01, -6, false));
    // lampen
    for (let x = cx - len / 2; x < cx + len / 2; x += 14) {
      const l = new THREE.PointLight(0xfff3c4, 30, 30, 1.5);
      l.position.set(x, 8, 0);
      this.root.add(l);
    }
  }

  update(t: number, wind: number): void {
    for (const a of this.animated) a.update(t, wind);
    for (const w of this.water) w.position.y = 0.03 + Math.sin(t * 0.8) * 0.03;
  }
}

/** Low-poly obstakel per stijl. Gebruikt dezelfde z-diepte als de fysica. */
export function buildObstacle(o: ObstacleDef, night: boolean): THREE.Group {
  const g = new THREE.Group();
  const [z0, z1] = obstacleZ(o);
  const X0 = o.x;
  const X1 = o.x + o.w;
  const Y0 = o.y;
  const Y1 = o.y + o.h;
  const zc = (z0 + z1) / 2;
  const D = z1 - z0;
  const add = (...m: THREE.Object3D[]) => g.add(...m);
  const style = o.style ?? o.kind;
  const rng = makeRng(hashString(o.id));
  const glassMat = glass(night);
  const concrete = surface('concrete', 0xd6d3cc);
  const block = surface('blockwall', 0xd8d4cc);
  if (o.kind === 'hazard') {
    buildHazard(g, o, X0, X1, Y0, Y1, z0, z1);
    return g;
  }
  switch (style) {
    case 'truckBed':
      add(boxMinMax(X0, X1, Y0 + 0.5, Y1 - 0.15, z0, z1, paint(0x3d4249)), boxMinMax(X0, X1, Y1 - 0.15, Y1, z0, z1, surface('steelplate', 0x8a7f72, { metal: 0.5 })));
      for (let x = X0 + 1; x < X1 - 0.5; x += Math.max(2.5, (X1 - X0) / 4)) {
        for (const z of [z0 + 0.2, z1 - 0.2]) {
          const w = cylinder(0.5, 0.4, rubber());
          w.rotation.x = Math.PI / 2;
          w.position.set(x, 0.5, z);
          add(w);
        }
      }
      break;
    case 'truckCab':
    case 'truckCabL':
      add(boxMinMax(X0, X1, 0.5, Y1, z0, z1, paint(0xdfe4e8)), boxMinMax(style === 'truckCab' ? X1 - 0.05 : X0 - 0.01, style === 'truckCab' ? X1 + 0.01 : X0 + 0.05, Y1 - 1.3, Y1 - 0.25, z0 + 0.2, z1 - 0.2, glassMat));
      break;
    case 'brick':
      add(boxMinMax(X0, X1, Y0, Y1, z0, z1, surface('blockwall', 0xc98a72)));
      break;
    case 'glass': {
      add(boxMinMax(X0, X1, Y0, Y1, z0, z1, glassMat));
      const frame = steel(0xa7adb3, 0.4);
      for (let y = Y0 + 3.5; y < Y1; y += 3.5) add(boxMinMax(X0 - 0.05, X1 + 0.05, y - 0.15, y, z0 - 0.05, z1 + 0.05, frame));
      for (let x = X0 + 1.5; x < X1; x += 1.5) add(boxMinMax(x - 0.06, x + 0.06, Y0, Y1, z1, z1 + 0.04, frame));
      if (night) for (let y = Y0 + 1; y < Y1 - 1; y += 3.5) if (rng() < 0.6) add(boxMinMax(X0 + 0.5, X1 - 0.5, y, y + 1.6, z1 + 0.01, z1 + 0.03, mat(0xffd27a, { emissive: 0xffb347 })));
      break;
    }
    case 'skeleton': {
      const floors = Math.max(1, Math.round((Y1 - Y0) / 3.5));
      const fh = (Y1 - Y0) / floors;
      for (let f = 1; f <= floors; f++) add(boxMinMax(X0, X1, Y0 + f * fh - 0.3, Y0 + f * fh, z0, z1, concrete));
      for (let x = X0; x <= X1 - 0.4; x += Math.max(3, (X1 - X0) / 5)) for (let z = z0; z <= z1 - 0.4; z += Math.max(3, D / 3)) add(boxMinMax(x, x + 0.4, Y0, Y1 - 0.3, z, z + 0.4, concrete));
      break;
    }
    case 'scaffold': {
      add(boxMinMax(X0, X1, Y1 - 0.15, Y1, z0, z1, 0x8a6a3a));
      const tube = steel(0xc4c9ce, 0.45);
      for (let x = X0; x <= X1 + 0.01; x += (X1 - X0) / Math.max(1, Math.round((X1 - X0) / 1.6))) for (const z of [z0, z1]) add(boxMinMax(x - 0.04, x + 0.04, Y0, Y1, z - 0.04, z + 0.04, tube));
      for (let y = Y0 + 1; y < Y1; y += 1.5) for (const z of [z0, z1]) add(boxMinMax(X0, X1, y - 0.03, y + 0.03, z - 0.03, z + 0.03, tube));
      break;
    }
    case 'fence': {
      for (let z = z0; z < z1; z += 0.6) add(boxMinMax(X0, X1, Y0, Y1, z, z + 0.3, Math.round((z - z0) / 0.6) % 2 ? 0xe74c3c : 0xffffff));
      break;
    }
    case 'foundation':
      add(boxMinMax(X0, X1, Y0, Y1, z0, z1, concrete));
      break;
    case 'steel':
      add(boxMinMax(X0, X1, Y0, Y1, z0, z1, surface('steelplate', 0x7d8a96, { metal: 0.7 })));
      break;
    case 'rack':
      add(boxMinMax(X0, X1, Y0, Y1, z0, z1, paint(0x3f5a73)));
      for (let y = Y0 + 1; y < Y1; y += 1.2) add(boxMinMax(X0 - 0.02, X1 + 0.02, y, y + 0.12, z0 - 0.02, z1 + 0.02, 0xf2b705));
      break;
    case 'conveyor':
      add(boxMinMax(X0, X1, Y0, Y1 - 0.12, z0, z1, 0x4a5560), boxMinMax(X0, X1, Y1 - 0.12, Y1, z0 + 0.1, z1 - 0.1, 0x23272b));
      for (let x = X0 + 0.5; x < X1; x += 1) {
        const r = cylinder(0.15, D - 0.2, 0x9aa3ab);
        r.rotation.x = Math.PI / 2;
        r.position.set(x, Y1 - 0.3, zc);
        add(r);
      }
      break;
    case 'tank': {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(o.w, D) / 2, Math.min(o.w, D) / 2, o.h, 32), steel(0xc8ccd0, 0.45));
      t.position.set((X0 + X1) / 2, Y0 + o.h / 2, zc);
      t.castShadow = true;
      t.receiveShadow = true;
      add(t);
      break;
    }
    case 'column': {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(o.w / 2, o.w / 2, o.h, 10), mat(0x9aa3ab));
      t.position.set((X0 + X1) / 2, Y0 + o.h / 2, zc);
      t.castShadow = true;
      add(t);
      for (let y = Y0 + 4; y < Y1; y += 6) {
        const r = cylinder(o.w / 2 + 0.5, 0.2, 0xf2b705);
        r.position.set((X0 + X1) / 2, y, zc);
        add(r);
      }
      break;
    }
    case 'pipe':
    case 'pipeRack': {
      const r = Math.min(o.h, D) / 2;
      const p = cylinder(r, o.w, style === 'pipe' ? 0x6b8798 : 0x5d6d7e);
      p.rotation.z = Math.PI / 2;
      p.position.set((X0 + X1) / 2, (Y0 + Y1) / 2, zc);
      add(p);
      break;
    }
    case 'containerStack': {
      const colors = [0xc0392b, 0x2f6db5, 0x27ae60, 0xd35400];
      const n = Math.max(1, Math.round((Y1 - Y0) / 2.59));
      for (let i = 0; i < n; i++) {
        const c = colors[Math.floor(rng() * colors.length)];
        const yy = Y0 + i * 2.59;
        add(boxMinMax(X0, X1, yy, yy + 2.59, z0, z1, surface('corrugated', shadeHex(c, 1.25))));
      }
      break;
    }
    case 'ship': {
      add(boxMinMax(X0, X1, Y0 - 2, Y1 - 0.8, z0, z1, 0x1f3a52), boxMinMax(X0, X1, Y1 - 0.8, Y1, z0, z1, 0x7b8a8c), boxMinMax(X0, X1, Y0 - 2, Y0 + 0.4, z0 - 0.02, z1 + 0.02, 0xa93226));
      break;
    }
    case 'shiphouse':
      add(boxMinMax(X0, X1, Y0, Y1, z0, z1, 0xe9edf0));
      for (let y = Y0 + 1.5; y < Y1 - 0.5; y += 2.4) add(boxMinMax(X0 + 0.6, X1 - 0.6, y, y + 1, z1, z1 + 0.04, glassMat));
      break;
    case 'turbine': {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(o.w * 0.47, o.w * 0.5, o.h, 12), mat(0xeef1f3));
      t.position.set((X0 + X1) / 2, Y0 + o.h / 2, zc);
      t.castShadow = true;
      t.receiveShadow = true;
      add(t);
      break;
    }
    case 'jacket': {
      for (const x of [X0 + 0.5, X1 - 0.5]) {
        for (const z of [z0 + 0.5, z1 - 0.5]) {
          const leg = cylinder(0.5, o.h - 1, 0xe67e22);
          leg.position.set(x, Y0 + (o.h - 1) / 2, z);
          add(leg);
        }
      }
      for (let y = Y0 + 3; y < Y1 - 1; y += 5) add(boxMinMax(X0 + 0.4, X1 - 0.4, y, y + 0.4, z0 + 0.4, z1 - 0.4, mat(0xe67e22, { transparent: 0.95 })));
      add(boxMinMax(X0, X1, Y1 - 1, Y1, z0, z1, 0x7f8c8d));
      break;
    }
    case 'module':
      add(boxMinMax(X0, X1, Y0, Y1, z0, z1, surface('steelplate', 0xb0bac4, { metal: 0.6 })));
      for (let y = Y0 + 4; y < Y1; y += 4) add(boxMinMax(X0 - 0.03, X1 + 0.03, y, y + 0.3, z0 - 0.03, z1 + 0.03, 0xf2b705));
      break;
    case 'flare': {
      const t = trussUnit(0xc0392b, 18, 0.12, 0.06);
      placeBetween(t, { x: (X0 + X1) / 2, y: Y0, z: zc }, { x: (X0 + X1) / 2, y: Y1, z: zc }, o.w, o.w);
      add(t);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.8, 3, 6), mat(0xff7a00, { emissive: 0xff5a00 }));
      flame.position.set((X0 + X1) / 2, Y1 + 1.5, zc);
      add(flame);
      break;
    }
    case 'ceiling': {
      // dakspanten en lichtstraten van de hal (geen dichte plaat, zodat de camera erin kan kijken)
      for (let x = Math.ceil(X0 / 6) * 6; x < X1; x += 6) {
        const t = trussUnit(0x4a5058, 4, 0.12, 0.05);
        placeBetween(t, { x, y: Y0 + 0.6, z: z0 }, { x, y: Y0 + 0.6, z: z1 }, 1.2, 0.5);
        add(t);
        add(box(1.2, 0.15, 4, mat(0xfff3c4, { emissive: 0xfff0b0 }), x + 3, Y0 - 0.1, 0, false));
      }
      add(boxMinMax(X0, X1, Y0 + 1.2, Y0 + 1.5, z0, z1, mat(0x30353b, { transparent: 0.35 })));
      break;
    }
    case 'roof':
      add(boxMinMax(X0, X1, Y0, Y1, z0, z1, surface('corrugated', 0x9aa1a8)));
      break;
    case 'concrete':
    default:
      add(boxMinMax(X0, X1, Y0, Y1, z0, z1, o.kind === 'support' ? concrete : block));
      break;
  }
  return g;
}

/**
 * Gevarenzone: een doorzichtig rood vak met rode randen (de veiligheidsafstand), met wat er de reden van is:
 * een hoogspanningslijn met masten en draden, spoorstaven, of alleen het afgezette vak.
 */
function buildHazard(g: THREE.Group, o: ObstacleDef, X0: number, X1: number, Y0: number, Y1: number, z0: number, z1: number): void {
  const fill = boxMinMax(X0, X1, Y0, Y1, z0, z1, mat(0xe02020, { transparent: 0.1, emissive: 0x300000 }));
  fill.castShadow = fill.receiveShadow = false;
  (fill.material as THREE.Material).depthWrite = false;
  g.add(fill);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(X1 - X0, Y1 - Y0, z1 - z0)), new THREE.LineBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.7 }));
  edges.position.set((X0 + X1) / 2, (Y0 + Y1) / 2, (z0 + z1) / 2);
  g.add(edges);
  const cx = (X0 + X1) / 2;
  const cy = (Y0 + Y1) / 2;
  const cz = (z0 + z1) / 2;
  if (o.style === 'powerline') {
    // draden lopen langs de lange kant van het vak, op de middenhoogte; masten aan beide uiteinden
    const alongX = X1 - X0 > z1 - z0;
    const steelMat = steel(0x8d949b);
    const wireMat = mat(0x2a2d31, { rough: 0.5 });
    const ends = alongX ? [X0 - 2, X1 + 2] : [z0 - 2, z1 + 2];
    for (const e of ends) {
      const px = alongX ? e : cx;
      const pz = alongX ? cz : e;
      const pole = box(0.6, cy + 2, 0.6, steelMat, px, (cy + 2) / 2, pz);
      const arm = box(alongX ? 0.3 : 5, 0.25, alongX ? 5 : 0.3, steelMat, px, cy + 0.5, pz);
      g.add(pole, arm);
    }
    for (const off of [-2, 0, 2]) {
      const a = alongX ? new THREE.Vector3(ends[0], cy + 0.5, cz + off) : new THREE.Vector3(cx + off, cy + 0.5, ends[0]);
      const b = alongX ? new THREE.Vector3(ends[1], cy + 0.5, cz + off) : new THREE.Vector3(cx + off, cy + 0.5, ends[1]);
      const w = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 5), wireMat);
      placeCylinderBetween(w, a, b, 0.025);
      g.add(w);
    }
  } else if (o.style === 'rail') {
    const railMat = steel(0x6d6a66);
    const alongX = X1 - X0 > z1 - z0;
    for (const off of [-0.72, 0.72]) g.add(alongX ? box(X1 - X0, 0.16, 0.08, railMat, cx, 0.2, cz + off) : box(0.08, 0.16, z1 - z0, railMat, cx + off, 0.2, cz));
    const n = Math.floor((alongX ? X1 - X0 : z1 - z0) / 0.6);
    for (let i = 0; i < n; i++) {
      const t = (alongX ? X0 : z0) + 0.3 + i * 0.6;
      g.add(alongX ? box(0.25, 0.12, 2.6, 0x5a4a3a, t, 0.06, cz) : box(2.6, 0.12, 0.25, 0x5a4a3a, cx, 0.06, t));
    }
  }
}

/** Doelzone: transparant vak op het oppervlak met omkaderde "spooklast". */
export class ZoneMarker {
  readonly root = new THREE.Group();
  private fill: THREE.Mesh;
  private edges: THREE.LineSegments;
  private ghost: THREE.LineSegments | null = null;

  constructor(x: number, y: number, halfW: number, tol: number, zTol: number, ghost?: { w: number; h: number; d: number }, z = 0) {
    const w = halfW * 2 + tol * 2;
    const d = Math.max(1, zTol * 2 + (ghost?.d ?? 1));
    this.fill = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), new THREE.MeshBasicMaterial({ color: 0xf2b705, transparent: true, opacity: 0.25, depthWrite: false }));
    this.fill.position.set(x, y + 0.03, z);
    this.edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.05, d)), new THREE.LineBasicMaterial({ color: 0xf2b705 }));
    this.edges.position.copy(this.fill.position);
    this.root.add(this.fill, this.edges);
    if (ghost) {
      this.ghost = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(ghost.w, ghost.h, ghost.d)), new THREE.LineDashedMaterial({ color: 0xf2b705, dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0.7 }));
      this.ghost.computeLineDistances();
      this.ghost.position.set(x, y + ghost.h / 2, z);
      this.root.add(this.ghost);
    }
  }

  setState(active: boolean, done: boolean, t: number): void {
    const color = done ? 0x2ecc71 : active ? 0xf2b705 : 0x9aa3ab;
    const pulse = active ? 0.25 + 0.15 * Math.sin(t * 4) : 0.15;
    (this.fill.material as THREE.MeshBasicMaterial).color.setHex(color);
    (this.fill.material as THREE.MeshBasicMaterial).opacity = pulse;
    (this.edges.material as THREE.LineBasicMaterial).color.setHex(color);
    if (this.ghost) this.ghost.visible = !done;
  }
}

let fenceMat: THREE.MeshStandardMaterial | null = null;
/** Gaas van een bouwhek (alpha-getest raster) met verzinkt buisframe. */
function fenceMesh(): THREE.MeshStandardMaterial {
  if (fenceMat) return fenceMat;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 160);
  g.strokeStyle = '#cfd3d6';
  g.lineWidth = 1.4;
  for (let x = 0; x <= 256; x += 6) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 160);
    g.stroke();
  }
  for (let y = 0; y <= 160; y += 14) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  g.lineWidth = 7;
  g.strokeRect(3, 3, 250, 154);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  fenceMat = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.35, transparent: false, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide });
  return fenceMat;
}
