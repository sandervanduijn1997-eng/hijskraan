import * as THREE from 'three';
import type { Signal } from '../sim/signalman';

/**
 * Bouwvakkers en signaalgever: low-poly figuren op ware grootte (1,80 m) met hesje en helm.
 * Armen hangen aan een schouderscharnier, zodat handsignalen en loopbewegingen mogelijk zijn.
 */
export interface Worker {
  root: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
}

const matCache = new Map<number, THREE.MeshStandardMaterial>();
const m = (c: number, rough = 0.85, emissive = 0): THREE.MeshStandardMaterial => {
  const key = c * 10 + (emissive ? 1 : 0);
  let mm = matCache.get(key);
  if (!mm) {
    mm = new THREE.MeshStandardMaterial({ color: c, roughness: rough, emissive, emissiveIntensity: emissive ? 0.25 : 0 });
    matCache.set(key, mm);
  }
  return mm;
};
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const part = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(boxGeo, mat);
  o.scale.set(w, h, d);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
};

/** Eén bouwvakker. `vest` = kleur van het hesje (oranje of geel), `helmet` = helmkleur. */
export function buildWorker(vest = 0xff7a1a, helmet = 0xf4f4f2, trousers = 0x2b3340): Worker {
  const root = new THREE.Group();
  const skin = m(0xc99a7a);
  const vestM = m(vest, 0.7, vest);
  const stripe = m(0xd8dde2, 0.25);
  // benen aan een heupscharnier
  const leg = (x: number) => {
    const g = new THREE.Group();
    g.position.set(x, 0.92, 0);
    g.add(part(0.16, 0.86, 0.18, m(trousers), 0, -0.43, 0), part(0.17, 0.1, 0.28, m(0x1c1d1f), 0, -0.88, 0.05));
    root.add(g);
    return g;
  };
  const legL = leg(-0.11);
  const legR = leg(0.11);
  // romp met hesje en reflecterende strepen
  root.add(part(0.44, 0.58, 0.24, vestM, 0, 1.22, 0));
  root.add(part(0.45, 0.05, 0.25, stripe, 0, 1.12, 0), part(0.45, 0.05, 0.25, stripe, 0, 1.3, 0));
  // hoofd en helm
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), skin);
  head.position.set(0, 1.64, 0);
  head.castShadow = true;
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), m(helmet, 0.4));
  hat.position.set(0, 1.68, 0);
  hat.castShadow = true;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.015, 14), m(helmet, 0.4));
  brim.position.set(0, 1.68, 0.02);
  root.add(head, hat, brim);
  // armen aan een schouderscharnier (rust: langs het lichaam)
  const arm = (x: number) => {
    const g = new THREE.Group();
    g.position.set(x, 1.48, 0);
    g.add(part(0.11, 0.62, 0.12, vestM, 0, -0.31, 0), part(0.09, 0.1, 0.1, m(0x3a3a3a), 0, -0.66, 0));
    root.add(g);
    return g;
  };
  const armL = arm(-0.29);
  const armR = arm(0.29);
  return { root, armL, armR, legL, legR };
}

/**
 * Zet de armen in de stand van een handsignaal (rotatie om de schouder; z = zijwaarts, x = voorwaarts).
 * `t` (s) laat herhalende gebaren bewegen (cirkelen bij hijsen/zakken, wenken bij "in").
 */
export function poseSignal(w: Worker, s: Signal, t: number): void {
  const L = w.armL.rotation;
  const R = w.armR.rotation;
  L.set(0, 0, 0);
  R.set(0, 0, 0);
  const wave = Math.sin(t * 6);
  switch (s) {
    case 'hoist':
      R.set(0, 0, Math.PI - 0.2 + wave * 0.15);
      break;
    case 'lower':
      R.set(-0.5 + wave * 0.2, 0, 0.35);
      break;
    case 'slow':
      L.set(-Math.PI / 2, 0, 0);
      R.set(-0.4 + wave * 0.15, 0, 0.3);
      break;
    case 'stop':
      L.set(0, 0, -Math.PI / 2);
      R.set(0, 0, Math.PI / 2);
      break;
    case 'slewLeft':
      L.set(0, 0, -Math.PI / 2);
      break;
    case 'slewRight':
      R.set(0, 0, Math.PI / 2);
      break;
    case 'out':
      L.set(-Math.PI / 2, 0, -0.3);
      R.set(-Math.PI / 2, 0, 0.3);
      break;
    case 'in':
      R.set(-Math.PI / 2 - wave * 0.5, 0, 0);
      break;
    case 'wait':
      L.set(-Math.PI / 2, 0, 0.4);
      R.set(-Math.PI / 2, 0, -0.4);
      break;
    case 'release':
      R.set(-Math.PI / 4, 0, 0.2);
      break;
    default:
      break;
  }
}
