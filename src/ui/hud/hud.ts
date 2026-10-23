import { levelFor } from '../../career/career';
import { outriggerPad } from '../../cranes/controllers/craneController';
import { hasSetupProcedure, setupStageLabel } from '../../cranes/models/kinematics';
import { formatMoney } from '../../economy/economy';
import { GROUND_LABEL, groundAt } from '../../physics/ground';
import type { ActionId } from '../../save/saveSystem';
import type { Simulation } from '../../sim/simulation';
import { RAD, clamp } from '../../utils/math';
import { controlHints, keyLabel } from '../../game/input/inputManager';
import { h, kbd, setClass, setText } from '../dom';

export interface HudContext {
  money: number;
  xp: number;
  bindings: Record<ActionId, string[]>;
  outriggerMode: boolean;
  outriggerTarget: number;
  showHints: boolean;
  overview: boolean;
  timeLimitActive: boolean;
}

export interface HudActions {
  pause(): void;
  fullscreen(): void;
  outriggerMode(): void;
  outriggerAuto(): void;
  rigging(): void;
  overview(): void;
}

const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');

export class Hud {
  readonly root: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  private tasksEl!: HTMLUListElement;
  private keysEl!: HTMLElement;
  private plan!: HTMLCanvasElement;
  private keySig = '';
  private toastTimer = 0;
  private outrigEls: HTMLElement[] = [];

  constructor(readonly sim: Simulation, actions: HudActions) {
    const E = (k: string, cls = '', text = '') => (this.el[k] = h('span', { class: cls }, text));
    this.tasksEl = h('ul', { class: 'tasks' });
    this.plan = h('canvas', { class: 'planview', width: 320, height: 170 });
    this.keysEl = h('div', { class: 'hud-keys box' });
    const cfg = sim.spec.cfg;
    const n = sim.spec.gb.outriggerCount;
    const outr = h('div', { class: 'outriggers' });
    const names = ['LV', 'RV', 'LA', 'RA'];
    for (let i = 0; i < n; i++) {
      const d = h('div', null, names[i]);
      this.outrigEls.push(d);
      outr.append(d);
    }
    const row = (label: string, key: string) => [h('span', { class: 'k' }, label), E(key, 'v')];
    this.root = h(
      'div',
      { class: 'hud', 'data-testid': 'hud' },
      h(
        'div',
        { class: 'hud-mission box' },
        h('div', { class: 'title' }, sim.mission.number > 0 ? `${sim.mission.number}. ${sim.mission.title}` : sim.mission.title),
        h('div', { class: 'crane' }, `${cfg.name} · ${cfg.classLabel}`),
        this.tasksEl,
        E('timer', 'timer'),
        (this.el.setup = h('div', { class: 'setup-bar', style: 'display:none' }, (this.el.setupLbl = h('div', { style: 'font-size:.8em' })), h('div', { class: 'bar' }, (this.el.setupFill = h('div', { class: 'fill' }))))),
      ),
      h(
        'div',
        { class: 'hud-top-right' },
        h('div', { class: 'box stat' }, h('div', { class: 'lbl' }, 'Saldo'), E('money', 'val')),
        h('div', { class: 'box stat' }, h('div', { class: 'lbl' }, 'XP / niveau'), E('xp', 'val')),
        h('div', { class: 'box stat' }, h('div', { class: 'lbl' }, 'Wind'), h('div', { class: 'val' }, (this.el.windArrow = h('span', { class: 'wind-arrow' }, '➜')), ' ', E('wind'))),
      ),
      h(
        'div',
        { class: 'hud-buttons' },
        h('button', { class: 'btn small', onclick: () => actions.pause(), 'data-testid': 'btn-pause' }, '❚❚ Pauze'),
        h('button', { class: 'btn small', onclick: () => actions.overview() }, '⤢ Overzicht'),
        h('button', { class: 'btn small', onclick: () => actions.fullscreen() }, '⛶ Scherm'),
        n > 0 && cfg.gameBalance.setupType !== 'selfErect' ? h('button', { class: 'btn small', onclick: () => actions.outriggerMode(), 'data-testid': 'btn-outriggers' }, '⊞ Stempels') : null,
      ),
      h(
        'div',
        { class: 'hud-data box' },
        h('h4', null, 'Lastmomentbegrenzer'),
        h('div', { class: 'dgrid' }, ...row('Lastgewicht', 'load'), ...row('Toegestaan', 'cap'), ...row('Giekhoek', 'angle'), ...row('Gieklengte', 'length'), ...row('Werkstraal', 'radius'), ...row('Haakhoogte', 'hookH'), ...row('Kabellengte', 'rope'), ...row('Contragewicht', 'cw')),
        h(
          'div',
          { class: 'lmi' },
          h('div', { class: 'bar' }, (this.el.lmiFill = h('div', { class: 'fill' })), h('div', { class: 'mark', style: 'left:90%' })),
          h('div', { class: 'row2' }, h('span', null, 'Belasting'), E('pct')),
        ),
        h(
          'div',
          { class: 'lmi' },
          h('div', { class: 'bar' }, (this.el.stabFill = h('div', { class: 'fill' }))),
          h('div', { class: 'row2' }, h('span', null, 'Kantelmoment'), E('stab')),
        ),
      ),
      h(
        'div',
        { class: 'hud-side box' },
        h('h4', null, 'Plattegrond (bovenaanzicht)'),
        this.plan,
        h('div', { class: 'sway' }, h('span', null, 'Slinger'), h('div', { class: 'dial' }, (this.el.needle = h('div', { class: 'needle' }))), E('sway')),
        n > 0 ? h('div', null, h('h4', { style: 'margin-top:.6em' }, 'Stempels'), outr, E('support', 'muted')) : null,
        h('div', { style: 'margin-top:.4em;font-size:.8em' }, h('span', { class: 'muted' }, 'Ondergrond: '), E('ground')),
      ),
      (this.el.warns = h('div', { class: 'hud-warn', 'data-testid': 'warnings' })),
      (this.el.prompt = h('div', { class: 'hud-prompt box', style: 'display:none' })),
      (this.el.toast = h('div', { class: 'hud-toast box' })),
      this.keysEl,
    );
    this.renderTasks();
  }

  toast(text: string, ms = 2200): void {
    setText(this.el.toast, text);
    this.el.toast.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.el.toast.classList.remove('show'), ms);
  }

  private renderTasks(): void {
    const ul = this.tasksEl;
    ul.innerHTML = '';
    for (const t of this.sim.tasks) ul.append(h('li', { class: t.status }, h('span', { class: 'ck' }), h('span', null, t.label)));
  }

  private taskSig = '';

  update(ctx: HudContext): void {
    const sim = this.sim;
    const g = sim.geom;
    const gb = sim.spec.gb;
    const kind = sim.spec.cfg.kind;
    const sig = sim.tasks.map((t) => t.status).join(',');
    if (sig !== this.taskSig) {
      this.taskSig = sig;
      this.renderTasks();
    }
    const tl = sim.mission.timeLimit;
    const time = sim.time;
    if (tl && ctx.timeLimitActive) {
      const left = Math.max(0, tl - time);
      setText(this.el.timer, `⏱ ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} resterend`);
      setClass(this.el.timer, left < 60 ? 'timer low' : 'timer');
    } else setText(this.el.timer, `⏱ ${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`);
    // opbouw
    const needsSetup = hasSetupProcedure(sim.spec) && sim.crane.setupProgress < 1;
    this.el.setup.style.display = needsSetup || sim.outriggerAuto.outriggerAuto !== 'none' ? '' : 'none';
    if (needsSetup) {
      const p = sim.crane.setupProgress;
      const label = `${setupStageLabel(sim.spec, p)} — houd B`;
      setText(this.el.setupLbl, label);
      this.el.setupFill.style.width = `${p * 100}%`;
    } else if (sim.outriggerAuto.outriggerAuto !== 'none') {
      const avg = (sim.crane.outriggerBeam.reduce((a, b) => a + b, 0) + sim.crane.outriggerJack.reduce((a, b) => a + b, 0)) / Math.max(1, sim.crane.outriggerBeam.length * 2);
      setText(this.el.setupLbl, sim.outriggerAuto.outriggerAuto === 'deploy' ? 'Stempels worden uitgezet…' : 'Stempels worden ingehaald…');
      this.el.setupFill.style.width = `${avg * 100}%`;
    }

    setText(this.el.money, formatMoney(ctx.money));
    const lv = levelFor(ctx.xp);
    setText(this.el.xp, `${ctx.xp} · Nv ${lv.level}`);
    setText(this.el.wind, `${fmt(sim.wind.speed)} m/s`);
    this.el.windArrow.style.transform = `rotate(${sim.wind.x >= 0 ? 0 : 180}deg)`;

    setText(this.el.load, `${fmt(sim.measuredLoadT(), 2)} t`);
    setText(this.el.cap, sim.capacityT > 0 ? `${fmt(sim.capacityT, 1)} t` : '—');
    setText(this.el.angle, kind === 'tower' ? '—' : `${fmt(g.displayBoomAngle * RAD)}°`);
    setText(this.el.length, `${fmt(g.displayBoomLength)} m`);
    setText(this.el.radius, `${fmt(g.radius)} m`);
    setText(this.el.hookH, `${fmt(sim.hookPoint().y)} m`);
    setText(this.el.rope, `${fmt(sim.rope.length)} m`);
    const cw = sim.spec.counterweights[sim.crane.counterweightIndex];
    setText(this.el.cw, `${fmt((cw?.massT ?? 0) + sim.crane.extraCounterweightT, 1)} t`);
    const pct = sim.attached ? sim.loadPct : Math.min(sim.loadPct, 100);
    this.el.lmiFill.style.width = `${clamp(pct, 0, 100)}%`;
    setClass(this.el.lmiFill, pct >= 100 ? 'fill d' : pct >= 90 ? 'fill c' : 'fill');
    setText(this.el.pct, sim.capacityT > 0 ? `${Math.round(pct)} %` : sim.attached ? 'GEEN HIJS' : '—');
    if (sim.stability) {
      const k = sim.stability.tippingRatio * 100;
      this.el.stabFill.style.width = `${clamp(k, 0, 100)}%`;
      setClass(this.el.stabFill, k >= 100 ? 'fill d' : k >= 85 ? 'fill c' : 'fill');
      setText(this.el.stab, `${Math.round(Math.max(0, k))} %`);
    } else {
      this.el.stabFill.style.width = '0%';
      setText(this.el.stab, 'verankerd');
    }

    // slinger
    const sw = sim.swayDeg;
    setText(this.el.sway, `${fmt(sw)}° ${sim.swayDir > 0 ? '→' : sim.swayDir < 0 ? '←' : '·'}`);
    const tipX = g.tip.x;
    const hp = sim.ropeAttachPoint();
    const off = clamp((hp.x - tipX) / 2, -1, 1);
    this.el.needle.style.left = `${50 + off * 50}%`;
    this.el.needle.style.background = sw > 6 ? 'var(--red)' : sw > 3 ? 'var(--yellow)' : 'var(--green)';

    // stempels
    for (let i = 0; i < this.outrigEls.length; i++) {
      const b = sim.crane.outriggerBeam[i];
      const j = sim.crane.outriggerJack[i];
      const st = j >= 0.999 && b >= 0.999 ? 'ok' : j > 0 || b > 0 ? 'part' : '';
      setClass(this.outrigEls[i], `${st}${ctx.outriggerMode && (ctx.outriggerTarget === i || ctx.outriggerTarget < 0) ? ' sel' : ''}`);
      setText(this.outrigEls[i], `${['LV', 'RV', 'LA', 'RA'][i]} ${Math.round(b * 100)}%${j >= 0.999 ? ' ▼' : ''}`);
    }
    if (this.el.support) setText(this.el.support, sim.support.mode === 'outriggers' ? 'Op stempels — volledig' : sim.support.mode === 'partial' ? 'Op stempels — gedeeltelijk' : 'Op banden / rupsen');
    const gi = groundAt(sim.mission.ground ?? [], sim.crane.baseX, sim.mission.groundFallback);
    setText(this.el.ground, `${GROUND_LABEL[gi.type]} · factor ${fmt(sim.groundFactor, 2)}`);

    // waarschuwingen (max 2)
    const top = sim.warnings.top(2);
    const wsig = top.map((w) => w.id + w.level + w.text).join('|');
    if (this.el.warns.dataset.sig !== wsig) {
      this.el.warns.dataset.sig = wsig;
      this.el.warns.innerHTML = '';
      for (const w of top) this.el.warns.append(h('div', { class: `warn ${w.level}` }, w.text));
    }

    // aanslaan-prompt
    const cand = sim.attachCandidate();
    const rig = ctx.bindings.rigging.map(keyLabel)[0] ?? 'T';
    let prompt = '';
    if (sim.outcome === 'running') {
      if (cand) prompt = `${rig} — ${cand.type.name} aanslaan`;
      else if (sim.attached && (sim.attached.cb.supports.size > 0 || sim.attached.cb.body.sleeping) && sim.rope.slack) prompt = `${rig} — afkoppelen`;
      else if (ctx.outriggerMode) prompt = 'STEMPELMODUS — 1–4 kies stempel, 0 = alle';
    }
    this.el.prompt.style.display = prompt ? '' : 'none';
    setText(this.el.prompt, prompt);

    // toetsenoverzicht
    const ksig = `${ctx.outriggerMode}|${ctx.showHints}|${JSON.stringify(ctx.bindings)}`;
    if (ksig !== this.keySig) {
      this.keySig = ksig;
      this.keysEl.innerHTML = '';
      this.keysEl.style.display = ctx.showHints ? '' : 'none';
      const hints = controlHints(kind, ctx.outriggerMode, gb.driveSpeed > 0, kind === 'telescopic');
      for (const hi of hints) this.keysEl.append(h('span', null, ...hi.keys.map((k) => kbd(keyLabel(ctx.bindings[k][0] ?? '?'))), ' ', hi.label));
      if (gb.outriggerCount > 0 && gb.setupType !== 'selfErect' && !ctx.outriggerMode) this.keysEl.append(h('span', null, kbd(keyLabel(ctx.bindings.outriggerMode[0])), ' Stempels'));
      if (hasSetupProcedure(sim.spec)) this.keysEl.append(h('span', null, kbd(keyLabel(ctx.bindings.setup[0])), ' Opbouw'));
      this.keysEl.append(h('span', null, kbd(keyLabel(ctx.bindings.pause[0])), ' Pauze'));
    }
    this.drawPlan();
  }

  /** Bovenaanzicht: kraan, giek, haak en doelzones in x/z. */
  private drawPlan(): void {
    const sim = this.sim;
    const c = this.plan.getContext('2d');
    if (!c) return;
    const W = this.plan.width;
    const H = this.plan.height;
    c.clearRect(0, 0, W, H);
    const g = sim.geom;
    const reach = Math.max(12, Math.abs(g.tipU) * 1.25, sim.spec.cfg.visual.carrierLength * 0.8);
    const scale = Math.min(W, H * 1.8) / (reach * 2.4);
    const cx = W / 2;
    const cz = H / 2;
    const X = (x: number) => cx + (x - g.slewX) * scale;
    const Z = (z: number) => cz + z * scale;
    c.strokeStyle = '#2a2f36';
    c.lineWidth = 1;
    for (let r = 5; r < reach * 1.3; r += 5) {
      c.beginPath();
      c.arc(cx, cz, r * scale, 0, Math.PI * 2);
      c.stroke();
    }
    // obstakels met eindige diepte
    for (const o of sim.colliders) {
      if (o.kind === 'crane' || o.kind === 'ceiling') continue;
      const z0 = Math.max(o.minZ, -reach);
      const z1 = Math.min(o.maxZ, reach);
      c.fillStyle = 'rgba(160,170,180,0.25)';
      c.fillRect(X(o.minX), Z(z0), (o.maxX - o.minX) * scale, (z1 - z0) * scale);
    }
    // zones
    for (const z of sim.mission.zones) {
      const t = sim.tasks.find((tk) => tk.def.type === 'deliver' && tk.def.zoneId === z.id && tk.status === 'active');
      c.strokeStyle = t ? '#f2b705' : '#5b616a';
      c.lineWidth = 2;
      const zt = z.zTolerance ?? 1;
      c.strokeRect(X(z.x - z.tolerance), Z(-zt), z.tolerance * 2 * scale, zt * 2 * scale);
    }
    // onderwagen
    const half = sim.spec.cfg.visual.carrierLength / 2;
    c.fillStyle = '#3b4048';
    c.fillRect(X(sim.crane.baseX - half), Z(-1.3), half * 2 * scale, 2.6 * scale);
    for (let i = 0; i < sim.spec.gb.outriggerCount; i++) {
      const p = outriggerPad(sim.spec, sim.crane, i);
      c.fillStyle = sim.crane.outriggerJack[i] >= 0.999 ? '#36c172' : '#f2b705';
      c.fillRect(X(p.x) - 3, Z(p.z) - 3, 6, 6);
    }
    // giek
    c.strokeStyle = '#f2b705';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx, cz);
    c.lineTo(X(g.tip.x), Z(g.tip.z));
    c.stroke();
    // haak
    const hp = sim.hookPoint();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(X(hp.x), Z(hp.z), 3.5, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#a3a9b1';
    c.font = '10px sans-serif';
    c.fillText(`z ${hp.z >= 0 ? '+' : ''}${hp.z.toFixed(2)} m`, 6, H - 6);
  }
}
