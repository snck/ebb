/**
 * Procedural audio (WebAudio, no asset files).
 * Every enemy tell has a distinct sound that starts exactly with the wind-up. Sustained tells (growl, held hymn,
 * gathering wave) END exactly when the blow lands, so the sound itself carries the timing.
 */
type Dest = AudioNode;

export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode; sfx!: GainNode; music!: GainNode;
  private noiseBuf!: AudioBuffer;
  private ambient: { stop: () => void } | null = null;
  private bossLoop: number | null = null;
  private bossBeat = 0;
  private bossIntensity = 1;
  volume = 0.9; musicVol = 0.6;

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain(); this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);
    this.music = this.ctx.createGain(); this.music.gain.value = this.musicVol; this.music.connect(this.master);
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // iOS needs a sound started inside the gesture
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain(); g.gain.value = 0; o.connect(g).connect(this.master); o.start(); o.stop(this.ctx.currentTime + 0.05);
    this.startAmbient();
  }
  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.value = v; }
  setMusic(v: number) { this.musicVol = v; if (this.ctx) this.music.gain.value = v; }
  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
  get t() { return this.ctx!.currentTime; }

  // ------------------------------------------------------------------ primitives
  private pan(p: number, dest: Dest = this.sfx): Dest {
    if (!this.ctx || !(this.ctx as any).createStereoPanner) return dest;
    const n = this.ctx.createStereoPanner(); n.pan.value = Math.max(-1, Math.min(1, p)); n.connect(dest); return n;
  }
  private env(g: GainNode, t0: number, a: number, peak: number, hold: number, r: number) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t0 + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + hold + r);
  }
  tone(freq: number, dur: number, opt: { type?: OscillatorType; gain?: number; a?: number; r?: number; to?: number; dest?: Dest; delay?: number; detune?: number } = {}) {
    if (!this.ctx) return;
    const t0 = this.t + (opt.delay ?? 0);
    const o = this.ctx.createOscillator(); o.type = opt.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (opt.to) o.frequency.exponentialRampToValueAtTime(opt.to, t0 + dur);
    if (opt.detune) o.detune.value = opt.detune;
    const g = this.ctx.createGain();
    this.env(g, t0, opt.a ?? 0.005, opt.gain ?? 0.2, Math.max(0, dur - (opt.a ?? 0.005) - (opt.r ?? 0.1)), opt.r ?? 0.1);
    o.connect(g).connect(opt.dest ?? this.sfx);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  noise(dur: number, opt: { f?: number; to?: number; q?: number; type?: BiquadFilterType; gain?: number; a?: number; r?: number; dest?: Dest; delay?: number } = {}) {
    if (!this.ctx) return;
    const t0 = this.t + (opt.delay ?? 0);
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = opt.type ?? 'bandpass'; f.Q.value = opt.q ?? 1;
    f.frequency.setValueAtTime(opt.f ?? 1000, t0);
    if (opt.to) f.frequency.exponentialRampToValueAtTime(opt.to, t0 + dur);
    const g = this.ctx.createGain();
    this.env(g, t0, opt.a ?? 0.005, opt.gain ?? 0.2, Math.max(0, dur - (opt.a ?? 0.005) - (opt.r ?? 0.1)), opt.r ?? 0.1);
    s.connect(f).connect(g).connect(opt.dest ?? this.sfx);
    s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
  }
  /** inharmonic bell: the island's voice */
  bell(freq: number, dur = 1.6, gain = 0.15, dest?: Dest, delay = 0) {
    const parts = [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.93, 0.12], [0.5, 0.35]];
    for (const [m, g] of parts) this.tone(freq * m, dur * (m < 1 ? 1.4 : 1 / Math.sqrt(m)), { gain: gain * g, a: 0.003, r: dur * 0.8, dest, delay });
  }
  /** a sung vowel (formant filtered sawtooth) */
  voice(freq: number, dur: number, gain = 0.12, dest?: Dest, vowel: 'a' | 'o' | 'u' = 'a', delay = 0) {
    if (!this.ctx) return;
    const t0 = this.t + delay;
    const F = { a: [800, 1150], o: [450, 800], u: [325, 700] }[vowel];
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const vib = this.ctx.createOscillator(); vib.frequency.value = 5.2; const vg = this.ctx.createGain(); vg.gain.value = freq * 0.012;
    vib.connect(vg).connect(o.frequency);
    const g = this.ctx.createGain();
    this.env(g, t0, 0.06, gain, Math.max(0, dur - 0.1), 0.04);
    for (const ff of F) {
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = 6;
      o.connect(bp).connect(g);
    }
    g.connect(dest ?? this.sfx);
    o.start(t0); vib.start(t0); o.stop(t0 + dur + 0.1); vib.stop(t0 + dur + 0.1);
  }

  // ------------------------------------------------------------------ game sounds
  /** tell sound; `windupMs` lets sustained tells end exactly on the hit. `p` = stereo position -1..1 */
  tell(id: string, windupMs: number, p = 0, boss = false) {
    if (!this.ctx) return;
    const d = this.pan(p);
    const W = windupMs / 1000;
    const g = boss ? 1.25 : 1;
    switch (id) {
      case 'tellSoft': this.noise(0.35, { f: 500, to: 900, q: 2, gain: 0.12 * g, a: 0.08, dest: d }); this.tone(330, 0.3, { gain: 0.06, dest: d }); break;
      case 'tellSoft2': this.noise(0.35, { f: 500, to: 900, q: 2, gain: 0.12 * g, a: 0.08, dest: d }); this.tone(330, 0.15, { gain: 0.06, dest: d }); this.tone(330, 0.15, { gain: 0.06, dest: d, delay: 0.15 }); break;
      case 'tellQuick': this.tone(880, 0.12, { gain: 0.08, type: 'triangle', dest: d }); break;
      case 'tellMetal': this.tone(700, 0.4, { type: 'triangle', gain: 0.08, dest: d, to: 690 }); this.tone(1870, 0.25, { gain: 0.04, dest: d }); break;
      case 'tellMetal2': this.tone(700, 0.2, { type: 'triangle', gain: 0.08, dest: d }); this.tone(700, 0.2, { type: 'triangle', gain: 0.08, dest: d, delay: 0.14 }); break;
      case 'tellGrowl': this.tone(62, W, { type: 'sawtooth', gain: 0.16 * g, a: 0.05, r: 0.05, to: 80, dest: d }); this.noise(W, { f: 220, q: 3, gain: 0.08 * g, a: 0.05, r: 0.05, dest: d }); break;
      case 'tellSnap': this.noise(0.08, { f: 2500, q: 2, gain: 0.15, dest: d }); this.tone(500, 0.1, { gain: 0.06, type: 'square', dest: d }); break;
      case 'tellFlame': this.noise(W * 0.9, { f: 300, to: 2400, q: 1.2, gain: 0.1, a: W * 0.6, r: 0.08, dest: d }); break;
      case 'tellHeavy': this.bell(110, 1.2, 0.2 * g, d); this.noise(0.3, { f: 150, q: 1, gain: 0.12, dest: d }); break;
      case 'tellHeavy2': this.bell(98, 1.0, 0.18 * g, d); this.noise(0.4, { f: 900, to: 300, q: 2, gain: 0.08, dest: d }); break;
      case 'tellChain': for (let i = 0; i < 4; i++) this.noise(0.05, { f: 3000 + i * 300, q: 4, gain: 0.08, dest: d, delay: i * 0.05 }); this.bell(392, 0.8, 0.1 * g, d); break;
      case 'tellChain2': for (let i = 0; i < 4; i++) this.noise(0.05, { f: 3000 + i * 300, q: 4, gain: 0.08, dest: d, delay: i * 0.05 }); this.bell(523, 0.8, 0.1 * g, d); break;
      case 'tellStomp': this.tone(55, 0.35, { gain: 0.35, to: 35, dest: d }); this.noise(0.5, { f: 400, to: 1400, q: 1, gain: 0.08, a: 0.3, dest: d }); break;
      case 'tellStomp2': this.tone(60, 0.2, { gain: 0.3, to: 40, dest: d }); this.tone(60, 0.2, { gain: 0.3, to: 40, dest: d, delay: 0.18 }); break;
      case 'tellWhirl': for (let i = 0; i < 4; i++) this.noise(0.12, { f: 600 + i * 150, q: 3, gain: 0.1, dest: d, delay: i * 0.13 }); break;
      case 'tellNeedle': this.tone(1760, 0.35, { gain: 0.07, dest: d }); this.tone(2637, 0.25, { gain: 0.04, dest: d }); break;
      case 'tellNote1': this.voice(440, 0.32, 0.11, d, 'a'); break;
      case 'tellNote2': this.voice(523, 0.3, 0.11, d, 'a'); break;
      case 'tellNote3': this.voice(349, W * 0.95, 0.12, d, 'o'); break;
      case 'tellHymn': this.voice(392, W, 0.14, d, 'o'); this.voice(587, W, 0.06, d, 'u'); break;
      case 'tellBlink': this.tone(1200, 0.25, { gain: 0.07, to: 300, dest: d }); this.bell(880, 0.6, 0.08, d, 0.3); break;
      case 'tellChoir': for (const f of [262, 311, 392]) this.voice(f, W, 0.06, d, 'a'); this.noise(W, { f: 300, to: 3000, q: 1, gain: 0.05, a: W * 0.8, dest: d }); break;
      case 'tellStep': this.noise(0.15, { f: 1200, q: 1, gain: 0.06, dest: d }); break;
      case 'tellWave': this.noise(W, { f: 200, to: 900, type: 'lowpass', q: 1, gain: 0.25, a: W * 0.85, r: 0.15, dest: d }); this.bell(147, 1.4, 0.12, d, W - 0.02); break;
      case 'tellWave3': this.noise(W, { f: 200, to: 900, type: 'lowpass', q: 1, gain: 0.25, a: W * 0.85, r: 0.15, dest: d }); for (let i = 0; i < 3; i++) this.tone(196, 0.12, { gain: 0.08, type: 'triangle', dest: d, delay: i * 0.12 }); break;
      case 'tellWaveS': this.noise(W, { f: 300, to: 900, type: 'lowpass', q: 1, gain: 0.2, a: W * 0.85, r: 0.1, dest: d }); break;
      case 'tellCoral': this.noise(0.4, { f: 4000, q: 8, gain: 0.08, dest: d }); this.bell(123, 1.0, 0.15 * g, d); break;
      case 'tellCoral2': this.noise(0.4, { f: 4000, q: 8, gain: 0.08, dest: d }); this.bell(165, 1.0, 0.15 * g, d); break;
      case 'tellDive': case 'tellDive2':
        for (let i = 0; i < 8; i++) this.tone(300 + Math.random() * 400, 0.06, { gain: 0.05, to: 150, dest: d, delay: i * 0.06 });
        this.noise(0.6, { f: 600, to: 120, type: 'lowpass', gain: 0.2, dest: d });
        if (id === 'tellDive2') this.bell(196, 1, 0.08, d);
        break;
      case 'tellSwell': this.noise(W, { f: 300, to: 1800, q: 1, gain: 0.15, a: W * 0.9, r: 0.05, dest: d }); break;
      default: this.tone(600, 0.2, { gain: 0.05, dest: d });
    }
  }
  /** played when an attack's hitbox goes live: a swish whose weight scales with the attacker */
  strike(p: number, heavy: boolean) {
    const d = this.pan(p);
    this.noise(heavy ? 0.22 : 0.14, { f: heavy ? 900 : 1800, to: heavy ? 250 : 600, q: 1.2, gain: heavy ? 0.2 : 0.12, dest: d });
  }
  swing(combo: number, riposte: boolean) {
    this.noise(0.13, { f: 2400 + combo * 300, to: 700, q: 1.4, gain: 0.1 });
    if (riposte) this.bell(659, 0.9, 0.12);
  }
  enemyHit(p: number, heavy: boolean, guarded: boolean) {
    const d = this.pan(p);
    if (guarded) { this.tone(900, 0.12, { type: 'square', gain: 0.05, dest: d }); this.noise(0.08, { f: 3000, q: 3, gain: 0.08, dest: d }); return; }
    this.tone(heavy ? 90 : 140, 0.16, { gain: 0.3, to: 50, dest: d });
    this.noise(0.12, { f: 1500, to: 400, q: 0.8, gain: 0.22, dest: d });
  }
  playerHit() { this.tone(80, 0.25, { gain: 0.4, to: 40, type: 'triangle' }); this.noise(0.25, { f: 700, to: 200, q: 0.7, gain: 0.3 }); }
  slip() { this.bell(1046, 0.7, 0.08); this.tone(2093, 0.3, { gain: 0.04 }); this.noise(0.2, { f: 5000, q: 2, gain: 0.04 }); }
  roll() { this.noise(0.25, { f: 700, to: 300, q: 0.8, gain: 0.07, a: 0.02 }); }
  heal() { this.tone(220, 0.15, { gain: 0.1, to: 160 }); this.tone(220, 0.15, { gain: 0.1, to: 160, delay: 0.25 }); }
  healDone() { this.bell(784, 1.0, 0.07); }
  reject() { this.tone(120, 0.08, { type: 'square', gain: 0.06 }); }
  death() { this.bell(65, 4, 0.35); this.noise(3, { f: 400, to: 80, type: 'lowpass', gain: 0.3, a: 0.5, r: 2 }); }
  rest() { for (const [i, f] of [262, 330, 392, 523].entries()) this.bell(f, 2.2, 0.07, undefined, i * 0.18); }
  item() { this.bell(988, 1.2, 0.1); this.bell(1319, 1.2, 0.06, undefined, 0.15); }
  gate(open: boolean) { this.noise(1.2, { f: open ? 300 : 200, to: open ? 600 : 90, type: 'lowpass', gain: 0.25 }); this.tone(45, 0.6, { gain: 0.25 }); }
  bossBroken() { this.bell(220, 1.5, 0.2); this.tone(55, 0.6, { gain: 0.4, to: 30 }); }
  bossPhase() { this.noise(1.2, { f: 100, to: 1200, type: 'lowpass', gain: 0.3, a: 0.6 }); this.bell(73, 2.5, 0.3); }
  land(p: number) { const d = this.pan(p); this.tone(45, 0.5, { gain: 0.5, to: 28, dest: d }); this.noise(0.6, { f: 500, to: 120, type: 'lowpass', gain: 0.35, dest: d }); }
  ring(p: number) { const d = this.pan(p); this.noise(0.9, { f: 900, to: 200, type: 'lowpass', gain: 0.25, dest: d }); }
  victory() {
    for (const [i, f] of [196, 247, 294, 392, 494, 587].entries()) this.bell(f, 3.5, 0.09, undefined, i * 0.12);
  }
  ending() { for (const [i, f] of [262, 330, 392, 523, 659, 784].entries()) this.bell(f, 5, 0.08, undefined, i * 0.4); }
  ui() { this.tone(660, 0.06, { gain: 0.05, type: 'triangle' }); }
  footstep() { this.noise(0.05, { f: 400, q: 1, gain: 0.025 }); }

  // ------------------------------------------------------------------ music
  private startAmbient() {
    if (!this.ctx || this.ambient) return;
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0.0; g.connect(this.music);
    g.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 4);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.connect(g);
    const oscs: AudioScheduledSourceNode[] = [];
    for (const [f, gg] of [[55, 0.12], [82.4, 0.07], [110.5, 0.04], [164.8, 0.02]]) {
      const o = ctx.createOscillator(); o.frequency.value = f; const og = ctx.createGain(); og.gain.value = gg; o.connect(og).connect(lp); o.start(); oscs.push(o);
    }
    // sea: slowly breathing filtered noise
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 380;
    const sg = ctx.createGain(); sg.gain.value = 0.12;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09; const lg = ctx.createGain(); lg.gain.value = 0.09; lfo.connect(lg).connect(sg.gain);
    s.connect(sf).connect(sg).connect(g); s.start(); lfo.start(); oscs.push(s, lfo);
    this.ambient = { stop: () => { g.gain.linearRampToValueAtTime(0, ctx.currentTime + 1); setTimeout(() => oscs.forEach((o) => o.stop()), 1200); } };
  }

  startBoss(kind: string) {
    if (!this.ctx) return;
    this.stopBoss();
    this.bossIntensity = 1;
    const bpm = kind === 'cantor' ? 104 : kind === 'abbess' ? 72 : 84;
    const root = kind === 'cantor' ? 98 : kind === 'abbess' ? 65.4 : 73.4;
    const spb = 60 / bpm;
    let next = this.t + 0.1;
    this.bossBeat = 0;
    const scale = [1, 1.189, 1.335, 1.498, 1.587, 1.782]; // minor-ish
    this.bossLoop = window.setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      while (next < this.t + 0.3) {
        const b = this.bossBeat++;
        const delay = next - this.t;
        this.tone(root, 0.3, { gain: b % 4 === 0 ? 0.3 : 0.16, to: root * 0.6, dest: this.music, delay });
        if (this.bossIntensity > 1 && b % 2 === 1) this.noise(0.06, { f: 6000, q: 1, gain: 0.04, dest: this.music, delay });
        if (b % 8 === 0) this.bell(root * 4, 2.5, 0.06, this.music, delay);
        if (b % 4 === 2) this.tone(root * 2 * scale[(b / 4 + (b >> 4)) % scale.length | 0], spb * 1.8, { type: 'triangle', gain: 0.035 * this.bossIntensity, a: 0.08, r: 0.3, dest: this.music, delay });
        next += spb / (this.bossIntensity > 1 ? 1.12 : 1);
      }
    }, 100);
  }
  bossIntense() { this.bossIntensity = 2; }
  stopBoss() { if (this.bossLoop !== null) { clearInterval(this.bossLoop); this.bossLoop = null; } }
}
