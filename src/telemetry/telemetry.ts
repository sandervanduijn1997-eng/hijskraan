import type { Simulation } from '../sim/simulation';

/**
 * Speeltestgegevens: per gespeelde missie de tijd per fase, waarschuwingen, fouten en waar een speler
 * stopt. Anoniem (geen naam, geen apparaat-id) en alleen lokaal opgeslagen; de speler exporteert het
 * bestand zelf voor de speeltest. Er wordt niets verstuurd.
 */

export type Phase = 'setup' | 'approach' | 'rigging' | 'lift' | 'place';
export type SessionEnd = 'success' | 'failed' | 'quit' | 'restart';

export interface TelemetrySession {
  /** Volgnummer binnen dit apparaat (geen identificatie). */
  n: number;
  mission: string;
  crane: string;
  mode: string;
  difficulty: string;
  /** Duur (s simulatietijd). */
  time: number;
  end: SessionEnd | null;
  reason?: string;
  phases: Record<Phase, number>;
  warnings: Record<string, number>;
  attaches: number;
  violations: number;
  maxSway: number;
  damage: number;
  /** Tijd per lesstap (s), als er een les liep. */
  lesson: Record<string, number>;
  /** Laatste lesstap of fase op het moment van stoppen (waar spelers afhaken). */
  lastStep: string;
  stars?: number;
}

const KEY = 'crane.telemetry.v1';
const MAX = 300;

/** Fase van het werk op dit moment. */
export function phaseOf(sim: Simulation): Phase {
  if (sim.attached) {
    const lifted = sim.attached.cb.supports.size === 0;
    if (!lifted) return 'rigging';
    const task = sim.tasks.find((k) => k.status === 'active' && k.def.type === 'deliver');
    const zone = task && task.def.type === 'deliver' ? sim.mission.zones.find((z) => z.id === (task.def as { zoneId: string }).zoneId) : undefined;
    if (zone) {
      const p = sim.attached.cb.body.pos;
      if (Math.hypot(p.x - zone.x, p.z - (zone.z ?? 0)) < 3) return 'place';
    }
    return 'lift';
  }
  const needsSetup = sim.manualLmi && !sim.lmi.configured;
  if (needsSetup || (sim.spec.gb.outriggerCount > 0 && sim.support.mode === 'tires' && !sim.spec.gb.liftOnTires)) return 'setup';
  return 'approach';
}

export class Telemetry {
  private cur: TelemetrySession | null = null;
  private lastTime = 0;
  private lessonStep: string | null = null;

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null) {}

  enabled = true;

  /** Alle opgeslagen sessies. */
  all(): TelemetrySession[] {
    try {
      const raw = this.storage?.getItem(KEY);
      const v = raw ? (JSON.parse(raw) as TelemetrySession[]) : [];
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  clear(): void {
    try {
      this.storage?.removeItem(KEY);
    } catch {
      /* niet beschikbaar */
    }
  }

  begin(sim: Simulation, mode: string, difficulty: string): void {
    if (this.cur) this.end('restart');
    if (!this.enabled) return;
    const prev = this.all();
    this.cur = {
      n: (prev.at(-1)?.n ?? 0) + 1,
      mission: sim.mission.id,
      crane: sim.spec.cfg.id,
      mode,
      difficulty,
      time: 0,
      end: null,
      phases: { setup: 0, approach: 0, rigging: 0, lift: 0, place: 0 },
      warnings: {},
      attaches: 0,
      violations: 0,
      maxSway: 0,
      damage: 0,
      lesson: {},
      lastStep: 'setup',
    };
    this.lastTime = sim.time;
    this.lessonStep = null;
  }

  /** Per frame: tijd optellen bij de huidige fase (en lesstap). */
  sample(sim: Simulation, lessonStep: string | null): void {
    const c = this.cur;
    if (!c || c.mission !== sim.mission.id) return;
    const dt = Math.max(0, sim.time - this.lastTime);
    this.lastTime = sim.time;
    const ph = phaseOf(sim);
    c.phases[ph] += dt;
    c.time = sim.time;
    if (lessonStep) {
      c.lesson[lessonStep] = (c.lesson[lessonStep] ?? 0) + dt;
      this.lessonStep = lessonStep;
    }
    c.lastStep = this.lessonStep && lessonStep ? `les:${lessonStep}` : ph;
    c.maxSway = Math.max(c.maxSway, sim.swayDeg);
    c.violations = sim.metrics.safetyViolations;
    c.damage = sim.metrics.damage;
  }

  warning(id: string): void {
    if (this.cur) this.cur.warnings[id] = (this.cur.warnings[id] ?? 0) + 1;
  }

  attach(): void {
    if (this.cur) this.cur.attaches++;
  }

  end(end: SessionEnd, reason?: string, stars?: number): void {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    c.end = end;
    if (reason) c.reason = reason;
    if (stars !== undefined) c.stars = stars;
    c.time = Math.round(c.time * 10) / 10;
    for (const k of Object.keys(c.phases) as Phase[]) c.phases[k] = Math.round(c.phases[k] * 10) / 10;
    for (const k of Object.keys(c.lesson)) c.lesson[k] = Math.round(c.lesson[k] * 10) / 10;
    const list = [...this.all(), c].slice(-MAX);
    try {
      this.storage?.setItem(KEY, JSON.stringify(list));
    } catch {
      /* opslag vol of niet beschikbaar: dan niet loggen */
    }
  }

  get active(): boolean {
    return this.cur !== null;
  }
}

/** Samenvatting per missie voor het speeltestverslag: aantal pogingen, slagingspercentage, mediaan tijd, afhaakpunten. */
export function summarize(list: TelemetrySession[]): { mission: string; tries: number; success: number; medianTime: number; quits: Record<string, number>; topWarnings: [string, number][] }[] {
  const by = new Map<string, TelemetrySession[]>();
  for (const s of list) by.set(s.mission, [...(by.get(s.mission) ?? []), s]);
  return [...by.entries()].map(([mission, ss]) => {
    const times = ss.map((s) => s.time).sort((a, b) => a - b);
    const quits: Record<string, number> = {};
    const warn: Record<string, number> = {};
    for (const s of ss) {
      if (s.end === 'quit' || s.end === 'restart') quits[s.lastStep] = (quits[s.lastStep] ?? 0) + 1;
      for (const [k, v] of Object.entries(s.warnings)) warn[k] = (warn[k] ?? 0) + v;
    }
    return {
      mission,
      tries: ss.length,
      success: ss.filter((s) => s.end === 'success').length,
      medianTime: times[Math.floor(times.length / 2)] ?? 0,
      quits,
      topWarnings: Object.entries(warn).sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  });
}
