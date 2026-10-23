import { audio } from '../audio/audioEngine';
import { LICENSE_LABELS, isChapterUnlocked, isCompleted, isMissionUnlocked, levelFor, nextMission, totalStars } from '../career/career';
import { CRANES, CRANE_IDS, getCrane } from '../cranes/config/cranes';
import type { CraneId } from '../cranes/config/types';
import { UPGRADES, upgradePrice } from '../cranes/config/upgrades';
import { generateLoadChart, allowedCapacityT } from '../cranes/models/capacity';
import { resolveCrane } from '../cranes/models/craneSpec';
import { createCraneState } from '../cranes/models/craneState';
import { applyMissionResult, buyCrane, buyUpgrade, canBuyCrane, canBuyUpgrade, computePayout, formatMoney, isOwned, rentCost, repairCost, repairCrane } from '../economy/economy';
import type { Payout } from '../economy/economy';
import { CHALLENGES, challengeMission, practiceMission } from '../missions/data/challenges';
import type { ChallengeDef } from '../missions/data/challenges';
import { CHAPTERS, MISSIONS, missionsInChapter } from '../missions/data/index';
import { LOADS, getLoad } from '../missions/data/loads';
import type { EnvironmentId, MissionDef } from '../missions/data/types';
import { SCORE_LABELS, SCORE_WEIGHTS } from '../missions/runtime/scoring';
import { validateMission } from '../missions/validation/validateMission';
import { DEFAULT_BINDINGS, loadGame, saveGame } from '../save/saveSystem';
import type { ActionId, SaveData, StorageLike } from '../save/saveSystem';
import { DIFFICULTIES } from '../sim/difficulty';
import type { DifficultyId } from '../sim/difficulty';
import type { SimEvent, Simulation } from '../sim/simulation';
import { GRAVITY } from '../physics/constants';
import { clamp } from '../utils/math';
import type { EdgeAction } from '../game/input/inputManager';
import { InputManager, keyLabel } from '../game/input/inputManager';
import { LIVERIES } from '../game3d/craneModel';
import type { Host3D } from '../game3d/host';
import { ENVIRONMENTS } from '../game/render/palette';
import type { SessionConfig, SceneHooks, World3D } from '../game3d/world3d';
import { h, kbd, stars } from './dom';
import { Hud } from './hud/hud';

const ACTION_LABELS: Record<ActionId, string> = {
  boomUp: 'Giek omhoog', boomDown: 'Giek omlaag', slewLeft: 'Draaien links', slewRight: 'Draaien rechts', hoistUp: 'Hijsen', hoistDown: 'Vieren',
  teleOut: 'Telescoop uit', teleIn: 'Telescoop in', trolleyOut: 'Loopkat naar buiten', trolleyIn: 'Loopkat naar binnen', knuckleUp: 'Knikarm omhoog', knuckleDown: 'Knikarm omlaag',
  knuckleTeleOut: 'Knikarm-telescoop uit', knuckleTeleIn: 'Knikarm-telescoop in', driveLeft: 'Rijden links', driveRight: 'Rijden rechts', precision: 'Precisiebediening',
  rigging: 'Aanslaan / afkoppelen', outriggerMode: 'Stempelmodus', outriggerAuto: 'Automatische stempelprocedure', setup: 'Opbouwprocedure (vasthouden)', pause: 'Pauze',
  menu: 'Menu', zoomIn: 'Inzoomen', zoomOut: 'Uitzoomen', overview: 'Overzichtsmodus', cameraReset: 'Camera herstellen', cameraMode: 'Camera: volgen / cabine', horn: 'Claxon', help: 'Bedieningsoverzicht',
};

interface PlanChoice {
  craneId: CraneId;
  cw: number;
  boom: number;
  jib: number;
  difficulty: DifficultyId;
}

export class App {
  save: SaveData;
  input: InputManager;
  private ui: HTMLElement;
  private screen: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private hud: Hud | null = null;
  private scene: World3D | null = null;
  private session: SessionConfig | null = null;
  private plan: PlanChoice | null = null;
  private resultShown = false;
  private notice: HTMLElement | null = null;

  constructor(private host: Host3D, private storage: StorageLike, loadStatus?: (s: string) => void) {
    const res = loadGame(storage);
    this.save = res.data;
    loadStatus?.(res.status);
    this.ui = document.getElementById('ui')!;
    this.input = new InputManager(this.save.settings.bindings);
    audio.setMix({ master: this.save.settings.masterVolume, music: this.save.settings.musicVolume, sfx: this.save.settings.sfxVolume });
    const unlock = () => {
      audio.unlock();
      audio.setMix({ master: this.save.settings.masterVolume, music: this.save.settings.musicVolume, sfx: this.save.settings.sfxVolume });
      audio.startMusic();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('resize', () => this.applyScale());
    this.applyScale();
    if (res.status === 'corrupt') this.showNotice('Het savebestand was beschadigd. Er is een reservekopie gemaakt en een nieuw profiel gestart.');
    else if (res.status === 'repaired') this.showNotice('Het savebestand is gecontroleerd en gerepareerd.');
    window.setInterval(() => {
      this.save.stats.playTime += 5;
      this.persist();
    }, 5000);
  }

  private applyScale(): void {
    const s = clamp(Math.min(window.innerWidth / 1920, window.innerHeight / 1080) * 1.15, 0.68, 1.2);
    document.documentElement.style.setProperty('--ui-scale', s.toFixed(3));
  }

  persist(): void {
    saveGame(this.storage, this.save);
  }

  showNotice(text: string, ms = 4500): void {
    this.notice?.remove();
    this.notice = h('div', { class: 'notice box panel' }, text);
    this.ui.append(this.notice);
    const n = this.notice;
    window.setTimeout(() => n.remove(), ms);
  }

  // ------------------------------------------------------------------ sessies

  private hooks(): SceneHooks {
    return {
      input: this.input,
      onFrame: (sim, scene) => this.onFrame(sim, scene),
      onEvents: (sim, ev) => this.onEvents(sim, ev),
      onEdge: (a, sim) => this.onEdge(a, sim),
      settings: () => ({ cameraShake: this.save.settings.cameraShake, particles: this.save.settings.particles }),
    };
  }

  private startScene(cfg: SessionConfig): void {
    this.session = cfg;
    this.resultShown = false;
    this.input.outriggerMode = false;
    this.input.outriggerTarget = -1;
    this.input.consumeEdges();
    this.scene = this.host.start(cfg, this.hooks());
  }

  startDemo(): void {
    const m = MISSIONS.find((x) => x.id === 'm26')!;
    this.startScene({ mode: 'demo', sim: { mission: m, difficulty: DIFFICULTIES.practice }, livery: 'standard' });
    this.hud?.root.remove();
    this.hud = null;
  }

  private startPlay(cfg: SessionConfig): void {
    this.closeScreen();
    this.closeOverlay();
    this.startScene(cfg);
    audio.stopMusic();
  }

  startMission(m: MissionDef, p: PlanChoice): void {
    this.plan = p;
    const ups = this.save.upgrades[p.craneId] ?? [];
    this.startPlay({
      mode: 'career',
      sim: {
        mission: m,
        craneId: p.craneId,
        upgrades: isOwned(this.save, p.craneId) ? ups : [],
        difficulty: DIFFICULTIES[p.difficulty],
        condition: isOwned(this.save, p.craneId) ? this.save.craneCondition[p.craneId] ?? 1 : 1,
        counterweightIndex: p.cw,
        boomOptionIndex: p.boom,
        jibIndex: p.jib,
      },
      livery: this.save.activeLivery,
    });
  }

  restart(): void {
    if (!this.session) return;
    this.startPlay({ ...this.session });
  }

  private onFrame(sim: Simulation, scene: World3D): void {
    this.scene = scene;
    if (this.session?.mode === 'demo') return;
    if (!this.hud || this.hud.sim !== sim) {
      this.hud?.root.remove();
      this.hud = new Hud(sim, {
        pause: () => this.togglePause(),
        fullscreen: () => this.toggleFullscreen(),
        outriggerMode: () => this.onEdge('outriggerMode', sim),
        outriggerAuto: () => this.onEdge('outriggerAuto', sim),
        rigging: () => this.onEdge('rigging', sim),
        overview: () => this.input.pressAction('overview'),
      });
      this.ui.prepend(this.hud.root);
    }
    this.hud.update({
      money: this.save.money,
      xp: this.save.xp,
      bindings: this.save.settings.bindings,
      outriggerMode: this.input.outriggerMode,
      outriggerTarget: this.input.outriggerTarget,
      showHints: this.save.settings.showHints,
      overview: scene.overviewActive,
      timeLimitActive: sim.difficulty.timer && this.session?.mode === 'career',
    });
    const v = sim.crane.vel;
    const gb = sim.spec.gb;
    const hyd = Math.min(1, Math.abs(v.luff) / Math.max(1e-6, gb.luffSpeedDeg * 0.0175) + Math.abs(v.tele) / Math.max(1e-6, gb.teleSpeed || 1) + Math.abs(v.slew) / Math.max(1e-6, gb.slewSpeedDeg * 0.0175) * 0.5 + Math.abs(v.knuckle) * 3 + Math.abs(v.trolley) * 0.5);
    audio.update({ engine: sim.crane.engine, hydraulic: hyd, winch: v.hoist / Math.max(0.1, gb.hoistSpeed), wind: sim.wind.speed, drive: Math.abs(v.drive) / Math.max(0.1, gb.driveSpeed) });
  }

  private onEvents(sim: Simulation, ev: SimEvent[]): void {
    if (this.session?.mode === 'demo') return;
    for (const e of ev) {
      switch (e.type) {
        case 'impact':
          if (e.speed > 0.1) audio.impact(e.speed, e.mass, e.obstacle);
          break;
        case 'warning':
          if (e.warning.level !== 'info') audio.warning(e.warning.level);
          break;
        case 'lmiCutoff':
          audio.lmiBeep();
          break;
        case 'attach':
        case 'detach':
          audio.clank(0.08, 520);
          break;
        case 'placed':
          audio.ui('confirm');
          this.hud?.toast('Last correct geplaatst ✓');
          break;
        case 'taskComplete':
          if (sim.tasks[e.index]?.def.type !== 'deliver') {
            audio.ui('confirm');
            this.hud?.toast(`${sim.tasks[e.index].label} ✓`);
          }
          break;
        case 'success':
        case 'fail':
          audio.ui(e.type === 'success' ? 'success' : 'fail');
          if (!this.resultShown) {
            this.resultShown = true;
            window.setTimeout(() => this.showResults(sim), e.type === 'success' ? 1400 : 2200);
          }
          break;
        default:
          break;
      }
    }
  }

  private onEdge(a: EdgeAction, sim: Simulation): void {
    if (this.session?.mode === 'demo') return;
    switch (a) {
      case 'rigging': {
        if (this.scene?.paused) return;
        const msg = sim.toggleRigging();
        if (msg) this.hud?.toast(msg);
        break;
      }
      case 'outriggerMode': {
        const gb = sim.spec.gb;
        if (gb.outriggerCount === 0 || gb.setupType === 'selfErect') {
          this.hud?.toast('Deze kraan heeft geen bedienbare stempels.');
          return;
        }
        this.input.outriggerMode = !this.input.outriggerMode;
        this.hud?.toast(this.input.outriggerMode ? 'Stempelmodus: W/S schuiven · E/Q vijzels · 1–4 kiezen · P automatisch' : 'Kraanbediening actief');
        break;
      }
      case 'outriggerAuto': {
        const gb = sim.spec.gb;
        if (gb.outriggerCount === 0 || gb.setupType === 'selfErect') return;
        sim.outriggerAuto.outriggerAuto = sim.crane.outriggerJack.every((j) => j >= 0.999) ? 'retract' : 'deploy';
        this.hud?.toast(sim.outriggerAuto.outriggerAuto === 'deploy' ? 'Automatische procedure: stempels uitzetten' : 'Automatische procedure: stempels inhalen');
        break;
      }
      case 'pause':
      case 'menu':
        if (!this.resultShown) this.togglePause();
        break;
      case 'horn':
        audio.horn();
        break;
      case 'help':
        if (!this.scene?.paused) this.togglePause();
        this.showHelp(true);
        break;
      default:
        break;
    }
  }

  toggleFullscreen(): void {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    } catch {
      this.showNotice('Volledig scherm wordt niet ondersteund in deze browser.');
    }
  }

  private togglePause(): void {
    const sc = this.scene;
    if (!sc || this.session?.mode === 'demo') return;
    if (sc.paused) {
      sc.setPaused(false);
      this.closeOverlay();
      this.input.enabled = true;
      return;
    }
    sc.setPaused(true);
    this.input.enabled = false;
    const sim = sc.sim;
    this.openOverlay(
      h(
        'div',
        { class: 'screen dim', 'data-testid': 'pause-menu' },
        h(
          'div',
          { class: 'dialog panel' },
          h('h2', null, 'Gepauzeerd'),
          h('p', { class: 'muted' }, sim.mission.briefing),
          h('p', null, h('b', null, 'Tip: '), sim.mission.hint),
          h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn primary', onclick: () => this.togglePause(), 'data-testid': 'btn-resume' }, '▶ Hervatten'),
            h('button', { class: 'btn', onclick: () => { this.input.enabled = true; this.restart(); }, 'data-testid': 'btn-restart' }, '↻ Opnieuw beginnen'),
            h('button', { class: 'btn', onclick: () => this.showHelp(true) }, '⌨ Bediening'),
            h('button', { class: 'btn', onclick: () => this.showSettings(true) }, '⚙ Instellingen'),
            h('button', { class: 'btn danger', onclick: () => { this.input.enabled = true; this.closeOverlay(); this.backToMenu(); } }, '✕ Stoppen'),
          ),
        ),
      ),
    );
  }

  backToMenu(): void {
    this.hud?.root.remove();
    this.hud = null;
    this.closeOverlay();
    this.startDemo();
    this.showMainMenu();
    audio.setMachineActive(false);
    audio.startMusic();
  }

  // ------------------------------------------------------------------ schermen

  private closeScreen(): void {
    this.screen?.remove();
    this.screen = null;
  }

  private openScreen(el: HTMLElement): void {
    this.closeScreen();
    this.screen = el;
    this.ui.append(el);
    audio.ui('click');
  }

  private openOverlay(el: HTMLElement): void {
    this.closeOverlay();
    this.overlay = el;
    this.ui.append(el);
  }

  private closeOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private head(title: string, back: () => void, extra: (HTMLElement | null)[] = []): HTMLElement {
    return h(
      'div',
      null,
      h('div', { class: 'hazard' }),
      h('div', { class: 'screen-head' }, h('button', { class: 'btn ghost', onclick: () => { audio.ui('back'); back(); }, 'data-testid': 'btn-back' }, '← Terug'), h('h1', null, title), h('div', { class: 'spacer' }), ...extra, this.walletChip()),
    );
  }

  private walletChip(): HTMLElement {
    const lv = levelFor(this.save.xp);
    return h('div', { class: 'row', style: 'gap:1.2em' }, h('span', null, h('span', { class: 'muted' }, 'Saldo '), h('b', null, formatMoney(this.save.money))), h('span', null, h('span', { class: 'muted' }, `${lv.title} · niveau `), h('b', null, String(lv.level))));
  }

  showMainMenu(): void {
    const lv = levelFor(this.save.xp);
    const next = nextMission(this.save);
    this.openScreen(
      h(
        'div',
        { class: 'screen main-menu', 'data-testid': 'main-menu' },
        h('div', { class: 'logo' }, h('div', { class: 'l1' }, 'Crane Operator'), h('div', { class: 'l2' }, 'Heavy Lift')),
        h(
          'div',
          { class: 'menu-list' },
          h('button', { class: 'btn primary', onclick: () => this.showCareer(), 'data-testid': 'menu-career' }, 'Carrière', h('small', null, next ? `Volgende: ${next.number}. ${next.title}` : 'Alles voltooid')),
          h('button', { class: 'btn', onclick: () => this.showPractice(), 'data-testid': 'menu-practice' }, 'Vrije oefening', h('small', null, 'Sandbox')),
          h('button', { class: 'btn', onclick: () => this.showChallenges() }, 'Uitdagingen', h('small', null, `${CHALLENGES.length} proeven`)),
          h('button', { class: 'btn', onclick: () => this.showFleet() }, 'Vloot & bedrijf', h('small', null, `${this.save.ownedCranes.length} kranen`)),
          h('button', { class: 'btn', onclick: () => this.showProfile() }, 'Licenties & profiel', h('small', null, `${this.save.licenses.length}/7`)),
          h('button', { class: 'btn', onclick: () => this.showSettings(false), 'data-testid': 'menu-settings' }, 'Instellingen'),
          h('button', { class: 'btn', onclick: () => this.showHelp(false) }, 'Bediening & help'),
          h('button', { class: 'btn ghost', onclick: () => this.toggleFullscreen() }, 'Volledig scherm', h('small', null, 'F11')),
        ),
        h('div', { class: 'profile-strip' }, h('span', null, 'Saldo ', h('b', null, formatMoney(this.save.money))), h('span', null, `${lv.title} `, h('b', null, `niv. ${lv.level}`)), h('span', null, 'Sterren ', h('b', null, `${totalStars(this.save)}/120`))),
        h('div', { class: 'version' }, 'v0.1.0 · fictieve machines, spelwaarden'),
      ),
    );
  }

  showCareer(): void {
    const body = h('div', { class: 'screen-body ui-scroll' });
    for (const ch of CHAPTERS) {
      const unlocked = isChapterUnlocked(this.save, ch.number);
      const grid = h('div', { class: 'missions' });
      for (const m of missionsInChapter(ch.number)) {
        const rec = this.save.completed[m.id];
        const open = isMissionUnlocked(this.save, m);
        const crane = getCrane(m.craneOptions[0]);
        grid.append(
          h(
            'button',
            { class: `mcard${rec ? ' done' : ''}`, disabled: !open, onclick: () => this.showPlanning(m), 'data-testid': `mission-${m.id}` },
            h('div', { class: 'num' }, `MISSIE ${String(m.number).padStart(2, '0')}`),
            h('div', { class: 'title' }, m.title),
            h('div', { class: 'meta' }, h('span', null, crane.classLabel), stars(rec?.stars ?? 0)),
            h('div', { class: 'meta' }, h('span', null, `${formatMoney(m.reward.money)} · ${m.reward.xp} XP`), h('span', null, '◆'.repeat(m.difficulty))),
          ),
        );
      }
      const lic = ch.requiresLicense ? LICENSE_LABELS[ch.requiresLicense] : null;
      body.append(
        h(
          'div',
          { class: 'chapter' },
          h('h2', null, `Hoofdstuk ${ch.number} — ${ch.title}`, ' ', unlocked ? null : h('span', { class: 'tag r' }, 'vergrendeld')),
          h('div', { class: 'sub' }, `Fase ${ch.stage}: ${ch.subtitle}`, !unlocked ? ` · vereist: voltooiing vorig hoofdstuk${lic ? ` en ${lic}` : ''}` : ''),
          grid,
        ),
      );
    }
    this.openScreen(h('div', { class: 'screen', 'data-testid': 'career' }, this.head('Carrière', () => this.showMainMenu()), body));
  }

  // ------------------------------------------------------------------ planning

  showPlanning(m: MissionDef, prev?: PlanChoice): void {
    const val = validateMission(m);
    const feas = new Map(val.feasibility.map((f) => [f.craneId, f]));
    const p: PlanChoice = prev ?? {
      craneId: m.craneOptions[0],
      cw: m.crane.counterweightIndex ?? 99,
      boom: m.crane.boomOptionIndex ?? 0,
      jib: m.crane.jibIndex ?? 0,
      difficulty: this.save.settings.difficulty,
    };
    const spec = resolveCrane(getCrane(p.craneId), isOwned(this.save, p.craneId) ? this.save.upgrades[p.craneId] ?? [] : []);
    p.cw = clamp(p.cw, 0, spec.counterweights.length - 1);
    p.boom = clamp(p.boom, 0, Math.max(0, spec.boomOptions.length - 1));
    p.jib = clamp(p.jib, 0, spec.jibOptions.length - 1);
    const plan = m.planning ?? {};
    const rerender = () => this.showPlanning(m, p);
    const choiceRow = (label: string, items: { label: string; sel: boolean; on: () => void; disabled?: boolean }[]) =>
      h('div', null, h('div', { class: 'muted', style: 'font-size:.85em' }, label), h('div', { class: 'choice' }, ...items.map((it) => h('button', { class: `btn small${it.sel ? ' sel' : ''}`, disabled: it.disabled, onclick: () => { it.on(); rerender(); } }, it.label))));

    // kraankeuze
    const craneItems = m.craneOptions.map((cid) => {
      const c = CRANES[cid];
      const f = feas.get(cid);
      return { label: `${c.name}${isOwned(this.save, cid) ? '' : ` (huur ${formatMoney(c.economy.rentPerMission)})`}${f && !f.feasible ? ' ⚠' : ''}`, sel: p.craneId === cid, on: () => { p.craneId = cid; p.cw = 99; p.boom = m.crane.boomOptionIndex ?? 0; } };
    });

    // lastdiagram
    const base = createCraneState(spec, { ...m.crane, counterweightIndex: p.cw, boomOptionIndex: p.boom, jibIndex: p.jib, outriggersDeployed: true, preassembled: true });
    const chart = generateLoadChart(spec, base, { counterweightIndex: p.cw, jibIndex: p.jib, support: spec.gb.footprintOutriggers ? 'outriggers' : 'tires' });
    const heaviest = Math.max(...m.loads.map((l) => getLoad(l.type).massKg)) / 1000 + spec.gb.hookMassKg / 1000;
    const R = plan.plannedRadius;
    let colHl = -1;
    if (R !== undefined) {
      let best = Infinity;
      chart.radii.forEach((r, i) => {
        if (Math.abs(r - R) < best) {
          best = Math.abs(r - R);
          colHl = i;
        }
      });
    }
    const table = h('table', { class: 'chart' }, h('tr', null, h('th', null, spec.cfg.kind === 'tower' ? 'Giek' : spec.cfg.kind === 'knuckle' ? 'Tele' : 'L \\ R'), ...chart.radii.map((r) => h('th', null, `${r} m`))));
    chart.boomLengths.forEach((L, ri) => {
      const isSel = spec.cfg.kind === 'lattice' ? ri === p.boom : false;
      table.append(
        h(
          'tr',
          null,
          h('th', { style: isSel ? 'color:var(--yellow)' : '' }, `${L} m`),
          ...chart.capacity[ri].map((c, ci) => h('td', { class: c === null ? 'na' : ci === colHl && (isSel || spec.cfg.kind !== 'lattice') ? 'hl' : c >= heaviest ? 'ok' : 'bad' }, c === null ? '—' : c.toFixed(1))),
        ),
      );
    });

    // controle op geplande straal
    let check: HTMLElement;
    const f = feas.get(p.craneId);
    if (R !== undefined) {
      const st = { ...base };
      const capAtR = (() => {
        let best = 0;
        for (const L of chart.boomLengths) {
          if (spec.cfg.kind === 'telescopic') st.boomLength = L;
          const c = allowedCapacityT(spec, { ...st, boomAngle: Math.acos(clamp((R - spec.gb.pivotU) / Math.max(L, 1), -1, 1)) }, R);
          best = Math.max(best, c);
        }
        return best;
      })();
      const pct = (heaviest / Math.max(0.01, capAtR)) * 100;
      check = h('div', { class: `check ${pct <= 92 ? 'ok' : pct <= 100 ? 'warn' : 'bad'}` }, `Geplande straal ${R} m: max. ${capAtR.toFixed(1)} t toegestaan — zwaarste last incl. haak ${heaviest.toFixed(1)} t → ${Math.round(pct)} %${pct > 100 ? ' — NIET TOEGESTAAN' : ''}`);
    } else check = h('div', { class: `check ${f?.feasible ? 'ok' : 'bad'}` }, f?.feasible ? `Hijsplan haalbaar (hoogste benodigde belasting ca. ${Math.round(f.peakPercent)} %)` : `Deze configuratie is ongeschikt: ${f?.reasons[0] ?? ''}`);

    const owned = isOwned(this.save, p.craneId);
    const rent = rentCost(this.save, p.craneId);
    const crane = spec.cfg;
    const loadList = h('ul', { style: 'margin:.3em 0 0;padding-left:1.2em' }, ...m.loads.map((l) => {
      const t = getLoad(l.type);
      return h('li', null, `${t.name} — ${(t.massKg / 1000).toFixed(t.massKg < 10000 ? 2 : 1)} t, ${t.width}×${t.height} m, ${t.liftPoints}`);
    }));
    const body = h(
      'div',
      { class: 'screen-body ui-scroll' },
      h(
        'div',
        { class: 'planning' },
        h(
          'section',
          { class: 'panel' },
          h('h3', null, `Missie ${m.number} — briefing`),
          h('p', null, m.briefing),
          h('p', { class: 'muted' }, h('b', null, 'Leerdoel: '), m.learningGoal),
          h('p', { class: 'muted' }, h('b', null, 'Bedieningstip: '), m.hint),
          h('dl', { class: 'kv' },
            h('dt', null, 'Locatie'), h('dd', null, `${ENVIRONMENTS[m.environment].label}`),
            h('dt', null, 'Wind'), h('dd', null, `${m.wind.base} m/s${m.wind.variable ? ' (wisselend)' : ''}`),
            h('dt', null, 'Tijdslimiet'), h('dd', null, m.timeLimit ? `${Math.round(m.timeLimit / 60)} min` : 'geen'),
            h('dt', null, 'Max. schade'), h('dd', null, `${m.maxDamage} %`),
            h('dt', null, 'Moeilijkheid'), h('dd', null, '◆'.repeat(m.difficulty)),
            h('dt', null, 'Beloning'), h('dd', null, `${formatMoney(m.reward.money)} · ${m.reward.xp} XP${m.reward.license ? ` · ${LICENSE_LABELS[m.reward.license]}` : ''}`),
          ),
          h('h3', { style: 'margin-top:1em' }, 'Lasten'),
          loadList,
          h('h3', { style: 'margin-top:1em' }, 'Voorwaarden'),
          h('ul', { style: 'margin:0;padding-left:1.2em' },
            ...[
              m.requirements.outriggers ? 'Stempels volledig uitzetten voor het hijsen' : null,
              m.requirements.noCollision ? 'Geen enkele botsing' : null,
              m.requirements.ordered ? 'Leveringen in de opgegeven volgorde' : null,
              m.requirements.maxLoadPercent ? `Hijsplan: maximaal ${m.requirements.maxLoadPercent} % belasting` : null,
              m.requirements.maxSwayDeg ? `Slingering beperken (< ${m.requirements.maxSwayDeg}°)` : null,
              m.requirements.minGroundFactor ? `Ondergrondfactor minimaal ${m.requirements.minGroundFactor}` : null,
              'Last stabiel, recht en binnen de tolerantie neerzetten',
            ].filter(Boolean).map((t) => h('li', null, t as string)),
          ),
        ),
        h(
          'section',
          { class: 'panel' },
          h('h3', null, 'Kraan en configuratie'),
          m.craneOptions.length > 1 || plan.chooseCrane ? choiceRow('Kraan', craneItems) : null,
          h('div', { style: 'margin-bottom:.6em' }, h('b', null, crane.name), ' ', h('span', { class: 'muted' }, `· ${crane.classLabel}`), ' ', owned ? h('span', { class: 'tag g' }, 'eigen vloot') : h('span', { class: 'tag y' }, `huur ${formatMoney(rent)} — wordt van de beloning afgetrokken`)),
          plan.chooseCounterweight && spec.counterweights.length > 1 ? choiceRow('Contragewicht', spec.counterweights.map((c, i) => ({ label: c.label, sel: p.cw === i, on: () => { p.cw = i; } }))) : h('div', { class: 'muted', style: 'font-size:.85em;margin-bottom:.5em' }, `Contragewicht: ${spec.counterweights[p.cw]?.label ?? '—'} (vast voor deze opdracht)`),
          plan.chooseBoom && spec.boomOptions.length > 1 ? choiceRow('Hoofdgiek (vakwerk)', spec.boomOptions.map((L, i) => ({ label: `${L} m`, sel: p.boom === i, on: () => { p.boom = i; } }))) : null,
          (plan.chooseBoom || plan.chooseJib) && spec.jibOptions.length > 1 ? choiceRow('Hulpgiek', spec.jibOptions.map((L, i) => ({ label: L === 0 ? 'geen' : `${L} m`, sel: p.jib === i, on: () => { p.jib = i; } }))) : null,
          choiceRow('Moeilijkheidsgraad', (Object.keys(DIFFICULTIES) as DifficultyId[]).map((d) => ({ label: DIFFICULTIES[d].label, sel: p.difficulty === d, on: () => { p.difficulty = d; this.save.settings.difficulty = d; this.persist(); } }))),
          h('div', { class: 'muted', style: 'font-size:.85em' }, DIFFICULTIES[p.difficulty].description),
          h('h3', { style: 'margin-top:1em' }, `Lastdiagram (t) — ${spec.counterweights[p.cw]?.label ?? ''} ${spec.gb.footprintOutriggers ? 'op stempels' : ''}, in lijn met onderwagen`),
          h('div', { class: 'ui-scroll', style: 'overflow:auto' }, table),
          h('div', { class: 'muted', style: 'font-size:.78em;margin-top:.3em' }, 'Spelwaarden afgeleid uit het stabiliteitsmodel (75 % van de kantellast) en de structurele grens; geen fabrikantgegevens. Groen = zwaarste last past, rood = te zwaar.'),
          check,
          h('div', { class: 'row', style: 'margin-top:1.2em' }, h('button', { class: 'btn primary', onclick: () => this.startMission(m, p), 'data-testid': 'btn-start' }, '▶ Start opdracht'), h('button', { class: 'btn', onclick: () => this.showCareer() }, 'Annuleren')),
        ),
      ),
    );
    this.openScreen(h('div', { class: 'screen', 'data-testid': 'planning' }, this.head(`${m.number}. ${m.title}`, () => this.showCareer()), body));
  }

  // ------------------------------------------------------------------ resultaten

  private showResults(sim: Simulation): void {
    const sc = this.scene;
    sc?.setPaused(true);
    this.input.enabled = false;
    const mode = this.session?.mode ?? 'career';
    const success = sim.outcome === 'success';
    const score = sim.score!;
    let payout: Payout | null = null;
    let challengeLine: HTMLElement | null = null;
    const m = sim.mission;
    if (success && mode === 'career') {
      const lifted = m.loads.reduce((a, l) => a + getLoad(l.type).massKg / 1000, 0);
      payout = applyMissionResult(this.save, m, score, sim.time, sim.spec.cfg.id, sim.metrics.damage, lifted);
      this.persist();
    } else if (mode === 'career') {
      payout = null;
    }
    if (mode === 'challenge' && this.session?.challengeId) {
      const ch = CHALLENGES.find((c) => c.id === this.session!.challengeId)!;
      const r = ch.rate(sim.metrics);
      const val = success && r.pass ? r.score : 0;
      const prevBest = this.save.challengeBest[ch.id] ?? 0;
      if (val > prevBest) {
        this.save.challengeBest[ch.id] = val;
        this.persist();
      }
      challengeLine = h('div', { class: `check ${success && r.pass ? 'ok' : 'bad'}` }, `${ch.title}: ${r.value} → ${val} punten${val > prevBest ? ' (nieuw record!)' : ` (record ${prevBest})`}`);
    }
    const breakdown = h('div', { class: 'score-grid' });
    for (const k of Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]) {
      const v = Math.round(score[k]);
      breakdown.append(h('div', null, `${SCORE_LABELS[k]} (${Math.round(SCORE_WEIGHTS[k] * 100)} %)`, h('div', { class: 'bar' }, h('i', { style: `width:${v}%` }))), h('div', { style: 'font-family:var(--mono)' }, `${v}`));
    }
    const next = mode === 'career' && success ? MISSIONS.find((x) => x.number === m.number + 1) : undefined;
    const pay = payout
      ? h(
          'div',
          { class: 'payout' },
          h('div', null, h('span', null, 'Basisbeloning'), h('span', null, formatMoney(payout.baseMoney))),
          payout.starBonus !== 0 ? h('div', null, h('span', null, 'Sterrenfactor'), h('span', null, `${payout.starBonus >= 0 ? '+' : ''}${formatMoney(payout.starBonus)}`)) : null,
          payout.repeatPenalty > 0 ? h('div', null, h('span', null, 'Herhaalde opdracht (35 %)'), h('span', null, `−${formatMoney(payout.repeatPenalty)}`)) : null,
          payout.rent > 0 ? h('div', null, h('span', null, 'Kraanhuur'), h('span', null, `−${formatMoney(payout.rent)}`)) : null,
          h('div', { class: 'tot' }, h('span', null, 'Uitbetaald'), h('span', null, `${formatMoney(payout.money)} · +${payout.xp} XP`)),
          payout.newLicense ? h('div', { style: 'color:var(--green)' }, h('span', null, `Nieuwe licentie: ${LICENSE_LABELS[m.reward.license!]}`), h('span', null, '✓')) : null,
          payout.newLivery ? h('div', { style: 'color:var(--green)' }, h('span', null, `Speciale uitvoering vrijgespeeld: ${LIVERIES[m.reward.livery!]?.label}`), h('span', null, '✓')) : null,
          payout.wear > 0 ? h('div', { class: 'muted' }, h('span', null, 'Slijtage eigen kraan'), h('span', null, `conditie ${Math.round((this.save.craneCondition[sim.spec.cfg.id] ?? 1) * 100)} %`)) : null,
        )
      : null;
    this.openOverlay(
      h(
        'div',
        { class: 'screen dim', 'data-testid': success ? 'result-success' : 'result-fail' },
        h(
          'div',
          { class: 'dialog panel' },
          h('h2', null, success ? 'Opdracht voltooid' : 'Opdracht mislukt'),
          success ? h('div', { class: 'big-stars' }, stars(score.stars)) : h('div', { class: 'check bad' }, sim.failReason),
          h('div', { class: 'muted' }, `Totaalscore ${score.total}/100 · tijd ${sim.time.toFixed(0)} s · max. slinger ${sim.metrics.maxSwayDeg.toFixed(1)}° · botsingen ${sim.metrics.collisions} · schade ${sim.metrics.damage.toFixed(1)} % · max. belasting ${Math.round(sim.metrics.maxLoadPct)} %`),
          breakdown,
          challengeLine,
          pay,
          mode === 'practice' ? h('p', { class: 'muted' }, 'Vrije oefening: geen beloning, wel een score.') : null,
          h(
            'div',
            { class: 'row', style: 'margin-top:1.2em' },
            next && isMissionUnlocked(this.save, next) ? h('button', { class: 'btn primary', onclick: () => { this.input.enabled = true; this.closeOverlay(); this.showPlanning(next); }, 'data-testid': 'btn-next' }, 'Volgende opdracht →') : null,
            h('button', { class: `btn${next ? '' : ' primary'}`, onclick: () => { this.input.enabled = true; this.restart(); }, 'data-testid': 'btn-retry' }, '↻ Opnieuw'),
            mode === 'career' ? h('button', { class: 'btn', onclick: () => { this.input.enabled = true; this.closeOverlay(); this.showPlanning(m, this.plan ?? undefined); } }, 'Planning') : null,
            h('button', { class: 'btn', onclick: () => { this.input.enabled = true; this.backToMenu(); if (mode === 'career') this.showCareer(); } }, mode === 'career' ? 'Carrière' : 'Menu'),
          ),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------ vrije oefening & uitdagingen

  showPractice(): void {
    const available = CRANE_IDS.filter((c) => isOwned(this.save, c) || CRANES[c].suitableMissions.some((n) => {
      const m = MISSIONS.find((x) => x.number === n);
      return m && isMissionUnlocked(this.save, m);
    }));
    const state = { craneId: available[0] ?? 'at60', load: 'pallet500', env: 'trainingYard' as EnvironmentId, wind: 0, gravity: GRAVITY, difficulty: this.save.settings.difficulty };
    const sel = (opts: [string, string][], val: string, on: (v: string) => void, testid?: string) => {
      const s = h('select', { 'data-testid': testid }, ...opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));
      s.addEventListener('change', () => on(s.value));
      return s;
    };
    const num = (val: number, min: number, max: number, step: number, on: (v: number) => void) => {
      const i = h('input', { type: 'range', min, max, step, value: val }) as HTMLInputElement;
      const out = h('b', null, String(val));
      i.addEventListener('input', () => {
        on(Number(i.value));
        out.textContent = i.value;
      });
      return h('span', { class: 'row' }, i, out);
    };
    const body = h(
      'div',
      { class: 'screen-body' },
      h(
        'div',
        { class: 'settings' },
        h(
          'section',
          { class: 'panel' },
          h('h3', null, 'Opstelling'),
          h('label', { class: 'line' }, 'Kraan', sel(CRANE_IDS.map((c) => [c, `${CRANES[c].name} — ${CRANES[c].classLabel}${available.includes(c) ? '' : ' 🔒'}`]), state.craneId, (v) => { state.craneId = v as CraneId; }, 'practice-crane')),
          h('label', { class: 'line' }, 'Last', sel(Object.values(LOADS).map((l) => [l.id, `${l.name} (${(l.massKg / 1000).toFixed(1)} t)`]), state.load, (v) => { state.load = v; })),
          h('label', { class: 'line' }, 'Omgeving', sel((Object.keys(ENVIRONMENTS) as EnvironmentId[]).map((e) => [e, ENVIRONMENTS[e].label]), state.env, (v) => { state.env = v as EnvironmentId; })),
          h('label', { class: 'line' }, 'Wind (m/s)', num(state.wind, 0, 20, 1, (v) => { state.wind = v; })),
          h('label', { class: 'line' }, 'Zwaartekracht (m/s²)', num(state.gravity, 1.6, 15, 0.1, (v) => { state.gravity = v; })),
          h('label', { class: 'line' }, 'Moeilijkheid', sel((Object.keys(DIFFICULTIES) as DifficultyId[]).map((d) => [d, DIFFICULTIES[d].label]), state.difficulty, (v) => { state.difficulty = v as DifficultyId; })),
          h('p', { class: 'muted' }, 'Geen timer. Kranen met 🔒 speel je vrij in de carrière of door ze te kopen.'),
          h('button', {
            class: 'btn primary',
            'data-testid': 'btn-practice-start',
            onclick: () => {
              if (!available.includes(state.craneId)) {
                audio.ui('error');
                this.showNotice('Deze kraan is nog niet vrijgespeeld. Speel de bijbehorende carrièremissies of koop de kraan.');
                return;
              }
              const m = practiceMission({ craneId: state.craneId, loadType: state.load, environment: state.env, windBase: state.wind, gravity: state.gravity });
              this.startPlay({ mode: 'practice', sim: { mission: m, craneId: state.craneId, difficulty: DIFFICULTIES[state.difficulty], gravity: state.gravity, freePlay: true, upgrades: this.save.upgrades[state.craneId] ?? [] }, livery: this.save.activeLivery });
            },
          }, '▶ Start oefening'),
        ),
      ),
    );
    this.openScreen(h('div', { class: 'screen', 'data-testid': 'practice' }, this.head('Vrije oefening', () => this.showMainMenu()), body));
  }

  showChallenges(): void {
    const grid = h('div', { class: 'missions' });
    for (const c of CHALLENGES) {
      const unlocked = isCompleted(this.save, c.baseMissionId);
      const best = this.save.challengeBest[c.id] ?? 0;
      grid.append(
        h('button', { class: 'mcard', disabled: !unlocked, onclick: () => this.startChallenge(c) },
          h('div', { class: 'num' }, c.kind.toUpperCase()),
          h('div', { class: 'title' }, c.title),
          h('div', { class: 'meta' }, h('span', null, c.description)),
          h('div', { class: 'meta' }, h('span', null, unlocked ? `Record: ${best} punten` : `Vrij na missie ${MISSIONS.find((m) => m.id === c.baseMissionId)?.number}`)),
        ),
      );
    }
    this.openScreen(h('div', { class: 'screen' }, this.head('Uitdagingen', () => this.showMainMenu()), h('div', { class: 'screen-body ui-scroll' }, grid)));
  }

  private startChallenge(c: ChallengeDef): void {
    const m = challengeMission(c);
    const craneId = m.craneOptions[0];
    this.startPlay({ mode: 'challenge', challengeId: c.id, sim: { mission: m, craneId, difficulty: DIFFICULTIES[this.save.settings.difficulty], upgrades: isOwned(this.save, craneId) ? this.save.upgrades[craneId] ?? [] : [] }, livery: this.save.activeLivery });
  }

  // ------------------------------------------------------------------ vloot

  showFleet(): void {
    const grid = h('div', { class: 'fleet' });
    for (const id of CRANE_IDS) {
      const c = CRANES[id];
      const owned = isOwned(this.save, id);
      const buy = canBuyCrane(this.save, id);
      const cond = this.save.craneCondition[id] ?? 1;
      const ups = h('div', { class: 'upgrades' });
      for (const u of c.upgrades) {
        const has = (this.save.upgrades[id] ?? []).includes(u);
        const can = canBuyUpgrade(this.save, id, u);
        ups.append(h('div', { class: 'u' }, h('span', { title: UPGRADES[u].description }, has ? '✓ ' : '', UPGRADES[u].name, h('br'), h('span', { class: 'muted', style: 'font-size:.85em' }, UPGRADES[u].description)), has ? h('span', { class: 'tag g' }, 'actief') : h('button', { class: 'btn small', disabled: !can.ok, title: can.ok ? '' : can.reason, onclick: () => { buyUpgrade(this.save, id, u); this.persist(); audio.ui('confirm'); this.showFleet(); } }, formatMoney(upgradePrice(c, u)))));
      }
      const refSpecs = Object.entries(c.reference.publicSpecs).map(([k, v]) => `${k}: ${v}`).join(' · ');
      grid.append(
        h(
          'div',
          { class: 'ccard panel' },
          h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', null, c.name), owned ? h('span', { class: 'tag g' }, 'in vloot') : h('span', { class: 'tag' }, `huur ${formatMoney(c.economy.rentPerMission)}/opdracht`)),
          h('div', { class: 'cls' }, c.classLabel),
          h('div', { class: 'desc' }, c.description),
          h('div', { class: 'ref' }, `Referentie: ${c.reference.model} (${refSpecs}). ${c.reference.note}`),
          h('div', { class: 'dgrid', style: 'font-size:.8em' },
            h('span', { class: 'k' }, 'Max. capaciteit (spel)'), h('span', { class: 'v' }, `${c.gameBalance.maxCapacityT} t`),
            h('span', { class: 'k' }, c.kind === 'tower' ? 'Giek' : 'Giek'), h('span', { class: 'v' }, c.kind === 'tower' ? `${c.gameBalance.jibLength} m` : c.kind === 'knuckle' ? `${((c.gameBalance.arm1Length ?? 0) + (c.gameBalance.arm2Length ?? 0) + (c.gameBalance.knuckleTeleMax ?? 0)).toFixed(1)} m` : `${c.gameBalance.boomMin}–${c.gameBalance.boomMax} m`),
            h('span', { class: 'k' }, 'Hijssnelheid'), h('span', { class: 'v' }, `${c.gameBalance.hoistSpeed} m/s`),
            h('span', { class: 'k' }, 'Opbouwtijd'), h('span', { class: 'v' }, `${c.gameBalance.setupTime} s`),
          ),
          owned
            ? h('div', null, h('div', { class: 'row', style: 'justify-content:space-between;font-size:.85em' }, h('span', null, `Conditie ${Math.round(cond * 100)} %`), h('button', { class: 'btn small', disabled: repairCost(this.save, id) <= 0 || this.save.money < repairCost(this.save, id), onclick: () => { repairCrane(this.save, id); this.persist(); audio.ui('confirm'); this.showFleet(); } }, `Onderhoud ${formatMoney(repairCost(this.save, id))}`)), h('div', { class: 'cond' }, h('i', { style: `width:${cond * 100}%;background:${cond < 0.4 ? 'var(--red)' : cond < 0.7 ? 'var(--yellow)' : 'var(--green)'}` })))
            : h('div', { class: 'row' }, h('button', { class: 'btn primary', disabled: !buy.ok, onclick: () => { const r = buyCrane(this.save, id); if (r.ok) { this.persist(); audio.ui('confirm'); this.showFleet(); } } }, `Kopen ${formatMoney(c.economy.buyPrice)}`), !buy.ok ? h('span', { class: 'muted', style: 'font-size:.85em' }, buy.reason, c.economy.requiredLicense && !this.save.licenses.includes(c.economy.requiredLicense) ? ` (${LICENSE_LABELS[c.economy.requiredLicense]})` : '') : null),
          h('h4', { style: 'margin:.4em 0 0;color:var(--yellow);font-size:.75em;letter-spacing:.1em;text-transform:uppercase' }, 'Upgrades'),
          ups,
        ),
      );
    }
    const liv = h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Kraanuitvoering:'), ...this.save.liveries.map((l) => h('button', { class: `btn small${this.save.activeLivery === l ? ' primary' : ''}`, onclick: () => { this.save.activeLivery = l; this.persist(); this.showFleet(); } }, LIVERIES[l]?.label ?? l)));
    this.openScreen(h('div', { class: 'screen' }, this.head('Vloot & bedrijf', () => this.showMainMenu()), h('div', { class: 'screen-body ui-scroll' }, h('p', { class: 'muted' }, 'Eigen kranen kosten geen huur, slijten per opdracht en kunnen worden geüpgraded. Prijzen zijn spelwaarden.'), liv, h('div', { style: 'height:1em' }), grid)));
  }

  showProfile(): void {
    const lv = levelFor(this.save.xp);
    const lic = h('div', { class: 'missions' }, ...(Object.keys(LICENSE_LABELS) as (keyof typeof LICENSE_LABELS)[]).map((k) => h('div', { class: `mcard${this.save.licenses.includes(k) ? ' done' : ''}` }, h('div', { class: 'title' }, LICENSE_LABELS[k]), h('div', { class: 'meta' }, this.save.licenses.includes(k) ? 'behaald' : 'nog niet behaald'))));
    const st = this.save.stats;
    this.openScreen(
      h('div', { class: 'screen' }, this.head('Licenties & profiel', () => this.showMainMenu()), h('div', { class: 'screen-body ui-scroll' },
        h('div', { class: 'panel', style: 'padding:1em 1.2em;margin-bottom:1em' },
          h('h3', { style: 'margin-top:0' }, `${lv.title} — niveau ${lv.level}`),
          h('div', { class: 'lmi' }, h('div', { class: 'bar' }, h('div', { class: 'fill c', style: `width:${((this.save.xp - lv.xpForLevel) / Math.max(1, lv.xpForNext - lv.xpForLevel)) * 100}%` })), h('div', { class: 'row2' }, h('span', null, `${this.save.xp} XP`), h('span', null, `volgend niveau ${lv.xpForNext} XP`))),
          h('p', { class: 'muted' }, `Hijsen: ${st.lifts} · totaal gehesen: ${st.tonnage.toFixed(1)} t · speeltijd: ${Math.round(st.playTime / 60)} min · sterren: ${totalStars(this.save)}/120`),
          this.save.certificates.length ? h('p', null, 'Certificaten: ', this.save.certificates.join(', ')) : null,
        ),
        lic,
        h('div', { class: 'row', style: 'margin-top:1.5em' }, h('button', { class: 'btn danger', onclick: () => { if (window.confirm('Weet je zeker dat je alle voortgang wilt wissen?')) { this.resetProgress(); } } }, 'Voortgang wissen')),
      )),
    );
  }

  private resetProgress(): void {
    const settings = this.save.settings;
    const fresh = loadGame({ getItem: () => null, setItem: () => undefined, removeItem: () => undefined }).data;
    fresh.settings = settings;
    this.save = fresh;
    this.persist();
    this.showMainMenu();
  }

  // ------------------------------------------------------------------ instellingen & help

  showSettings(inGame: boolean): void {
    const s = this.save.settings;
    const slider = (label: string, val: number, on: (v: number) => void) => {
      const i = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: val }) as HTMLInputElement;
      i.addEventListener('input', () => {
        on(Number(i.value));
        audio.setMix({ master: s.masterVolume, music: s.musicVolume, sfx: s.sfxVolume });
        this.persist();
      });
      return h('label', { class: 'line' }, label, i);
    };
    const toggle = (label: string, val: boolean, on: (v: boolean) => void) => {
      const i = h('input', { type: 'checkbox', checked: val }) as HTMLInputElement;
      i.addEventListener('change', () => {
        on(i.checked);
        this.persist();
      });
      return h('label', { class: 'line' }, label, i);
    };
    const binds = h('div', { class: 'ui-scroll', style: 'max-height:24em;overflow:auto' });
    for (const a of Object.keys(DEFAULT_BINDINGS) as ActionId[]) {
      const b = h('button', { class: 'btn small', 'data-testid': `bind-${a}` }, s.bindings[a].map(keyLabel).join(' / '));
      b.addEventListener('click', () => {
        b.classList.add('listening');
        b.textContent = 'druk een toets…';
        const onKey = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopPropagation();
          window.removeEventListener('keydown', onKey, true);
          if (e.code !== 'Escape') s.bindings[a] = [e.code];
          this.input.setBindings(s.bindings);
          this.persist();
          b.classList.remove('listening');
          b.textContent = s.bindings[a].map(keyLabel).join(' / ');
        };
        window.addEventListener('keydown', onKey, true);
      });
      binds.append(h('div', { class: 'bind' }, h('span', null, ACTION_LABELS[a]), b));
    }
    const diff = h('select', null, ...(Object.keys(DIFFICULTIES) as DifficultyId[]).map((d) => h('option', { value: d, selected: s.difficulty === d }, DIFFICULTIES[d].label)));
    diff.addEventListener('change', () => {
      s.difficulty = diff.value as DifficultyId;
      this.persist();
    });
    const content = h(
      'div',
      { class: 'settings' },
      h('section', { class: 'panel' }, h('h3', null, 'Audio'), slider('Mastervolume', s.masterVolume, (v) => (s.masterVolume = v)), slider('Muziek', s.musicVolume, (v) => (s.musicVolume = v)), slider('Geluidseffecten', s.sfxVolume, (v) => (s.sfxVolume = v)), !audio.available ? h('p', { class: 'muted' }, 'Audio start na de eerste klik of toetsaanslag.') : null),
      h('section', { class: 'panel' }, h('h3', null, 'Gameplay & weergave'), h('label', { class: 'line' }, 'Standaard moeilijkheid', diff), toggle('Camerabeweging bij zware lasten', s.cameraShake, (v) => (s.cameraShake = v)), toggle('Bedieningshints in beeld', s.showHints, (v) => (s.showHints = v)), toggle('Deeltjes (stof, rook, vonken)', s.particles, (v) => (s.particles = v)), h('div', { class: 'row', style: 'margin-top:.6em' }, h('button', { class: 'btn small', onclick: () => this.toggleFullscreen() }, 'Volledig scherm'))),
      h('section', { class: 'panel' }, h('h3', null, 'Besturing'), h('p', { class: 'muted', style: 'font-size:.85em' }, 'Klik op een toets om die te wijzigen. Esc annuleert.'), binds, h('button', { class: 'btn small', style: 'margin-top:.6em', onclick: () => { s.bindings = structuredClone(DEFAULT_BINDINGS); this.input.setBindings(s.bindings); this.persist(); this.showSettings(inGame); } }, 'Standaardbesturing herstellen')),
    );
    if (inGame) {
      this.openOverlay(h('div', { class: 'screen dim' }, h('div', { class: 'dialog panel', style: 'width:min(1100px,95vw)' }, h('h2', null, 'Instellingen'), content, h('div', { class: 'row', style: 'margin-top:1em' }, h('button', { class: 'btn primary', onclick: () => { this.closeOverlay(); this.scene?.setPaused(false); this.input.enabled = true; } }, 'Hervatten')))));
    } else this.openScreen(h('div', { class: 'screen', 'data-testid': 'settings' }, this.head('Instellingen', () => this.showMainMenu()), h('div', { class: 'screen-body ui-scroll' }, content)));
  }

  showHelp(inGame: boolean): void {
    const b = this.save.settings.bindings;
    const sec = (title: string, rows: [ActionId[], string][]) => h('section', { class: 'panel' }, h('h3', null, title), ...rows.map(([keys, label]) => h('div', { class: 'bind' }, h('span', null, label), h('span', null, ...keys.map((k) => kbd(keyLabel(b[k][0] ?? '?')))))));
    const content = h(
      'div',
      { class: 'help-grid' },
      sec('Mobiele telescoopkraan / rupskraan', [[['boomUp', 'boomDown'], 'Giek omhoog / omlaag'], [['slewLeft', 'slewRight'], 'Bovenwagen draaien'], [['hoistDown', 'hoistUp'], 'Kabel vieren / hijsen'], [['teleOut', 'teleIn'], 'Telescoop uit / in'], [['driveLeft', 'driveRight'], 'Rijden (stempels in)'], [['precision'], 'Precisiebediening (vasthouden)']]),
      sec('Torenkraan', [[['slewLeft', 'slewRight'], 'Giek draaien'], [['trolleyOut', 'trolleyIn'], 'Loopkat naar buiten / binnen'], [['hoistDown', 'hoistUp'], 'Vieren / hijsen'], [['setup'], 'Opbouwprocedure (zelfopbouw)']]),
      sec('Knikarmkraan', [[['boomUp', 'boomDown'], 'Hoofdarm'], [['knuckleUp', 'knuckleDown'], 'Knikarm'], [['knuckleTeleOut', 'knuckleTeleIn'], 'Telescoopsegmenten'], [['hoistDown', 'hoistUp'], 'Lier'], [['slewLeft', 'slewRight'], 'Kolom draaien']]),
      sec('Stempels', [[['outriggerMode'], 'Stempelmodus aan/uit'], [['boomUp', 'boomDown'], 'Geselecteerde stempel uit / in'], [['hoistUp', 'hoistDown'], 'Vijzel neer / op'], [['outriggerAuto'], 'Automatische procedure']]),
      sec('Algemeen & camera', [[['rigging'], 'Last aanslaan / afkoppelen'], [['pause'], 'Pauze'], [['menu'], 'Menu'], [['zoomIn', 'zoomOut'], 'Zoomen (ook muiswiel)'], [['overview'], 'Overzichtsmodus'], [['cameraMode'], 'Volgcamera / cabinezicht'], [['cameraReset'], 'Camera herstellen (ook dubbelklik)'], [['horn'], 'Claxon']]),
      h('section', { class: 'panel' }, h('h3', null, 'Muis'), h('div', { class: 'bind' }, h('span', null, 'Camera draaien'), h('span', null, 'linkermuisknop slepen')), h('div', { class: 'bind' }, h('span', null, 'Camera verschuiven'), h('span', null, 'rechtermuisknop slepen')), h('div', { class: 'bind' }, h('span', null, 'Zoomen'), h('span', null, 'muiswiel'))),
      h('section', { class: 'panel' }, h('h3', null, 'Werkwijze'), h('ol', { style: 'margin:0;padding-left:1.2em;line-height:1.5' },
        h('li', null, 'Zet de stempels volledig uit (O, daarna P voor automatisch).'),
        h('li', null, 'Breng de haak boven de last; laat zakken tot de prompt verschijnt en druk T.'),
        h('li', null, 'Hijs ruim boven obstakels, beweeg rustig en let op de belasting (LMI).'),
        h('li', null, 'Laat de last uitslingeren boven de zone, zet hem stil en recht neer.'),
        h('li', null, 'Vier de kabel tot hij ontlast is: na 1,5 s stabiel telt de levering.'),
      )),
    );
    const done = () => {
      if (inGame) {
        this.closeOverlay();
        this.scene?.setPaused(false);
        this.input.enabled = true;
      } else this.showMainMenu();
    };
    if (inGame) this.openOverlay(h('div', { class: 'screen dim' }, h('div', { class: 'dialog panel', style: 'width:min(1100px,95vw)' }, h('h2', null, 'Bediening'), content, h('div', { class: 'row', style: 'margin-top:1em' }, h('button', { class: 'btn primary', onclick: done }, 'Hervatten')))));
    else this.openScreen(h('div', { class: 'screen' }, this.head('Bediening & help', () => this.showMainMenu()), h('div', { class: 'screen-body ui-scroll' }, content)));
  }

  /** Testhaak voor end-to-end-tests en debugging. */
  debugApi(): Record<string, unknown> {
    return {
      sim: () => this.scene?.sim ?? null,
      save: () => this.save,
      state: () => {
        const s = this.scene?.sim;
        if (!s) return null;
        const hp = s.hookPoint();
        return {
          mission: s.mission.id,
          outcome: s.outcome,
          tip: s.geom.tip,
          hook: hp,
          attached: s.attached?.id ?? null,
          candidate: s.attachCandidate()?.id ?? null,
          tasks: s.tasks.map((t) => t.status),
          loadPct: s.loadPct,
          sway: s.swayDeg,
          paused: this.scene?.paused ?? false,
          time: s.time,
          ropeLength: s.rope.length,
          boomAngle: s.crane.boomAngle,
          boomLength: s.crane.boomLength,
          support: s.support.mode,
          loads: s.loads.map((l) => ({ id: l.id, x: l.cb.body.pos.x, y: l.cb.body.pos.y, status: l.status })),
          warnings: s.warnings.top(3).map((w) => w.id),
        };
      },
      startMission: (id: string, difficulty: DifficultyId = 'practice') => {
        const m = MISSIONS.find((x) => x.id === id);
        if (m) this.startMission(m, { craneId: m.craneOptions[0], cw: m.crane.counterweightIndex ?? 99, boom: m.crane.boomOptionIndex ?? 0, jib: m.crane.jibIndex ?? 0, difficulty });
      },
      validate: () => MISSIONS.map((m) => ({ id: m.id, ok: validateMission(m).issues.every((i) => i.severity !== 'error') })),
      computePayout,
    };
  }
}
