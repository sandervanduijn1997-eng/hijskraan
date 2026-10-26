export type WarningLevel = 'info' | 'caution' | 'critical';

export type WarningId =
  | 'tipping'
  | 'lmiSetup'
  | 'lmiMismatch'
  | 'slingOverload'
  | 'overPeople'
  | 'slingAngle'
  | 'rigTilt'
  | 'overload'
  | 'stability'
  | 'outriggers'
  | 'unsafeRadius'
  | 'highLoad'
  | 'snag'
  | 'boomHit'
  | 'ropeContact'
  | 'collisionRisk'
  | 'sway'
  | 'wind'
  | 'ground'
  | 'landing'
  | 'order'
  | 'setup'
  | 'outriggerObstacle'
  | 'driveBlocked';

export interface Warning {
  id: WarningId;
  level: WarningLevel;
  text: string;
  priority: number;
}

const PRIORITY: Record<WarningId, number> = {
  lmiMismatch: 95,
  slingOverload: 92,
  overPeople: 97,
  slingAngle: 62,
  rigTilt: 42,
  lmiSetup: 30,
  tipping: 100,
  overload: 90,
  stability: 85,
  outriggers: 80,
  snag: 78,
  unsafeRadius: 75,
  boomHit: 74,
  ropeContact: 70,
  collisionRisk: 65,
  highLoad: 60,
  ground: 58,
  wind: 55,
  sway: 50,
  outriggerObstacle: 45,
  landing: 40,
  order: 38,
  driveBlocked: 30,
  setup: 20,
};

/**
 * Houdt actieve waarschuwingen bij met hysterese (minimale weergaveduur), zodat de HUD niet flikkert
 * en nooit alle waarschuwingen tegelijk toont.
 */
export class WarningTracker {
  private active = new Map<WarningId, { w: Warning; hold: number }>();
  private raised: Warning[] = [];

  begin(): void {
    this.raised.length = 0;
  }

  raise(id: WarningId, level: WarningLevel, text: string): void {
    this.raised.push({ id, level, text, priority: PRIORITY[id] + (level === 'critical' ? 5 : 0) });
  }

  /** Verwerk de stap. Geeft nieuw geactiveerde waarschuwingen terug (voor geluid). */
  end(dt: number): Warning[] {
    const fresh: Warning[] = [];
    for (const w of this.raised) {
      const prev = this.active.get(w.id);
      if (!prev) fresh.push(w);
      this.active.set(w.id, { w, hold: 1.2 });
    }
    for (const [id, a] of this.active) {
      if (!this.raised.some((r) => r.id === id)) {
        a.hold -= dt;
        if (a.hold <= 0) this.active.delete(id);
      }
    }
    return fresh;
  }

  /** De belangrijkste n waarschuwingen. */
  top(n = 2): Warning[] {
    return [...this.active.values()].map((a) => a.w).sort((a, b) => b.priority - a.priority).slice(0, n);
  }

  has(id: WarningId): boolean {
    return this.active.has(id);
  }

  anyCritical(): boolean {
    for (const a of this.active.values()) if (a.w.level === 'critical') return true;
    return false;
  }
}
