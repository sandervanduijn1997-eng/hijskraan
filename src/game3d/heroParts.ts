import * as THREE from 'three';
import { box } from './kit';
import { decal, mesh, profile } from './parts';
import { paint, steel } from './realism';

/**
 * Hero-details voor de telescoopkraan (de AT 60 als slicekraan): giekkop met geprofileerde
 * zijplaten, kabelschijven met flenzen, windmeter, vliegtuiglamp en hijsendschakelaar;
 * giekvoet met scharnierpen en lengtekabelhaspel; hijslier met kabelwikkelingen.
 */

const DARK = 0x2b2f36;

/** Kabelschijf met flenzen en naaf; as langs z. */
export function sheave(r: number, w: number): THREE.Group {
  const g = new THREE.Group();
  const s = steel(0x8f969c, 0.35);
  const hub = steel(0x5c6166, 0.5);
  const core = mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.86, w, 24), s);
  core.rotation.x = Math.PI / 2;
  g.add(core);
  for (const z of [-w / 2, w / 2]) {
    const fl = mesh(new THREE.CylinderGeometry(r, r, w * 0.18, 24), s);
    fl.rotation.x = Math.PI / 2;
    fl.position.z = z;
    g.add(fl);
  }
  const h = mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.28, w * 1.25, 12), hub);
  h.rotation.x = Math.PI / 2;
  g.add(h);
  return g;
}

/**
 * Giekkop van een telescoopgiek. Oorsprong = as van de kopschijven, x langs de giek (naar voren),
 * y loodrecht erop. `night` zet de vliegtuiglamp aan.
 */
export function teleHead(color: number, night: boolean, sheaves = 4): THREE.Group {
  const g = new THREE.Group();
  const P = paint(color, { gloss: 0.7 });
  const D = paint(DARK, { gloss: 0.3 });
  const span = 0.86;
  // zijplaten: lang, naar de neus toe afgerond rond de schijven
  const plate: [number, number][] = [
    [-1.7, -0.42],
    [-0.35, -0.52],
    [0.22, -0.4],
    [0.5, -0.1],
    [0.48, 0.22],
    [0.25, 0.46],
    [-0.2, 0.55],
    [-1.7, 0.42],
  ];
  for (const z of [-span / 2, span / 2]) {
    const p = mesh(profile(plate, 0.05, 0.012), P);
    p.position.z = z;
    g.add(p);
    // naafplaat rond de schijfas
    const boss = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 18), D);
    boss.rotation.x = Math.PI / 2;
    boss.position.z = z + Math.sign(z) * 0.03;
    g.add(boss);
  }
  // dekplaat boven en schot achter
  g.add(box(1.5, 0.05, span, P, -0.95, 0.47, 0));
  g.add(box(0.05, 0.9, span, D, -1.68, 0, 0));
  // kopschijven
  const w = (span - 0.1) / sheaves;
  for (let i = 0; i < sheaves; i++) {
    const s = sheave(0.38, w * 0.82);
    s.position.z = -span / 2 + 0.05 + w * (i + 0.5);
    g.add(s);
  }
  // as en kabelgeleider (dwarsstang die de kabel in de schijf houdt)
  const pin = mesh(new THREE.CylinderGeometry(0.06, 0.06, span + 0.16, 10), steel(0xc9ccce, 0.25));
  pin.rotation.x = Math.PI / 2;
  g.add(pin);
  const guard = mesh(new THREE.CylinderGeometry(0.035, 0.035, span, 8), steel(0x9aa0a6, 0.3));
  guard.rotation.x = Math.PI / 2;
  guard.position.set(0.12, -0.46, 0);
  g.add(guard);
  // hulpschijf (runner) boven op de kop
  const runner = sheave(0.2, 0.12);
  runner.position.set(-0.55, 0.62, 0);
  g.add(runner);
  // windmeter op een staander, met drie cups
  const mast = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), steel(0x9aa0a6, 0.3));
  mast.position.set(-1.25, 0.8, -span / 2 + 0.05);
  g.add(mast);
  const cups = new THREE.Group();
  cups.name = 'anemometer';
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const arm = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.18, 4), D);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = a;
    arm.position.set(Math.cos(a) * 0.09, 0, -Math.sin(a) * 0.09);
    const cup = mesh(new THREE.SphereGeometry(0.035, 8, 6, 0, Math.PI), D);
    cup.position.set(Math.cos(a) * 0.18, 0, -Math.sin(a) * 0.18);
    cup.rotation.y = a;
    cups.add(arm, cup);
  }
  cups.position.set(-1.25, 1.12, -span / 2 + 0.05);
  g.add(cups);
  // vliegtuiglamp (rood) en werklamp naar beneden
  const red = new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: night ? 3 : 0.6, roughness: 0.3 });
  const lamp = mesh(new THREE.SphereGeometry(0.07, 10, 8), red, false);
  lamp.position.set(-1.05, 0.62, span / 2 - 0.05);
  g.add(lamp);
  // hijsendschakelaar: schakelkastje met een gewicht aan een kettinkje om de kabel
  g.add(box(0.14, 0.12, 0.1, paint(0xf2b705, { gloss: 0.4 }), 0.2, -0.5, span / 2 - 0.08));
  const chain = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.7, 4), steel(0x5c6166, 0.5));
  chain.position.set(0.25, -0.9, 0.1);
  g.add(chain);
  const weight = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 12), paint(0xd02a1e, { gloss: 0.4 }));
  weight.position.set(0.25, -1.3, 0.1);
  g.add(weight);
  return g;
}

/**
 * Giekvoet: scharnierpen met lagerbussen, aangrijppunt van de hefcilinder, lengtekabelhaspel
 * en een merkplaat. Oorsprong = scharnierpunt, x langs de giek.
 */
export function teleFoot(width: number, brand: string): THREE.Group {
  const g = new THREE.Group();
  const D = paint(DARK, { gloss: 0.3 });
  const pin = mesh(new THREE.CylinderGeometry(0.11, 0.11, width * 0.95 + 0.3, 14), steel(0xc9ccce, 0.25));
  pin.rotation.x = Math.PI / 2;
  g.add(pin);
  for (const z of [-1, 1]) {
    const b = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 18), D);
    b.rotation.x = Math.PI / 2;
    b.position.z = z * (width * 0.85 * 0.5 + 0.06);
    g.add(b);
  }
  // lengtekabelhaspel op de zijkant van het basisdeel (meet de uitschuiflengte voor de begrenzer)
  const reel = new THREE.Group();
  const drum = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.16, 20), paint(0xd8dde2, { gloss: 0.5 }));
  drum.rotation.x = Math.PI / 2;
  reel.add(drum);
  reel.add(box(0.5, 0.5, 0.03, D, 0, 0, -0.09));
  reel.position.set(1.4, 0.05, width * 0.85 * 0.5 + 0.12);
  g.add(reel);
  // merkplaat op het basisdeel
  const d = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.5), decal(brand, '#1d2126'));
  d.position.set(3.4, 0.02, width * 0.85 * 0.5 + 0.035);
  g.add(d);
  const d2 = d.clone();
  d2.rotation.y = Math.PI;
  d2.position.z = -d.position.z;
  g.add(d2);
  // slijtstrips onder het basisdeel bij de voet
  g.add(box(0.6, 0.03, width * 0.6, paint(0x1d1f22, { gloss: 0.1 }), 0.9, -width * 0.42, 0));
  return g;
}

/** Hijslier: trommel met kabelwikkelingen tussen twee lagerplaten en een hydromotor; as langs z. */
export function hoistWinch(ropeTex?: THREE.Texture): { group: THREE.Group; drum: THREE.Object3D; radius: number } {
  const g = new THREE.Group();
  const D = paint(DARK, { gloss: 0.3 });
  const r = 0.32;
  const drum = new THREE.Group();
  const wraps = new THREE.MeshStandardMaterial({ color: ropeTex ? 0xffffff : 0x6a6f74, map: ropeTex ?? null, metalness: 0.85, roughness: 0.42 });
  if (ropeTex) {
    const t = ropeTex.clone();
    t.needsUpdate = true;
    t.repeat.set(10, 3);
    wraps.map = t;
  }
  const core = mesh(new THREE.CylinderGeometry(r, r, 0.85, 28), wraps);
  core.rotation.x = Math.PI / 2;
  drum.add(core);
  for (const z of [-0.45, 0.45]) {
    const fl = mesh(new THREE.CylinderGeometry(r + 0.12, r + 0.12, 0.05, 28), D);
    fl.rotation.x = Math.PI / 2;
    fl.position.z = z;
    drum.add(fl);
  }
  // kleine merkstreep zodat het draaien zichtbaar is
  drum.add(box(0.06, 0.02, 0.86, paint(0xf2b705), 0, r + 0.005, 0));
  g.add(drum);
  for (const z of [-0.52, 0.52]) g.add(box(0.9, 0.95, 0.06, D, 0, -0.05, z));
  const motor = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.3, 14), paint(0x3a5a78, { gloss: 0.5 }));
  motor.rotation.x = Math.PI / 2;
  motor.position.z = 0.7;
  g.add(motor);
  return { group: g, drum, radius: r };
}
