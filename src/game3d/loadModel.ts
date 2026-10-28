import * as THREE from 'three';
import type { LoadType } from '../missions/data/loads';
import { box, cylinder, mat, shadeHex, trussUnit, placeBetween } from './kit';
import { buildHookBlock } from './cabs';

/**
 * Low-poly 3D-model van een last. Het model is opgebouwd rond het geometrische midden;
 * `pivot` verschuift het naar het zwaartepunt (boxOffset in de simulatie).
 */
export function buildLoad(t: LoadType): THREE.Group {
  const g = new THREE.Group();
  const w = t.width;
  const h = t.height;
  const d = t.depth;
  const c = t.color;
  const add = (...o: THREE.Object3D[]) => g.add(...o);
  switch (t.style) {
    case 'pallet':
    case 'bricks': {
      add(box(w, 0.15, d, 0xb98a4b, 0, -h / 2 + 0.075, 0));
      for (const x of [-w / 2 + 0.1, 0, w / 2 - 0.1]) add(box(0.12, 0.12, d, 0x8a6235, x, -h / 2 + 0.06, 0));
      const n = t.style === 'bricks' ? 5 : 3;
      const layer = (h - 0.15) / n;
      for (let i = 0; i < n; i++) add(box(w - 0.08, layer * 0.92, d - 0.08, shadeHex(c, 0.92 + (i % 2) * 0.1), 0, -h / 2 + 0.15 + layer * (i + 0.5), 0));
      break;
    }
    case 'container': {
      add(box(w, h, d, c, 0, 0, 0));
      const ribs = Math.max(3, Math.round(w / 0.35));
      for (let i = 0; i <= ribs; i++) add(box(0.05, h * 0.92, d + 0.04, shadeHex(c, 0.75), -w / 2 + (i * w) / ribs, 0, 0));
      for (const x of [-w / 2, w / 2]) for (const y of [-h / 2, h / 2]) add(box(0.18, 0.18, d + 0.06, 0x3b3f45, x, y, 0));
      break;
    }
    case 'beam': {
      add(box(w, 0.06, d, c, 0, h / 2 - 0.03, 0), box(w, 0.06, d, c, 0, -h / 2 + 0.03, 0), box(w, h - 0.12, 0.05, shadeHex(c, 0.85), 0, 0, 0));
      break;
    }
    case 'pipe': {
      const p = cylinder(h / 2, w, c);
      p.rotation.z = Math.PI / 2;
      add(p);
      for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) {
        const f = cylinder(h / 2 + 0.06, 0.1, shadeHex(c, 0.7));
        f.rotation.z = Math.PI / 2;
        f.position.x = x;
        add(f);
      }
      break;
    }
    case 'truss': {
      const tt = trussUnit(c, Math.max(3, Math.round(w / Math.max(0.6, h))), 0.08, 0.05);
      placeBetween(tt, { x: -w / 2, y: 0, z: 0 }, { x: w / 2, y: 0, z: 0 }, h, Math.min(d, h));
      add(tt);
      break;
    }
    case 'bridge': {
      add(box(w, h * 0.75, d * 0.6, c, 0, -h * 0.125, 0), box(w, h * 0.12, d, shadeHex(c, 1.12), 0, h / 2 - h * 0.06, 0));
      for (let x = -w / 2 + 1; x < w / 2; x += 3) add(box(0.15, h * 0.7, d * 0.62, shadeHex(c, 0.8), x, -h * 0.12, 0));
      break;
    }
    case 'turbineTower': {
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.47, w * 0.5, h, 10), mat(c));
      tw.castShadow = true;
      add(tw);
      for (const y of [-h / 2 + 0.1, h / 2 - 0.1]) {
        const f = cylinder(w / 2 + 0.2, 0.2, 0xb8c0c6, 8);
        f.position.y = y;
        add(f);
      }
      break;
    }
    case 'nacelle': {
      add(box(w, h, d, c, 0, 0, 0), box(2.4, h * 0.7, d * 0.7, 0xd5dbe0, w / 2 + 1.1, 0, 0));
      const hub = new THREE.Mesh(new THREE.ConeGeometry(d * 0.35, 1.6, 8), mat(0xeef1f3));
      hub.rotation.z = -Math.PI / 2;
      hub.position.x = w / 2 + 3;
      add(hub);
      break;
    }
    case 'bucket': {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w * 0.18, h, 8), mat(c, { metal: 0.3 }));
      b.castShadow = true;
      add(b, box(w * 1.05, 0.12, 0.12, 0x3b3f45, 0, h / 2 + 0.3, 0));
      break;
    }
    case 'counterweight': {
      add(box(w, h, d, c, 0, 0, 0), box(w * 0.9, 0.06, d + 0.02, 0xf2b705, 0, 0, 0));
      break;
    }
    case 'module': {
      add(box(w, h, d, c, 0, 0, 0));
      for (let y = -h / 2 + 1.2; y < h / 2; y += 1.6) add(box(w + 0.05, 0.15, d + 0.05, 0xf2b705, 0, y, 0));
      for (let x = -w / 2 + 1; x < w / 2; x += 2.2) add(box(0.2, h, 0.2, 0x5d6d7e, x, 0, d / 2));
      break;
    }
    case 'transformer': {
      add(box(w, h, d, c, 0, 0, 0));
      for (let i = -2; i <= 2; i++) add(box(0.25, 0.8, 0.25, 0x8d6e3f, i * w * 0.18, h / 2 + 0.4, 0));
      for (let i = 0; i < 6; i++) add(box(0.08, h * 0.7, d * 0.9, shadeHex(c, 0.8), -w / 2 + 0.1, 0, -d / 2 + 0.2 + (i * d) / 6));
      break;
    }
    case 'hvac':
    case 'generator':
    case 'engine':
    case 'machine': {
      add(box(w, h, d, c, 0, 0, 0), box(w - 0.2, 0.15, d - 0.2, shadeHex(c, 0.85), 0, h / 2 + 0.07, 0));
      if (t.style === 'hvac' || t.style === 'generator') {
        for (const x of [-w / 4, w / 4]) {
          const f = cylinder(Math.min(w, d) * 0.18, 0.12, 0x2b2f36);
          f.position.set(x, h / 2 + 0.12, 0);
          add(f);
        }
      }
      break;
    }
    case 'towerMast': {
      const tt = trussUnit(c, 3, 0.1, 0.05);
      placeBetween(tt, { x: 0, y: -h / 2, z: 0 }, { x: 0, y: h / 2, z: 0 }, w, d);
      add(tt);
      break;
    }
    case 'towerSlewing': {
      add(box(w, h * 0.35, d, 0x3b3f45, 0, -h / 2 + h * 0.175, 0), box(w * 0.9, h * 0.3, d * 0.9, c, 0, 0, 0));
      add(box(1.9, h * 0.65, 1.5, 0xe9edf0, w / 2 + 0.6, h * 0.05, d / 2 - 0.75), box(0.05, h * 0.4, 1.2, 0x6f97b8, w / 2 + 1.56, h * 0.1, d / 2 - 0.75));
      break;
    }
    case 'towerHead': {
      // vier stijlen die naar de top toe samenkomen
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const leg = box(1, 1, 1, c);
          placeBetween(leg, { x: (sx * w) / 2 - sx * 0.1, y: -h / 2, z: (sz * d) / 2 - sz * 0.1 }, { x: 0, y: h / 2 - 0.3, z: 0 }, 0.14, 0.14);
          add(leg);
        }
      }
      add(box(0.5, 0.6, 0.5, 0x3b3f45, 0, h / 2 - 0.3, 0), box(w, 0.15, d, shadeHex(c, 0.8), 0, -h / 2 + 0.08, 0));
      break;
    }
    case 'towerJib': {
      const tt = trussUnit(c, Math.max(4, Math.round(w / 2.2)), 0.1, 0.05);
      placeBetween(tt, { x: -w / 2, y: 0, z: 0 }, { x: w / 2, y: 0, z: 0 }, h, d);
      add(tt);
      break;
    }
    case 'slab': {
      // kanaalplaat / dakelement / tafel: plaat met afgeschuinde kopse kant en (bij kanaalplaten) kanalen
      add(box(w, h, d, c, 0, 0, 0));
      if (h < 0.5) {
        const n = Math.max(2, Math.round(d / 0.22));
        for (let i = 0; i < n; i++) {
          const k = cylinder(h * 0.3, 0.02, shadeHex(c, 0.45));
          k.rotation.z = Math.PI / 2;
          k.position.set(w / 2 + 0.005, 0, -d / 2 + (d * (i + 0.5)) / n);
          add(k);
        }
      } else {
        // bekistingstafel: houten vloer op stalen poten
        add(box(w, 0.08, d, 0xc68f3c, 0, h / 2 - 0.04, 0));
        for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) for (const z of [-d / 2 + 0.3, d / 2 - 0.3]) add(box(0.1, h - 0.1, 0.1, 0x6a6f75, x, -0.05, z));
      }
      break;
    }
    case 'glass': {
      const frame = shadeHex(c, 0.5);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, h - 0.1, 0.04), new THREE.MeshStandardMaterial({ color: c, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.55 }));
      add(pane, box(w, 0.06, d, frame, 0, h / 2 - 0.03, 0), box(w, 0.06, d, frame, 0, -h / 2 + 0.03, 0), box(0.06, h, d, frame, -w / 2 + 0.03, 0, 0), box(0.06, h, d, frame, w / 2 - 0.03, 0, 0));
      break;
    }
    case 'wall': {
      add(box(w, h, d, c, 0, 0, 0));
      if (h > 6) {
        // damwandplank met het trilblok bovenop
        add(box(w * 1.6, 1.2, d * 1.8, 0x3b3f45, 0, h / 2 - 0.6, 0), box(w * 1.2, 0.3, d * 1.2, 0xe0b020, 0, h / 2 - 1.3, 0));
      } else {
        for (const x of [-w / 4, w / 4]) add(box(0.15, 0.08, 0.15, 0x777777, x, h / 2 + 0.04, 0));
      }
      break;
    }
    case 'tree': {
      if (h > w) {
        const tr = cylinder(w / 2, h, c);
        add(tr);
        for (const y of [-h / 4, h / 4]) add(box(w * 1.05, 0.08, w * 1.05, shadeHex(c, 0.8), 0, y, 0));
      } else {
        const tr = cylinder(0.35, h, 0x6b4f35);
        add(tr);
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), mat(c, { rough: 1 }));
        leaf.scale.set(w / 2, h * 0.38, d / 2);
        leaf.position.y = h * 0.12;
        add(leaf);
      }
      break;
    }
    case 'vehicle': {
      // vrachtwagen op zijn kant: chassis, cabine en wielen naar de zijkant
      add(box(w * 0.72, h, d * 0.92, c, -w * 0.14, 0, 0), box(w * 0.26, h * 0.9, d * 0.95, 0x2d6db5, w * 0.37, -h * 0.05, 0));
      for (const x of [-w * 0.4, -w * 0.25, w * 0.32]) {
        const wh = cylinder(0.5, 0.4, 0x222222);
        wh.position.set(x, h / 2 - 0.2, -d * 0.35);
        add(wh);
      }
      break;
    }
    case 'basket': {
      const y = 0xf0c419;
      add(box(w, 0.08, d, 0x555555, 0, -h / 2 + 0.04, 0));
      for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) add(box(0.06, h, 0.06, y, x, 0, z));
      for (const yy of [0, h / 2 - 0.03]) add(box(w, 0.05, 0.05, y, 0, yy, -d / 2), box(w, 0.05, 0.05, y, 0, yy, d / 2), box(0.05, 0.05, d, y, -w / 2, yy, 0), box(0.05, 0.05, d, y, w / 2, yy, 0));
      for (const x of [-0.45, 0.45]) {
        add(box(0.36, 0.9, 0.3, 0xe86a1c, x, -h / 2 + 0.53, 0), box(0.24, 0.24, 0.24, 0xe9c9a5, x, -h / 2 + 1.1, 0), box(0.28, 0.1, 0.28, 0xffffff, x, -h / 2 + 1.27, 0));
      }
      break;
    }
    case 'pool': {
      add(box(w, 0.12, d, shadeHex(c, 1.1), 0, -h / 2 + 0.06, 0));
      for (const z of [-d / 2 + 0.06, d / 2 - 0.06]) add(box(w, h, 0.12, c, 0, 0, z));
      for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) add(box(0.12, h, d, c, x, 0, 0));
      add(box(w + 0.2, 0.08, 0.3, 0xf5f5f0, 0, h / 2, -d / 2), box(w + 0.2, 0.08, 0.3, 0xf5f5f0, 0, h / 2, d / 2));
      break;
    }
    case 'blade': {
      // rotorblad: dikke wortel links, taps toelopend naar de tip
      const n = 8;
      for (let i = 0; i < n; i++) {
        const f = i / n;
        const sw = w / n;
        const sh = h * (1 - f * 0.8);
        const sd = d * (f < 0.15 ? 0.6 + f * 2.6 : 1 - (f - 0.15) * 0.75);
        add(box(sw * 1.02, sh, sd, c, -w / 2 + sw * (i + 0.5), 0, 0));
      }
      const root = cylinder(h / 2, 0.3, 0x8a8f94);
      root.rotation.z = Math.PI / 2;
      root.position.x = -w / 2 - 0.15;
      add(root);
      break;
    }
    case 'vessel': {
      if (t.id === 'yacht') {
        add(box(w, h * 0.55, d, c, 0, -h * 0.22, 0), box(w * 0.55, h * 0.35, d * 0.8, 0xf9f9f9, -w * 0.05, h * 0.25, 0), box(w * 0.5, h * 0.06, d * 0.82, 0x2a3440, -w * 0.05, h * 0.12, 0));
        add(box(w * 0.9, 0.12, d * 1.01, 0x1d4f91, 0, -h * 0.05, 0));
        const bow = new THREE.Mesh(new THREE.ConeGeometry(d / 2, w * 0.18, 4), mat(c));
        bow.rotation.z = -Math.PI / 2;
        bow.rotation.x = Math.PI / 4;
        bow.position.set(w / 2 + w * 0.08, -h * 0.22, 0);
        add(bow);
      } else {
        const v = cylinder(h / 2, w, c);
        v.rotation.z = Math.PI / 2;
        add(v);
        for (let x = -w / 2 + 2; x < w / 2; x += 4) {
          const ring = cylinder(h / 2 + 0.06, 0.2, shadeHex(c, 0.75));
          ring.rotation.z = Math.PI / 2;
          ring.position.x = x;
          add(ring);
        }
      }
      break;
    }
    case 'spire': {
      add(box(w, h * 0.18, d, 0x9d8f7a, 0, -h / 2 + h * 0.09, 0));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(w * 0.48, h * 0.78, 8), mat(c, { rough: 0.6, metal: 0.4 }));
      cone.position.y = h * 0.02 + 0.04;
      add(cone);
      add(box(0.08, 0.9, 0.08, 0xc9a24a, 0, h / 2 - 0.1, 0), box(0.5, 0.08, 0.08, 0xc9a24a, 0, h / 2 - 0.25, 0));
      break;
    }
    default:
      add(box(w, h, d, c, 0, 0, 0));
  }
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return g;
}

/** Haakblok met zijplaten, kabelschijven en haak (aantal schijven volgt de grootte). */
export function buildHook(w: number, h: number): THREE.Group {
  return buildHookBlock(w, h, w > 0.7 ? 4 : w > 0.5 ? 2 : 1);
}
