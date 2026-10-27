import type { CraneInput } from '../cranes/controllers/craneInput';
import type { LmiConfig } from '../cranes/models/lmi';
import type { RigChoice } from './rigging';

/**
 * Opname van een missie voor de herhaling. De simulatie is deterministisch (vaste stap, vaste seed),
 * dus het volstaat om per stap de invoer en de handelingen van de speler (aanslaan, LMI, matten,
 * stempelprocedure) vast te leggen: een nieuwe simulatie met dezelfde opname loopt exact hetzelfde.
 * Daarnaast een grove tijdlijn (10 Hz) met slinger en belasting, en markeringen voor wat er gebeurde.
 */

export type RecordedAction =
  | { step: number; kind: 'rig' }
  | { step: number; kind: 'attachWith'; choice: RigChoice }
  | { step: number; kind: 'lmi'; cfg: Omit<LmiConfig, 'configured'> }
  | { step: number; kind: 'mats' }
  | { step: number; kind: 'outriggerAuto'; mode: 'none' | 'deploy' | 'retract' };

export interface TimelineSample {
  t: number;
  sway: number;
  load: number;
  hookY: number;
}

export type MarkerKind = 'attach' | 'detach' | 'placed' | 'impact' | 'warning' | 'fail' | 'success' | 'surprise' | 'inspection';

export interface TimelineMarker {
  t: number;
  step: number;
  kind: MarkerKind;
  text: string;
  /** Kritiek (rood in de tijdlijn). */
  bad: boolean;
}

export interface Recording {
  /** Invoer: wisselt alleen als de invoer verandert (run-length). */
  inputs: { step: number; input: CraneInput }[];
  actions: RecordedAction[];
  samples: TimelineSample[];
  markers: TimelineMarker[];
  steps: number;
}

const same = (a: CraneInput, b: CraneInput): boolean => {
  for (const k of Object.keys(a) as (keyof CraneInput)[]) if (a[k] !== b[k]) return false;
  return true;
};

export class Recorder {
  readonly rec: Recording = { inputs: [], actions: [], samples: [], markers: [], steps: 0 };
  private last: CraneInput | null = null;
  private warned = new Set<string>();

  input(step: number, input: CraneInput): void {
    if (!this.last || !same(this.last, input)) {
      const copy = { ...input };
      this.rec.inputs.push({ step, input: copy });
      this.last = copy;
    }
    this.rec.steps = step + 1;
  }

  action(a: RecordedAction): void {
    this.rec.actions.push(a);
  }

  sample(s: TimelineSample): void {
    this.rec.samples.push(s);
  }

  marker(m: TimelineMarker): void {
    // dezelfde waarschuwing niet steeds opnieuw markeren
    if (m.kind === 'warning') {
      if (this.warned.has(m.text)) return;
      this.warned.add(m.text);
    }
    this.rec.markers.push(m);
  }
}

/** Invoer bij een stap uit een opname (binair zoeken in de run-length-lijst). */
export function inputAt(rec: Recording, step: number): CraneInput | null {
  const a = rec.inputs;
  if (!a.length || step < a[0].step) return null;
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (a[mid].step <= step) lo = mid;
    else hi = mid - 1;
  }
  return a[lo].input;
}
