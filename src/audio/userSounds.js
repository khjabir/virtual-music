// Your own sounds: drop audio files onto drum pads, or record your voice (or anything)
// and play it as a piano sound. Stored in this browser with IndexedDB; nothing is uploaded.
import { sampleSet } from './sampler.js';
import { playBuffer } from './synths.js';

const DB = 'virtual-music';
const STORE = 'sounds';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
  });
}

/** Rough pitch of a recording (autocorrelation on its loudest part), as a MIDI note. */
export function detectPitch(buffer) {
  const d = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  let best = 0, at = 0;
  for (let i = 0; i < d.length - 2048; i += 1024) {
    let e = 0;
    for (let j = 0; j < 2048; j += 4) e += d[i + j] * d[i + j];
    if (e > best) { best = e; at = i; }
  }
  const n = 2048;
  let bestLag = 0, bestCorr = 0;
  for (let lag = Math.floor(sr / 1000); lag < Math.floor(sr / 70); lag++) {
    let c = 0;
    for (let i = 0; i < n; i++) c += d[at + i] * d[at + i + lag];
    if (c > bestCorr) { bestCorr = c; bestLag = lag; }
  }
  if (!bestLag) return 60;
  const f = sr / bestLag;
  return Math.round(69 + 12 * Math.log2(f / 440));
}

/** Trim silence from the start and end of a recording. */
function trim(ctx, buffer) {
  const d = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const th = peak * 0.06;
  let a = 0, b = d.length - 1;
  while (a < b && Math.abs(d[a]) < th) a++;
  while (b > a && Math.abs(d[b]) < th) b--;
  a = Math.max(0, a - Math.floor(buffer.sampleRate * 0.01));
  b = Math.min(d.length - 1, b + Math.floor(buffer.sampleRate * 0.1));
  const out = ctx.createBuffer(1, b - a + 1, buffer.sampleRate);
  const o = out.getChannelData(0);
  const gain = peak > 0 ? 0.9 / peak : 1;
  for (let i = a; i <= b; i++) o[i - a] = d[i] * gain;
  return out;
}

export class UserSounds {
  constructor(app) {
    this.app = app;
    this.pads = new Map(); // pad id -> AudioBuffer
    this.names = new Map(); // id -> file name
    this.voice = null; // { buffer, root, name }
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); }
  changed() { this.listeners.forEach((fn) => fn(this)); }

  /** Load everything saved in this browser (after audio has started). */
  async load() {
    const ctx = this.app.audio.ctx;
    if (!ctx || this.loaded) return;
    this.loaded = true;
    try {
      const all = await tx('readonly', (s) => s.getAll());
      for (const item of all || []) {
        const buf = await ctx.decodeAudioData(item.data.slice(0));
        if (item.id.startsWith('pad:')) { this.pads.set(item.id.slice(4), buf); this.names.set(item.id, item.name); }
        if (item.id === 'voice') this.#setVoice(buf, item.root, item.name);
      }
      this.changed();
    } catch (err) {
      console.warn('Saved sounds could not be loaded', err);
    }
  }

  padBuffer(id) { return this.pads.get(id) || null; }

  playPad(id, dest, vel, when = 0) {
    return playBuffer(this.app.audio, dest, this.pads.get(id), { velocity: vel, when });
  }

  async setPadFromFile(id, file) {
    const ctx = this.app.audio.ctx;
    const data = await file.arrayBuffer();
    const buf = await ctx.decodeAudioData(data.slice(0));
    this.pads.set(id, buf);
    this.names.set(`pad:${id}`, file.name);
    await tx('readwrite', (s) => s.put({ id: `pad:${id}`, name: file.name, data }));
    this.changed();
  }

  async resetPad(id) {
    this.pads.delete(id);
    this.names.delete(`pad:${id}`);
    await tx('readwrite', (s) => s.delete(`pad:${id}`));
    this.changed();
  }

  #setVoice(buffer, root, name) {
    this.voice = { buffer, root, name };
    sampleSet(this.app.audio, 'user').setUserBuffer(buffer, root);
  }

  /** Use an audio file as the piano's "My recorded sound". */
  async setVoiceFromFile(file) {
    const ctx = this.app.audio.ctx;
    const data = await file.arrayBuffer();
    const buf = trim(ctx, await ctx.decodeAudioData(data.slice(0)));
    await this.#saveVoice(buf, file.name);
  }

  async #saveVoice(buf, name) {
    const root = detectPitch(buf);
    this.#setVoice(buf, root, name);
    // Store as 16-bit WAV so it decodes anywhere
    await tx('readwrite', (s) => s.put({ id: 'voice', name, root, data: toWav(buf) }));
    this.changed();
  }

  async clearVoice() {
    this.voice = null;
    sampleSet(this.app.audio, 'user').setUserBuffer(null, 60);
    await tx('readwrite', (s) => s.delete('voice'));
    this.changed();
  }

  /** Record from the microphone for `seconds`. onLevel(0..1) shows a meter. */
  async recordVoice(seconds, onLevel) {
    const ctx = this.app.audio.ctx;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const wave = new Float32Array(an.fftSize);
    const meter = setInterval(() => {
      an.getFloatTimeDomainData(wave);
      let m = 0;
      for (const v of wave) m = Math.max(m, Math.abs(v));
      if (onLevel) onLevel(m);
    }, 50);
    const done = new Promise((resolve) => { rec.onstop = resolve; });
    rec.start();
    await new Promise((r) => setTimeout(r, seconds * 1000));
    rec.stop();
    await done;
    clearInterval(meter);
    stream.getTracks().forEach((tr) => tr.stop());
    src.disconnect();
    const blob = new Blob(chunks, { type: rec.mimeType });
    const buf = trim(ctx, await ctx.decodeAudioData(await blob.arrayBuffer()));
    await this.#saveVoice(buf, 'Microphone recording');
    return this.voice;
  }
}

function toWav(buf) {
  const d = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const out = new ArrayBuffer(44 + d.length * 2);
  const v = new DataView(out);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + d.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
  return out;
}
