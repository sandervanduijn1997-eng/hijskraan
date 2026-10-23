import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Realistische kraanonderdelen als geometrie: geprofileerde plaatdelen, banden met profiel, velgen,
 * ovale telescoopdelen, buisvakwerk (samengevoegd tot één mesh per vakwerk) en belettering.
 * Alles in meters; onderdelen met lengte 1 langs x kunnen met placeBetween worden geplaatst.
 */

const geoCache = new Map<string, THREE.BufferGeometry>();
const cached = (key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry => {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    g.userData.shared = true;
    geoCache.set(key, g);
  }
  return g;
};

export function mesh(geo: THREE.BufferGeometry, m: THREE.Material, shadow = true): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
}

/**
 * Plaatdeel met een zijprofiel (punten in x/y, tegen de klok in), geëxtrudeerd over `depth` in z (gecentreerd),
 * met een kleine afronding op de randen.
 */
export function profile(points: [number, number][], depth: number, bevel = 0.04): THREE.BufferGeometry {
  const key = `prof|${points.map((p) => p.join(',')).join(';')}|${depth}|${bevel}`;
  return cached(key, () => {
    const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(s, { depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 4 });
    g.translate(0, 0, -(depth - bevel * 2) / 2);
    g.computeVertexNormals();
    return g;
  });
}

/** Band met afgeronde schouders en noppenprofiel; as langs z, middelpunt in de oorsprong. */
export function tireGeometry(r: number, w: number): THREE.BufferGeometry {
  return cached(`tire|${r}|${w}`, () => {
    const pts: THREE.Vector2[] = [];
    const ri = r * 0.62;
    const sh = Math.min(w * 0.28, r * 0.18);
    pts.push(new THREE.Vector2(ri, -w / 2));
    pts.push(new THREE.Vector2(r - sh, -w / 2));
    for (let i = 0; i <= 6; i++) {
      const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(r - sh + Math.cos(a) * sh, -w / 2 + sh + Math.sin(a) * sh));
    }
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(r - sh + Math.cos(a) * sh, w / 2 - sh + Math.sin(a) * sh));
    }
    pts.push(new THREE.Vector2(ri, w / 2));
    const body = new THREE.LatheGeometry(pts, 40);
    body.rotateX(Math.PI / 2);
    // noppen: schuine blokken over het loopvlak
    const parts: THREE.BufferGeometry[] = [body.toNonIndexed()];
    const n = Math.max(18, Math.round(r * 30));
    for (let i = 0; i < n; i++) {
      for (const side of [-1, 1]) {
        const b = new THREE.BoxGeometry(r * 0.11, r * 0.045, w * 0.36);
        b.rotateY(side * 0.35);
        b.translate(0, r + r * 0.01, side * w * 0.2);
        b.rotateZ((i / n) * Math.PI * 2 + (side > 0 ? Math.PI / n : 0));
        parts.push(b.toNonIndexed());
      }
    }
    const g = mergeGeometries(parts)!;
    g.computeVertexNormals();
    return g;
  });
}

/** Stalen velg met naaf en wielbouten; as langs z. */
export function rimGeometry(r: number, w: number): THREE.BufferGeometry {
  return cached(`rim|${r}|${w}`, () => {
    const rr = r * 0.6;
    const parts: THREE.BufferGeometry[] = [];
    const disc = new THREE.CylinderGeometry(rr, rr, w * 0.82, 28, 1, false);
    disc.rotateX(Math.PI / 2);
    parts.push(disc.toNonIndexed());
    const hub = new THREE.CylinderGeometry(rr * 0.42, rr * 0.5, w * 0.95, 16);
    hub.rotateX(Math.PI / 2);
    parts.push(hub.toNonIndexed());
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const b = new THREE.CylinderGeometry(rr * 0.05, rr * 0.05, w * 1.0, 6);
      b.rotateX(Math.PI / 2);
      b.translate(Math.cos(a) * rr * 0.6, Math.sin(a) * rr * 0.6, 0);
      parts.push(b.toNonIndexed());
    }
    const g = mergeGeometries(parts)!;
    g.computeVertexNormals();
    return g;
  });
}

/**
 * Telescoopgiekdeel: ovaal/ei-vormig profiel (onderkant rond, bovenkant afgevlakt), lengte 1 langs x,
 * doorsnede 1 × 1 (y × z), te schalen met placeBetween.
 */
export function boomSectionGeometry(): THREE.BufferGeometry {
  return cached('boomsec', () => {
    const s = new THREE.Shape();
    const n = 20;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      // superellips: bovenkant vlakker dan de onderkant (zoals een ovaalprofiel van een telescoopgiek)
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const ey = sn >= 0 ? 0.35 : 0.8;
      const y = 0.5 * Math.sign(sn) * Math.pow(Math.abs(sn), ey);
      const z = 0.5 * Math.sign(c) * Math.pow(Math.abs(c), 0.55);
      if (i === 0) s.moveTo(z, y);
      else s.lineTo(z, y);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 1 });
    // extrusie langs z → draaien naar x, centreren
    g.rotateY(Math.PI / 2);
    g.translate(-0.5, 0, 0);
    g.computeVertexNormals();
    return g;
  });
}

/**
 * Buisvakwerk van lengte 1 langs x met doorsnede 1 × 1: vier ronde koorden en diagonalen,
 * samengevoegd tot één geometrie (één draw call). `triangle` geeft een driehoekige doorsnede (torenkraangiek).
 */
export function tubeTrussGeometry(bays: number, chord = 0.08, lace = 0.04, triangle = false): THREE.BufferGeometry {
  return cached(`truss|${bays}|${chord}|${lace}|${triangle}`, () => {
    const corners: [number, number][] = triangle ? [[-0.5, -0.5], [-0.5, 0.5], [0.5, 0]] : [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    const inset = (c: [number, number]): [number, number] => [c[0] * (1 - chord), c[1] * (1 - chord)];
    const parts: THREE.BufferGeometry[] = [];
    const tube = (a: THREE.Vector3, b: THREE.Vector3, r: number, seg: number) => {
      const d = new THREE.Vector3().subVectors(b, a);
      const len = d.length();
      const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      g.applyQuaternion(q);
      g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      parts.push(g.toNonIndexed());
    };
    // koorden: corners zijn (y, z)
    for (const c of corners) {
      const [y, z] = inset(c);
      tube(new THREE.Vector3(-0.5, y, z), new THREE.Vector3(0.5, y, z), chord / 2, 8);
    }
    for (let f = 0; f < corners.length; f++) {
      const p = inset(corners[f]);
      const q = inset(corners[(f + 1) % corners.length]);
      for (let i = 0; i < bays; i++) {
        const x0 = -0.5 + i / bays;
        const x1 = -0.5 + (i + 1) / bays;
        const flip = (i + f) % 2 === 0;
        const a = flip ? p : q;
        const b = flip ? q : p;
        tube(new THREE.Vector3(x0, a[0], a[1]), new THREE.Vector3(x1, b[0], b[1]), lace / 2, 5);
      }
      // dwarsregels bij elk knooppunt
      for (let i = 0; i <= bays; i++) {
        const x = -0.5 + i / bays;
        tube(new THREE.Vector3(x, p[0], p[1]), new THREE.Vector3(x, q[0], q[1]), lace / 2.4, 5);
      }
    }
    const g = mergeGeometries(parts)!;
    g.computeVertexNormals();
    return g;
  });
}

/** Leuning van lengte 1 langs x (staanders + twee regels), hoogte 1. */
export function railingGeometry(posts: number): THREE.BufferGeometry {
  return cached(`rail|${posts}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i <= posts; i++) {
      const g = new THREE.CylinderGeometry(0.025, 0.025, 1, 5);
      g.translate(-0.5 + i / posts, 0.5, 0);
      parts.push(g.toNonIndexed());
    }
    for (const y of [0.5, 1]) {
      const g = new THREE.CylinderGeometry(0.025, 0.025, 1, 5);
      g.rotateZ(Math.PI / 2);
      g.translate(0, y, 0);
      parts.push(g.toNonIndexed());
    }
    return mergeGeometries(parts)!;
  });
}

const decalCache = new Map<string, THREE.MeshStandardMaterial>();
/** Belettering (merk/type) als transparante textuur op een vlak. */
export function decal(text: string, color = '#1d2126', sub = ''): THREE.MeshStandardMaterial {
  const key = `${text}|${color}|${sub}`;
  let m = decalCache.get(key);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = color;
  g.font = 'italic 900 150px "Arial Black", "Helvetica Neue", Arial, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(text, 24, sub ? 105 : 128);
  if (sub) {
    g.font = '700 64px "Helvetica Neue", Arial, sans-serif';
    g.fillText(sub, 30, 210);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  m = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.45, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
  decalCache.set(key, m);
  return m;
}

let stripeMat: THREE.MeshStandardMaterial | null = null;
/** Rood-witte waarschuwingsstrepen (stempelbalken, giekkop). */
export function warningStripes(): THREE.MeshStandardMaterial {
  if (stripeMat) return stripeMat;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f4f2';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#c8261d';
  for (let i = -128; i < 256; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 32, 0);
    g.lineTo(i + 32 + 128, 128);
    g.lineTo(i + 128, 128);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  stripeMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
  return stripeMat;
}

/** Merknaam en type uit de fictieve kraannaam ("Vectra AT 60-3" → "VECTRA", "AT 60-3"). */
export function brandOf(name: string): { brand: string; model: string } {
  const i = name.indexOf(' ');
  return i < 0 ? { brand: name.toUpperCase(), model: '' } : { brand: name.slice(0, i).toUpperCase(), model: name.slice(i + 1) };
}
