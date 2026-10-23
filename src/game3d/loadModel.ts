import * as THREE from 'three';
import type { LoadType } from '../missions/data/loads';
import { box, cylinder, mat, shadeHex, trussUnit, placeBetween } from './kit';

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

/** Haakblok met schijfkast en haak. */
export function buildHook(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  g.add(box(w, h * 0.6, w * 0.8, 0xf2b705, 0, h * 0.15, 0), box(w * 0.85, h * 0.2, w * 0.82, 0x2b2f36, 0, h * 0.45, 0));
  const shank = cylinder(w * 0.1, h * 0.25, 0x3b3f45, 6);
  shank.position.y = -h * 0.25;
  const hook = new THREE.Mesh(new THREE.TorusGeometry(w * 0.22, w * 0.07, 4, 8, Math.PI * 1.4), mat(0x3b3f45, { metal: 0.5 }));
  hook.position.y = -h * 0.42;
  hook.rotation.z = Math.PI * 0.8;
  g.add(shank, hook);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}
