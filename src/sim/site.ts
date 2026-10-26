import type { EnvironmentId } from '../missions/data/types';
import { makeRng } from '../utils/math';

/**
 * Levende bouwplaats: bouwvakkers die rondlopen en werken, en een vrachtwagen die aan- en afrijdt.
 * Mensen reageren op een last boven hun hoofd: ze lopen weg uit de gevarenzone. Komt de last toch
 * boven iemand, dan is dat een overtreding. Puur logica en deterministisch (seed van de missie);
 * de 3D-laag tekent de figuren.
 */

export type WorkerState = 'walk' | 'work' | 'flee';

export interface SiteWorker {
  id: number;
  x: number;
  z: number;
  heading: number;
  tx: number;
  tz: number;
  state: WorkerState;
  timer: number;
  /** Loopfase voor de animatie (rad). */
  phase: number;
  /** Hoe lang de last al boven deze persoon hangt (s). */
  exposure: number;
  /** Al als overtreding geteld voor deze blootstelling. */
  counted: boolean;
  vest: number;
}

export interface SiteTruck {
  x: number;
  z: number;
  /** Rijrichting langs x (1 of −1) en snelheid (m/s). */
  dir: number;
  speed: number;
  state: 'away' | 'arrive' | 'parked' | 'leave';
  timer: number;
  parkX: number;
  startX: number;
  endX: number;
}

/** Gevarenzone van een hangende last (horizontaal). */
export interface Danger {
  x: number;
  z: number;
  /** Halve diagonaal van de last (m). */
  half: number;
  /** Hoogte van de onderkant van de last (m). */
  bottom: number;
}

export interface SiteOptions {
  seed: number;
  count: number;
  cx: number;
  cz: number;
  /** Niet dichter bij het draaipunt dan dit (afgezette draaicirkel). */
  rMin: number;
  rMax: number;
  /** Is (x, z) vrij begaanbaar terrein (geen obstakel, last of afzetplek)? */
  free: (x: number, z: number) => boolean;
  /** Vrije rijstrook voor de vrachtwagen (z), of null. */
  laneZ: number | null;
}

const WALK = 1.25;
const RUN = 2.4;
/** Mensen houden deze afstand (m) tot de rand van een hangende last. */
const KEEP_OUT = 3;
/** Na deze tijd onder de last telt het als overtreding (s). */
const EXPOSURE_LIMIT = 0.5;

/** Aantal bouwvakkers per omgeving. */
export const WORKERS_BY_ENV: Record<EnvironmentId, number> = {
  trainingYard: 2,
  constructionSite: 6,
  cityCenter: 5,
  highrise: 6,
  factory: 4,
  roughTerrain: 3,
  riverBridge: 4,
  port: 5,
  industrialPlant: 5,
  windFarm: 3,
};

const VESTS = [0xff7a1a, 0xd8ff1f, 0xff7a1a, 0xffd21f];

export class SiteLife {
  readonly workers: SiteWorker[] = [];
  truck: SiteTruck | null = null;
  /** Staat er nu iemand onder de last? */
  peopleUnderLoad = false;
  private rng: () => number;
  /** Straal van de afgezette draaicirkel (m). */
  get rMin(): number {
    return this.opt.rMin;
  }

  constructor(private opt: SiteOptions) {
    this.rng = makeRng(opt.seed ^ 0x5173);
    for (let i = 0; i < opt.count; i++) {
      const p = this.pickPoint(null);
      if (!p) break;
      this.workers.push({ id: i, x: p.x, z: p.z, heading: this.rng() * Math.PI * 2, tx: p.x, tz: p.z, state: 'work', timer: 1 + this.rng() * 6, phase: 0, exposure: 0, counted: false, vest: VESTS[i % VESTS.length] });
    }
    if (opt.laneZ !== null) {
      const startX = opt.cx - 70;
      this.truck = { x: startX, z: opt.laneZ, dir: 1, speed: 0, state: 'away', timer: 8 + this.rng() * 10, parkX: opt.cx - 14 + this.rng() * 8, startX, endX: opt.cx + 70 };
    }
  }

  /** Willekeurig vrij punt in de werkring, buiten de gevarenzone. */
  private pickPoint(d: Danger | null): { x: number; z: number } | null {
    const o = this.opt;
    for (let k = 0; k < 40; k++) {
      const a = this.rng() * Math.PI * 2;
      const r = o.rMin + 1 + this.rng() * Math.max(1, o.rMax - o.rMin - 1);
      const x = o.cx + Math.cos(a) * r;
      const z = o.cz + Math.sin(a) * r;
      if (!o.free(x, z)) continue;
      if (d && Math.hypot(x - d.x, z - d.z) < d.half + KEEP_OUT + 1) continue;
      return { x, z };
    }
    return null;
  }

  /**
   * Eén stap. `danger` = de hangende last (of null). Geeft het aantal nieuwe overtredingen terug
   * (een persoon die langer dan een halve seconde onder de last staat).
   */
  update(dt: number, danger: Danger | null): number {
    let violations = 0;
    this.peopleUnderLoad = false;
    for (const w of this.workers) {
      const dd = danger ? Math.hypot(w.x - danger.x, w.z - danger.z) : Infinity;
      // reageren op de last: weglopen uit de gevarenzone (van de last af)
      if (danger && dd < danger.half + KEEP_OUT) {
        if (w.state !== 'flee') {
          const ax = dd > 0.01 ? (w.x - danger.x) / dd : Math.cos(w.heading);
          const az = dd > 0.01 ? (w.z - danger.z) / dd : Math.sin(w.heading);
          const run = danger.half + KEEP_OUT + 3;
          let tx = danger.x + ax * run;
          let tz = danger.z + az * run;
          // als die plek niet vrij is: zijwaarts
          if (!this.opt.free(tx, tz)) {
            tx = danger.x - az * run;
            tz = danger.z + ax * run;
          }
          w.tx = tx;
          w.tz = tz;
          w.state = 'flee';
        }
      }
      const under = danger !== null && dd < danger.half + 0.4 && danger.bottom > 0.2;
      if (under) {
        this.peopleUnderLoad = true;
        w.exposure += dt;
        if (w.exposure > EXPOSURE_LIMIT && !w.counted) {
          w.counted = true;
          violations++;
        }
      } else if (!danger || dd > danger.half + KEEP_OUT) {
        w.exposure = 0;
        w.counted = false;
      }
      // bewegen
      if (w.state === 'work') {
        w.timer -= dt;
        w.phase += dt * 3;
        if (w.timer <= 0) {
          const p = this.pickPoint(danger);
          if (p) {
            w.tx = p.x;
            w.tz = p.z;
            w.state = 'walk';
          } else w.timer = 2;
        }
        continue;
      }
      const dx = w.tx - w.x;
      const dz = w.tz - w.z;
      const dist = Math.hypot(dx, dz);
      const v = w.state === 'flee' ? RUN : WALK;
      if (dist < 0.15) {
        w.state = 'work';
        w.timer = 3 + this.rng() * 8;
        continue;
      }
      // zachte draai naar het doel
      const want = Math.atan2(dz, dx);
      let dh = want - w.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      w.heading += Math.sign(dh) * Math.min(Math.abs(dh), dt * (w.state === 'flee' ? 8 : 4));
      const step = Math.min(dist, v * dt);
      const nx = w.x + (dx / dist) * step;
      const nz = w.z + (dz / dist) * step;
      // niet door obstakels lopen; bij een blokkade een nieuw doel kiezen
      if (this.opt.free(nx, nz) || w.state === 'flee') {
        w.x = nx;
        w.z = nz;
      } else {
        w.state = 'work';
        w.timer = 0.5;
      }
      w.phase += dt * (w.state === 'flee' ? 11 : 6.5);
    }
    this.updateTruck(dt, danger);
    return violations;
  }

  private updateTruck(dt: number, danger: Danger | null): void {
    const t = this.truck;
    if (!t) return;
    const cruise = 4.5;
    // stoppen als de last boven de rijstrook hangt (vlak voor de vrachtwagen)
    const blocked = danger !== null && Math.abs(danger.z - t.z) < danger.half + 3 && (danger.x - t.x) * t.dir > -2 && (danger.x - t.x) * t.dir < danger.half + 10;
    switch (t.state) {
      case 'away':
        t.timer -= dt;
        if (t.timer <= 0) {
          t.state = 'arrive';
          t.x = t.startX;
        }
        return;
      case 'arrive': {
        const left = t.parkX - t.x;
        const target = blocked ? 0 : Math.min(cruise, Math.sqrt(Math.max(0, 2 * 1.2 * left)));
        t.speed += Math.sign(target - t.speed) * Math.min(Math.abs(target - t.speed), dt * 2.5);
        t.x += t.speed * dt;
        if (left < 0.1) {
          t.state = 'parked';
          t.speed = 0;
          t.timer = 18 + this.rng() * 14;
        }
        return;
      }
      case 'parked':
        t.timer -= dt;
        if (t.timer <= 0) t.state = 'leave';
        return;
      case 'leave': {
        const target = blocked ? 0 : cruise;
        t.speed += Math.sign(target - t.speed) * Math.min(Math.abs(target - t.speed), dt * 1.5);
        t.x += t.speed * dt;
        if (t.x > t.endX) {
          t.state = 'away';
          t.timer = 25 + this.rng() * 30;
        }
        return;
      }
    }
  }
}
