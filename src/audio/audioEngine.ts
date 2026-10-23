/**
 * Procedureel gegenereerde audio via WebAudio: geen externe assets nodig.
 * Als WebAudio niet beschikbaar is of faalt, wordt alles een no-op (de game crasht nooit op audio).
 */
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
    this.engineFilter.connect(this.engineGain).connect(this.sfxBus);
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
    hydSrc.connect(this.hydFilter).connect(this.hydGain).connect(this.sfxBus);

    // lier
    this.winchOsc = ctx.createOscillator();
    this.winchOsc.type = 'triangle';
    this.winchOsc.frequency.value = 120;
    this.winchGain = ctx.createGain();
    this.winchGain.gain.value = 0;
    this.winchOsc.connect(this.winchGain).connect(this.sfxBus);
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
  impact(speed: number, massKg: number, obstacle: boolean): void {
    const s = Math.min(1, speed / 1.5);
    const heavy = Math.min(1, Math.log10(Math.max(10, massKg)) / 5.5);
    this.envNoise(0.12 + 0.5 * s, 0.25 + heavy * 0.5, 120 + (1 - heavy) * 500);
    if (obstacle) this.clank(0.06 + 0.12 * s, 220 + (1 - heavy) * 400);
  }

  warning(level: 'info' | 'caution' | 'critical'): void {
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
