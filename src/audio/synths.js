// Sound generators. Everything is synthesised in the browser: no samples to download.
import { midiToFreq, clamp, lerp } from './music.js';
import { driveCurve } from './engine.js';

/* ------------------------------------------------------------------ */
/* Plucked strings: Karplus-Strong, rendered once per note and cached */
/* ------------------------------------------------------------------ */

export const PLUCK_PRESETS = {
  acoustic: { decay: 3.4, bright: 0.55, pick: 0.13, gain: 0.6, durMax: 4.5 },
  nylon: { decay: 2.8, bright: 0.28, pick: 0.18, gain: 0.7, durMax: 4 },
  electric: { decay: 5.5, bright: 0.75, pick: 0.1, gain: 0.45, durMax: 5.5 },
  harp: { decay: 4.8, bright: 0.32, pick: 0.5, gain: 0.62, durMax: 5.5 },
  koto: { decay: 2.2, bright: 0.9, pick: 0.07, gain: 0.8, durMax: 3 },
};

const ksCache = new Map();

function ksBuffer(ctx, freq, presetName, variant) {
  const key = `${presetName}|${freq.toFixed(2)}|${variant}`;
  const hit = ksCache.get(key);
  if (hit) return hit;
  const p = PLUCK_PRESETS[presetName];
  const sr = ctx.sampleRate;
  const N = Math.max(4, Math.round(sr / freq + 0.5));
  const actual = sr / (N - 0.5); // the averaging filter adds half a sample of delay
  const t60 = p.decay * clamp(Math.pow(110 / freq, 0.35), 0.3, 1.3);
  const perPeriod = Math.pow(0.001, 1 / (t60 * actual));
  const filterGain = Math.cos((Math.PI * actual) / sr);
  const damp = Math.min(0.99995, perPeriod / filterGain);
  const len = Math.floor(sr * Math.min(p.durMax, t60 * 0.9));
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);

  // Excitation: low-passed noise burst, then a comb for the pick position.
  const exc = new Float32Array(N);
  let lp = 0, mean = 0;
  for (let i = 0; i < N; i++) {
    lp += p.bright * (Math.random() * 2 - 1 - lp);
    exc[i] = lp;
    mean += lp;
  }
  mean /= N;
  const P = Math.max(1, Math.round(N * p.pick));
  const line = new Float32Array(N);
  let peak = 1e-6;
  for (let i = 0; i < N; i++) {
    line[i] = exc[i] - mean - 0.9 * (exc[(i - P + N) % N] - mean);
    peak = Math.max(peak, Math.abs(line[i]));
  }
  for (let i = 0; i < N; i++) line[i] *= 0.9 / peak;

  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = line[idx];
    const nxt = line[idx + 1 === N ? 0 : idx + 1];
    out[i] = cur;
    line[idx] = damp * 0.5 * (cur + nxt);
    idx = idx + 1 === N ? 0 : idx + 1;
  }
  const fade = Math.min(len, Math.floor(sr * 0.05));
  for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;

  const entry = { buf, actual };
  ksCache.set(key, entry);
  if (ksCache.size > 600) ksCache.delete(ksCache.keys().next().value);
  return entry;
}

/** Render the cached buffers ahead of time so the first pluck is instant. */
export function prewarmPluck(engine, midis, presetName) {
  if (!engine.ctx) return;
  const queue = [];
  for (const m of new Set(midis)) for (let v = 0; v < 3; v++) queue.push([m, v]);
  const step = () => {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 6) {
      const [m, v] = queue.shift();
      ksBuffer(engine.ctx, midiToFreq(m), presetName, v);
    }
    if (queue.length) setTimeout(step, 16);
  };
  setTimeout(step, 0);
}

export function pluckChannel(engine, presetName) {
  return engine.channel((ctx, input) => {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 60;
    input.connect(hp);
    if (presetName === 'electric') {
      const pre = ctx.createGain();
      pre.gain.value = 2.2;
      const shaper = ctx.createWaveShaper();
      shaper.curve = driveCurve(2.5);
      shaper.oversample = '2x';
      const cab = ctx.createBiquadFilter();
      cab.type = 'lowpass';
      cab.frequency.value = 3800;
      const post = ctx.createGain();
      post.gain.value = 0.45;
      hp.connect(pre).connect(shaper).connect(cab).connect(post);
      return post;
    }
    // A gentle body resonance for acoustic-type strings.
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = presetName === 'harp' ? 220 : 110;
    body.Q.value = 1.2;
    body.gain.value = 4;
    const air = ctx.createBiquadFilter();
    air.type = 'peaking';
    air.frequency.value = 2600;
    air.Q.value = 0.8;
    air.gain.value = presetName === 'nylon' ? 0 : 2;
    hp.connect(body).connect(air);
    return air;
  });
}

export function pluck(engine, channel, midi, { velocity = 0.8, preset = 'acoustic', when = 0, pan = 0 } = {}) {
  const ctx = engine.ctx;
  if (!ctx || !channel) return null;
  const p = PLUCK_PRESETS[preset] || PLUCK_PRESETS.acoustic;
  const freq = midiToFreq(midi);
  const { buf, actual } = ksBuffer(ctx, freq, preset in PLUCK_PRESETS ? preset : 'acoustic', (Math.random() * 3) | 0);
  const t = ctx.currentTime + Math.max(0, when);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = freq / actual;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = Math.min(16000, 500 + freq * (2 + 14 * velocity));
  tone.Q.value = 0.4;
  const g = ctx.createGain();
  g.gain.value = p.gain * (0.18 + 0.82 * velocity * velocity);
  src.connect(tone).connect(g);
  connectPanned(ctx, g, channel.input, pan);
  src.start(t);
  return {
    stop(fade = 0.05) {
      const n = ctx.currentTime;
      g.gain.cancelScheduledValues(n);
      g.gain.setValueAtTime(g.gain.value, n);
      g.gain.linearRampToValueAtTime(0, n + fade);
      try { src.stop(n + fade + 0.02); } catch (e) { /* already stopped */ }
    },
  };
}

function connectPanned(ctx, node, dest, pan) {
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    node.connect(p).connect(dest);
  } else {
    node.connect(dest);
  }
}

/* ------------------------------------------------------------------ */
/* Keyboard patches                                                     */
/* ------------------------------------------------------------------ */

const waveCache = new WeakMap();
function wave(ctx, kind) {
  let m = waveCache.get(ctx);
  if (!m) { m = {}; waveCache.set(ctx, m); }
  if (m[kind]) return m[kind];
  let imag;
  if (kind === 'piano') imag = [0, 1, 0.62, 0.4, 0.3, 0.2, 0.13, 0.1, 0.07, 0.05, 0.035, 0.025, 0.018];
  else if (kind === 'organ') {
    // Drawbar organ, built on a base frequency one octave below the note.
    imag = new Array(17).fill(0);
    imag[1] = 0.55; imag[2] = 1; imag[3] = 0.3; imag[4] = 0.65; imag[6] = 0.35; imag[8] = 0.3; imag[12] = 0.12; imag[16] = 0.14;
  }
  const real = new Float32Array(imag.length);
  m[kind] = ctx.createPeriodicWave(real, Float32Array.from(imag));
  return m[kind];
}

function osc(ctx, type, freq, detune = 0) {
  const o = ctx.createOscillator();
  if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
  o.frequency.value = freq;
  o.detune.value = detune;
  return o;
}

export const KEY_PATCHES = {
  grand: 'Grand piano',
  epiano: 'Electric piano',
  organ: 'Organ',
  synth: 'Synth',
};

/** Starts a keyboard note. Returns an object with release(). */
export function keyNote(engine, channel, midi, velocity = 0.7, patch = 'grand') {
  const ctx = engine.ctx;
  if (!ctx || !channel) return { release() {} };
  const f = midiToFreq(midi);
  const t = ctx.currentTime;
  const v = clamp(velocity, 0.05, 1);
  const amp = ctx.createGain();
  amp.gain.value = 0;
  const pan = clamp((midi - 60) / 40, -0.6, 0.6);
  connectPanned(ctx, amp, channel.input, pan);
  const nodes = [];
  let releaseTau = 0.1;
  let tail = 0.8;
  let endAt = null; // natural end for decaying patches

  if (patch === 'epiano') {
    const car = osc(ctx, 'sine', f);
    const mod = osc(ctx, 'sine', f);
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(f * (0.6 + 2.6 * v), t);
    idx.gain.setTargetAtTime(f * 0.25, t + 0.005, 0.35);
    mod.connect(idx).connect(car.frequency);
    const bell = osc(ctx, 'sine', f * 4.02);
    const bellG = ctx.createGain();
    bellG.gain.setValueAtTime(0.12 * v, t);
    bellG.gain.setTargetAtTime(0, t, 0.12);
    bell.connect(bellG).connect(amp);
    car.connect(amp);
    nodes.push(car, mod, bell);
    const peak = 0.3 * (0.25 + 0.75 * v);
    const tau = lerp(2.8, 0.8, clamp((midi - 36) / 60, 0, 1));
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.003);
    amp.gain.setTargetAtTime(peak * 0.55, t + 0.003, 0.25);
    amp.gain.setTargetAtTime(0, t + 0.5, tau);
    releaseTau = 0.12;
    endAt = t + 0.5 + tau * 6;
  } else if (patch === 'organ') {
    const o = osc(ctx, wave(ctx, 'organ'), f / 2);
    const lfo = osc(ctx, 'sine', 6.3);
    const lfoG = ctx.createGain();
    lfoG.gain.value = 6;
    lfo.connect(lfoG).connect(o.detune);
    const trem = ctx.createGain();
    trem.gain.value = 0.85;
    const tremDepth = ctx.createGain();
    tremDepth.gain.value = 0.12;
    lfo.connect(tremDepth).connect(trem.gain);
    o.connect(trem).connect(amp);
    const perc = osc(ctx, 'sine', f * 3);
    const percG = ctx.createGain();
    percG.gain.setValueAtTime(0.08, t);
    percG.gain.setTargetAtTime(0, t, 0.08);
    perc.connect(percG).connect(amp);
    nodes.push(o, lfo, perc);
    const peak = 0.17 * (0.7 + 0.3 * v);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.012);
    releaseTau = 0.03;
    tail = 0.25;
  } else if (patch === 'synth') {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 5;
    lp.frequency.setValueAtTime(Math.min(15000, f * (2 + 12 * v)), t);
    lp.frequency.setTargetAtTime(f * 2.2, t + 0.01, 0.25);
    const a = osc(ctx, 'sawtooth', f, -8);
    const b = osc(ctx, 'sawtooth', f, 8);
    const sub = osc(ctx, 'square', f / 2);
    const subG = ctx.createGain();
    subG.gain.value = 0.25;
    a.connect(lp); b.connect(lp); sub.connect(subG).connect(lp);
    lp.connect(amp);
    nodes.push(a, b, sub);
    const peak = 0.13 * (0.4 + 0.6 * v);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.01);
    amp.gain.setTargetAtTime(peak * 0.7, t + 0.01, 0.2);
    releaseTau = 0.12;
  } else {
    // Grand piano: two slightly detuned harmonic oscillators, a closing filter
    // and a short hammer noise.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.4;
    lp.frequency.setValueAtTime(Math.min(16000, 400 + f * (2.5 + 12 * v)), t);
    lp.frequency.setTargetAtTime(Math.max(f * 1.6, 350), t + 0.01, 0.5 + (1 - v) * 0.3);
    const a = osc(ctx, wave(ctx, 'piano'), f, -3);
    const b = osc(ctx, wave(ctx, 'piano'), f, 3.5);
    a.connect(lp); b.connect(lp);
    lp.connect(amp);
    nodes.push(a, b);
    const hammer = engine.noiseSource();
    const hbp = ctx.createBiquadFilter();
    hbp.type = 'bandpass';
    hbp.frequency.value = clamp(f * 3, 600, 7000);
    hbp.Q.value = 1;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.12 * v, t);
    hg.gain.setTargetAtTime(0, t, 0.012);
    hammer.connect(hbp).connect(hg).connect(amp);
    hammer.start(t, Math.random());
    hammer.stop(t + 0.1);
    const peak = 0.3 * (0.15 + 0.85 * v * v);
    const tau = lerp(2.6, 0.45, clamp((midi - 30) / 66, 0, 1));
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.004);
    amp.gain.setTargetAtTime(peak * 0.5, t + 0.004, 0.09);
    amp.gain.setTargetAtTime(0, t + 0.25, tau);
    releaseTau = 0.09;
    endAt = t + 0.25 + tau * 7;
  }

  nodes.forEach((n) => n.start(t));
  if (endAt) nodes.forEach((n) => n.stop(endAt));
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      const n = ctx.currentTime;
      amp.gain.cancelScheduledValues(n);
      amp.gain.setValueAtTime(amp.gain.value, n);
      amp.gain.setTargetAtTime(0, n, releaseTau);
      nodes.forEach((o) => { try { o.stop(n + releaseTau * 8 + tail * 0.2); } catch (e) { /* stopped */ } });
    },
  };
}

/* ------------------------------------------------------------------ */
/* Drums                                                               */
/* ------------------------------------------------------------------ */

function env(g, t, peak, decay, attack = 0.002) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function noiseHit(engine, dest, t, { type = 'highpass', freq = 1000, q = 0.7, peak = 0.5, decay = 0.2 }) {
  const ctx = engine.ctx;
  const src = engine.noiseSource();
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, peak, decay);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 1.5);
  src.stop(t + decay + 0.05);
}

function metal(engine, dest, t, { peak = 0.3, decay = 0.08, hp = 7000 }) {
  const ctx = engine.ctx;
  const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 10000;
  bp.Q.value = 0.6;
  const hpF = ctx.createBiquadFilter();
  hpF.type = 'highpass';
  hpF.frequency.value = hp;
  const g = ctx.createGain();
  env(g, t, peak, decay, 0.001);
  bp.connect(hpF).connect(g).connect(dest);
  for (const r of ratios) {
    const o = osc(ctx, 'square', 40 * r);
    o.connect(bp);
    o.start(t);
    o.stop(t + decay + 0.05);
  }
}

function tom(engine, dest, t, v, f) {
  const ctx = engine.ctx;
  const o = osc(ctx, 'sine', f * 1.7);
  o.frequency.setValueAtTime(f * 1.7, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
  const g = ctx.createGain();
  env(g, t, 0.9 * v, 0.5);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 0.6);
  noiseHit(engine, dest, t, { type: 'lowpass', freq: 1800, peak: 0.25 * v, decay: 0.08 });
}

export const DRUMS = {
  kick(engine, dest, v, t) {
    const ctx = engine.ctx;
    const o = osc(ctx, 'sine', 160);
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
    const g = ctx.createGain();
    env(g, t, 0.95 * v, 0.55, 0.003);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.62);
    noiseHit(engine, dest, t, { type: 'highpass', freq: 1500, peak: 0.25 * v, decay: 0.015 });
  },
  snare(engine, dest, v, t) {
    const ctx = engine.ctx;
    noiseHit(engine, dest, t, { type: 'highpass', freq: 1200, peak: 0.62 * v, decay: 0.24 });
    noiseHit(engine, dest, t, { type: 'bandpass', freq: 3200, q: 0.8, peak: 0.25 * v, decay: 0.12 });
    const o = osc(ctx, 'triangle', 200);
    o.frequency.setValueAtTime(205, t);
    o.frequency.exponentialRampToValueAtTime(170, t + 0.08);
    const g = ctx.createGain();
    env(g, t, 0.55 * v, 0.11);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.2);
  },
  hihat(engine, dest, v, t) { metal(engine, dest, t, { peak: 0.38 * v, decay: 0.06 }); },
  openhat(engine, dest, v, t) { metal(engine, dest, t, { peak: 0.32 * v, decay: 0.45 }); },
  crash(engine, dest, v, t) {
    metal(engine, dest, t, { peak: 0.3 * v, decay: 1.6, hp: 4500 });
    noiseHit(engine, dest, t, { type: 'highpass', freq: 5000, peak: 0.3 * v, decay: 1.3 });
  },
  ride(engine, dest, v, t) {
    metal(engine, dest, t, { peak: 0.2 * v, decay: 1.1, hp: 5500 });
    noiseHit(engine, dest, t, { type: 'bandpass', freq: 6200, q: 2, peak: 0.18 * v, decay: 0.3 });
  },
  tomHigh(engine, dest, v, t) { tom(engine, dest, t, v, 210); },
  tomMid(engine, dest, v, t) { tom(engine, dest, t, v, 150); },
  tomFloor(engine, dest, v, t) { tom(engine, dest, t, v, 95); },
  clap(engine, dest, v, t) {
    for (let i = 0; i < 3; i++) {
      noiseHit(engine, dest, t + i * 0.011, { type: 'bandpass', freq: 1300, q: 0.9, peak: 0.9 * v, decay: 0.02 });
    }
    noiseHit(engine, dest, t + 0.033, { type: 'bandpass', freq: 1300, q: 0.9, peak: 0.75 * v, decay: 0.16 });
  },
};

/* ------------------------------------------------------------------ */
/* Mallet percussion (modal synthesis)                                 */
/* ------------------------------------------------------------------ */

export const MALLET_KINDS = {
  marimba: { label: 'Marimba', ratios: [1, 3.93, 9.66], amps: [1, 0.36, 0.1], decay: 1.0, transpose: 0, click: 0.1 },
  vibes: { label: 'Vibraphone', ratios: [1, 4.0, 10.0], amps: [1, 0.22, 0.05], decay: 2.6, transpose: 12, click: 0.05, tremolo: 5.2 },
  glock: { label: 'Glockenspiel', ratios: [1, 2.71, 5.15], amps: [1, 0.42, 0.2], decay: 1.6, transpose: 24, click: 0.04 },
  steel: { label: 'Steel drum', ratios: [1, 2, 3, 4.1], amps: [1, 0.55, 0.3, 0.12], decay: 0.9, transpose: 12, click: 0.03 },
};

export function mallet(engine, channel, midi, { velocity = 0.8, kind = 'marimba', pan = 0 } = {}) {
  const ctx = engine.ctx;
  if (!ctx || !channel) return;
  const k = MALLET_KINDS[kind] || MALLET_KINDS.marimba;
  const f = midiToFreq(midi + k.transpose);
  const t = ctx.currentTime;
  const v = clamp(velocity, 0.1, 1);
  const out = ctx.createGain();
  out.gain.value = 1;
  connectPanned(ctx, out, channel.input, pan);
  if (k.tremolo) {
    const lfo = osc(ctx, 'sine', k.tremolo);
    const depth = ctx.createGain();
    depth.gain.value = 0.3;
    out.gain.value = 0.7;
    lfo.connect(depth).connect(out.gain);
    lfo.start(t);
    lfo.stop(t + k.decay * 5);
  }
  const tau0 = k.decay * clamp(Math.pow(220 / f, 0.3), 0.35, 1.4);
  k.ratios.forEach((r, i) => {
    const pf = f * r;
    if (pf > 18000) return;
    const o = osc(ctx, 'sine', pf);
    const g = ctx.createGain();
    const peak = 0.3 * k.amps[i] * (i === 0 ? 0.3 + 0.7 * v : v * v);
    const tau = tau0 / (1 + i * 2.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.002, tau);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + tau * 7 + 0.05);
  });
  noiseHit(engine, out, t, { type: 'bandpass', freq: clamp(f * 5, 1500, 9000), q: 1.2, peak: k.click * v, decay: 0.018 });
}

/* ------------------------------------------------------------------ */
/* Theremin: one continuous voice                                       */
/* ------------------------------------------------------------------ */

export const THEREMIN_KINDS = { classic: 'Classic', warm: 'Warm', voice: 'Voice' };

export class ThereminVoice {
  constructor(engine, channel, kind = 'classic') {
    const ctx = engine.ctx;
    this.engine = engine;
    this.ctx = ctx;
    const t = ctx.currentTime;
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.amp.connect(channel.input);
    this.oscs = [];

    const lfo = osc(ctx, 'sine', 5.6);
    const vib = ctx.createGain();
    vib.gain.value = 12; // cents
    lfo.connect(vib);
    this.oscs.push(lfo);

    if (kind === 'voice') {
      const src = osc(ctx, 'sawtooth', 220);
      vib.connect(src.detune);
      const mix = ctx.createGain();
      mix.gain.value = 2.6;
      for (const [fq, q, gain] of [[650, 5, 1], [1080, 7, 0.6], [2650, 9, 0.25]]) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = fq;
        bp.Q.value = q;
        const g = ctx.createGain();
        g.gain.value = gain;
        src.connect(bp).connect(g).connect(mix);
      }
      mix.connect(this.amp);
      this.main = src;
      this.oscs.push(src);
    } else {
      const a = osc(ctx, kind === 'warm' ? 'triangle' : 'sine', 220);
      const b = osc(ctx, 'triangle', 220);
      vib.connect(a.detune);
      vib.connect(b.detune);
      const bg = ctx.createGain();
      bg.gain.value = kind === 'warm' ? 0.3 : 0.1;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = kind === 'warm' ? 1600 : 4000;
      a.connect(lp);
      b.connect(bg).connect(lp);
      lp.connect(this.amp);
      this.main = a;
      this.second = b;
      this.oscs.push(a, b);
    }
    this.oscs.forEach((o) => o.start(t));
  }

  set(freq, level) {
    const n = this.ctx.currentTime;
    this.main.frequency.setTargetAtTime(freq, n, 0.025);
    if (this.second) this.second.frequency.setTargetAtTime(freq, n, 0.025);
    this.amp.gain.setTargetAtTime(clamp(level, 0, 1) * 0.3, n, 0.04);
  }

  stop() {
    const n = this.ctx.currentTime;
    this.amp.gain.cancelScheduledValues(n);
    this.amp.gain.setTargetAtTime(0, n, 0.05);
    this.oscs.forEach((o) => { try { o.stop(n + 0.5); } catch (e) { /* stopped */ } });
  }
}
