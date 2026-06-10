import type { Settings } from '../types';

/**
 * All game audio is synthesized with the Web Audio API — no audio files are
 * downloaded, which keeps the bundle tiny and loading instant.
 *
 * Graph: sources -> sfx/music gain -> master gain -> destination.
 * The context is created lazily on the first user gesture (browser autoplay policy).
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noiseBuffer!: AudioBuffer;

  // Engine voice
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  // Skid voice
  private skidGain: GainNode | null = null;

  // Music sequencer
  private musicTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;

  private lastCollisionAt = 0;
  private volumes = { master: 0.8, music: 0.6, sfx: 0.8 };

  constructor(settings: Settings) {
    this.volumes = {
      master: settings.masterVolume,
      music: settings.musicVolume,
      sfx: settings.sfxVolume,
    };
  }

  /** Must be called from a user gesture (click/keydown) to satisfy autoplay rules. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.applyVolumes();

    // 1 second of white noise reused by skids, collisions and hi-hats.
    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.volumes = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.musicBus.gain.value = this.volumes.music * 0.5;
    this.sfxBus.gain.value = this.volumes.sfx;
  }

  // ---------------------------------------------------------------- Engine

  startEngine(): void {
    if (!this.ctx || this.engineOsc1) return;
    const ctx = this.ctx;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfxBus);

    this.engineOsc1 = ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineOsc1.start();
    this.engineOsc2.start();

    // Looping skid noise, silenced until needed.
    const skidSrc = ctx.createBufferSource();
    skidSrc.buffer = this.noiseBuffer;
    skidSrc.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 950;
    bp.Q.value = 0.8;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    skidSrc.connect(bp);
    bp.connect(this.skidGain);
    this.skidGain.connect(this.sfxBus);
    skidSrc.start();
  }

  /** rpm and throttle are 0..1; pitch and grit follow engine load. */
  setEngine(rpm: number, throttle: number): void {
    if (!this.ctx || !this.engineOsc1 || !this.engineOsc2 || !this.engineFilter || !this.engineGain) return;
    const t = this.ctx.currentTime;
    const freq = 50 + rpm * 165;
    this.engineOsc1.frequency.setTargetAtTime(freq, t, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(freq * 0.5, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(220 + rpm * 1400 + throttle * 500, t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.05 + rpm * 0.1 + throttle * 0.06, t, 0.08);
  }

  setSkid(amount: number): void {
    if (!this.ctx || !this.skidGain) return;
    this.skidGain.gain.setTargetAtTime(amount * 0.22, this.ctx.currentTime, 0.05);
  }

  stopEngine(): void {
    if (!this.ctx) return;
    this.engineOsc1?.stop();
    this.engineOsc2?.stop();
    this.engineOsc1 = this.engineOsc2 = null;
    this.engineFilter = this.engineGain = null;
    this.skidGain?.disconnect();
    this.skidGain = null;
  }

  // ------------------------------------------------------------ One-shots

  /** Crunchy filtered-noise burst; intensity 0..1. Throttled to avoid spam. */
  collision(intensity: number): void {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this.lastCollisionAt < 90) return;
    this.lastCollisionAt = now;

    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300 + intensity * 900;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.15 + intensity * 0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + 0.2);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'square', when = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  uiClick(): void {
    this.tone(700, 0.06, 0.08, 'triangle');
  }

  countdownBeep(final: boolean): void {
    this.tone(final ? 880 : 440, final ? 0.5 : 0.18, 0.18, 'square');
  }

  finishFanfare(won: boolean): void {
    const notes = won ? [523, 659, 784, 1047] : [392, 494, 587];
    notes.forEach((f, i) => this.tone(f, 0.3, 0.14, 'triangle', i * 0.16));
  }

  // ---------------------------------------------------------------- Music

  /**
   * A tiny 16-step lo-fi sequencer (bass + arp + hat) in A minor.
   * Scheduled ahead of time so it stays steady regardless of frame rate.
   */
  startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 90);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private scheduleMusic(): void {
    if (!this.ctx) return;
    const stepDur = 60 / 126 / 2; // 126 BPM, 8th notes
    const bass = [110, 0, 110, 0, 131, 0, 98, 0, 110, 0, 110, 131, 147, 0, 98, 0];
    const arp = [440, 523, 659, 523, 440, 523, 587, 523, 440, 523, 659, 784, 659, 523, 587, 494];

    while (this.nextNoteTime < this.ctx.currentTime + 0.25) {
      const s = this.step % 16;
      const t = this.nextNoteTime;
      const bf = bass[s];
      if (bf) this.musicNote(bf, t, stepDur * 1.8, 0.20, 'triangle');
      if (s % 2 === 0) this.musicNote(arp[s], t, stepDur * 0.9, 0.05, 'square');
      if (s % 4 === 2) this.musicHat(t);
      this.nextNoteTime += stepDur;
      this.step++;
    }
  }

  private musicNote(freq: number, when: number, dur: number, gain: number, type: OscillatorType): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.musicBus);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  private musicHat(when: number): void {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.05, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.musicBus);
    src.start(when, Math.random());
    src.stop(when + 0.06);
  }
}
