import type Phaser from 'phaser';
import { clamp, smoothDamp } from '../../utils/math';
import { proj } from '../render/draw';

export interface FramePoint {
  x: number;
  y: number;
  z?: number;
}

/**
 * Camera die kraan, last en doelzone in beeld houdt. Zoomt automatisch uit als de giek of last
 * buiten beeld dreigt te raken, ondersteunt handmatige zoom en een overzichtsmodus.
 * Gebruikt kritisch gedempte veren: geen schokken.
 */
export class CameraDirector {
  userZoom = 1;
  overview = false;
  private vx = { v: 0 };
  private vy = { v: 0 };
  private vz = { v: 0 };
  private cx = 0;
  private cy = 0;
  private zoom = 0.6;
  private shakeAmp = 0;
  private initialized = false;
  shakeEnabled = true;

  constructor(private cam: Phaser.Cameras.Scene2D.Camera) {}

  zoomBy(steps: number): void {
    this.userZoom = clamp(this.userZoom * Math.pow(1.15, -steps), 0.35, 3.5);
  }

  reset(): void {
    this.userZoom = 1;
    this.overview = false;
  }

  shake(amount: number): void {
    if (this.shakeEnabled) this.shakeAmp = Math.min(12, this.shakeAmp + amount);
  }

  update(dt: number, focus: FramePoint[], overviewPts: FramePoint[]): void {
    const pts = this.overview ? overviewPts : focus;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      const s = proj(p.x, p.y, p.z ?? 0);
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y);
      maxY = Math.max(maxY, s.y);
    }
    const W = this.cam.width;
    const H = this.cam.height;
    // marges: HUD links/rechts en onder
    const padX = 0.18;
    const padY = 0.22;
    const bw = Math.max(200, maxX - minX);
    const bh = Math.max(150, maxY - minY);
    const fit = Math.min((W * (1 - 2 * padX)) / bw, (H * (1 - 2 * padY)) / bh);
    const targetZoom = clamp(fit * (this.overview ? 1 : this.userZoom), 0.05, 4);
    const tx = (minX + maxX) / 2;
    const ty = (minY + maxY) / 2 + bh * 0.04;
    if (!this.initialized) {
      this.cx = tx;
      this.cy = ty;
      this.zoom = targetZoom;
      this.initialized = true;
    }
    this.cx = smoothDamp(this.cx, tx, this.vx, 0.55, dt);
    this.cy = smoothDamp(this.cy, ty, this.vy, 0.55, dt);
    // logaritmisch dempen voor een natuurlijke zoom
    const lz = smoothDamp(Math.log(this.zoom), Math.log(targetZoom), this.vz, 0.7, dt);
    this.zoom = Math.exp(lz);
    this.cam.setZoom(this.zoom);
    let sx = 0;
    let sy = 0;
    if (this.shakeAmp > 0.05) {
      sx = (Math.random() - 0.5) * this.shakeAmp;
      sy = (Math.random() - 0.5) * this.shakeAmp;
      this.shakeAmp *= Math.exp(-dt * 6);
    }
    this.cam.centerOn(this.cx + sx / this.zoom, this.cy + sy / this.zoom);
  }
}
