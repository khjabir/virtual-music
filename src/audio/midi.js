// MIDI: send what you play to any synth, DAW or hardware (Web MIDI), and export
// loops and performances as standard .mid files.

// One MIDI channel per instrument (drums on channel 10, as General MIDI expects).
export const MIDI_CHANNELS = { guitar: 0, strings: 1, harp: 2, piano: 3, marimba: 4, theremin: 5, violin: 6, launchpad: 7, drums: 9 };

const vel7 = (v) => Math.max(1, Math.min(127, Math.round((v ?? 0.7) * 127)));

export class MidiOut {
  constructor(bus) {
    this.access = null;
    this.output = null;
    this.cont = new Map(); // instrument -> sounding note for continuous instruments
    this.onchange = null;
    bus.on((e) => this.handle(e));
  }

  get supported() { return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess; }

  async connect() {
    if (!this.supported) throw new Error('This browser has no Web MIDI. Try Chrome or Edge.');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => this.onchange && this.onchange();
    return this.outputs();
  }

  outputs() {
    return this.access ? [...this.access.outputs.values()].map((o) => ({ id: o.id, name: o.name })) : [];
  }

  select(id) {
    this.allOff();
    this.output = id && this.access ? this.access.outputs.get(id) || null : null;
  }

  send(bytes, at) {
    if (!this.output) return;
    try { this.output.send(bytes, at); } catch (err) { /* device went away */ }
  }

  handle(e) {
    if (!this.output || !(e.inst in MIDI_CHANNELS)) return;
    const ch = MIDI_CHANNELS[e.inst];
    const at = performance.now() + Math.max(0, (e.delay || 0) * 1000);
    if (e.type === 'hit' && e.midi != null) {
      this.send([0x90 | ch, e.midi, vel7(e.vel)], at);
      this.send([0x80 | ch, e.midi, 0], at + (ch === 9 ? 100 : 450));
    } else if (e.type === 'on') {
      this.send([0x90 | ch, e.midi, vel7(e.vel)], at);
    } else if (e.type === 'off') {
      this.send([0x80 | ch, e.midi, 0], at);
    } else if (e.type === 'cont') {
      // Continuous pitch: nearest note plus pitch bend (±2 semitones), loudness as expression (CC 11).
      const cur = this.cont.get(e.inst);
      if (e.level <= 0.02) {
        if (cur != null) this.send([0x80 | ch, cur, 0], at);
        this.cont.delete(e.inst);
        return;
      }
      const n = Math.round(e.midi);
      if (cur !== n) {
        if (cur != null) this.send([0x80 | ch, cur, 0], at);
        this.send([0x90 | ch, n, 100], at);
        this.cont.set(e.inst, n);
      }
      const bend = Math.max(0, Math.min(16383, Math.round(8192 + ((e.midi - n) / 2) * 8191)));
      this.send([0xe0 | ch, bend & 0x7f, bend >> 7], at);
      this.send([0xb0 | ch, 11, Math.round(Math.min(1, e.level) * 127)], at);
    }
  }

  allOff() {
    if (!this.output) return;
    for (let ch = 0; ch < 16; ch++) this.send([0xb0 | ch, 123, 0]);
    this.cont.clear();
  }
}

/**
 * Turns timed events ({ beat, evt }) into note pairs. Plucks and hits get a short length;
 * continuous instruments become a note each time the nearest pitch changes.
 */
export function eventsToNotes(items) {
  const notes = [];
  const open = new Map();
  const cont = new Map();
  const sorted = [...items].sort((a, b) => a.beat - b.beat);
  for (const { beat, evt } of sorted) {
    const ch = MIDI_CHANNELS[evt.inst] ?? 0;
    if (evt.type === 'hit' && evt.midi != null) {
      notes.push({ ch, midi: evt.midi, vel: vel7(evt.vel), start: beat, end: beat + (ch === 9 ? 0.25 : 0.5) });
    } else if (evt.type === 'on') {
      open.set(`${evt.inst}:${evt.key}`, { ch, midi: evt.midi, vel: vel7(evt.vel), start: beat });
    } else if (evt.type === 'off') {
      const k = `${evt.inst}:${evt.key}`;
      const o = open.get(k);
      if (o) { notes.push({ ...o, end: Math.max(beat, o.start + 0.05) }); open.delete(k); }
    } else if (evt.type === 'cont') {
      const cur = cont.get(evt.inst);
      const n = Math.round(evt.midi);
      if (cur && (evt.level <= 0.05 || cur.midi !== n)) {
        notes.push({ ...cur, end: Math.max(beat, cur.start + 0.05) });
        cont.delete(evt.inst);
      }
      if (evt.level > 0.05 && (!cont.get(evt.inst))) cont.set(evt.inst, { ch, midi: n, vel: vel7(evt.level), start: beat });
    }
  }
  const last = sorted.length ? sorted[sorted.length - 1].beat + 0.5 : 0;
  for (const o of [...open.values(), ...cont.values()]) notes.push({ ...o, end: Math.max(last, o.start + 0.25) });
  return notes;
}

/** A Standard MIDI File (format 0, 480 ticks per beat) from note pairs. */
export function writeMidiFile(notes, bpm = 120) {
  const PPQ = 480;
  const msgs = [];
  for (const n of notes) {
    msgs.push({ tick: Math.round(n.start * PPQ), data: [0x90 | n.ch, n.midi & 127, n.vel & 127] });
    msgs.push({ tick: Math.round(n.end * PPQ), data: [0x80 | n.ch, n.midi & 127, 0] });
  }
  msgs.sort((a, b) => a.tick - b.tick || (a.data[0] & 0xf0) - (b.data[0] & 0xf0));
  const track = [];
  const varLen = (v) => {
    const bytes = [v & 0x7f];
    while ((v >>= 7)) bytes.unshift((v & 0x7f) | 0x80);
    return bytes;
  };
  const tempo = Math.round(60000000 / bpm);
  track.push(0, 0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255);
  track.push(0, 0xff, 0x58, 4, 4, 2, 24, 8);
  let lastTick = 0;
  for (const m of msgs) {
    track.push(...varLen(Math.max(0, m.tick - lastTick)), ...m.data);
    lastTick = m.tick;
  }
  track.push(0, 0xff, 0x2f, 0);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255];
  const len = track.length;
  const trackHeader = [0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255];
  return new Uint8Array([...header, ...trackHeader, ...track]);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
