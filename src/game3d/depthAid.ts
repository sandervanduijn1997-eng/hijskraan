import * as THREE from 'three';
import { bodyYaw } from '../physics/load/rigidBody';
import { loadBottomCenter } from '../missions/validation/placement';
import type { Simulation } from '../sim/simulation';

/**
 * Dieptehulp bij het hijsen: een loodlijn van de last naar het vlak eronder, een markering van de
 * voetafdruk op dat vlak (draait mee met de last) en een label met de hoogte in cm. Boven de actieve
 * doelzone toont het label ook de afwijking in x en z. Groen = binnen de tolerantie.
 */
export class DepthAid {
  readonly root = new THREE.Group();
  private line: THREE.Line;
  private foot: THREE.LineLoop;
  private label: HTMLElement;
  private mat: THREE.LineDashedMaterial;
  private footMat: THREE.LineBasicMaterial;

  constructor(labelRoot: HTMLElement) {
    this.mat = new THREE.LineDashedMaterial({ color: 0xf2b705, dashSize: 0.25, gapSize: 0.15, depthTest: false, transparent: true, opacity: 0.9 });
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]), this.mat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 10;
    this.footMat = new THREE.LineBasicMaterial({ color: 0xf2b705, depthTest: false, transparent: true, opacity: 0.85 });
    this.foot = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 0, -0.5), new THREE.Vector3(0.5, 0, 0.5), new THREE.Vector3(-0.5, 0, 0.5)]), this.footMat);
    this.foot.frustumCulled = false;
    this.foot.renderOrder = 10;
    this.root.add(this.line, this.foot);
    this.label = document.createElement('div');
    this.label.className = 'zone-label depth-label';
    labelRoot.append(this.label);
  }

  dispose(): void {
    this.label.remove();
  }

  update(sim: Simulation, camera: THREE.Camera, enabled: boolean): void {
    const l = sim.attached;
    const show = enabled && !!l && sim.outcome === 'running';
    this.root.visible = show;
    if (!show || !l) {
      this.label.style.display = 'none';
      return;
    }
    const b = l.cb.body;
    const bc = loadBottomCenter(b);
    const under = sim.surfaceBelow(bc.x, bc.z, b.halfW * 0.6, b.depth * 0.3, bc.y, l);
    const h = bc.y - under.y;
    if (h < 0.03) {
      this.root.visible = false;
      this.label.style.display = 'none';
      return;
    }
    // actieve zone: afwijking tonen als de last er dichtbij hangt
    const task = sim.tasks.find((t) => t.status === 'active' && t.def.type === 'deliver' && t.def.loadId === l.id);
    const zone = task && task.def.type === 'deliver' ? sim.mission.zones.find((z) => z.id === (task.def as { zoneId: string }).zoneId) : undefined;
    let near = false;
    let ok = false;
    const hfmt = (v: number) => (v < 2 ? `${Math.max(0, v * 100).toFixed(0)} cm` : `${v.toFixed(1)} m`);
    let text = `↓ ${hfmt(h)}`;
    if (zone) {
      const dx = bc.x - zone.x;
      const dz = bc.z - (zone.z ?? 0);
      near = Math.abs(dx) < 3 && Math.abs(dz) < 3;
      if (near) {
        const hz = bc.y - zone.y;
        ok = Math.abs(dx) <= zone.tolerance && Math.abs(dz) <= (zone.zTolerance ?? 1);
        const cm = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(0)}`;
        text = `x ${cm(dx)} · z ${cm(dz)} cm · ↓ ${hfmt(hz)}`;
      }
    }
    const color = near ? (ok ? 0x36c172 : 0xf2b705) : 0xf2b705;
    this.mat.color.setHex(color);
    this.footMat.color.setHex(color);
    const pos = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, bc.x, bc.y, bc.z);
    pos.setXYZ(1, bc.x, under.y + 0.02, bc.z);
    pos.needsUpdate = true;
    this.line.computeLineDistances();
    this.foot.position.set(bc.x, under.y + 0.03, bc.z);
    this.foot.rotation.y = bodyYaw(b);
    this.foot.scale.set(b.halfW * 2, 1, b.depth);
    // label naast de last
    const v = new THREE.Vector3(bc.x, bc.y - 0.2, bc.z).project(camera);
    const vis = v.z < 1;
    this.label.style.display = vis ? '' : 'none';
    if (vis) {
      this.label.textContent = text;
      this.label.style.transform = `translate(${((v.x + 1) / 2) * window.innerWidth + 18}px, ${((1 - v.y) / 2) * window.innerHeight}px)`;
      this.label.style.color = near && ok ? '#7ff0a8' : '#fff';
    }
  }
}
