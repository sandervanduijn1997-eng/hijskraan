import { loadBottomCenter } from '../missions/validation/placement';
import type { ActionId } from '../save/saveSystem';
import type { Simulation } from './simulation';

/**
 * Geregisseerde les: een instructeur leidt de speler via de portofoon door een missie, één bediening
 * per stap, met een markering in de wereld. Puur logica; de app spreekt de tekst uit en toont hem,
 * de 3D-laag tekent de markering.
 */

export type LessonId = 'firstLift';

export interface LessonMarker {
  kind: 'arrow' | 'ring';
  x: number;
  y: number;
  z: number;
  /** Straal van de ring (m). */
  r?: number;
}

interface LessonStep {
  id: string;
  text: (key: (a: ActionId) => string, sim: Simulation) => string;
  done: (sim: Simulation, elapsed: number) => boolean;
  /** Stap overslaan als hij niet van toepassing is. */
  skip?: (sim: Simulation) => boolean;
  marker?: (sim: Simulation) => LessonMarker | null;
}

const firstLoad = (sim: Simulation) => sim.loads[0];
const firstZone = (sim: Simulation) => sim.mission.zones[0];

/** Hoekverschil (rad) tussen de giekrichting en de richting naar het eerste afzetvak. */
function slewError(sim: Simulation): number {
  const z = firstZone(sim);
  if (!z) return 0;
  const want = Math.atan2((z.z ?? 0) - sim.geom.slewZ, z.x - sim.geom.slewX);
  const d = want - sim.crane.slew;
  return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
}

const FIRST_LIFT: LessonStep[] = [
  {
    id: 'intro',
    text: () => 'Goedemorgen, ik ben je instructeur. We doen samen je eerste hijs. De stempels staan al uit, de kraan staat stabiel.',
    done: (_s, t) => t > 6,
  },
  {
    id: 'lmi',
    text: (k) => `Eerst de lastmomentbegrenzer. Druk ${k('lmi')} en voer de opstelling in zoals hij is: stempels 100 procent, het contragewicht en het aantal parten.`,
    skip: (s) => !s.manualLmi,
    done: (s) => s.lmi.configured,
  },
  {
    id: 'lower',
    text: (k) => `Laat de haak zakken met ${k('hoistDown')} tot vlak boven de pallet.`,
    done: (s) => s.attachCandidate() !== null || s.attached !== null,
    marker: (s) => {
      const l = firstLoad(s);
      if (!l) return null;
      const p = s.slingPoint(l);
      return { kind: 'arrow', x: p.x, y: p.y + 0.6, z: p.z };
    },
  },
  {
    id: 'rig',
    text: (k, s) => (s.manualRigging ? `Stop. Druk ${k('rigging')} om aan te slaan. Kies stroppen die de vijfhonderd kilo ruim dragen, en niet te kort.` : `Stop. Druk ${k('rigging')} om de last aan te slaan.`),
    done: (s) => s.attached !== null,
  },
  {
    id: 'hoist',
    text: (k) => `Hijs op met ${k('hoistUp')} tot de pallet een meter of drie hoog hangt. Over de afzetting heen.`,
    done: (s) => !!s.attached && loadBottomCenter(s.attached.cb.body).y > 2.6,
  },
  {
    id: 'slew',
    text: (k) => `Nu zwenken: met ${k('slewLeft')} en ${k('slewRight')} draai je de bovenwagen tot de giek naar het groene vak wijst. Rustig beginnen en op tijd afremmen.`,
    skip: (s) => slewError(s) < 0.03,
    done: (s) => slewError(s) < 0.03 && Math.abs(s.crane.vel.slew) < 0.02,
    marker: (s) => {
      const z = firstZone(s);
      return z ? { kind: 'ring', x: z.x, y: z.y, z: z.z ?? 0, r: z.tolerance + 0.4 } : null;
    },
  },
  {
    id: 'tele',
    text: (k) => `Schuif de giek uit met ${k('teleOut')} tot de last boven het vak hangt. Houd ${k('precision')} ingedrukt voor fijn bewegen.`,
    done: (s) => {
      const z = firstZone(s);
      if (!s.attached || !z) return false;
      const bc = loadBottomCenter(s.attached.cb.body);
      return Math.hypot(bc.x - z.x, bc.z - (z.z ?? 0)) < z.tolerance;
    },
    marker: (s) => {
      const z = firstZone(s);
      return z ? { kind: 'ring', x: z.x, y: z.y, z: z.z ?? 0, r: z.tolerance + 0.4 } : null;
    },
  },
  {
    id: 'settle',
    text: () => 'Mooi. Even wachten tot de last stil hangt.',
    done: (s) => s.swayDeg < 1,
  },
  {
    id: 'set',
    text: (k) => `Laat nu rustig zakken met ${k('hoistDown')}. Vlak boven de grond heel langzaam, met ${k('precision')}.`,
    done: (s) => s.tasks[0]?.status === 'done' || s.outcome === 'success',
    marker: (s) => {
      const z = firstZone(s);
      return z ? { kind: 'ring', x: z.x, y: z.y, z: z.z ?? 0, r: z.tolerance + 0.4 } : null;
    },
  },
  {
    id: 'slack',
    text: (k) => `Staat. Vier nog iets bij met ${k('hoistDown')}, zodat de kabel ontlast is.`,
    done: (s) => s.outcome === 'success',
  },
  {
    id: 'end',
    text: () => 'Goed gedaan, dat was je eerste hijs!',
    done: (_s, t) => t > 4,
  },
];

const LESSONS: Record<LessonId, LessonStep[]> = { firstLift: FIRST_LIFT };

export class LessonRunner {
  private steps: LessonStep[];
  index = -1;
  private elapsed = 0;
  finished = false;

  constructor(
    id: LessonId,
    private key: (a: ActionId) => string,
  ) {
    this.steps = LESSONS[id];
  }

  get stepId(): string | null {
    return this.finished || this.index < 0 ? null : this.steps[this.index].id;
  }

  /** Huidige markering in de wereld. */
  marker(sim: Simulation): LessonMarker | null {
    if (this.finished || this.index < 0) return null;
    return this.steps[this.index].marker?.(sim) ?? null;
  }

  /** Eén stap verder kijken; geeft de nieuwe instructie terug als er een nieuwe stap begint. */
  update(sim: Simulation, dt: number): string | null {
    if (this.finished) return null;
    this.elapsed += dt;
    let started: string | null = null;
    // afgeronde of niet-relevante stappen doorlopen (een speler mag vooruit werken)
    for (let guard = 0; guard < this.steps.length + 1; guard++) {
      const cur = this.index >= 0 ? this.steps[this.index] : null;
      if (cur && !cur.skip?.(sim) && !cur.done(sim, this.elapsed)) break;
      if (sim.outcome === 'failed') {
        this.finished = true;
        return null;
      }
      this.index++;
      this.elapsed = 0;
      if (this.index >= this.steps.length) {
        this.finished = true;
        return null;
      }
      const next = this.steps[this.index];
      if (next.skip?.(sim)) continue;
      started = next.text(this.key, sim);
    }
    return started;
  }
}
