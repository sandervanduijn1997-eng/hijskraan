import * as THREE from 'three';

/**
 * Staalkabel als keten van korte buisdelen (InstancedMesh): echte dikte, gedraaid strengenpatroon,
 * doorhang als de kabel slap is en een lichte boog als de last zijdelings beweegt.
 * Eén instantie kan meerdere parallelle kabelparten tekenen (de parten van de haak).
 */

let wireTex: THREE.Texture | null = null;
/** Gedraaide strengen: schuine lichte en donkere banen (wordt langs de kabel herhaald). */
function wireTexture(): THREE.Texture {
  if (wireTex) return wireTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5c6166';
  g.fillRect(0, 0, 64, 64);
  for (let i = -64; i < 128; i += 10) {
    const grd = g.createLinearGradient(i, 0, i + 10, 0);
    grd.addColorStop(0, '#3e4246');
    grd.addColorStop(0.5, '#a9aeb2');
    grd.addColorStop(1, '#3e4246');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 10, 0);
    g.lineTo(i + 10 + 32, 64);
    g.lineTo(i + 32, 64);
    g.fill();
  }
  wireTex = new THREE.CanvasTexture(c);
  wireTex.wrapS = wireTex.wrapT = THREE.RepeatWrapping;
  wireTex.colorSpace = THREE.SRGBColorSpace;
  return wireTex;
}

const SEGMENTS = 24;
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

export class RopeMesh {
  readonly mesh: THREE.InstancedMesh;
  private parts: number;
  private radius: number;
  /** Afgevlakte zijdelingse boog (m), volgt de beweging van de last. */
  private bow = new THREE.Vector3();

  constructor(parts: number, radius: number, material?: THREE.Material) {
    this.parts = Math.max(1, parts);
    this.radius = radius;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    // textuur langs de kabel laten doorlopen: v schaalt met de lengte van elk deel
    const mat =
      material ??
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: wireTexture(), metalness: 0.85, roughness: 0.42 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.parts * SEGMENTS);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }

  /**
   * Teken de kabel van `a` (boven) naar `b` (onder). `length` is de werkelijke kabellengte:
   * langer dan de afstand → doorhang. `lateral` is de zijdelingse snelheid van de last (m/s).
   * `spread` is de afstand tussen de parten (m) en `axis` de richting waarin ze naast elkaar liggen.
   */
  update(a: THREE.Vector3, b: THREE.Vector3, length: number, lateral: THREE.Vector3, dt: number, spread = 0.12, axis = new THREE.Vector3(1, 0, 0)): void {
    const d = a.distanceTo(b);
    const slack = Math.max(0, length - d);
    // doorhang van een slappe kabel: boogdiepte uit de extra lengte (parabool-benadering)
    const sag = slack > 0.01 ? Math.min(d * 0.6, Math.sqrt((3 * d * slack) / 8)) : 0;
    // lichte boog bij zijdelingse beweging (de kabel loopt achter op de last)
    const target = lateral.clone().multiplyScalar(-0.04 * d);
    target.y = 0;
    this.bow.lerp(target, Math.min(1, dt * 3));
    let k = 0;
    for (let p = 0; p < this.parts; p++) {
      const o = (p - (this.parts - 1) / 2) * spread;
      const off = axis.clone().multiplyScalar(o);
      let prev = a.clone().add(off);
      for (let i = 1; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        const pt = a.clone().lerp(b, t).add(off);
        const w = 4 * t * (1 - t);
        pt.y -= sag * w;
        pt.addScaledVector(this.bow, w);
        // deel van prev naar pt
        tmpP.addVectors(prev, pt).multiplyScalar(0.5);
        const dir = pt.clone().sub(prev);
        const len = Math.max(1e-4, dir.length());
        tmpQ.setFromUnitVectors(up, dir.multiplyScalar(1 / len));
        tmpS.set(this.radius, len, this.radius);
        tmpM.compose(tmpP, tmpQ, tmpS);
        this.mesh.setMatrixAt(k++, tmpM);
        prev = pt;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Kabeldiameter (m) bij de maximale capaciteit van een kraan: ca. 14 mm (kleine kraan) tot 32 mm (heavy lift). */
export const ropeRadius = (maxCapacityT: number): number => (0.012 + 0.0035 * Math.cbrt(Math.max(1, maxCapacityT))) / 2;
