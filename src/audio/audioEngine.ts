/**
 * Audio via WebAudio: lagen van echte CC0-opnames (BigSoundBank, zie public/assets/LICENSE-ASSETS.md)
 * met ruimtelijke weergave en een cabinedemping, met procedurele synthese als terugval zolang de
 * opnames laden of als ze niet beschikbaar zijn. Faalt WebAudio, dan is alles een no-op.
 */
const SAMPLE_BASE = `${import.meta.env?.BASE_URL ?? '/'}assets/audio/`;
const LOOPS = ['diesel', 'telehandler', 'hydraulic', 'winch', 'creak', 'wind', 'ambience'] as const;
const SHOTS = ['chain', 'chainHeavy', 'steelFall', 'anvil', 'reverse', 'radioStart', 'radioCrackle', 'alarm', 'horn'] as const;
type LoopId = (typeof LOOPS)[number];
type ShotId = (typeof SHOTS)[number];

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}
export interface AudioMix {
  master: number;
  music: number;
  sfx: number;
}

export interface MachineSound {
  /** Motorbelasting 0..1 */
  engine: number;
  /** Hydrauliekactiviteit 0..1 */
  hydraulic: number;
  /** Liersnelheid −1..1 */
  winch: number;
  /** Windsnelheid (m/s) */
  wind: number;
  /** Rijden 0..1 */
  drive: number;
  /** Belasting van de kraan (%), voor gekraak van de giek. */
  loadPct?: number;
  /** Rijdt de kraan achteruit (achteruitrijpiep)? */
  reversing?: boolean;
  /** Plaats van de machine (bovenwagen) in de wereld. */
  pos?: Vec3Like;
}

type Ctx = AudioContext;

export class AudioEngine {
  private ctx: Ctx | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private engineOsc!: OscillatorNode;
  private engineOsc2!: OscillatorNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private hydGain!: GainNode;
  private hydFilter!: BiquadFilterNode;
  private winchOsc!: OscillatorNode;
  private winchGain!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private ambientGain!: GainNode;
  private noiseBuf: AudioBuffer | null = null;
  private mix: AudioMix = { master: 0.8, music: 0.35, sfx: 0.8 };
  private machineActive = false;
  private musicTimer: number | null = null;
  private ambientTimer: number | null = null;
  private failed = false;
  // opnames
  private buffers = new Map<string, AudioBuffer>();
  private loops = new Map<LoopId, { src: AudioBufferSourceNode; gain: GainNode }>();
  private samplesReady = false;
  private loading = false;
  /** Bus voor de machine (ruimtelijk, bij de kraan) en een dempfilter voor de cabine. */
  private machineBus!: GainNode;
  private machinePanner!: PannerNode;
  private cabinFilter!: BiquadFilterNode;
  private duckGain!: GainNode;
  private inside = false;
  private reverseTimer: number | null = null;
  private lastAlarm = 0;

  /** Start de audiocontext (moet na een gebruikersinteractie). */
  unlock(): void {
    if (this.failed) return;
    try {
      if (!this.ctx) this.build();
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.failed = true;
      this.ctx = null;
    }
  }

  get available(): boolean {
    return !!this.ctx;
  }

  private build(): void {
    const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) {
      this.failed = true;
      return;
    }
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.applyMix();

    // cabinedemping op alles en een ruimtelijke machinebus (geluid komt van de kraan)
    this.cabinFilter = ctx.createBiquadFilter();
    this.cabinFilter.type = 'lowpass';
    this.cabinFilter.frequency.value = 18000;
    this.duckGain = ctx.createGain();
    this.sfxBus.disconnect();
    this.sfxBus.connect(this.cabinFilter).connect(this.duckGain).connect(this.master);
    this.machinePanner = ctx.createPanner();
    this.machinePanner.panningModel = 'equalpower';
    this.machinePanner.distanceModel = 'inverse';
    this.machinePanner.refDistance = 10;
    this.machinePanner.rolloffFactor = 0.8;
    this.machineBus = ctx.createGain();
    this.machineBus.connect(this.machinePanner).connect(this.sfxBus);
    void this.loadSamples();

    // ruisbuffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      b = 0.97 * b + 0.03 * (Math.random() * 2 - 1);
      data[i] = b * 6 + (Math.random() * 2 - 1) * 0.15;
    }

    // dieselmotor: twee zaagtanden + laagdoorlaat
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 220;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 38;
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.value = 19;
    const e2g = ctx.createGain();
    e2g.gain.value = 0.4;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(e2g).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.machineBus);
    this.engineOsc.start();
    this.engineOsc2.start();

    // hydrauliek: gefilterde ruis
    const hydSrc = this.loopNoise();
    this.hydFilter = ctx.createBiquadFilter();
    this.hydFilter.type = 'bandpass';
    this.hydFilter.frequency.value = 900;
    this.hydFilter.Q.value = 3;
    this.hydGain = ctx.createGain();
    this.hydGain.gain.value = 0;
    hydSrc.connect(this.hydFilter).connect(this.hydGain).connect(this.machineBus);

    // lier
    this.winchOsc = ctx.createOscillator();
    this.winchOsc.type = 'triangle';
    this.winchOsc.frequency.value = 120;
    this.winchGain = ctx.createGain();
    this.winchGain.gain.value = 0;
    this.winchOsc.connect(this.winchGain).connect(this.machineBus);
    this.winchOsc.start();

    // wind
    const windSrc = this.loopNoise();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(this.windFilter).connect(this.windGain).connect(this.sfxBus);

    // omgeving (verre bouwplaats)
    const ambSrc = this.loopNoise();
    const ambF = ctx.createBiquadFilter();
    ambF.type = 'lowpass';
    ambF.frequency.value = 260;
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0;
    ambSrc.connect(ambF).connect(this.ambientGain).connect(this.sfxBus);
  }

  /** Laad en decodeer de opnames; start de loops stil (gain 0). */
  private async loadSamples(): Promise<void> {
    if (!this.ctx || this.loading) return;
    this.loading = true;
    const ctx = this.ctx;
    const ids = [...LOOPS, ...SHOTS];
    await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetch(`${SAMPLE_BASE}${id}.m4a`);
          if (!res.ok) return;
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(id, buf);
        } catch {
          /* geen opname: synthese blijft */
        }
      }),
    );
    for (const id of LOOPS) {
      const buf = this.buffers.get(id);
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      // machinegeluid ruimtelijk, wind en omgeving om de luisteraar heen
      src.connect(gain).connect(id === 'wind' || id === 'ambience' ? this.sfxBus : this.machineBus);
      src.start(0, Math.random() * Math.max(0, buf.duration - 0.5));
      this.loops.set(id, { src, gain });
    }
    this.samplesReady = this.buffers.has('diesel');
  }

  private loopGain(id: LoopId, v: number, rate?: number, tc = 0.12): void {
    const l = this.loops.get(id);
    if (!l || !this.ctx) return;
    const t = this.ctx.currentTime;
    l.gain.gain.setTargetAtTime(v, t, tc);
    if (rate !== undefined) l.src.playbackRate.setTargetAtTime(rate, t, 0.15);
  }

  /** Speel een opname eenmalig af, optioneel op een plek in de wereld. */
  private shot(id: ShotId, gain: number, rate = 1, at?: Vec3Like): boolean {
    const buf = this.buffers.get(id);
    if (!buf || !this.ctx) return false;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    if (at) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 8;
      p.rolloffFactor = 1;
      p.positionX.value = at.x;
      p.positionY.value = at.y;
      p.positionZ.value = at.z;
      g.connect(p).connect(this.sfxBus);
    } else g.connect(this.sfxBus);
    src.start();
    return true;
  }

  /** Andere geluiden tijdelijk wegdrukken (alarm, portofoon). */
  private duck(amount: number, dur: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.machineBus.gain.cancelScheduledValues(t);
    this.machineBus.gain.setTargetAtTime(1 - amount, t, 0.05);
    this.machineBus.gain.setTargetAtTime(1, t + dur, 0.4);
  }

  /** Luisteraar = camera. In de cabine klinkt alles gedempt en de wind zachter. */
  setListener(pos: Vec3Like, forward: Vec3Like, up: Vec3Like, inside: boolean): void {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.05);
      L.positionY.setTargetAtTime(pos.y, t, 0.05);
      L.positionZ.setTargetAtTime(pos.z, t, 0.05);
      L.forwardX.value = forward.x;
      L.forwardY.value = forward.y;
      L.forwardZ.value = forward.z;
      L.upX.value = up.x;
      L.upY.value = up.y;
      L.upZ.value = up.z;
    } else (L as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
    if (inside !== this.inside) {
      this.inside = inside;
      this.cabinFilter.frequency.setTargetAtTime(inside ? 1400 : 18000, t, 0.2);
    }
  }

  /** Aanslaan of afkoppelen: rammelende ketting/stroppen. */
  rigging(heavy: boolean, at?: Vec3Like): void {
    if (!this.shot(heavy ? 'chainHeavy' : 'chain', 0.5, 0.9 + Math.random() * 0.2, at)) this.clank(0.08, 520);
  }

  /** Portofoon: korte ruis en een "klik" zoals bij een signaalgever. */
  radio(): void {
    if (this.shot('radioCrackle', 0.25, 1.05)) this.duck(0.4, 1.2);
  }

  private loopNoise(): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.loopStart = Math.random();
    src.start(0, Math.random() * 1.5);
    return src;
  }

  setMix(mix: AudioMix): void {
    this.mix = { ...mix };
    this.applyMix();
  }

  private applyMix(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.mix.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.mix.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.mix.music * 0.5, t, 0.05);
  }

  /** Machinegeluid aan/uit (bij pauze of menu). */
  setMachineActive(on: boolean, ambient = 0.5): void {
    this.machineActive = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (!on) {
      for (const g of [this.engineGain, this.hydGain, this.winchGain, this.windGain]) g.gain.setTargetAtTime(0, t, 0.08);
      for (const l of this.loops.values()) l.gain.gain.setTargetAtTime(0, t, 0.1);
    }
    this.ambientGain.gain.setTargetAtTime(on ? 0.05 * ambient : 0, t, 0.3);
    if (on && this.ambientTimer === null) this.scheduleAmbientClank();
    if (!on && this.ambientTimer !== null) {
      window.clearTimeout(this.ambientTimer);
      this.ambientTimer = null;
    }
  }

  update(m: MachineSound): void {
    if (!this.ctx || !this.machineActive) return;
    const t = this.ctx.currentTime;
    if (m.pos && this.machinePanner.positionX) {
      this.machinePanner.positionX.setTargetAtTime(m.pos.x, t, 0.05);
      this.machinePanner.positionY.setTargetAtTime(m.pos.y, t, 0.05);
      this.machinePanner.positionZ.setTargetAtTime(m.pos.z, t, 0.05);
    }
    if (this.samplesReady) {
      // opnames: diesel volgt het toerental, pomp en hydrauliek de activiteit, lier de liersnelheid
      const e = Math.max(0, Math.min(1, m.engine));
      const load = Math.max(0, Math.min(1.2, (m.loadPct ?? 0) / 100));
      const w = Math.abs(m.winch);
      const wind = Math.min(1, m.wind / 18);
      this.loopGain('diesel', 0.35 + 0.4 * e, 0.75 + 0.55 * e);
      this.loopGain('telehandler', 0.45 * m.hydraulic * (0.4 + 0.6 * e), 0.85 + 0.3 * e);
      this.loopGain('hydraulic', 0.3 * m.hydraulic * (0.5 + 0.5 * load), 0.9 + 0.25 * m.hydraulic);
      this.loopGain('winch', 0.5 * w, 0.8 + 0.5 * w);
      this.loopGain('creak', load > 0.7 ? 0.35 * Math.min(1, (load - 0.7) / 0.3) : 0, 1, 0.4);
      this.loopGain('wind', (this.inside ? 0.25 : 1) * (0.05 + 0.5 * wind * wind), 0.8 + 0.4 * wind, 0.4);
      this.loopGain('ambience', 0.12, 1, 0.5);
      for (const g of [this.engineGain, this.hydGain, this.winchGain, this.windGain]) g.gain.setTargetAtTime(0, t, 0.1);
      // achteruitrijpiep
      if (m.reversing && this.reverseTimer === null) {
        const beep = () => {
          this.shot('reverse', 0.35, 1, m.pos);
          this.reverseTimer = window.setTimeout(() => {
            this.reverseTimer = null;
          }, 4000);
        };
        beep();
      }
      return;
    }
    const rpm = 0.25 + 0.75 * m.engine;
    this.engineOsc.frequency.setTargetAtTime(32 + rpm * 38, t, 0.15);
    this.engineOsc2.frequency.setTargetAtTime(16 + rpm * 19, t, 0.15);
    this.engineFilter.frequency.setTargetAtTime(160 + rpm * 520, t, 0.15);
    this.engineGain.gain.setTargetAtTime(0.05 + 0.12 * m.engine, t, 0.1);
    this.hydGain.gain.setTargetAtTime(0.06 * m.hydraulic, t, 0.08);
    this.hydFilter.frequency.setTargetAtTime(700 + m.hydraulic * 900, t, 0.1);
    const w = Math.abs(m.winch);
    this.winchOsc.frequency.setTargetAtTime(90 + w * 160, t, 0.1);
    this.winchGain.gain.setTargetAtTime(0.035 * w, t, 0.08);
    const wind = Math.min(1, m.wind / 18);
    this.windGain.gain.setTargetAtTime(0.02 + 0.18 * wind * wind, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(250 + wind * 900, t, 0.3);
  }

  private scheduleAmbientClank(): void {
    this.ambientTimer = window.setTimeout(() => {
      this.ambientTimer = null;
      if (!this.machineActive) return;
      this.clank(0.03 + Math.random() * 0.04, 300 + Math.random() * 900);
      this.scheduleAmbientClank();
    }, 1800 + Math.random() * 5000);
  }

  private envNoise(gain: number, dur: number, freq: number, type: BiquadFilterType = 'lowpass'): void {
    if (!this.ctx || !this.noiseBuf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', bus?: GainNode, at = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime + at;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Metalen klank. */
  clank(gain: number, freq: number): void {
    this.tone(freq, 0.25, gain, 'square');
    this.tone(freq * 2.7, 0.18, gain * 0.5, 'triangle');
    this.envNoise(gain * 1.5, 0.12, freq * 2, 'highpass');
  }

  /** Contactgeluid bij neerzetten of botsen, sterkte op basis van snelheid en massa. */
  impact(speed: number, massKg: number, obstacle: boolean, at?: Vec3Like): void {
    const s = Math.min(1, speed / 1.5);
    const heavy = Math.min(1, Math.log10(Math.max(10, massKg)) / 5.5);
    // zware last: lager en voller (lagere afspeelsnelheid); botsing met een obstakel: staal op staal
    if (this.shot(obstacle ? 'anvil' : 'steelFall', 0.15 + 0.7 * s, 1.15 - 0.45 * heavy, at)) return;
    this.envNoise(0.12 + 0.5 * s, 0.25 + heavy * 0.5, 120 + (1 - heavy) * 500);
    if (obstacle) this.clank(0.06 + 0.12 * s, 220 + (1 - heavy) * 400);
  }

  warning(level: 'info' | 'caution' | 'critical'): void {
    if (level === 'critical' && this.ctx && this.ctx.currentTime - this.lastAlarm > 1.5 && this.shot('alarm', 0.35)) {
      this.lastAlarm = this.ctx.currentTime;
      this.duck(0.5, 1.5);
      return;
    }
    if (level === 'critical') {
      this.tone(1180, 0.18, 0.09, 'square');
      this.tone(1180, 0.18, 0.09, 'square', undefined, 0.25);
      this.tone(1180, 0.18, 0.09, 'square', undefined, 0.5);
    } else if (level === 'caution') {
      this.tone(880, 0.22, 0.06, 'square');
      this.tone(660, 0.22, 0.06, 'square', undefined, 0.26);
    } else this.tone(660, 0.12, 0.04, 'sine');
  }

  /** Korte bevestigingspiep van de lastmomentbegrenzer. */
  lmiBeep(): void {
    this.tone(1500, 0.08, 0.06, 'square');
  }

  horn(): void {
    if (this.shot('horn', 0.6)) return;
    this.tone(330, 0.6, 0.12, 'sawtooth');
    this.tone(415, 0.6, 0.08, 'sawtooth');
  }

  ui(kind: 'click' | 'confirm' | 'back' | 'error' | 'success' | 'fail'): void {
    switch (kind) {
      case 'click':
        this.tone(900, 0.05, 0.04, 'triangle');
        break;
      case 'confirm':
        this.tone(660, 0.08, 0.05, 'triangle');
        this.tone(990, 0.12, 0.05, 'triangle', undefined, 0.07);
        break;
      case 'back':
        this.tone(500, 0.08, 0.04, 'triangle');
        break;
      case 'error':
        this.tone(200, 0.2, 0.06, 'square');
        break;
      case 'success':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 0.06, 'triangle', undefined, i * 0.12));
        break;
      case 'fail':
        [392, 330, 262].forEach((f, i) => this.tone(f, 0.35, 0.06, 'sawtooth', undefined, i * 0.18));
        break;
    }
  }

  /** Eenvoudige generatieve ambient-muziek (akkoordenreeks met zachte pads). */
  startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    const chords = [
      [220, 261.6, 329.6],
      [196, 246.9, 293.7],
      [174.6, 220, 261.6],
      [196, 233.1, 293.7],
    ];
    let i = 0;
    const play = () => {
      if (!this.ctx) return;
      const ch = chords[i++ % chords.length];
      for (const f of ch) this.pad(f, 3.8);
      this.pad(ch[0] / 2, 3.8, 0.05);
      this.musicTimer = window.setTimeout(play, 4000);
    };
    play();
  }

  stopMusic(): void {
    if (this.musicTimer !== null) window.clearTimeout(this.musicTimer);
    this.musicTimer = null;
  }

  private pad(freq: number, dur: number, gain = 0.035): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.3 + Math.random() * 0.4;
    const lg = ctx.createGain();
    lg.gain.value = 1.5;
    lfo.connect(lg).connect(o.detune);
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 1.2);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.1);
    lfo.stop(t + dur + 0.1);
  }
}

export const audio = new AudioEngine();
