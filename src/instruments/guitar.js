import { Instrument } from './base.js';
import { VString, CrossingDetector, pluckVelocity, roundRect, FONT } from './common.js';
import { CHORD_SETS, chordNotes, GUITAR_TUNING, noteColor, noteName } from '../audio/music.js';
import { pluck, pluckChannel, prewarmPluck } from '../audio/synths.js';
import { later } from '../core/bus.js';

const THICKNESS = [3.4, 2.8, 2.3, 1.9, 1.5, 1.2];

export class Guitar extends Instrument {
  static id = 'guitar';
  static label = 'Guitar';
  static icon = '<circle cx="8" cy="16" r="5"/><circle cx="12.2" cy="11.6" r="3.3"/><path d="M14.6 9.4 20.5 3.5"/><circle cx="8" cy="16" r="1.4"/>';
  static hint = 'Hold your left hand over the neck to pick a chord, and strum across the strings with your right index finger. Left-handed players can flip sides in Settings.';
  static settings = [
    { key: 'chordSet', label: 'Chords', type: 'select', options: Object.entries(CHORD_SETS).map(([k, v]) => [k, v.label]), default: 'pop' },
    { key: 'sound', label: 'Sound', type: 'select', options: [['acoustic', 'Acoustic'], ['nylon', 'Nylon'], ['electric', 'Electric with overdrive']], default: 'acoustic' },
  ];

  constructor(app) {
    super(app);
    this.crossing = new CrossingDetector(6);
    this.chordIndex = 0;
    this.hoverIndex = -1;
    this.chordFlash = 0;
    this.strings = [];
  }

  makeChannel() { return pluckChannel(this.engine, this.opts.sound); }

  activate() { this.prewarm(); }
  audioReady() { this.prewarm(); }

  prewarm() {
    const midis = [];
    for (const name of CHORD_SETS[this.opts.chordSet].chords) chordNotes(name).forEach((m) => m != null && midis.push(m));
    prewarmPluck(this.engine, midis, this.opts.sound);
  }

  settingsChanged() {
    this.resetChannel();
    this.chordIndex = Math.min(this.chordIndex, this.chords.length - 1);
    this.prewarm();
    this.layout();
  }

  /** Song mode can swap in the chords a song needs. */
  get chords() { return this.songChords || CHORD_SETS[this.opts.chordSet].chords; }

  setSongChords(list) {
    this.songChords = list && list.length ? list : null;
    this.chordIndex = 0;
    this.layout();
  }

  layout() {
    const { W, H } = this;
    const lefty = this.global.lefty;
    const st = this.stage;
    // Kept in the upper-middle of the frame so the whole hand stays visible while strumming.
    this.top = Math.max(st.top + 70, H * 0.28);
    this.bottom = Math.min(st.bottom - 60, H * 0.64);
    const neck = lefty ? [W * 0.53, W * 0.97] : [W * 0.03, W * 0.47];
    const strum = lefty ? [W * 0.03, W * 0.5] : [W * 0.5, W * 0.97];
    this.neck = neck;
    this.strum = strum;
    const n = this.chords.length;
    this.cells = Array.from({ length: n }, (_, i) => {
      const x0 = neck[0] + ((neck[1] - neck[0]) * i) / n;
      return { x0, x1: x0 + (neck[1] - neck[0]) / n };
    });
    const pad = (this.bottom - this.top) * 0.18;
    this.zoneY = [this.top - pad - 40, this.bottom + pad];
    this.strings = GUITAR_TUNING.map((m, i) => {
      const y = this.top + ((this.bottom - this.top) * i) / 5;
      return new VString({ x: W * 0.03, y }, { x: W * 0.97, y }, m, { width: THICKNESS[i] });
    });
    this.crossing.reset();
    this.applyChord();
  }

  applyChord() {
    const notes = chordNotes(this.chords[this.chordIndex]);
    this.strings.forEach((s, i) => {
      s.midi = notes[i] ?? GUITAR_TUNING[i];
      s.muted = notes[i] == null;
    });
  }

  inNeck(p) { return p.x >= this.neck[0] && p.x <= this.neck[1] && p.y >= this.zoneY[0] && p.y <= this.zoneY[1]; }
  inStrum(p) { return p.x >= this.strum[0] && p.x <= this.strum[1]; }

  update(hands, dt) {
    this.hoverIndex = -1;
    for (const h of hands) {
      const p = h.points[8];
      if (!this.inNeck(p)) continue;
      const i = this.cells.findIndex((c) => p.x >= c.x0 && p.x < c.x1);
      if (i >= 0) this.hoverIndex = i;
    }
    if (this.hoverIndex >= 0 && this.hoverIndex !== this.chordIndex) {
      this.chordIndex = this.hoverIndex;
      this.chordFlash = 1;
      // Changing a chord shape damps the strings, like lifting fingers off the fretboard.
      this.strings.forEach((s) => { if (s.voice) { s.voice.stop(0.08); s.voice = null; } s.amp *= 0.3; });
      this.applyChord();
    }

    const hits = this.crossing.detect(this.strings, hands, [8]);
    for (const hit of hits) {
      if (!this.inStrum(hit.point)) continue;
      const s = hit.string;
      const vel = pluckVelocity(hit.normalSpeed, this.H);
      if (s.muted) { s.amp = Math.max(s.amp, 0.15); continue; }
      if (s.voice) s.voice.stop(0.03);
      const i = this.strings.indexOf(s);
      const delay = hit.u * Math.min(hit.hand.sampleDt, 0.05);
      s.voice = pluck(this.engine, this.channel, s.midi, { velocity: vel, preset: this.opts.sound, when: delay, pan: (i - 2.5) / 10 });
      s.excite(vel);
      this.emit({ type: 'hit', key: `s${i}`, string: i, midi: s.midi, vel, delay, chord: this.chords[this.chordIndex], x: hit.point.x, y: s.a.y });
    }
    this.strings.forEach((s) => s.step(dt));
    this.chordFlash *= Math.exp(-dt * 3);
  }

  playEvent(evt, when = 0) {
    if (evt.type !== 'hit') return;
    pluck(this.engine, this.channel, evt.midi, { velocity: evt.vel, preset: this.opts.sound, when, pan: ((evt.string ?? 2.5) - 2.5) / 10 });
    if (this.onScreen && this.strings[evt.string]) later(when, () => this.strings[evt.string].excite(evt.vel));
  }

  draw(ctx) {
    const { W, H, top, bottom } = this;
    const lefty = this.global.lefty;

    // Neck with chord positions
    const [n0, n1] = this.neck;
    ctx.fillStyle = 'rgba(18, 20, 43, 0.42)';
    roundRect(ctx, n0, top - 26, n1 - n0, bottom - top + 52, 18);
    ctx.fill();
    this.cells.forEach((c, i) => {
      const active = i === this.chordIndex;
      if (active) {
        ctx.fillStyle = `rgba(255, 209, 102, ${0.16 + 0.2 * this.chordFlash})`;
        roundRect(ctx, c.x0 + 4, top - 22, c.x1 - c.x0 - 8, bottom - top + 44, 14);
        ctx.fill();
      } else if (i === this.hoverIndex) {
        ctx.strokeStyle = 'rgba(255, 209, 102, 0.5)';
        ctx.lineWidth = 1.5;
        roundRect(ctx, c.x0 + 4, top - 22, c.x1 - c.x0 - 8, bottom - top + 44, 14);
        ctx.stroke();
      }
      if (i > 0) {
        ctx.strokeStyle = 'rgba(237, 235, 255, 0.28)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(c.x0, top - 18);
        ctx.lineTo(c.x0, bottom + 18);
        ctx.stroke();
      }
      ctx.fillStyle = active ? '#FFD166' : 'rgba(237, 235, 255, 0.78)';
      ctx.font = `${active ? 750 : 560} ${Math.round(Math.min(30, (c.x1 - c.x0) * 0.32))}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(this.chords[i], (c.x0 + c.x1) / 2, top - 40);
    });

    // Body: sound hole and bridge
    const [s0, s1] = this.strum;
    const cx = (s0 + s1) / 2;
    const cy = (top + bottom) / 2;
    const r = Math.min((s1 - s0) * 0.3, (bottom - top) * 0.75);
    ctx.fillStyle = 'rgba(18, 20, 43, 0.38)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.18)';
    ctx.stroke();
    const bx = lefty ? W * 0.045 : W * 0.955;
    ctx.fillStyle = 'rgba(237, 235, 255, 0.35)';
    roundRect(ctx, bx - 6, top - 16, 12, bottom - top + 32, 6);
    ctx.fill();

    // Current chord, large and faint inside the sound hole
    ctx.fillStyle = `rgba(255, 209, 102, ${0.28 + 0.4 * this.chordFlash})`;
    ctx.font = `850 ${Math.round(r * 0.85)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.chords[this.chordIndex], cx, cy + r * 0.04);

    this.strings.forEach((s) => s.draw(ctx));

    // Note names at the body end of each string
    ctx.font = `600 13px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = lefty ? 'left' : 'right';
    const lx = lefty ? W * 0.06 : W * 0.94;
    this.strings.forEach((s) => {
      ctx.fillStyle = s.muted ? 'rgba(237, 235, 255, 0.3)' : noteColor(s.midi, 0.9, 78);
      ctx.fillText(s.muted ? '×' : noteName(s.midi), lx, s.a.y - 12);
    });

  }
}
