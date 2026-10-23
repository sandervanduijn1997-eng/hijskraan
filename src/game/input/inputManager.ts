import type { CraneKind } from '../../cranes/config/types';
import type { CraneInput } from '../../cranes/controllers/craneInput';
import { emptyInput } from '../../cranes/controllers/craneInput';
import type { ActionId } from '../../save/saveSystem';

/** Eenmalige acties (flank) die de scene afhandelt. */
export type EdgeAction = 'rigging' | 'outriggerMode' | 'outriggerAuto' | 'pause' | 'menu' | 'overview' | 'cameraReset' | 'cameraMode' | 'horn' | 'zoomIn' | 'zoomOut' | 'help';

const EDGE: EdgeAction[] = ['rigging', 'outriggerMode', 'outriggerAuto', 'pause', 'menu', 'overview', 'cameraReset', 'cameraMode', 'horn', 'zoomIn', 'zoomOut', 'help'];

/**
 * Bron-onafhankelijke invoerlaag. Toetsenbord is nu de bron; een gamepad-bron kan later
 * dezelfde `CraneInput` vullen via `addAxisSource`.
 */
export class InputManager {
  private pressed = new Set<string>();
  private edges: EdgeAction[] = [];
  private keyToActions = new Map<string, ActionId[]>();
  /** Stempelmodus: W/S schuiven, Q/E vijzels, 1–4 kiezen. */
  outriggerMode = false;
  outriggerTarget = -1;
  wheel = 0;
  enabled = true;
  private axisSources: ((inp: CraneInput) => void)[] = [];
  private readonly onDown = (e: KeyboardEvent) => this.handleKey(e, true);
  private readonly onUp = (e: KeyboardEvent) => this.handleKey(e, false);
  private readonly onBlur = () => this.pressed.clear();
  private readonly onWheel = (e: WheelEvent) => {
    if ((e.target as HTMLElement)?.closest?.('.ui-scroll')) return;
    this.wheel += Math.sign(e.deltaY);
  };

  constructor(bindings: Record<ActionId, string[]>) {
    this.setBindings(bindings);
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('wheel', this.onWheel, { passive: true });
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('wheel', this.onWheel);
  }

  setBindings(b: Record<ActionId, string[]>): void {
    this.keyToActions.clear();
    for (const [action, keys] of Object.entries(b) as [ActionId, string[]][]) {
      for (const k of keys) {
        const list = this.keyToActions.get(k) ?? [];
        list.push(action);
        this.keyToActions.set(k, list);
      }
    }
  }

  addAxisSource(fn: (inp: CraneInput) => void): void {
    this.axisSources.push(fn);
  }

  private handleKey(e: KeyboardEvent, down: boolean): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (!this.enabled && e.code !== 'Escape' && e.code !== 'Space') return;
    const actions = this.keyToActions.get(e.code) ?? [];
    if (actions.length || /^Digit[0-4]$/.test(e.code)) e.preventDefault();
    if (down) {
      if (!e.repeat) {
        for (const a of actions) if ((EDGE as string[]).includes(a)) this.edges.push(a as EdgeAction);
        if (this.outriggerMode && /^Digit[0-4]$/.test(e.code)) {
          const n = Number(e.code.slice(5));
          this.outriggerTarget = n === 0 ? -1 : n - 1;
        }
      }
      this.pressed.add(e.code);
    } else this.pressed.delete(e.code);
  }

  /** Simuleer een toets (voor knoppen op het scherm en tests). */
  pressAction(a: EdgeAction): void {
    this.edges.push(a);
  }

  isDown(a: ActionId): boolean {
    for (const k of this.pressed) if (this.keyToActions.get(k)?.includes(a)) return true;
    return false;
  }

  private axis(pos: ActionId, neg: ActionId): number {
    return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
  }

  consumeEdges(): EdgeAction[] {
    const e = this.edges;
    this.edges = [];
    return e;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Lees de kraanbesturing voor een bepaald kraantype. */
  readCrane(kind: CraneKind): CraneInput {
    const inp = emptyInput();
    if (!this.enabled) return inp;
    inp.precision = this.isDown('precision');
    inp.setupHold = this.isDown('setup');
    inp.drive = this.axis('driveRight', 'driveLeft');
    if (this.outriggerMode) {
      inp.outriggerTarget = this.outriggerTarget;
      inp.outriggerBeam = this.axis('boomUp', 'boomDown');
      inp.outriggerJack = this.axis('hoistUp', 'hoistDown');
      return inp;
    }
    inp.slew = this.axis('slewRight', 'slewLeft');
    inp.hoist = this.axis('hoistUp', 'hoistDown');
    switch (kind) {
      case 'tower':
        inp.trolley = this.axis('trolleyOut', 'trolleyIn');
        break;
      case 'knuckle':
        inp.luff = this.axis('boomUp', 'boomDown');
        inp.knuckle = this.axis('knuckleUp', 'knuckleDown');
        inp.knuckleTele = this.axis('knuckleTeleOut', 'knuckleTeleIn');
        break;
      case 'telescopic':
        inp.luff = this.axis('boomUp', 'boomDown');
        inp.tele = this.axis('teleOut', 'teleIn');
        break;
      case 'lattice':
        inp.luff = this.axis('boomUp', 'boomDown');
        break;
    }
    for (const s of this.axisSources) s(inp);
    return inp;
  }
}

/** Leesbare naam voor een toetscode. */
export function keyLabel(code: string): string {
  const map: Record<string, string> = {
    ShiftLeft: 'Shift', ShiftRight: 'Shift R', Space: 'Spatie', Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Equal: '+', Minus: '−', NumpadAdd: 'Num +', NumpadSubtract: 'Num −', Tab: 'Tab', Enter: 'Enter', Backspace: '⌫',
  };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

export interface ControlHint {
  keys: ActionId[];
  label: string;
}

/** Bedieningsoverzicht per kraantype (voor HUD en help). */
export function controlHints(kind: CraneKind, outriggerMode: boolean, canDrive: boolean, hasTele: boolean): ControlHint[] {
  if (outriggerMode) {
    return [
      { keys: ['boomUp', 'boomDown'], label: 'Stempel uit / in' },
      { keys: ['hoistUp', 'hoistDown'], label: 'Vijzel neer / op' },
      { keys: ['outriggerAuto'], label: 'Automatische procedure' },
      { keys: ['outriggerMode'], label: 'Stempelmodus verlaten' },
    ];
  }
  const h: ControlHint[] = [];
  if (kind === 'tower') h.push({ keys: ['trolleyOut', 'trolleyIn'], label: 'Loopkat uit / in' });
  else if (kind === 'knuckle') {
    h.push({ keys: ['boomUp', 'boomDown'], label: 'Hoofdarm op / neer' });
    h.push({ keys: ['knuckleUp', 'knuckleDown'], label: 'Knikarm op / neer' });
    h.push({ keys: ['knuckleTeleOut', 'knuckleTeleIn'], label: 'Telescoop uit / in' });
  } else {
    h.push({ keys: ['boomUp', 'boomDown'], label: 'Giek op / neer' });
    if (hasTele) h.push({ keys: ['teleOut', 'teleIn'], label: 'Telescoop uit / in' });
  }
  h.push({ keys: ['slewLeft', 'slewRight'], label: 'Draaien links / rechts' });
  h.push({ keys: ['hoistDown', 'hoistUp'], label: 'Vieren / hijsen' });
  h.push({ keys: ['precision'], label: 'Precisie' });
  h.push({ keys: ['rigging'], label: 'Aanslaan / afkoppelen' });
  if (canDrive) h.push({ keys: ['driveLeft', 'driveRight'], label: 'Rijden' });
  return h;
}
