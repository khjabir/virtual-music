// Sampled keyboard sounds, streamed on demand from public CDNs:
//  - Grand piano: Salamander Grand Piano V3 (Alexander Holm, CC BY 3.0), via the
//    @audio-samples npm packages, two velocity layers so soft and hard presses differ in tone.
//  - Everything else: the FluidR3 General MIDI sound font (Frank Wen, CC BY 3.0), via
//    gleitz/midi-js-soundfonts.
// Samples sit every three semitones and are pitch-shifted at most one semitone.
// If a sample is not loaded (still downloading, or offline) the caller falls back to a synth.
import { clamp, lerp } from './music.js';

const SALAMANDER = (layer) => `https://cdn.jsdelivr.net/npm/@audio-samples/piano-mp3-velocity${layer}@1.0.5/audio/`;
const GM_BASE = 'https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@044fab8e1456bfafc5776e86dfd6bb8697149aef/FluidR3_GM/';
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const octave = (m) => Math.floor(m / 12) - 1;

/**
 * Keyboard sounds. `layers` lists velocity layers (softest first) with the top velocity each covers.
 * `synth` entries use the built-in synthesiser and work offline.
 */
export const KEYBOARD_SOUNDS = {
  grand: { label: 'Grand piano', salamander: true, layers: [{ v: 4, upTo: 0.42 }, { v: 11, upTo: 1 }], main: 1, gain: 1.15, release: 0.32, fallback: 'grand' },
  bright: { label: 'Bright piano', gm: 'bright_acoustic_piano', gain: 0.9, release: 0.3, fallback: 'grand' },
  epiano: { label: 'Electric piano', gm: 'electric_piano_1', gain: 1, release: 0.25, fallback: 'epiano' },
  fmpiano: { label: 'FM electric piano', gm: 'electric_piano_2', gain: 0.9, release: 0.25, fallback: 'epiano' },
  harpsichord: { label: 'Harpsichord', gm: 'harpsichord', gain: 0.8, release: 0.12, fallback: 'grand' },
  musicbox: { label: 'Music box', gm: 'music_box', gain: 0.9, release: 0.8, fallback: 'epiano' },
  vibes: { label: 'Vibraphone', gm: 'vibraphone', gain: 0.9, release: 0.6, fallback: 'epiano' },
  organ: { label: 'Jazz organ', gm: 'drawbar_organ', gain: 0.6, release: 0.06, loop: true, fallback: 'organ' },
  church: { label: 'Church organ', gm: 'church_organ', gain: 0.6, release: 0.3, loop: true, fallback: 'organ' },
  strings: { label: 'Strings', gm: 'string_ensemble_1', gain: 0.8, release: 0.45, loop: true, fallback: 'synth' },
  choir: { label: 'Choir', gm: 'choir_aahs', gain: 0.8, release: 0.45, loop: true, fallback: 'synth' },
  pad: { label: 'Warm pad', gm: 'pad_2_warm', gain: 0.7, release: 0.6, loop: true, fallback: 'synth' },
  nylon: { label: 'Nylon guitar', gm: 'acoustic_guitar_nylon', gain: 1, release: 0.25, fallback: 'grand' },
  'synth-grand': { label: 'Built-in piano (works offline)', synth: 'grand' },
  'synth-epiano': { label: 'Built-in electric piano (offline)', synth: 'epiano' },
  'synth-organ': { label: 'Built-in organ (offline)', synth: 'organ' },
  'synth-lead': { label: 'Built-in synth (offline)', synth: 'synth' },
};

const sets = new Map();

/** One sample set per sound, shared and kept for the session. */
export function sampleSet(engine, id) {
  if (!sets.has(id)) sets.set(id, new SampleSet(engine, id));
  return sets.get(id);
}

class SampleSet {
  constructor(engine, id) {
    this.engine = engine;
    this.id = id;
    this.def = KEYBOARD_SOUNDS[id];
    this.layers = this.def.salamander ? this.def.layers : [{ v: 0, upTo: 1 }];
    this.buffers = new Map(); // "layer:midi" -> AudioBuffer
    this.requested = new Set();
    this.total = 0;
    this.done = 0;
    this.failed = 0;
    this.queue = [];
    this.active = 0;
  }

  get progress() { return this.total ? (this.done + this.failed) / this.total : 1; }
  get loading() { return this.done + this.failed < this.total; }
  get unavailable() { return this.total > 0 && this.failed > this.total / 2; }

  url(layer, midi) {
    if (this.def.salamander) {
      return SALAMANDER(layer.v) + encodeURIComponent(`${SHARPS[midi % 12]}${octave(midi)}v${layer.v}.mp3`);
    }
    return `${GM_BASE}${this.def.gm}-mp3/${FLATS[midi % 12]}${octave(midi)}.mp3`;
  }

  /** Queue the samples needed for notes lo..hi, nearest to `focus` first. Main layer before others. */
  load(lo, hi, focus = (lo + hi) / 2) {
    if (!this.engine.ctx) return;
    const grid = [];
    for (let m = 21; m <= 108; m += 3) if (m >= lo - 2 && m <= hi + 2) grid.push(m);
    grid.sort((a, b) => Math.abs(a - focus) - Math.abs(b - focus));
    const order = [this.def.main ?? 0, ...this.layers.map((_, i) => i).filter((i) => i !== (this.def.main ?? 0))];
    for (const li of order) {
      for (const m of grid) {
        const key = `${li}:${m}`;
        if (this.requested.has(key)) continue;
        this.requested.add(key);
        this.queue.push([li, m]);
        this.total++;
      }
    }
    this.#pump();
  }

  #pump() {
    while (this.active < 6 && this.queue.length) {
      const [li, m] = this.queue.shift();
      this.active++;
      this.#fetch(li, m)
        .then(() => { this.done++; })
        .catch((err) => { this.failed++; console.warn(`Sample ${this.id} ${m} failed`, err); })
        .finally(() => { this.active--; this.#pump(); });
    }
  }

  async #fetch(li, m) {
    const res = await fetch(this.url(this.layers[li], m), { cache: 'force-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.arrayBuffer();
    const buf = await this.engine.ctx.decodeAudioData(data);
    this.buffers.set(`${li}:${m}`, this.#trim(buf, m));
  }

  /** Piano samples run up to 20 s; keep the useful part (mono) to save memory. */
  #trim(buf, m) {
    if (!this.def.salamander) return buf;
    const ctx = this.engine.ctx;
    const keep = Math.min(buf.length, Math.floor(buf.sampleRate * lerp(9, 3.5, clamp((m - 21) / 87, 0, 1))));
    const out = ctx.createBuffer(1, keep, buf.sampleRate);
    const o = out.getChannelData(0);
    const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const fade = Math.floor(buf.sampleRate * 0.4);
    for (let i = 0; i < keep; i++) {
      let v = (L[i] + R[i]) * 0.5;
      if (i > keep - fade) v *= (keep - i) / fade;
      o[i] = v;
    }
    return out;
  }

  #nearest(li, midi) {
    // Prefer the closest sample; look further out while the closest is still downloading.
    let best = null;
    for (let d = 0; d <= 12; d++) {
      for (const s of d ? [-d, d] : [0]) {
        const m = midi + s;
        const b = this.buffers.get(`${li}:${m}`);
        if (b) { best = { buf: b, root: m }; break; }
      }
      if (best) break;
    }
    return best;
  }

  /** Plays a note. Returns a voice with release(), or null if nothing is loaded yet. */
  play(midi, velocity, dest, pan = 0) {
    const ctx = this.engine.ctx;
    if (!ctx) return null;
    let li = this.layers.findIndex((l) => velocity <= l.upTo);
    if (li < 0) li = this.layers.length - 1;
    let hit = this.#nearest(li, midi);
    if (!hit || Math.abs(hit.root - midi) > 2) {
      for (let j = 0; j < this.layers.length && (!hit || Math.abs(hit.root - midi) > 2); j++) {
        const alt = this.#nearest(j, midi);
        if (alt && (!hit || Math.abs(alt.root - midi) < Math.abs(hit.root - midi))) { hit = alt; li = j; }
      }
    }
    if (!hit) return null;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = hit.buf;
    src.playbackRate.value = Math.pow(2, (midi - hit.root) / 12);
    if (this.def.loop) {
      src.loop = true;
      src.loopStart = hit.buf.duration * 0.35;
      src.loopEnd = hit.buf.duration * 0.88;
    }
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1800 + 17000 * Math.pow(velocity, 1.5);
    const amp = ctx.createGain();
    const layered = this.layers.length > 1;
    const v = clamp(velocity, 0.05, 1);
    amp.gain.value = (this.def.gain || 1) * (layered ? 0.35 + 0.65 * v : 0.12 + 0.88 * Math.pow(v, 1.4));
    src.connect(tone).connect(amp);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -0.8, 0.8);
      amp.connect(p).connect(dest);
    } else {
      amp.connect(dest);
    }
    src.start(t);
    const release = this.def.release || 0.3;
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        const n = ctx.currentTime;
        amp.gain.cancelScheduledValues(n);
        amp.gain.setValueAtTime(amp.gain.value, n);
        amp.gain.setTargetAtTime(0, n, release / 4);
        try { src.stop(n + release * 2 + 0.05); } catch (e) { /* already stopped */ }
      },
    };
  }
}
