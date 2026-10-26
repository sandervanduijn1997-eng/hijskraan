import type { CraneKind } from '../../cranes/config/types';
import type { CraneInput } from '../../cranes/controllers/craneInput';
import { emptyInput } from '../../cranes/controllers/craneInput';
import type { ActionId } from '../../save/saveSystem';
import { FIXED_DT } from '../../physics/constants';
import type { AnalogSettings } from './analog';
import { defaultAnalog, keyRampLevel, stickToCommand } from './analog';

/** Eenmalige acties (flank) die de scene afhandelt. */
export type EdgeAction = 'rigging' | 'outriggerMode' | 'outriggerAuto' | 'pause' | 'menu' | 'overview' | 'cameraReset' | 'cameraMode' | 'horn' | 'zoomIn' | 'zoomOut' | 'help' | 'lmi' | 'mats';

const EDGE: EdgeAction[] = ['rigging', 'outriggerMode', 'outriggerAuto', 'pause', 'menu', 'overview', 'cameraReset', 'cameraMode', 'horn', 'zoomIn', 'zoomOut', 'help', 'lmi', 'mats'];

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
  /** Instellingen voor sticks en oplopende toetsen. */
  analog: AnalogSettings = defaultAnalog();
  /** Hoe lang (s) elke as al in dezelfde richting via het toetsenbord wordt bediend. */
  private held = new Map<string, number>();
  private padButtons: boolean[] = [];
  /** Naam van de aangesloten controller (leeg = geen). */
  gamepadName = '';
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

  /**
   * Toetsenbordas met oplopende snelheid: hoe langer vastgehouden, hoe sneller (zoals doseren met een hendel).
   * Wordt één keer per vaste simulatiestap gelezen.
   */
  private axis(pos: ActionId, neg: ActionId): number {
    const dir = (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
    const key = `${pos}|${neg}`;
    if (dir === 0) {
      this.held.delete(key);
      return 0;
    }
    const prev = this.held.get(key) ?? 0;
    // richting gewisseld: opnieuw beginnen bij de minimale snelheid
    const t = Math.sign(prev) === dir ? Math.abs(prev) + FIXED_DT : 0;
    this.held.set(key, dir * Math.max(t, 1e-9));
    return dir * keyRampLevel(t, this.analog.keyRamp);
  }

  /** Eerste aangesloten controller met standaardindeling (of null). */
  private gamepad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const g of navigator.getGamepads()) if (g && g.connected) return g;
    return null;
  }

  /** Knoppen van de controller als flanken (A = aanslaan, Start = pauze, …). */
  private pollPadButtons(g: Gamepad): void {
    const map: Record<number, EdgeAction> = { 0: 'rigging', 2: 'outriggerAuto', 3: 'cameraMode', 1: 'overview', 9: 'pause', 8: 'menu', 12: 'zoomIn', 13: 'zoomOut', 10: 'horn', 11: 'cameraReset' };
    g.buttons.forEach((b, i) => {
      const was = this.padButtons[i] ?? false;
      if (b.pressed && !was && map[i]) this.edges.push(map[i]);
      this.padButtons[i] = b.pressed;
    });
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
    const pad = this.gamepad();
    this.gamepadName = pad ? pad.id : '';
    if (pad) this.pollPadButtons(pad);
    inp.precision = this.isDown('precision');
    inp.setupHold = this.isDown('setup');
    inp.drive = this.axis('driveRight', 'driveLeft');
    if (this.outriggerMode) {
      inp.outriggerTarget = this.outriggerTarget;
      inp.outriggerBeam = this.axis('boomUp', 'boomDown');
      inp.outriggerJack = this.axis('hoistUp', 'hoistDown');
      if (pad) this.applyGamepad(pad, kind, inp);
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
    if (pad) this.applyGamepad(pad, kind, inp);
    for (const s of this.axisSources) s(inp);
    return inp;
  }

  /**
   * Controller (standaardindeling): linkerstick zwenken + giek/loopkat/hoofdarm, rechterstick hijsen + telescoop/knikarm,
   * triggers rijden, RB precisie, LB opbouw. Een stick overschrijft de toets alleen als hij buiten de dode zone staat.
   */
  private applyGamepad(g: Gamepad, kind: CraneKind, inp: CraneInput): void {
    const a = this.analog;
    const ax = (i: number) => stickToCommand(g.axes[i] ?? 0, a);
    const set = (k: keyof CraneInput, v: number) => {
      if (v !== 0) (inp as unknown as Record<string, number>)[k] = v;
    };
    const btn = (i: number) => g.buttons[i]?.pressed ?? false;
    const trig = (i: number) => g.buttons[i]?.value ?? 0;
    if (btn(5)) inp.precision = true;
    if (btn(4)) inp.setupHold = true;
    const drive = stickToCommand(trig(7) - trig(6), { ...a, curve: 1 });
    set('drive', drive);
    if (this.outriggerMode) {
      set('outriggerBeam', -ax(1));
      set('outriggerJack', -ax(3));
      return;
    }
    set('slew', ax(0));
    set('hoist', (a.invertHoist ? 1 : -1) * ax(3));
    switch (kind) {
      case 'tower':
        set('trolley', -ax(1));
        break;
      case 'knuckle':
        set('luff', -ax(1));
        set('knuckle', ax(2));
        if (btn(14) || btn(15)) inp.knuckleTele = btn(15) ? 1 : -1;
        break;
      case 'telescopic':
        set('luff', -ax(1));
        set('tele', ax(2));
        break;
      case 'lattice':
        set('luff', -ax(1));
        break;
    }
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
