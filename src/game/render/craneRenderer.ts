import type Phaser from 'phaser';
import { outriggerPad } from '../../cranes/controllers/craneController';
import type { ResolvedCrane } from '../../cranes/models/craneSpec';
import type { CraneState } from '../../cranes/models/craneState';
import type { CraneGeometry } from '../../cranes/models/kinematics';
import type { P2 } from './draw';
import { KX, KY, S, beam3, box3, lineW, poly, proj, shade, truss3, wheel } from './draw';

type G = Phaser.GameObjects.Graphics;
type V3 = [number, number, number];

export interface Livery {
  body: number;
  accent: number;
  boom: number;
}

export const LIVERIES: Record<string, { label: string; make: (base: number, accent: number) => Livery }> = {
  standard: { label: 'Standaard', make: (b, a) => ({ body: b, accent: a, boom: b }) },
  heritage: { label: 'Heritage (eindcertificaat)', make: () => ({ body: 0x13294b, accent: 0xd4af37, boom: 0xd4af37 }) },
};

export interface CraneDrawInfo {
  exhaust: { x: number; y: number };
  groundContacts: { x: number; z: number }[];
}

const VIEW = { x: KX, y: KY, z: 1 };

/** Doos in het draaiframe (u langs de giek, w zijwaarts) met zichtbare vlakken. */
function slewBox(g: G, slewX: number, phi: number, u0: number, u1: number, w0: number, w1: number, y0: number, y1: number, color: number, alpha = 1): void {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const P = (u: number, w: number, y: number): P2 => proj(slewX + u * c - w * s, y, u * s + w * c);
  const faces: { n: V3; pts: [number, number, number][]; f: number }[] = [
    { n: [0, 1, 0], pts: [[u0, w0, y1], [u1, w0, y1], [u1, w1, y1], [u0, w1, y1]], f: 1.18 },
    { n: [0, -1, 0], pts: [[u0, w0, y0], [u1, w0, y0], [u1, w1, y0], [u0, w1, y0]], f: 0.5 },
    { n: [c, 0, s], pts: [[u1, w0, y0], [u1, w1, y0], [u1, w1, y1], [u1, w0, y1]], f: 0.9 },
    { n: [-c, 0, -s], pts: [[u0, w0, y0], [u0, w1, y0], [u0, w1, y1], [u0, w0, y1]], f: 0.8 },
    { n: [-s, 0, c], pts: [[u0, w1, y0], [u1, w1, y0], [u1, w1, y1], [u0, w1, y1]], f: 1.0 },
    { n: [s, 0, -c], pts: [[u0, w0, y0], [u1, w0, y0], [u1, w0, y1], [u0, w0, y1]], f: 0.72 },
  ];
  for (const f of faces) {
    const d = f.n[0] * VIEW.x + f.n[1] * VIEW.y + f.n[2] * VIEW.z;
    if (d <= 0) continue;
    poly(g, f.pts.map(([u, w, y]) => P(u, w, y)), shade(color, f.f), alpha);
  }
}

const toWorld = (g: CraneGeometry, phi: number, u: number, y: number, w = 0): V3 => [g.slewX + u * Math.cos(phi) - w * Math.sin(phi), y, u * Math.sin(phi) + w * Math.cos(phi)];

export function drawCrane(g: G, spec: ResolvedCrane, s: CraneState, geo: CraneGeometry, liv: Livery, time: number, night: boolean): CraneDrawInfo {
  g.clear();
  const cfg = spec.cfg;
  const gb = spec.gb;
  const vis = cfg.visual;
  const L = vis.carrierLength;
  const x0 = s.baseX - L / 2;
  const x1 = s.baseX + L / 2;
  const phi = s.slew;
  const minJack = s.outriggerJack.length ? Math.min(...s.outriggerJack) : 0;
  const lift = minJack * 0.15;
  const info: CraneDrawInfo = { exhaust: { x: s.baseX, y: vis.carrierHeight + 1 }, groundContacts: [] };

  // kanteling: hele kraan om het kantelpunt
  const tilting = s.tilt > 0.0001;
  if (tilting) {
    const p = proj(geo.tiltPivotX, 0, 0);
    const dir = Math.cos(phi) >= 0 ? 1 : -1;
    g.save();
    g.translateCanvas(p.x, p.y);
    g.rotateCanvas(dir * s.tilt);
    g.translateCanvas(-p.x, -p.y);
  }

  const parts: { z: number; draw: () => void }[] = [];
  const add = (z: number, draw: () => void) => parts.push({ z, draw });

  // ---------------- stempels
  if (gb.outriggerCount > 0 && cfg.carrier !== 'selfErecting') {
    for (let i = 0; i < gb.outriggerCount; i++) {
      const pad = outriggerPad(spec, s, i);
      const jack = s.outriggerJack[i] ?? 0;
      const zIn = pad.z > 0 ? 1.1 : -1.1;
      const beamY = 0.75 + lift;
      add(pad.z * 0.5 - 0.01 + (pad.z > 0 ? 2 : -50), () => {
        if (Math.abs(pad.z - zIn) > 0.05) box3(g, pad.x - 0.25, pad.x + 0.25, beamY, beamY + 0.4, Math.min(zIn, pad.z), Math.max(zIn, pad.z), 0x3a3f45);
        const padY = (1 - jack) * 0.45;
        box3(g, pad.x - 0.12, pad.x + 0.12, padY + 0.1, beamY + 0.05, pad.z - 0.12, pad.z + 0.12, 0xb8bec4);
        box3(g, pad.x - 0.5, pad.x + 0.5, padY, padY + 0.12, pad.z - 0.5, pad.z + 0.5, jack > 0.99 ? 0x2f343a : 0x5a6068);
      });
      if (jack > 0.99) info.groundContacts.push({ x: pad.x, z: pad.z });
    }
  }

  // ---------------- onderwagen
  add(-20, () => drawCarrier(g, spec, s, liv, x0, x1, lift, night, info));

  // ---------------- bovenwagen en giek
  if (cfg.kind === 'tower') drawTower(g, spec, s, geo, liv, time, night, add);
  else drawUpper(g, spec, s, geo, liv, time, night, add, info);

  parts.sort((a, b) => a.z - b.z);
  for (const p of parts) p.draw();
  if (tilting) g.restore();
  return info;
}

function drawCarrier(g: G, spec: ResolvedCrane, s: CraneState, liv: Livery, x0: number, x1: number, lift: number, night: boolean, info: CraneDrawInfo): void {
  const cfg = spec.cfg;
  const vis = cfg.visual;
  const h = vis.carrierHeight;
  const body = liv.body;
  const dark = 0x2b2f36;
  const L = x1 - x0;
  switch (cfg.carrier) {
    case 'allTerrain':
    case 'truck':
    case 'knuckleTruck': {
      const r = vis.wheelRadius;
      const n = vis.axles;
      const axX: number[] = [];
      const cabW = cfg.carrier === 'allTerrain' ? 2.6 : 2.4;
      const cabAtRight = vis.cabFront;
      const span0 = cabAtRight ? x0 + 1.4 : x0 + cabW + 1;
      const span1 = cabAtRight ? x1 - cabW - 0.6 : x1 - 1.4;
      for (let i = 0; i < n; i++) axX.push(n === 1 ? (span0 + span1) / 2 : span0 + ((span1 - span0) * i) / (n - 1));
      if (cabAtRight) axX[axX.length - 1] = x1 - 1.6;
      else axX[0] = x0 + 1.6;
      for (const ax of axX) wheel(g, ax, r + lift * 0, -1.1, r, s.wheelRot, 0x15171a, 0x6d747b);
      box3(g, x0 + 0.2, x1 - 0.2, r * 0.9 + lift, h * 0.75 + lift, -1.25, 1.25, dark, { facets: false });
      box3(g, x0, x1, h * 0.55 + lift, h + lift, -1.3, 1.3, body);
      // stempelkasten
      for (const ox of [x0 + 0.9, x1 - 0.9]) box3(g, ox - 0.45, ox + 0.45, h * 0.4 + lift, h * 0.8 + lift, -1.32, 1.32, shade(body, 0.85));
      // cabine
      const cx0 = cabAtRight ? x1 - cabW : x0;
      const cx1 = cabAtRight ? x1 : x0 + cabW;
      const cabH = cfg.carrier === 'allTerrain' ? h + 1.0 : h + 1.6;
      box3(g, cx0, cx1, h * 0.8 + lift, cabH + lift, -1.3, cfg.carrier === 'allTerrain' ? 0.2 : 1.3, cfg.carrier === 'knuckleTruck' ? 0xe9edf0 : body);
      const wx0 = cabAtRight ? cx1 - 1.0 : cx0 + 0.15;
      const win = proj(wx0, cabH - 0.15 + lift, cfg.carrier === 'allTerrain' ? 0.2 : 1.3);
      const win2 = proj(wx0 + 0.85, h + 0.35 + lift, cfg.carrier === 'allTerrain' ? 0.2 : 1.3);
      g.fillStyle(night ? 0xffe39a : 0x8fb7d6, night ? 0.9 : 0.85);
      g.fillRect(win.x, win.y, win2.x - win.x, win2.y - win.y);
      if (cfg.carrier === 'knuckleTruck') {
        // laadvloer
        const bx0 = cabAtRight ? x0 : x0 + cabW + 0.3;
        const bx1 = cabAtRight ? x1 - cabW - 0.3 : x1;
        box3(g, bx0, bx1, h - 0.15 + lift, h + lift, -1.3, 1.3, 0x7d6a55);
      }
      for (const ax of axX) wheel(g, ax, r, 1.15, r, s.wheelRot);
      info.exhaust = { x: cabAtRight ? x1 - cabW - 0.3 : x0 + cabW + 0.3, y: cabH + 0.3 };
      for (const ax of axX) info.groundContacts.push({ x: ax, z: 1.2 });
      break;
    }
    case 'roughTerrain': {
      const r = vis.wheelRadius;
      const ax = [x0 + 2.3, x1 - 2.3];
      for (const a of ax) wheel(g, a, r, -1.15, r, s.wheelRot, 0x15171a, 0x6d747b);
      box3(g, x0 + 0.6, x1 - 0.6, r * 0.8 + lift, h + lift, -1.25, 1.25, body);
      for (const ox of [x0 + 0.7, x1 - 0.7]) box3(g, ox - 0.5, ox + 0.5, h * 0.5 + lift, h * 0.9 + lift, -1.3, 1.3, shade(body, 0.8));
      for (const a of ax) {
        wheel(g, a, r, 1.2, r, s.wheelRot);
        info.groundContacts.push({ x: a, z: 1.2 });
      }
      info.exhaust = { x: x0 + 2, y: h + 0.8 };
      break;
    }
    case 'carryDeck': {
      const r = vis.wheelRadius;
      const ax = [x0 + 1.1, x1 - 1.1];
      for (const a of ax) wheel(g, a, r, -1.0, r, s.wheelRot, 0x15171a, 0x6d747b);
      box3(g, x0, x1, r * 0.7 + lift, h + lift, -1.25, 1.25, body);
      // dek
      box3(g, x0 + 0.2, x1 - 2.4, h + lift, h + 0.12 + lift, -1.2, 1.2, 0x6b6f74);
      // cabine voorop
      box3(g, x1 - 1.9, x1 - 0.2, h + lift, h + 1.6 + lift, 0.1, 1.25, shade(body, 0.95));
      const w0 = proj(x1 - 1.7, h + 1.45 + lift, 1.25);
      const w1 = proj(x1 - 0.4, h + 0.6 + lift, 1.25);
      g.fillStyle(night ? 0xffe39a : 0x8fb7d6, 0.85);
      g.fillRect(w0.x, w0.y, w1.x - w0.x, w1.y - w0.y);
      for (const a of ax) {
        wheel(g, a, r, 1.15, r, s.wheelRot);
        info.groundContacts.push({ x: a, z: 1.1 });
      }
      info.exhaust = { x: x0 + 0.6, y: h + 0.6 };
      break;
    }
    case 'crawler': {
      const tb = spec.gb.footprintRetracted.b;
      for (const zc of [-tb + 0.5, tb - 0.5]) {
        const tz0 = zc - 0.55;
        const tz1 = zc + 0.55;
        box3(g, x0, x1, 0, 1.25, tz0, tz1, 0x2a2d31, { facets: false });
        // loopvlak dat meebeweegt
        const step = 0.6;
        const off = ((s.wheelRot * vis.wheelRadius) % step + step) % step;
        g.lineStyle(Math.max(1, S * 0.08), 0x45494e, 1);
        for (let x = x0 + off; x < x1; x += step) {
          const a = proj(x, 0.05, tz1);
          const b = proj(x, 1.2, tz1);
          g.lineBetween(a.x, a.y, a.x, a.y - 3);
          g.lineBetween(b.x, b.y, b.x, b.y + 3);
        }
        for (let i = 0; i < 6; i++) {
          const wx = x0 + 0.7 + (i * (L - 1.4)) / 5;
          const c = proj(wx, 0.62, tz1);
          g.fillStyle(0x6d747b, 1);
          g.fillCircle(c.x, c.y, S * (i === 0 || i === 5 ? 0.5 : 0.28));
        }
        if (zc > 0) for (let i = 0; i < 6; i++) info.groundContacts.push({ x: x0 + 0.7 + (i * (L - 1.4)) / 5, z: tz1 });
      }
      box3(g, s.baseX - 2.4, s.baseX + 2.4, 0.9, vis.carrierHeight, -tb + 1, tb - 1, shade(body, 0.8));
      info.exhaust = { x: s.baseX, y: vis.carrierHeight + 3 };
      break;
    }
    case 'towerBase': {
      box3(g, s.baseX - 4, s.baseX + 4, -0.2, 0.6, -4, 4, 0x8c8f92);
      box3(g, s.baseX - 3, s.baseX + 3, 0.6, 1.5, -0.6, 0.6, 0x3b3f45);
      for (const bx of [-2.4, 1.4]) box3(g, s.baseX + bx, s.baseX + bx + 1, 0.6, 1.8, -3, 3, 0x9aa0a6);
      break;
    }
    case 'selfErecting': {
      for (let i = 0; i < 4; i++) {
        const pad = outriggerPad(spec, s, i);
        lineW(g, s.baseX, 0.8, 0, pad.x, 0.4, pad.z, S * 0.25, 0x30343a);
        box3(g, pad.x - 0.4, pad.x + 0.4, 0, 0.25, pad.z - 0.4, pad.z + 0.4, 0x30343a);
      }
      box3(g, x0, x1, 0.25, vis.carrierHeight, -1.1, 1.1, shade(liv.body, 0.85));
      const ballast = Math.min(1, Math.max(0, (s.setupProgress - 0.2) / 0.2));
      const n = Math.round(ballast * 4);
      for (let i = 0; i < n; i++) box3(g, s.baseX - 1.6 + i * 0.8, s.baseX - 0.9 + i * 0.8, vis.carrierHeight, vis.carrierHeight + 0.8, -0.9, 0.9, 0x9aa0a6);
      break;
    }
  }
}

function drawUpper(g: G, spec: ResolvedCrane, s: CraneState, geo: CraneGeometry, liv: Livery, time: number, night: boolean, add: (z: number, d: () => void) => void, info: CraneDrawInfo): void {
  const cfg = spec.cfg;
  const gb = spec.gb;
  const phi = s.slew;
  const sx = geo.slewX;
  const h = cfg.visual.carrierHeight;
  const sn = Math.sin(phi);
  const kind = cfg.kind;
  const body = liv.body;
  const isKnuckle = kind === 'knuckle';
  const cw = spec.counterweights[s.counterweightIndex];
  const cwT = (cw?.massT ?? 0) + s.extraCounterweightT;
  const cwR = cw?.radius ?? 2;

  if (!isKnuckle) {
    // draaikrans + bovenwagen
    const houseLen = Math.max(3, Math.min(8, cwR + 1.2));
    const top = h + (kind === 'lattice' ? 2.6 : 1.5);
    add(-houseLen * 0.5 * sn, () => {
      slewBox(g, sx, phi, -houseLen, 1.6, -1.3, 1.3, h, top, shade(body, 0.95));
      slewBox(g, sx, phi, -houseLen + 0.4, -1.2, -1.15, 1.15, top, top + 0.5, shade(body, 0.8));
    });
    // contragewicht
    if (cwT > 0.05 && cw) {
      const cwH = Math.min(3.2, 0.5 + Math.sqrt(cwT) * 0.22);
      add(-cwR * sn - 0.2, () => slewBox(g, sx, phi, -cwR - 0.9, -cwR + 0.7, -1.4, 1.4, h + 0.3, h + 0.3 + cwH, 0x3b3f45));
    }
    // cabine opzij
    add(1.0 * sn + 1.5 * Math.cos(phi), () => {
      slewBox(g, sx, phi, -0.4, 2.0, 1.35, 2.3, h + 0.2, h + 2.2, shade(body, 1.05));
      slewBox(g, sx, phi, 0.9, 2.02, 1.4, 2.31, h + 1.1, h + 2.0, night ? 0xffe39a : 0x8fb7d6);
    });
    // zwaailicht
    const beaconOn = Math.sin(time * 0.012) > 0;
    add(5, () => {
      const p = proj(...toWorld(geo, phi, 0.6, h + 2.4, 1.8));
      g.fillStyle(0xff8c00, beaconOn ? 1 : 0.35);
      g.fillCircle(p.x, p.y, S * 0.18);
      if (beaconOn) {
        g.fillStyle(0xffa733, 0.18);
        g.fillCircle(p.x, p.y, S * 0.9);
      }
    });
    info.exhaust = { x: sx - (houseLen - 1) * Math.cos(phi), y: top + 0.6 };
  } else {
    // knikarmkolom
    add(-0.5, () => slewBox(g, sx, phi, -0.6, 0.6, -0.6, 0.6, h, h + 0.6, 0x3b3f45));
  }

  // giek
  const segs = geo.segments;
  const boomZ = geo.tipU * 0.5 * sn;
  add(boomZ + 0.5, () => {
    const boomColor = liv.boom;
    for (const seg of segs) {
      const a = toWorld(geo, phi, seg.u0, seg.y0);
      const b = toWorld(geo, phi, seg.u1, seg.y1);
      switch (seg.kind) {
        case 'boom':
          if (kind === 'lattice') truss3(g, a[0], a[1], a[2], b[0], b[1], b[2], seg.width, boomColor);
          else beam3(g, a[0], a[1], a[2], b[0], b[1], b[2], seg.width, 0.9, boomColor);
          break;
        case 'boomSection':
          beam3(g, a[0], a[1], a[2], b[0], b[1], b[2], seg.width, 0.8, shade(boomColor, 1.08));
          break;
        case 'jib':
          truss3(g, a[0], a[1], a[2], b[0], b[1], b[2], seg.width, boomColor);
          break;
        case 'column':
          beam3(g, a[0], a[1], a[2], b[0], b[1], b[2], seg.width, 0.7, 0x3b3f45);
          break;
        case 'arm1':
        case 'arm2':
          beam3(g, a[0], a[1], a[2], b[0], b[1], b[2], seg.width, 0.5, boomColor);
          break;
        case 'tele':
          beam3(g, a[0], a[1], a[2], b[0], b[1], b[2], seg.width, 0.35, shade(boomColor, 1.12));
          break;
        default:
          break;
      }
    }
    // hydraulische cilinders
    if (kind === 'telescopic') {
      const th = geo.displayBoomAngle;
      const base = toWorld(geo, phi, gb.pivotU + 1.6, h + 0.2);
      const at = 0.42 * gb.boomMin;
      const tgt = toWorld(geo, phi, gb.pivotU + at * Math.cos(th), gb.pivotHeight + at * Math.sin(th) - 0.4);
      const mid: V3 = [base[0] + (tgt[0] - base[0]) * 0.55, base[1] + (tgt[1] - base[1]) * 0.55, base[2] + (tgt[2] - base[2]) * 0.55];
      lineW(g, base[0], base[1], base[2] + 0.4, mid[0], mid[1], mid[2] + 0.4, S * 0.38, 0x2b2f36);
      lineW(g, mid[0], mid[1], mid[2] + 0.4, tgt[0], tgt[1], tgt[2] + 0.4, S * 0.2, 0xd5dbe0);
    } else if (isKnuckle) {
      const a1 = segs.find((x) => x.kind === 'arm1');
      const a2 = segs.find((x) => x.kind === 'arm2');
      if (a1) {
        const b0 = toWorld(geo, phi, 0.5, a1.y0 - 1.5);
        const b1 = toWorld(geo, phi, a1.u0 + (a1.u1 - a1.u0) * 0.45, a1.y0 + (a1.y1 - a1.y0) * 0.45);
        lineW(g, b0[0], b0[1], b0[2] + 0.3, b1[0], b1[1], b1[2] + 0.3, S * 0.22, 0xd5dbe0);
      }
      if (a1 && a2) {
        const c0 = toWorld(geo, phi, a1.u0 + (a1.u1 - a1.u0) * 0.6, a1.y0 + (a1.y1 - a1.y0) * 0.6 + 0.3);
        const c1 = toWorld(geo, phi, a2.u0 + (a2.u1 - a2.u0) * 0.35, a2.y0 + (a2.y1 - a2.y0) * 0.35 + 0.3);
        lineW(g, c0[0], c0[1], c0[2] + 0.3, c1[0], c1[1], c1[2] + 0.3, S * 0.18, 0xd5dbe0);
      }
    } else if (kind === 'lattice') {
      // A-bok en giekverstagingen
      const aTop = toWorld(geo, phi, -2.2, gb.pivotHeight + 6);
      const aBase = toWorld(geo, phi, -1.2, h + 2.6);
      lineW(g, aBase[0], aBase[1], aBase[2], aTop[0], aTop[1], aTop[2], S * 0.25, 0x3b3f45);
      const bt = segs.find((x) => x.kind === 'boom')!;
      const tipW = toWorld(geo, phi, bt.u1, bt.y1);
      lineW(g, aTop[0], aTop[1], aTop[2], tipW[0], tipW[1], tipW[2], Math.max(1, S * 0.06), 0x1d1f22);
      const back = toWorld(geo, phi, -cwR, h + 2.6);
      lineW(g, aTop[0], aTop[1], aTop[2], back[0], back[1], back[2], Math.max(1, S * 0.06), 0x1d1f22);
    }
    // kop met schijven
    const tp = proj(geo.tip.x, geo.tip.y + 0.3, geo.tip.z);
    g.fillStyle(0x2b2f36, 1);
    g.fillCircle(tp.x, tp.y, S * (kind === 'knuckle' ? 0.2 : 0.45));
    g.fillStyle(0x9aa3ab, 1);
    g.fillCircle(tp.x, tp.y, S * (kind === 'knuckle' ? 0.1 : 0.22));
  });
}

function drawTower(g: G, spec: ResolvedCrane, s: CraneState, geo: CraneGeometry, liv: Livery, time: number, night: boolean, add: (z: number, d: () => void) => void): void {
  const gb = spec.gb;
  const phi = s.slew;
  const segs = geo.segments;
  const mast = segs.find((x) => x.kind === 'mast')!;
  const jib = segs.find((x) => x.kind === 'jib')!;
  const cj = segs.find((x) => x.kind === 'counterJib');
  const color = liv.boom;
  const top = toWorld(geo, phi, mast.u1, mast.y1);
  add(-1, () => {
    const b = toWorld(geo, phi, mast.u0, mast.y0);
    truss3(g, b[0], b[1], b[2], top[0], top[1], top[2], mast.width, color);
  });
  const sn = Math.sin(phi);
  add(jib ? (jib.u1 * 0.5) * sn : 0, () => {
    const a = toWorld(geo, phi, jib.u0, jib.y0);
    const b = toWorld(geo, phi, jib.u1, jib.y1);
    truss3(g, a[0], a[1], a[2], b[0], b[1], b[2], jib.width, color);
    if (cj) {
      const c = toWorld(geo, phi, cj.u1, cj.y1);
      truss3(g, a[0], a[1], a[2], c[0], c[1], c[2], cj.width, color);
      // ballastblokken
      const bal = spec.counterweights[0]?.massT ?? 0;
      if (bal > 0 && geo.jibUnfold >= 1 && (gb.setupType !== 'towerAssembly' || s.setupProgress >= 0.9)) {
        const n = gb.setupType === 'selfErect' ? 2 : 4;
        for (let i = 0; i < n; i++) {
          const u = cj.u1 + 0.4 + i * 1.1;
          slewBox(g, geo.slewX, phi, u - 0.5, u + 0.5, -0.8, 0.8, cj.y1 - 2.2, cj.y1 - 0.2, 0x8c9096);
        }
      }
    }
    if (geo.jibUnfold >= 1 && (gb.setupType !== 'towerAssembly' || s.setupProgress >= 0.5)) {
      // torenspits met trekstangen
      const peak = toWorld(geo, phi, 0, jib.y0 + (gb.setupType === 'selfErect' ? 3 : 7));
      lineW(g, top[0], top[1], top[2], peak[0], peak[1], peak[2], S * 0.3, color);
      const j1 = toWorld(geo, phi, jib.u1 * 0.65, jib.y0);
      lineW(g, peak[0], peak[1], peak[2], j1[0], j1[1], j1[2], Math.max(1, S * 0.06), 0x1d1f22);
      if (cj) {
        const c1 = toWorld(geo, phi, cj.u1, cj.y1);
        lineW(g, peak[0], peak[1], peak[2], c1[0], c1[1], c1[2], Math.max(1, S * 0.06), 0x1d1f22);
      }
      // cabine
      slewBox(g, geo.slewX, phi, 0.6, 2.6, 0.8, 2.6, jib.y0 - 2.6, jib.y0 - 0.2, 0xe9edf0);
      slewBox(g, geo.slewX, phi, 1.8, 2.62, 0.85, 2.62, jib.y0 - 2.2, jib.y0 - 0.8, night ? 0xffe39a : 0x8fb7d6);
      // loopkat
      slewBox(g, geo.slewX, phi, s.trolley - 0.7, s.trolley + 0.7, -0.7, 0.7, jib.y0 - 0.9, jib.y0 - 0.3, 0x2b2f36);
      const on = Math.sin(time * 0.006) > 0;
      const tp = proj(...toWorld(geo, phi, jib.u1, jib.y0 + 0.4));
      g.fillStyle(0xff3b30, on ? 1 : 0.3);
      g.fillCircle(tp.x, tp.y, S * 0.2);
      const pk = proj(...peak);
      g.fillStyle(0xff3b30, on ? 1 : 0.3);
      g.fillCircle(pk.x, pk.y, S * 0.2);
    }
  });
}
