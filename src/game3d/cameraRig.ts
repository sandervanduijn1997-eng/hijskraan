import * as THREE from 'three';
import { clamp, smoothDamp } from '../utils/math';

export type CameraMode = 'follow' | 'overview' | 'cab';

export interface FramePoint {
  x: number;
  y: number;
  z?: number;
}

/**
 * 3D-camera: draait vrij rond de kraan (slepen met de muis), zoomt met het muiswiel,
 * kadreert automatisch giek, last en doelzone, en heeft een overzichts- en cabineweergave.
 * Alles kritisch gedempt: geen schokken.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'follow';
  yaw = 0.42;
  pitch = 0.3;
  userZoom = 1;
  autoOrbit = 0;
  shakeEnabled = true;
  private pan = new THREE.Vector3();
  private target = new THREE.Vector3();
  private dist = 60;
  private vel = { tx: { v: 0 }, ty: { v: 0 }, tz: { v: 0 }, d: { v: 0 } };
  private shakeAmp = 0;
  private init = false;
  private drag: { x: number; y: number; button: number } | null = null;
  private cabPos = new THREE.Vector3();
  private cabLook = new THREE.Vector3();

  constructor(private dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.3, 4000);
    dom.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('dblclick', () => this.reset());
  }

  dispose(): void {
    this.dom.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
  }

  private onDown = (e: PointerEvent) => {
    this.drag = { x: e.clientX, y: e.clientY, button: e.button };
  };
  private onMove = (e: PointerEvent) => {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    if (this.drag.button === 0 && this.mode !== 'cab') {
      this.yaw -= dx * 0.006;
      this.pitch = clamp(this.pitch + dy * 0.005, 0.03, 1.45);
    } else if (this.drag.button !== 0) {
      // pannen in het kijkvlak
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const up = new THREE.Vector3(0, 1, 0);
      const s = this.dist * 0.0018;
      this.pan.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    } else if (this.mode === 'cab') {
      this.yaw -= dx * 0.004;
    }
  };
  private onUp = () => {
    this.drag = null;
  };

  zoomBy(steps: number): void {
    this.userZoom = clamp(this.userZoom * Math.pow(1.12, steps), 0.15, 4);
  }

  reset(): void {
    this.userZoom = 1;
    this.pan.set(0, 0, 0);
    this.yaw = 0.42;
    this.pitch = 0.3;
    if (this.mode === 'cab') this.mode = 'follow';
  }

  cycleMode(): CameraMode {
    this.mode = this.mode === 'follow' ? 'cab' : 'follow';
    return this.mode;
  }

  shake(a: number): void {
    if (this.shakeEnabled) this.shakeAmp = Math.min(1.2, this.shakeAmp + a);
  }

  setCab(pos: THREE.Vector3Like, look: THREE.Vector3Like): void {
    this.cabPos.set(pos.x, pos.y, pos.z);
    this.cabLook.set(look.x, look.y, look.z);
  }

  setAspect(w: number, h: number): void {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, focus: FramePoint[], overview: FramePoint[]): void {
    const cam = this.camera;
    if (this.mode === 'cab') {
      cam.position.copy(this.cabPos);
      cam.lookAt(this.cabLook);
      return;
    }
    const pts = this.mode === 'overview' ? overview : focus;
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of pts) {
      min.min(new THREE.Vector3(p.x, p.y, p.z ?? 0));
      max.max(new THREE.Vector3(p.x, p.y, p.z ?? 0));
    }
    const c = min.clone().add(max).multiplyScalar(0.5);
    const radius = Math.max(8, max.clone().sub(min).length() / 2);
    const fov = (cam.fov * Math.PI) / 180;
    const fit = (radius / Math.sin(Math.min(fov, fov * cam.aspect) / 2)) * 0.9;
    const desired = fit * (this.mode === 'overview' ? 1 : this.userZoom);
    c.add(this.pan);
    if (!this.init) {
      this.target.copy(c);
      this.dist = desired;
      this.init = true;
    }
    this.yaw += this.autoOrbit * dt;
    this.target.x = smoothDamp(this.target.x, c.x, this.vel.tx, 0.5, dt);
    this.target.y = smoothDamp(this.target.y, c.y, this.vel.ty, 0.5, dt);
    this.target.z = smoothDamp(this.target.z, c.z, this.vel.tz, 0.5, dt);
    this.dist = Math.exp(smoothDamp(Math.log(this.dist), Math.log(desired), this.vel.d, 0.7, dt));
    const cp = Math.cos(this.pitch);
    cam.position.set(this.target.x + Math.sin(this.yaw) * cp * this.dist, Math.max(1.2, this.target.y + Math.sin(this.pitch) * this.dist), this.target.z + Math.cos(this.yaw) * cp * this.dist);
    cam.lookAt(this.target);
    if (this.shakeAmp > 0.01) {
      cam.position.x += (Math.random() - 0.5) * this.shakeAmp;
      cam.position.y += (Math.random() - 0.5) * this.shakeAmp * 0.6;
      this.shakeAmp *= Math.exp(-dt * 6);
    }
    cam.near = Math.max(0.3, this.dist * 0.01);
    cam.far = Math.max(1500, this.dist * 30);
    cam.updateProjectionMatrix();
  }

  get focusTarget(): THREE.Vector3 {
    return this.target;
  }

  get distance(): number {
    return this.dist;
  }
}
