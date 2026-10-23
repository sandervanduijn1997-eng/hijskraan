import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, railingGeometry, warningStripes } from './parts';
import { paint, steel } from './realism';

/**
 * Cabines, haakblokken en kleine details die een kraan geloofwaardig maken: afgeronde profielen,
 * een gebogen voorruit uit één stuk, zijruiten die het profiel volgen, stijlen, ruitenwisser,
 * spiegels, interieur achter het glas, handgrepen en werklampen.
 */

const DARK = 0x23262b;

let cabGlass: THREE.MeshPhysicalMaterial | null = null;
let cabGlassNight: THREE.MeshPhysicalMaterial | null = null;
/** Licht getint, half doorzichtig cabineglas dat de lucht weerspiegelt. */
export function cabinGlass(night: boolean): THREE.MeshPhysicalMaterial {
  const make = () =>
    new THREE.MeshPhysicalMaterial({
      color: 0x18212a,
      roughness: 0.03,
      metalness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: THREE.DoubleSide,
      emissive: night ? 0x403020 : 0,
      emissiveIntensity: night ? 0.4 : 0,
    });
  if (night) return (cabGlassNight ??= make());
  return (cabGlass ??= make());
}

interface Profile {
  /** Zijprofiel (x vooruit, y omhoog) als gesloten polygoon, tegen de klok in. */
  outline: [number, number][];
  /** Voorruitlijn: punten van onder naar boven langs de voorkant. */
  front: [number, number][];
  /** Zijruit: polygoon binnen het profiel. */
  side: [number, number][];
}

const quad = (a: [number, number], c: [number, number], b: [number, number], n: number): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]] as [number, number];
  });

/** Profiel van een machinistencabine (bovenwagen): hoge, gebogen voorruit, licht hellend dak. */
function operatorProfile(L: number, H: number): Profile {
  const x0 = -L / 2;
  const x1 = L / 2;
  const y0 = -H / 2;
  const y1 = H / 2;
  const nose = quad([x1, y0 + 0.45], [x1 + 0.08, y1 - 0.15], [x1 - 0.42, y1], 8);
  const outline: [number, number][] = [[x0, y0], [x1 - 0.15, y0], [x1, y0 + 0.2], ...nose, [x0 + 0.12, y1 - 0.04], [x0, y1 - 0.18]];
  const front = nose.map(([x, y]) => [x + 0.012, y] as [number, number]);
  const side: [number, number][] = [[x0 + 0.35, y0 + 0.62], ...quad([x1 - 0.1, y0 + 0.5], [x1 - 0.02, y1 - 0.2], [x1 - 0.5, y1 - 0.1], 6), [x0 + 0.3, y1 - 0.14]];
  return { outline, front, side };
}

/** Profiel van een rijcabine (onderwagen): steile, licht gebogen voorruit, lage neus. */
function driverProfile(L: number, H: number): Profile {
  const x0 = -L / 2;
  const x1 = L / 2;
  const y0 = -H / 2;
  const y1 = H / 2;
  const nose = quad([x1, y0 + H * 0.42], [x1 - 0.05, y1 - 0.05], [x1 - 0.32, y1], 6);
  const outline: [number, number][] = [[x0, y0], [x1 - 0.05, y0], [x1, y0 + 0.15], ...nose, [x0 + 0.1, y1], [x0, y1 - 0.1]];
  const front = nose.map(([x, y]) => [x + 0.012, y] as [number, number]);
  const side: [number, number][] = [[x0 + 0.25, y0 + H * 0.5], [x1 - 0.12, y0 + H * 0.46], ...quad([x1 - 0.1, y0 + H * 0.5], [x1 - 0.12, y1 - 0.1], [x1 - 0.42, y1 - 0.1], 4), [x0 + 0.25, y1 - 0.12]];
  return { outline, front, side };
}

function extrude(points: [number, number][], depth: number, bevel = 0.04): THREE.BufferGeometry {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: depth - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  g.computeVertexNormals();
  return g;
}

/** Gebogen ruit langs een lijn (x, y) over de breedte in z. */
function ribbon(line: [number, number][], z0: number, z1: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    pos.push(ax, ay, z0, bx, by, z0, bx, by, z1, ax, ay, z0, bx, by, z1, ax, ay, z1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function flatShape(points: [number, number][], z: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))));
  g.translate(0, 0, z);
  return g;
}

export interface CabOptions {
  length: number;
  height: number;
  width: number;
  color: number;
  night: boolean;
  kind: 'operator' | 'driver';
  /** Voorkant naar −x in plaats van +x. */
  flip?: boolean;
  /** Toon de zijruit aan beide kanten (anders alleen +z). */
  bothSides?: boolean;
}

/**
 * Complete cabine als groep, gecentreerd in de oorsprong (x vooruit, y omhoog, z = breedte).
 */
export function buildCab(o: CabOptions): THREE.Group {
  const g = new THREE.Group();
  const pr = o.kind === 'operator' ? operatorProfile(o.length, o.height) : driverProfile(o.length, o.height);
  const w = o.width;
  const body = mesh(extrude(pr.outline, w, 0.05), paint(o.color, { gloss: 0.7 }));
  g.add(body);
  const gl = cabinGlass(o.night);
  // voorruit uit één stuk, net buiten de carrosserie
  g.add(mesh(ribbon(pr.front, -w / 2 + 0.07, w / 2 - 0.07), gl, false));
  // zijruiten volgen het profiel
  for (const side of o.bothSides ? [-1, 1] : [1]) g.add(mesh(flatShape(pr.side, side * (w / 2 + 0.006)), gl, false));
  // stijlen en raamrubbers
  const frame = paint(DARK, { gloss: 0.3, worn: false });
  for (const z of [-w / 2 + 0.04, w / 2 - 0.04]) g.add(mesh(ribbon(pr.front, z - 0.035, z + 0.035).translate(0.004, 0, 0), frame, false));
  const sideFrame = pr.side.map(([x, y]) => new THREE.Vector3(x, y, w / 2 + 0.012));
  sideFrame.push(sideFrame[0]);
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(sideFrame), new THREE.LineBasicMaterial({ color: 0x111214 })));
  // interieur: stoel en bedieningspaneel, zichtbaar door het glas
  const interior = paint(0x1a1c1f, { gloss: 0.1, worn: false });
  const seat = new THREE.Group();
  seat.add(mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), interior), mesh(new THREE.BoxGeometry(0.12, 0.7, 0.5).translate(-0.25, 0.35, 0), interior));
  seat.position.set(-o.length * 0.12, -o.height * 0.12, 0);
  g.add(seat);
  g.add(mesh(new THREE.BoxGeometry(0.35, 0.5, w * 0.7).translate(o.length * 0.3, -o.height * 0.25, 0), interior));
  if (o.kind === 'operator') {
    for (const z of [-0.28, 0.28]) g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 6).translate(-o.length * 0.02, -o.height * 0.08, z), steel(0x222222, 0.5)));
  }
  // ruitenwisser
  const top = pr.front[pr.front.length - 1];
  const mid = pr.front[Math.floor(pr.front.length * 0.45)];
  const wiper = mesh(new THREE.BoxGeometry(0.03, 0.02, w * 0.55), frame, false);
  wiper.position.set((mid[0] + top[0]) / 2 + 0.03, (mid[1] + top[1]) / 2, 0);
  wiper.rotation.y = 0.15;
  g.add(wiper);
  // dakluik en handgrepen
  g.add(mesh(new THREE.BoxGeometry(o.length * 0.35, 0.04, w * 0.55).translate(-o.length * 0.1, o.height / 2 + 0.02, 0), frame));
  const grab = steel(0xc0c4c8, 0.35);
  g.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, o.height * 0.45, 6).translate(-o.length / 2 + 0.08, -o.height * 0.05, w / 2 + 0.06), grab));
  if (o.kind === 'driver') {
    // spiegels aan armen
    for (const z of [-w / 2 - 0.3, w / 2 + 0.3]) {
      g.add(mesh(new THREE.BoxGeometry(0.07, 0.42, 0.24).translate(o.length / 2 - 0.25, o.height * 0.2, z), frame));
      g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.32, 5).rotateX(Math.PI / 2).translate(o.length / 2 - 0.25, o.height * 0.3, z - Math.sign(z) * 0.16), frame));
    }
    // koplampen en grille
    const lamp = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, emissive: o.night ? 0xfff2cc : 0x000000, emissiveIntensity: o.night ? 2 : 0, roughness: 0.1 });
    for (const z of [-w / 2 + 0.3, w / 2 - 0.3]) g.add(mesh(new THREE.BoxGeometry(0.03, 0.14, 0.32).translate(o.length / 2 + 0.01, -o.height / 2 + 0.28, z), lamp, false));
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.18, w * 0.5).translate(o.length / 2 + 0.01, -o.height / 2 + 0.3, 0), frame, false));
  }
  if (o.flip) g.rotation.y = Math.PI;
  g.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh && m.material !== gl) m.castShadow = true;
  });
  return g;
}

/** Werklamp (led-paneel op een beugel) die 's nachts licht geeft. */
export function workLight(night: boolean): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.22, 0.14, 0.08), paint(DARK, { gloss: 0.3, worn: false })));
  const lens = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, emissive: night ? 0xfff4d6 : 0, emissiveIntensity: night ? 3 : 0, roughness: 0.15 });
  g.add(mesh(new THREE.BoxGeometry(0.19, 0.11, 0.01).translate(0, 0, 0.045), lens, false));
  return g;
}

/** Leuning (staanders + twee regels) van lengte `len` en hoogte 1,0 m langs x. */
export function railing(len: number, color = 0xf2b705): THREE.Mesh {
  const m = mesh(railingGeometry(Math.max(2, Math.round(len / 1.2))), paint(color, { gloss: 0.4, worn: false }));
  m.scale.set(len, 1, 1);
  return m;
}

/** Ladder van hoogte `h` langs y. */
export function ladder(h: number, color = 0xc4c9ce): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  for (const z of [-0.2, 0.2]) parts.push(new THREE.CylinderGeometry(0.02, 0.02, h, 5).translate(0, h / 2, z).toNonIndexed());
  for (let y = 0.3; y < h; y += 0.3) parts.push(new THREE.CylinderGeometry(0.014, 0.014, 0.4, 5).rotateX(Math.PI / 2).translate(0, y, 0).toNonIndexed());
  return mesh(mergeGeometries(parts)!, steel(color, 0.45));
}

/**
 * Haakblok: twee zijplaten met ronde kop en waarschuwingsstrepen, zichtbare kabelschijven,
 * draaibare haak met schacht, moer en veiligheidspal. Breedte w, hoogte h (zoals in de simulatie).
 */
export function buildHookBlock(w: number, h: number, sheaves: number): THREE.Group {
  const g = new THREE.Group();
  const yellow = paint(0xf2b705, { gloss: 0.6 });
  const dark = paint(DARK, { gloss: 0.3, worn: false });
  // binnen het botsingsvolume van de simulatie: haakpunt (onderkant haak) op −h/2
  const blockH = h * 0.55;
  const blockY = h * 0.2;
  // zijplaten met afgeronde bovenkant
  const plate = new THREE.Shape();
  const pw = w / 2;
  plate.moveTo(-pw, -blockH / 2);
  plate.lineTo(pw, -blockH / 2);
  plate.lineTo(pw, blockH / 2 - pw * 0.7);
  plate.quadraticCurveTo(pw, blockH / 2, 0, blockH / 2);
  plate.quadraticCurveTo(-pw, blockH / 2, -pw, blockH / 2 - pw * 0.7);
  plate.lineTo(-pw, -blockH / 2);
  const t = w * 0.08;
  const plateGeo = new THREE.ExtrudeGeometry(plate, { depth: t, bevelEnabled: true, bevelSize: t * 0.25, bevelThickness: t * 0.25, bevelSegments: 2, curveSegments: 10 });
  const gap = w * 0.38;
  for (const z of [-gap - t, gap]) {
    const p = mesh(plateGeo, yellow);
    p.position.set(0, blockY, z);
    g.add(p);
    const st = mesh(new THREE.PlaneGeometry(w * 0.9, blockH * 0.22), warningStripes(), false);
    st.position.set(0, blockY - blockH * 0.25, z < 0 ? z - t * 0.3 : z + t * 1.3);
    if (z < 0) st.rotation.y = Math.PI;
    g.add(st);
  }
  // kabelschijven tussen de platen
  const n = Math.max(1, Math.min(4, sheaves));
  for (let i = 0; i < n; i++) {
    const z = -gap * 0.8 + ((i + 0.5) * gap * 1.6) / n;
    const sh = mesh(new THREE.CylinderGeometry(w * 0.34, w * 0.34, (gap * 1.4) / n, 20).rotateX(Math.PI / 2), steel(0x8a9096, 0.4));
    sh.position.set(0, blockY + blockH * 0.12, z);
    g.add(sh);
  }
  // as en onderste traverse
  g.add(mesh(new THREE.CylinderGeometry(w * 0.06, w * 0.06, gap * 2 + t * 3, 10).rotateX(Math.PI / 2).translate(0, blockY + blockH * 0.12, 0), steel(0xc9ced3, 0.25)));
  g.add(mesh(new THREE.BoxGeometry(w * 0.9, blockH * 0.16, gap * 2).translate(0, blockY - blockH * 0.42, 0), dark));
  // haak: schacht, moer en gesmede haak (lathe-profiel + torus)
  const shank = mesh(new THREE.CylinderGeometry(w * 0.07, w * 0.07, h * 0.15, 12), steel(0x5c6166, 0.45));
  shank.position.set(0, blockY - blockH / 2 - h * 0.075, 0);
  g.add(shank);
  g.add(mesh(new THREE.CylinderGeometry(w * 0.15, w * 0.15, h * 0.05, 6).translate(0, blockY - blockH / 2 - h * 0.02, 0), steel(0x4c5156, 0.5)));
  const hookR = h * 0.12;
  const hk = mesh(new THREE.TorusGeometry(hookR, Math.min(w * 0.07, hookR * 0.45), 10, 24, Math.PI * 1.45), paint(0xf2b705, { gloss: 0.5 }));
  hk.rotation.z = Math.PI * 0.78;
  hk.position.set(hookR * 0.25, blockY - blockH / 2 - h * 0.15 - hookR * 0.9, 0);
  g.add(hk);
  // veiligheidspal
  g.add(mesh(new THREE.BoxGeometry(w * 0.03, hookR * 1.1, w * 0.06).translate(-hookR * 0.55, blockY - blockH / 2 - h * 0.15 - hookR * 0.55, 0), steel(0xd0d4d8, 0.3)));
  g.traverse((c) => ((c as THREE.Mesh).castShadow = true));
  return g;
}
