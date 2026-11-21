// Audio engine: one AudioContext, a master effects chain, reverb and a limiter.
//
//   instruments → bus → wah (face control) → filter (effects hand) ─┬→ dry ──────────┐
//                                                                   ├→ reverb ───────┤
//                                                                   ├→ wash (reverb) ┤→ limiter → master → speakers
//                                                                   └→ echo ─────────┘                    ├→ analyser
//   metronome clicks → direct ───────────────────────────────────────────────────────────→ master       └→ recorder

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
  }

  async start() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.bus = ctx.createGain();

    // Talk-box style filter driven by the mouth (face control). Neutral when gain is 0.
    this.wah = ctx.createBiquadFilter();
    this.wah.type = 'peaking';
    this.wah.frequency.value = 900;
    this.wah.Q.value = 2.5;
    this.wah.gain.value = 0;

    // Low-pass filter swept by the effects hand. Fully open by default.
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.filter.Q.value = 0.9;

    this.dry = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.6, 3.2);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.3;
    this.washSend = ctx.createGain();
    this.washSend.gain.value = 0;

    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.36;
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.38;
    this.delayTone = ctx.createBiquadFilter();
    this.delayTone.type = 'lowpass';
    this.delayTone.frequency.value = 3800;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.2;

    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.direct = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;

    this.bus.connect(this.wah).connect(this.filter);
    const post = this.filter;
    post.connect(this.dry).connect(this.comp);
    post.connect(this.reverbSend).connect(this.reverb).connect(this.comp);
    post.connect(this.washSend).connect(this.reverb);
    post.connect(this.delaySend).connect(this.delay);
    this.delay.connect(this.delayTone);
    this.delayTone.connect(this.feedback).connect(this.delay);
    this.delayTone.connect(this.comp);
    this.comp.connect(this.master);
    this.direct.connect(this.master);
    this.master.connect(ctx.destination);
    this.master.connect(this.analyser);

    // Shared white noise used by drums and hammer/mallet transients.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    if (ctx.state !== 'running') await ctx.resume();
    this.ready = true;
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  #to(param, value, tau = 0.04) {
    if (this.ctx) param.setTargetAtTime(value, this.ctx.currentTime, tau);
  }

  setVolume(v) { if (this.master) this.#to(this.master.gain, v, 0.03); }
  setReverb(v) { if (this.reverbSend) this.#to(this.reverbSend.gain, v * 0.8, 0.05); }

  /** 0 = dark and muffled, 1 = fully open. */
  setFilter(n) {
    if (!this.filter) return;
    const f = 180 * Math.pow(20000 / 180, Math.max(0, Math.min(1, n)));
    this.#to(this.filter.frequency, f, 0.03);
    this.#to(this.filter.Q, n < 0.98 ? 4 : 0.9, 0.05);
  }

  /** Echo amount, 0..1. */
  setEcho(n) { if (this.delaySend) this.#to(this.delaySend.gain, Math.max(0, Math.min(1, n)) * 0.75, 0.05); }

  /** Echo time in seconds (synced to the tempo when the band is playing). */
  setEchoTime(sec) { if (this.delay) this.#to(this.delay.delayTime, Math.max(0.05, Math.min(1.9, sec)), 0.1); }

  /** Extra reverb swell, 0..1. */
  setWash(n) { if (this.washSend) this.#to(this.washSend.gain, Math.max(0, Math.min(1, n)) * 1.4, 0.08); }

  /** Talk-box filter: amount 0..1 (mouth open), or null to switch it off. */
  setWah(n) {
    if (!this.wah) return;
    if (n == null) { this.#to(this.wah.gain, 0, 0.05); return; }
    const k = Math.max(0, Math.min(1, n));
    this.#to(this.wah.frequency, 380 * Math.pow(7, k), 0.03);
    this.#to(this.wah.gain, 13, 0.05);
  }

  /** Mixed output as a MediaStream, for recording clips. */
  recordStream() {
    if (!this.ctx) return null;
    if (!this.recDest) {
      this.recDest = this.ctx.createMediaStreamDestination();
      this.master.connect(this.recDest);
    }
    return this.recDest.stream;
  }

  /** A channel is a gain node feeding the bus, with an optional filter chain in front. */
  channel(build, dest) {
    if (!this.ctx) return null;
    const input = this.ctx.createGain();
    const out = this.ctx.createGain();
    let last = input;
    if (build) last = build(this.ctx, input) || input;
    last.connect(out);
    out.connect(dest || this.bus);
    return {
      input,
      out,
      disconnect: () => {
        out.gain.setTargetAtTime(0, this.now, 0.05);
        setTimeout(() => { try { out.disconnect(); } catch (e) { /* already gone */ } }, 400);
      },
    };
  }

  makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 80 ? i / 80 : 1);
      }
    }
    return buf;
  }

  noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loopStart = 0;
    src.loop = true;
    return src;
  }
}

/** Soft-clipping curve for overdrive. */
export function driveCurve(amount = 3) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}
