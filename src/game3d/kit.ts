import * as THREE from 'three';

/**
 * Bouwstenen voor de low-poly 3D-wereld: gedeelde materialen (flat shading), balken tussen twee punten
 * en vakwerk. Simulatiecoördinaten worden 1-op-1 gebruikt: x rechts, y omhoog, z naar de kijker (meter).
 */
const matCache = new Map<string, THREE.MeshStandardMaterial>();

export function mat(color: number, opts: { rough?: number; metal?: number; emissive?: number; transparent?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.rough ?? 0.85}|${opts.metal ?? 0.05}|${opts.emissive ?? 0}|${opts.transparent ?? 1}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.85,
      metalness: opts.metal ?? 0.05,
      flatShading: true,
      emissive: opts.emissive ?? 0,
      emissiveIntensity: opts.emissive ? 1 : 0,
      transparent: (opts.transparent ?? 1) < 1,
      opacity: opts.transparent ?? 1,
    });
    matCache.set(key, m);
  }
  return m;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const unitCyl6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);

/** Doos met midden op (x, y, z) en afmetingen (w, h, d). */
export function box(w: number, h: number, d: number, color: number | THREE.Material, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(unitBox, typeof color === 'number' ? mat(color) : color);
  m.scale.set(Math.max(1e-3, w), Math.max(1e-3, h), Math.max(1e-3, d));
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

/** Doos tussen min- en max-hoek. */
export function boxMinMax(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number | THREE.Material): THREE.Mesh {
  return box(x1 - x0, y1 - y0, z1 - z0, color, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

export function cylinder(r: number, h: number, color: number | THREE.Material, sides: 6 | 8 = 8): THREE.Mesh {
  const m = new THREE.Mesh(sides === 6 ? unitCyl6 : unitCyl, typeof color === 'number' ? mat(color) : color);
  m.scale.set(r * 2, h, r * 2);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);
const xAxis = new THREE.Vector3(1, 0, 0);

/**
 * Plaats een object dat langs zijn lokale x-as 1 lang is (eenheidsbalk) tussen twee punten.
 * `width` en `depth` zijn de doorsnede.
 */
export function placeBetween(obj: THREE.Object3D, a: THREE.Vector3Like, b: THREE.Vector3Like, width: number, depth: number): void {
  tmpA.set(a.x, a.y, a.z);
  tmpB.set(b.x, b.y, b.z);
  tmpD.subVectors(tmpB, tmpA);
  const len = Math.max(1e-3, tmpD.length());
  obj.position.copy(tmpA).addScaledVector(tmpD, 0.5);
  obj.quaternion.setFromUnitVectors(xAxis, tmpD.normalize());
  obj.scale.set(len, width, depth);
}

/** Cilinder (as langs y) tussen twee punten. */
export function placeCylinderBetween(obj: THREE.Object3D, a: THREE.Vector3Like, b: THREE.Vector3Like, radius: number): void {
  tmpA.set(a.x, a.y, a.z);
  tmpB.set(b.x, b.y, b.z);
  tmpD.subVectors(tmpB, tmpA);
  const len = Math.max(1e-3, tmpD.length());
  obj.position.copy(tmpA).addScaledVector(tmpD, 0.5);
  obj.quaternion.setFromUnitVectors(yAxis, tmpD.normalize());
  obj.scale.set(radius * 2, len, radius * 2);
}

/** Eenheidsbalk (lengte 1 langs x, doorsnede 1×1) als mesh, te plaatsen met placeBetween. */
export function beamMesh(color: number | THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(unitBox, typeof color === 'number' ? mat(color) : color);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Vakwerk (lattice) van lengte 1 langs x met vierkante doorsnede 1×1: vier koorden en diagonalen.
 * Schaal met scale.set(len, w, w): de diagonalen schalen mee. `bays` is het aantal vakken.
 */
export function trussUnit(color: number, bays: number, chord = 0.08, lace = 0.04): THREE.Group {
  const g = new THREE.Group();
  const m = mat(color, { metal: 0.3, rough: 0.6 });
  const corners: [number, number][] = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  for (const [cy, cz] of corners) {
    const c = new THREE.Mesh(unitBox, m);
    c.scale.set(1, chord, chord);
    c.position.set(0, cy * (1 - chord), cz * (1 - chord));
    c.castShadow = true;
    g.add(c);
  }
  // diagonalen op de vier zijden
  const faces: [[number, number], [number, number]][] = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];
  for (let f = 0; f < 4; f++) {
    const [p, q] = faces[f];
    for (let i = 0; i < bays; i++) {
      const x0 = -0.5 + i / bays;
      const x1 = -0.5 + (i + 1) / bays;
      const flip = (i + f) % 2 === 0;
      const a = flip ? p : q;
      const b = flip ? q : p;
      const d = new THREE.Mesh(unitBox, m);
      placeBetween(d, { x: x0, y: a[0] * 0.92, z: a[1] * 0.92 }, { x: x1, y: b[0] * 0.92, z: b[1] * 0.92 }, lace, lace);
      g.add(d);
    }
  }
  return g;
}

/** Low-poly wiel (achthoekige band met velg) met as langs z. */
export function wheel(radius: number, width: number, tire = 0x16181b, rim = 0x8d949b): THREE.Group {
  const g = new THREE.Group();
  const t = cylinder(radius, width, tire);
  t.rotation.x = Math.PI / 2;
  const r = cylinder(radius * 0.55, width * 1.04, rim, 6);
  r.rotation.x = Math.PI / 2;
  g.add(t, r);
  return g;
}

export function disposeGroup(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && m.geometry !== unitBox && m.geometry !== unitCyl && m.geometry !== unitCyl6) m.geometry.dispose();
  });
}

export function shadeHex(color: number, f: number): number {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const m = (c: number) => Math.max(0, Math.min(255, Math.round(f >= 1 ? c + (255 - c) * (f - 1) : c * f)));
  return (m(r) << 16) | (m(g) << 8) | m(b);
}
