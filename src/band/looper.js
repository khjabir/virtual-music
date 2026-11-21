// Loop station: record what you play for 1–8 bars, it repeats, and you layer more on top,
// on any instrument. Layers live in beats, so changing the tempo keeps them in time.
import { click } from '../audio/transport.js';
import { eventsToNotes, writeMidiFile, downloadBlob } from '../audio/midi.js';

const QUANT = { off: 0, '8': 0.5, '16': 0.25 };
let nextLayer = 1;

export class Looper {
  constructor(app) {
    this.app = app;
    this.t = app.transport;
    this.bars = 2;
    this.quantize = '16';
    this.layers = [];
    this.state = 'idle'; // idle | countin | recording
    this.rec = null;
    this.origin = 0;
    this.listeners = new Set();
    app.bus.on((e) => this.capture(e));
    this.t.addScheduler((from, until) => this.schedule(from, until));
    this.t.on((type) => { if (type === 'stop') this.silence(); this.changed(); });
  }

  get loopBeats() { return this.bars * this.t.beatsPerBar; }
  get hasLoop() { return this.layers.length > 0; }

  onChange(fn) { this.listeners.add(fn); }
  changed() { this.listeners.forEach((fn) => fn(this)); }

  setBars(n) {
    if (this.hasLoop || this.state !== 'idle') return false;
    this.bars = n;
    this.changed();
    return true;
  }

  /** Start recording a layer (with a one-bar count-in if nothing is playing yet), or cancel. */
  record() {
    if (!this.app.audio.ctx) return;
    if (this.state !== 'idle') { this.state = 'idle'; this.rec = null; this.changed(); return; }
    const t = this.t;
    let start;
    if (!t.playing) {
      t.start(-t.beatsPerBar);
      start = 0;
      this.origin = 0;
    } else if (!this.hasLoop) {
      start = t.nextBar();
      this.origin = start;
    } else {
      start = t.beat; // overdub right away, wrapping around the loop
    }
    this.rec = { start, items: [] };
    this.state = start > t.beat + 0.01 ? 'countin' : 'recording';
    this.changed();
  }

  capture(e) {
    if (this.state !== 'recording' || e.playback || !e.inst || e.inst === 'launchpad') return;
    const beat = this.t.beatAt(e.t);
    if (beat < this.rec.start - 0.05) return;
    this.rec.items.push({ beat: beat - this.rec.start, evt: { ...e } });
  }

  #finish() {
    const L = this.loopBeats;
    const q = QUANT[this.quantize] || 0;
    const offset = ((this.rec.start - this.origin) % L + L) % L;
    const items = [];
    const openOn = new Map();
    for (const it of this.rec.items) {
      let pos = it.beat + offset;
      if (q && it.evt.type !== 'cont') pos = Math.round(pos / q) * q;
      pos = ((pos % L) + L) % L;
      const evt = it.evt;
      if (evt.type === 'on') openOn.set(evt.key, pos);
      if (evt.type === 'off' && openOn.has(evt.key)) {
        const on = openOn.get(evt.key);
        if (Math.abs(pos - on) < q / 2) pos = (on + Math.max(q, 0.25) / 2) % L;
        openOn.delete(evt.key);
      }
      items.push({ pos, evt });
    }
    // Close notes still held when the loop ended, and fade continuous instruments out.
    const end = (offset + L - 0.02) % L;
    for (const [key] of openOn) {
      const on = items.find((x) => x.evt.type === 'on' && x.evt.key === key);
      if (on) items.push({ pos: end, evt: { ...on.evt, type: 'off' } });
    }
    const contInst = new Set(items.filter((x) => x.evt.type === 'cont').map((x) => x.evt.inst));
    for (const inst of contInst) items.push({ pos: end, evt: { type: 'cont', inst, midi: 60, level: 0 } });
    const counts = {};
    items.forEach((x) => { counts[x.evt.inst] = (counts[x.evt.inst] || 0) + 1; });
    const inst = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (items.length) this.layers.push({ id: nextLayer++, inst: inst ? inst[0] : this.app.instrument.id, items, muted: false });
    this.rec = null;
    this.state = 'idle';
    this.changed();
  }

  schedule(from, until) {
    const t = this.t;
    const L = this.loopBeats;
    const bFrom = t.beatAt(from), bTo = t.beatAt(until);
    // Count-in clicks when the metronome is off
    if (this.state === 'countin' && !t.metronome) {
      for (let b = Math.ceil(bFrom - 1e-6); b < Math.min(bTo, this.rec.start); b++) {
        if (b >= this.rec.start - t.beatsPerBar) click(this.app.audio, t.timeAt(b), b === this.rec.start - t.beatsPerBar);
      }
    }
    const now = t.beat;
    if (this.state === 'countin' && now >= this.rec.start) { this.state = 'recording'; this.changed(); }
    if (this.state === 'recording' && now >= this.rec.start + L) this.#finish();

    for (const layer of this.layers) {
      if (layer.muted) continue;
      for (const { pos, evt } of layer.items) {
        let n = Math.ceil((bFrom - this.origin - pos) / L - 1e-9);
        for (let beat = this.origin + n * L + pos; beat < bTo; n++, beat = this.origin + n * L + pos) {
          if (beat < bFrom) continue;
          const time = t.timeAt(beat);
          const inst = this.app.instances.get(evt.inst);
          if (!inst) continue;
          const when = Math.max(0, time - this.app.audio.now);
          inst.playEvent(evt, when);
          this.app.bus.emit({ ...evt, playback: true, t: time, delay: when });
        }
      }
    }
  }

  silence() {
    this.app.instances.forEach((inst) => inst.stopPlayback());
    if (this.state !== 'idle') { this.state = 'idle'; this.rec = null; }
  }

  toggleMute(id) {
    const l = this.layers.find((x) => x.id === id);
    if (l) { l.muted = !l.muted; if (l.muted) this.app.instances.get(l.inst)?.stopPlayback(); }
    this.changed();
  }

  remove(id) {
    const l = this.layers.find((x) => x.id === id);
    this.layers = this.layers.filter((x) => x.id !== id);
    if (l) this.app.instances.get(l.inst)?.stopPlayback();
    this.changed();
  }

  undo() { if (this.layers.length) this.remove(this.layers[this.layers.length - 1].id); }

  clear() {
    this.layers = [];
    this.silence();
    this.changed();
  }

  /** Download all unmuted layers as a MIDI file (one pass of the loop). */
  exportMidi() {
    const items = [];
    for (const l of this.layers) if (!l.muted) l.items.forEach((x) => items.push({ beat: x.pos, evt: x.evt }));
    if (!items.length) return false;
    const data = writeMidiFile(eventsToNotes(items), this.t.bpm);
    downloadBlob(new Blob([data], { type: 'audio/midi' }), `virtual-music-loop-${this.t.bpm}bpm.mid`);
    return true;
  }
}
