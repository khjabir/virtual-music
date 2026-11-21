// Backing tracks: drums, bass and chords that play along in a chosen style.
// The chords follow whatever chord you hold on the guitar neck; on other instruments
// they cycle through a four-bar progression in the current key.
import { DRUMS, bassNote, chordVoice, keyNote } from '../audio/synths.js';
import { STYLES, progression, parseChord, degree } from './patterns.js';

export class Backing {
  constructor(app) {
    this.app = app;
    this.t = app.transport;
    this.style = 'off';
    this.level = 0.6;
    this.chord = null;
    this.channel = null;
    this.listeners = new Set();
    this.t.addScheduler((from, until) => this.schedule(from, until));
  }

  onChange(fn) { this.listeners.add(fn); }
  changed() { this.listeners.forEach((fn) => fn(this)); }

  get on() { return this.style !== 'off'; }

  setStyle(style, adoptTempo = true) {
    this.style = STYLES[style] ? style : 'off';
    if (this.on) {
      if (!this.channel && this.app.audio.ctx) {
        this.channel = this.app.audio.channel();
        this.channel.out.gain.value = this.level;
      }
      if (adoptTempo && !this.app.looper.hasLoop) this.t.setBpm(STYLES[this.style].bpm);
      if (!this.t.playing) this.t.start(0);
    }
    this.changed();
  }

  /** Chord for a bar: live from the guitar when it is on screen, otherwise the progression. */
  chordFor(bar) {
    const inst = this.app.instrument;
    if (inst && inst.id === 'guitar' && inst.chords) return inst.chords[inst.chordIndex];
    const g = this.app.settings.global;
    const prog = progression(g.key, g.scale);
    return prog[((bar % prog.length) + prog.length) % prog.length];
  }

  schedule(from, until) {
    if (!this.on || !this.channel) return;
    const style = STYLES[this.style];
    const t = this.t;
    const step = 0.25; // a sixteenth note, in beats
    const s0 = Math.ceil(t.beatAt(from) / step - 1e-6);
    for (let s = s0; t.timeAt(s * step) < until; s++) {
      if (s < 0) continue;
      const i = s % 16;
      const bar = Math.floor(s / 16);
      let time = t.timeAt(s * step);
      if (style.swing && i % 2 === 1) time += style.swing * step * t.spb;
      const name = this.chordFor(bar);
      const chord = parseChord(name);
      if (i === 0 && name !== this.chord) { this.chord = name; setTimeout(() => this.changed(), Math.max(0, (time - this.app.audio.now) * 1000)); }
      this.#drums(style, i, bar, time);
      this.#bass(style, i, chord, time);
      this.#comp(style, i, chord, time);
    }
  }

  #drums(style, i, bar, time) {
    const dest = this.channel.input;
    for (const [pad, steps] of Object.entries(style.drums)) {
      const v = steps[i];
      if (v) DRUMS[pad](this.app.audio, dest, v * 0.8, time);
    }
    if (style.crashEvery && i === 0 && bar % style.crashEvery === 0) DRUMS.crash(this.app.audio, dest, 0.5, time);
  }

  #bass(style, i, chord, time) {
    for (const [step, deg, len] of style.bass) {
      if (step !== i) continue;
      const midi = 36 + ((chord.root + 2) % 12) - 2 + degree(deg, chord);
      bassNote(this.app.audio, this.channel.input, midi, 0.8, time, len * 0.25 * this.t.spb * 0.95, this.style === 'funk' ? 'pluck' : 'round');
    }
  }

  #comp(style, i, chord, time) {
    const comp = style.comp;
    for (const [step, len] of comp.hits) {
      if (step !== i) continue;
      const base = 48 + chord.root + (chord.root < 5 ? 12 : 0); // keeps chords between F3 and E4
      const tones = comp.power ? [0, 7, 12] : chord.tones;
      const midis = tones.map((x) => base + x);
      const dur = len * 0.25 * this.t.spb;
      if (comp.sound === 'stab') {
        chordVoice(this.app.audio, this.channel.input, midis, comp.vel, time, dur, 'stab');
      } else {
        const when = Math.max(0, time - this.app.audio.now);
        for (const m of midis) {
          const v = keyNote(this.app.audio, this.channel, m, comp.vel, comp.sound === 'epiano' ? 'epiano' : 'grand', when);
          v.release(time + dur);
        }
      }
    }
  }
}
