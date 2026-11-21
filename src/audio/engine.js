// Audio engine: one AudioContext, a master chain with reverb and a limiter,
// and per-instrument channels. Every synth plays through a channel.

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
    this.dry = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.6, 3.2);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.3;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.2;

    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;

    this.bus.connect(this.dry).connect(this.comp);
    this.bus.connect(this.reverbSend).connect(this.reverb).connect(this.comp);
    this.comp.connect(this.master).connect(ctx.destination);
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

  setVolume(v) {
    if (this.master) this.master.gain.setTargetAtTime(v, this.now, 0.03);
  }

  setReverb(v) {
    if (this.reverbSend) this.reverbSend.gain.setTargetAtTime(v * 0.8, this.now, 0.05);
  }

  /** A channel is a gain node feeding the bus, with an optional filter chain in front. */
  channel(build) {
    if (!this.ctx) return null;
    const input = this.ctx.createGain();
    const out = this.ctx.createGain();
    let last = input;
    if (build) last = build(this.ctx, input) || input;
    last.connect(out);
    out.connect(this.bus);
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
