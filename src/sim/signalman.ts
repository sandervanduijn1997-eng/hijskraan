import { loadBottomCenter } from '../missions/validation/placement';
import type { Simulation } from './simulation';

/**
 * Signaalgever: volgt haak, last en doelzone en geeft aanwijzingen via de portofoon, zoals op de
 * bouwplaats ("zwenken links", "giek uit", "zakken… nog twee meter… langzaam… stop").
 * Puur logica: de app spreekt de tekst uit en het 3D-model toont het bijbehorende armgebaar.
 */
export type Signal = 'none' | 'hoist' | 'lower' | 'slow' | 'stop' | 'slewLeft' | 'slewRight' | 'out' | 'in' | 'wait' | 'release';

export interface SignalCall {
  signal: Signal;
  text: string;
}

/** Minimale tijd (s) tussen twee aanwijzingen, en hoe lang dezelfde aanwijzing niet herhaald wordt. */
const MIN_GAP = 2.2;
const REPEAT_GAP = 7;

export class Signalman {
  /** Huidig armgebaar (voor het 3D-model). */
  current: Signal = 'none';
  private lastTime = -99;
  private lastText = '';
  private lastSameTime = -99;

  /** Bepaal de aanwijzing voor dit moment (of null als er niets nieuws te zeggen is). */
  update(sim: Simulation): SignalCall | null {
    if (sim.outcome !== 'running') return null;
    const call = this.decide(sim);
    if (!call) {
      this.current = 'none';
      return null;
    }
    this.current = call.signal;
    const t = sim.time;
    if (t - this.lastTime < MIN_GAP) return null;
    if (call.text === this.lastText && t - this.lastSameTime < REPEAT_GAP) return null;
    this.lastTime = t;
    if (call.text !== this.lastText) this.lastSameTime = t;
    else this.lastSameTime = t;
    this.lastText = call.text;
    return call;
  }

  private decide(sim: Simulation): SignalCall | null {
    const g = sim.geom;
    const crane = sim.spec.cfg.kind;
    const outWord = crane === 'tower' ? 'loopkat' : 'giek';
    // doel: de actieve doelzone (met last) of het hijspunt van de last (zonder last)
    let tx: number;
    let tz: number;
    let px: number;
    let pz: number;
    let height: number | null = null;
    let tol = 0.4;
    if (sim.attached) {
      const task = sim.tasks.find((k) => k.status === 'active' && k.def.type === 'deliver' && k.def.loadId === sim.attached!.id);
      const zone = task && task.def.type === 'deliver' ? sim.mission.zones.find((z) => z.id === (task.def as { zoneId: string }).zoneId) : undefined;
      if (!zone) return null;
      const bc = loadBottomCenter(sim.attached.cb.body);
      tx = zone.x;
      tz = zone.z ?? 0;
      px = bc.x;
      pz = bc.z;
      height = bc.y - zone.y;
      tol = Math.max(0.12, zone.tolerance * 0.8);
      if (sim.swayDeg > 2.5 && height < 4) return { signal: 'wait', text: 'Wacht… laat hem uitslingeren.' };
    } else {
      const next = sim.tasks.find((k) => k.status === 'active' && k.def.type === 'deliver');
      const load = next && next.def.type === 'deliver' ? sim.loads.find((l) => l.id === (next.def as { loadId: string }).loadId) : undefined;
      if (!load || load.status === 'consumed') return null;
      const sp = sim.slingPoint(load);
      const hp = sim.hookPoint();
      tx = sp.x;
      tz = sp.z;
      px = hp.x;
      pz = hp.z;
      tol = 0.5;
      const dy = hp.y - sp.y;
      const close = Math.hypot(tx - px, tz - pz) < tol;
      if (close && dy > 0.4) return { signal: 'lower', text: dy > 2 ? `Haak zakken, nog ${Math.round(dy)} meter.` : 'Haak langzaam zakken.' };
      if (close && sim.attachCandidate() === load) return { signal: 'stop', text: 'Stop. Last aanslaan.' };
    }
    // horizontale afwijking in het draaivlak: zwenken (tangentieel) en giek/loopkat (radiaal)
    const ax = g.slewX;
    const az = g.slewZ;
    const rT = Math.hypot(tx - ax, tz - az);
    const rP = Math.hypot(px - ax, pz - az);
    const aT = Math.atan2(tz - az, tx - ax);
    const aP = Math.atan2(pz - az, px - ax);
    let da = aT - aP;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const tangential = da * rT;
    const radial = rT - rP;
    const dist = (m: number) => (m >= 1.5 ? `nog ${Math.round(m)} meter` : m >= 0.4 ? 'halve meter' : 'beetje');
    if (Math.abs(tangential) > tol) {
      // positieve zwenk (rechtsom) brengt de last naar een grotere hoek
      const right = da > 0;
      return { signal: right ? 'slewRight' : 'slewLeft', text: `Zwenken ${right ? 'rechts' : 'links'}, ${dist(Math.abs(tangential))}.` };
    }
    if (Math.abs(radial) > tol) {
      const out = radial > 0;
      return { signal: out ? 'out' : 'in', text: `${outWord === 'giek' ? 'Giek' : 'Loopkat'} ${out ? 'uit' : 'in'}, ${dist(Math.abs(radial))}.` };
    }
    if (height === null) return null;
    if (height > 2) return { signal: 'lower', text: `Zakken, ${dist(height)}.` };
    if (height > 0.5) return { signal: 'slow', text: 'Langzaam zakken…' };
    if (height > 0.08) return { signal: 'slow', text: 'Beetje… beetje…' };
    return { signal: 'release', text: 'Staat. Kabel vieren.' };
  }
}
