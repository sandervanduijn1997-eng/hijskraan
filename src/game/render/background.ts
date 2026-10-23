import Phaser from 'phaser';
import type { EnvironmentId, TimeOfDay, Weather } from '../../missions/data/types';
import { makeRng, hashString } from '../../utils/math';
import { S, mix, poly, shade } from './draw';
import type { EnvPalette } from './palette';
import { ENVIRONMENTS, SKIES } from './palette';

type G = Phaser.GameObjects.Graphics;

interface BgCrane {
  x: number;
  h: number;
  jib: number;
  phase: number;
  speed: number;
  layer: 'mid' | 'near';
}
interface Tree {
  x: number;
  h: number;
  phase: number;
}
interface Smoke {
  x: number;
  y: number;
  t: number;
}
interface Spark {
  x: number;
  y: number;
  next: number;
}
interface Flag {
  x: number;
  y: number;
}
interface Cloud {
  x: number;
  y: number;
  w: number;
  speed: number;
}

/**
 * Procedurele, gelaagde achtergrond met parallax. Statische lagen worden één keer getekend;
 * levende details (kranen, bomen, vlaggen, rook, vonken, wolken, regen) elk frame.
 */
export class Background {
  private far: G;
  private mid: G;
  private near: G;
  private anim: G;
  private animMid: G;
  private sky: G;
  private pal: EnvPalette;
  private cranes: BgCrane[] = [];
  private trees: Tree[] = [];
  private smokes: Smoke[] = [];
  private sparks: Spark[] = [];
  private flags: Flag[] = [];
  private clouds: Cloud[] = [];
  private rain: { x: number; y: number }[] = [];
  private light: number;

  constructor(scene: Phaser.Scene, env: EnvironmentId, private tod: TimeOfDay, private weather: Weather, seedKey: string) {
    this.pal = ENVIRONMENTS[env];
    const sky = SKIES[tod];
    this.light = sky.light;
    const rng = makeRng(hashString(seedKey + env));
    this.sky = scene.add.graphics().setScrollFactor(0).setDepth(-100);
    // alle lagen worden door de (ongezoomde) luchtcamera gerenderd; parallax en zoom per laag in layout()
    this.far = scene.add.graphics().setScrollFactor(0).setDepth(-90);
    this.mid = scene.add.graphics().setScrollFactor(0).setDepth(-80);
    this.animMid = scene.add.graphics().setScrollFactor(0).setDepth(-79);
    this.near = scene.add.graphics().setScrollFactor(0).setDepth(-70);
    this.anim = scene.add.graphics().setScrollFactor(0).setDepth(-69);
    this.drawStatic(rng, sky.sun, sky.haze);
  }

  private tint(c: number): number {
    return shade(c, this.light);
  }

  private drawStatic(rng: () => number, sun: number, haze: number): void {
    const pal = this.pal;
    const X0 = -4000;
    const X1 = 6000;
    if (pal.indoor) {
      this.drawHall(rng);
      return;
    }
    // zon/maan en wolken (vast in de lucht)
    const sky = this.sky;
    sky.fillStyle(sun, this.tod === 'night' ? 0.8 : 0.9);
    sky.fillCircle(this.tod === 'dusk' ? 1300 : 1500, this.tod === 'dusk' ? 520 : 180, this.tod === 'night' ? 30 : 46);
    sky.fillStyle(sun, 0.12);
    sky.fillCircle(this.tod === 'dusk' ? 1300 : 1500, this.tod === 'dusk' ? 520 : 180, 110);
    if (this.tod === 'night') {
      for (let i = 0; i < 120; i++) {
        sky.fillStyle(0xffffff, 0.3 + rng() * 0.6);
        sky.fillRect(rng() * 2400, rng() * 600, 2, 2);
      }
    }
    const nClouds = this.weather === 'cloudy' || this.weather === 'rain' ? 14 : 6;
    for (let i = 0; i < nClouds; i++) this.clouds.push({ x: rng() * 2600, y: 40 + rng() * 300, w: 140 + rng() * 260, speed: 4 + rng() * 10 });

    // verre laag: heuvels + skyline
    const far = this.far;
    const farC = this.tint(mix(pal.far, haze, 0.35));
    const hill: { x: number; y: number }[] = [{ x: X0, y: 200 }];
    for (let x = X0; x <= X1; x += 180) hill.push({ x, y: -60 - rng() * 140 });
    hill.push({ x: X1, y: 200 });
    poly(far, hill, shade(farC, 1.05));
    for (let x = X0; x < X1; x += 40 + rng() * 90) {
      const w = 30 + rng() * 70;
      const h = 60 + rng() * (pal.label === 'Windpark' ? 30 : 320);
      if (rng() < 0.25) continue;
      far.fillStyle(shade(farC, 0.9 + rng() * 0.15), 1);
      far.fillRect(x, -h, w, h + 200);
      if (this.tod === 'night' || this.tod === 'dusk') {
        for (let wy = -h + 10; wy < -10; wy += 14) for (let wx = x + 5; wx < x + w - 5; wx += 10) if (rng() < 0.35) {
          far.fillStyle(0xffd27a, 0.6);
          far.fillRect(wx, wy, 3, 4);
        }
      }
    }
    if (pal.label === 'Windpark') {
      for (let x = X0; x < X1; x += 260 + rng() * 200) {
        far.fillStyle(shade(farC, 1.25), 1);
        far.fillRect(x, -220, 6, 220);
      }
    }

    // middenlaag: industrie, gebouwen in aanbouw, achtergrondkranen
    const mid = this.mid;
    const midC = this.tint(mix(pal.mid, haze, 0.15));
    for (let x = X0; x < X1; x += 120 + rng() * 220) {
      const kind = rng();
      const w = 80 + rng() * 160;
      const h = 80 + rng() * 260;
      if (kind < 0.35) {
        // gebouw in aanbouw: skelet met verdiepingen
        mid.fillStyle(shade(midC, 0.95), 1);
        const floors = Math.round(h / 34);
        for (let f = 0; f <= floors; f++) mid.fillRect(x, -f * 34 - 6, w, 6);
        for (let c = 0; c <= 4; c++) mid.fillRect(x + (c * (w - 6)) / 4, -floors * 34, 6, floors * 34);
        if (rng() < 0.7) this.cranes.push({ x: x + w * 0.5, h: floors * 34 + 120, jib: 160 + rng() * 120, phase: rng() * 6, speed: 0.05 + rng() * 0.12, layer: 'mid' });
        if (rng() < 0.6) this.sparks.push({ x: x + rng() * w, y: -rng() * floors * 34, next: rng() * 3 });
      } else if (kind < 0.6) {
        // hal met zaagtanddak
        mid.fillStyle(midC, 1);
        mid.fillRect(x, -h * 0.4, w, h * 0.4 + 200);
        for (let s = 0; s < w; s += 30) poly(mid, [{ x: x + s, y: -h * 0.4 }, { x: x + s + 30, y: -h * 0.4 }, { x: x + s + 30, y: -h * 0.4 - 18 }], shade(midC, 1.1));
        if (rng() < 0.5) {
          mid.fillStyle(shade(midC, 0.8), 1);
          mid.fillRect(x + w * 0.7, -h * 0.4 - 140, 14, 140);
          this.smokes.push({ x: x + w * 0.7 + 7, y: -h * 0.4 - 140, t: rng() * 10 });
        }
      } else if (kind < 0.8) {
        // kantoortoren
        mid.fillStyle(shade(midC, 1.05), 1);
        mid.fillRect(x, -h, w * 0.6, h + 200);
        poly(mid, [{ x: x + w * 0.6, y: -h }, { x: x + w * 0.6 + 20, y: -h - 14 }, { x: x + w * 0.6 + 20, y: 200 }, { x: x + w * 0.6, y: 200 }], shade(midC, 0.8));
        for (let wy = -h + 12; wy < -10; wy += 18) {
          mid.fillStyle(this.tod === 'night' ? 0xffd27a : shade(midC, 1.25), this.tod === 'night' ? (rng() < 0.4 ? 0.7 : 0.1) : 0.5);
          mid.fillRect(x + 6, wy, w * 0.6 - 12, 6);
        }
      } else {
        // opslagtanks
        mid.fillStyle(shade(midC, 1.1), 1);
        mid.fillRect(x, -h * 0.35, w * 0.5, h * 0.35 + 200);
        mid.fillEllipse(x + w * 0.25, -h * 0.35, w * 0.5, 16);
      }
      if (rng() < 0.2) this.flags.push({ x: x + 10, y: -h * 0.45 });
    }

    // nabije laag: bomen, hekken, containers, materiaal
    const near = this.near;
    const nearC = this.tint(pal.near);
    for (let x = X0; x < X1; x += 60 + rng() * 140) {
      const k = rng();
      if (k < 0.35) this.trees.push({ x, h: 60 + rng() * 80, phase: rng() * 6 });
      else if (k < 0.55) {
        // container
        const cc = [0xc0392b, 0x2f6db5, 0x27ae60, 0xd35400, 0x7f8c8d][Math.floor(rng() * 5)];
        near.fillStyle(this.tint(shade(cc, 0.75)), 1);
        near.fillRect(x, -58, 140, 58);
        near.fillStyle(this.tint(shade(cc, 0.95)), 1);
        poly(near, [{ x, y: -58 }, { x: x + 140, y: -58 }, { x: x + 156, y: -70 }, { x: x + 16, y: -70 }], this.tint(shade(cc, 1.05)));
        if (rng() < 0.5) {
          near.fillStyle(this.tint(shade(cc, 0.6)), 1);
          near.fillRect(x + 20, -116, 140, 58);
        }
      } else if (k < 0.75) {
        // bouwhek
        near.lineStyle(2, this.tint(0xb8bec4), 0.8);
        for (let fx = x; fx < x + 160; fx += 40) {
          near.strokeRect(fx, -44, 40, 44);
          near.lineBetween(fx, -44, fx + 40, 0);
        }
        near.fillStyle(this.tint(0x3a3f45), 1);
        for (let fx = x; fx <= x + 160; fx += 40) near.fillRect(fx - 4, -4, 10, 6);
      } else if (k < 0.9) {
        // pallets en buizen
        near.fillStyle(this.tint(0xa98256), 1);
        near.fillRect(x, -22, 60, 22);
        near.fillStyle(this.tint(0x8f8b85), 1);
        near.fillRect(x + 70, -18, 90, 18);
      } else {
        // geparkeerde vrachtwagen
        near.fillStyle(this.tint(shade(nearC, 1.2)), 1);
        near.fillRect(x, -60, 180, 50);
        near.fillStyle(this.tint(0xe8e8e8), 1);
        near.fillRect(x + 180, -64, 50, 54);
        near.fillStyle(0x1d1f22, 1);
        for (const wx of [x + 30, x + 140, x + 205]) near.fillCircle(wx, -10, 13);
      }
    }
    // grondband onder de lagen (geen gat zichtbaar bij uitzoomen)
    near.fillStyle(shade(this.tint(pal.ground), 0.8), 1);
    near.fillRect(X0, -2, X1 - X0, 6000);
    mid.fillStyle(shade(midC, 0.85), 1);
    mid.fillRect(X0, 0, X1 - X0, 6000);
    far.fillStyle(shade(farC, 0.9), 1);
    far.fillRect(X0, 0, X1 - X0, 6000);
    if (this.weather === 'rain') for (let i = 0; i < 160; i++) this.rain.push({ x: rng() * 2400, y: rng() * 1400 });
  }

  /** Interieur van een fabriekshal. */
  private drawHall(rng: () => number): void {
    const g = this.mid;
    const wall = 0x3b4148;
    g.fillStyle(wall, 1);
    g.fillRect(-4000, -1400, 10000, 1600);
    for (let x = -4000; x < 6000; x += 260) {
      g.fillStyle(0x30353b, 1);
      g.fillRect(x, -1400, 26, 1400);
      // lichtstraat
      g.fillStyle(0x9fb4c8, 0.35);
      g.fillRect(x + 60, -1100, 140, 260);
      g.fillStyle(0x6d7f90, 0.3);
      for (let i = 0; i < 4; i++) g.fillRect(x + 60 + i * 35, -1100, 3, 260);
    }
    g.fillStyle(0x2a2f34, 1);
    g.fillRect(-4000, -760, 10000, 26);
    const n = this.near;
    for (let x = -4000; x < 6000; x += 180 + rng() * 260) {
      const h = 60 + rng() * 140;
      n.fillStyle(shade(0x56606a, 0.9 + rng() * 0.2), 1);
      n.fillRect(x, -h, 100 + rng() * 120, h);
      n.fillStyle(0xf2b705, 0.8);
      n.fillRect(x, -h, 100, 5);
      if (rng() < 0.4) this.sparks.push({ x: x + 40, y: -h, next: rng() * 3 });
    }
    n.fillStyle(0x5d646b, 1);
    n.fillRect(-4000, 0, 10000, 600);
  }

  /**
   * Plaats de lagen: horizontale parallax per laag, een gedempte zoom (verre lagen zoomen minder mee)
   * en de horizon op de achterrand van het speelveld.
   */
  layout(cam: Phaser.Cameras.Scene2D.Camera, horizonDepth: number): void {
    const z = cam.zoom;
    const cx = cam.midPoint.x;
    const cy = cam.midPoint.y;
    const W = cam.width;
    const H = cam.height;
    const groundY = (horizonDepth - cy) * z + H / 2;
    const place = (g: G, f: number, k: number) => {
      const zl = Math.pow(z, k);
      g.setScale(zl);
      g.x = W / 2 - cx * f * zl;
      g.y = groundY;
    };
    place(this.far, 0.08, 0.25);
    place(this.mid, 0.25, 0.45);
    place(this.animMid, 0.25, 0.45);
    place(this.near, 0.5, 0.7);
    place(this.anim, 0.5, 0.7);
  }

  update(time: number, dt: number, windX: number, camScrollX: number): void {
    const t = time / 1000;
    const g = this.animMid;
    g.clear();
    // achtergrondkranen
    for (const c of this.cranes) {
      g.lineStyle(3, this.tint(shade(this.pal.accent, 0.75)), 0.9);
      g.lineBetween(c.x, 0, c.x, -c.h);
      const a = Math.cos(t * c.speed + c.phase);
      g.lineStyle(3, this.tint(shade(this.pal.accent, 0.8)), 0.9);
      g.lineBetween(c.x - c.jib * 0.25 * a, -c.h, c.x + c.jib * a, -c.h);
      g.fillStyle(this.tint(0x555c63), 1);
      g.fillRect(c.x - c.jib * 0.25 * a - 6, -c.h, 12, 10);
      const tr = c.x + c.jib * a * (0.5 + 0.3 * Math.sin(t * 0.2 + c.phase));
      g.lineStyle(1, 0x222222, 0.6);
      g.lineBetween(tr, -c.h, tr, -c.h + 60 + 30 * Math.sin(t * 0.13 + c.phase));
      if (Math.sin(t * 3 + c.phase) > 0.3) {
        g.fillStyle(0xff3b30, 0.9);
        g.fillCircle(c.x, -c.h - 6, 3);
      }
    }
    // rook
    for (const s of this.smokes) {
      for (let i = 0; i < 6; i++) {
        const k = ((t * 0.25 + i / 6 + s.t) % 1);
        g.fillStyle(0xd8dde2, 0.35 * (1 - k));
        g.fillCircle(s.x + k * 120 * Math.sign(windX || 1) * (0.4 + Math.abs(windX) * 0.08), s.y - k * 140, 10 + k * 40);
      }
    }
    // laswerk / vonken
    for (const sp of this.sparks) {
      const flick = (Math.sin(t * 37 + sp.x) + Math.sin(t * 23 + sp.y)) > 1.1;
      if (flick) {
        g.fillStyle(0xbfe3ff, 0.9);
        g.fillCircle(sp.x, sp.y, 4);
        g.fillStyle(0xffd27a, 0.8);
        for (let i = 0; i < 4; i++) g.fillRect(sp.x + Math.sin(t * 50 + i) * 12, sp.y + Math.abs(Math.cos(t * 41 + i)) * 14, 2, 2);
      }
    }
    // vlaggen
    for (const f of this.flags) {
      g.lineStyle(2, 0x333333, 1);
      g.lineBetween(f.x, f.y, f.x, f.y - 50);
      const w = Math.min(1, Math.abs(windX) / 8 + 0.2) * Math.sign(windX || 1);
      const fl = Math.sin(t * (3 + Math.abs(windX)) + f.x) * 4;
      poly(g, [{ x: f.x, y: f.y - 50 }, { x: f.x + 26 * w, y: f.y - 46 + fl }, { x: f.x, y: f.y - 38 }], 0xd35400);
    }
    // bomen in de nabije laag
    const a = this.anim;
    a.clear();
    for (const tr of this.trees) {
      const sway = Math.sin(t * 1.3 + tr.phase) * (1 + Math.abs(windX) * 0.6) + windX * 0.8;
      a.fillStyle(this.tint(0x5a4632), 1);
      a.fillRect(tr.x - 4, -tr.h * 0.4, 8, tr.h * 0.4);
      const c = this.tint(0x3f6b3a);
      poly(a, [{ x: tr.x - tr.h * 0.32, y: -tr.h * 0.35 }, { x: tr.x + tr.h * 0.32, y: -tr.h * 0.35 }, { x: tr.x + sway, y: -tr.h }], c);
      poly(a, [{ x: tr.x, y: -tr.h * 0.35 }, { x: tr.x + tr.h * 0.32, y: -tr.h * 0.35 }, { x: tr.x + sway, y: -tr.h }], shade(c, 0.8));
    }
    // wolken & regen in schermruimte
    const sky = this.sky;
    sky.clear();
    const skyPal = SKIES[this.tod];
    sky.fillStyle(skyPal.sun, this.tod === 'night' ? 0.8 : 0.9);
    sky.fillCircle(this.tod === 'dusk' ? 1300 : 1500, this.tod === 'dusk' ? 520 : 180, this.tod === 'night' ? 30 : 46);
    for (const c of this.clouds) {
      const x = ((c.x + t * c.speed * (1 + Math.abs(windX) * 0.2) - camScrollX * 0.02) % 2900 + 2900) % 2900 - 250;
      const col = this.weather === 'rain' ? 0x8a9199 : this.tod === 'dusk' ? 0xf2b9a0 : 0xffffff;
      sky.fillStyle(col, this.weather === 'clear' ? 0.55 : 0.75);
      sky.fillEllipse(x, c.y, c.w, c.w * 0.28);
      sky.fillEllipse(x + c.w * 0.25, c.y - c.w * 0.08, c.w * 0.6, c.w * 0.3);
    }
    if (this.rain.length) {
      sky.lineStyle(1, 0xb7c6d6, 0.5);
      for (const r of this.rain) {
        r.y += dt * 900;
        r.x += dt * windX * 25;
        if (r.y > 1400) {
          r.y -= 1400;
          r.x = Math.random() * 2400;
        }
        sky.lineBetween(r.x, r.y, r.x + windX * 1.2, r.y + 18);
      }
    }
    if (this.weather === 'fog') {
      sky.fillStyle(0xcfd6dc, 0.25);
      sky.fillRect(0, 0, 4000, 2000);
    }
  }

  /** CSS-luchtgradiënt voor de achtergrond van het canvas. */
  static skyCss(tod: TimeOfDay, indoor: boolean): string {
    if (indoor) return 'linear-gradient(#1d2126, #2b3036)';
    const s = SKIES[tod];
    return `linear-gradient(${s.top} 0%, ${s.bottom} 85%)`;
  }

  destroy(): void {
    for (const g of [this.far, this.mid, this.near, this.anim, this.animMid, this.sky]) g.destroy();
  }

  static readonly SCALE = S;
}
