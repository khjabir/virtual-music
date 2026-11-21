import { Instrument } from './base.js';
import { FONT, roundRect } from './common.js';
import { scaleRange, snapToScale, noteColor, noteName, midiToFreq, pitchClass, clamp } from '../audio/music.js';
import { BowedVoice, BOWED_KINDS } from '../audio/synths.js';
import { later } from '../core/bus.js';

/**
 * Violin, viola or cello. One hand chooses the note on the fingerboard (height), the other
 * bows: sideways speed sets how loud and bright the note is, and stopping the bow stops the
 * sound, just like the real thing.
 */
export class Violin extends Instrument {
  static id = 'violin';
  static label = 'Violin';
  static icon = '<path d="M14.5 3.5 20.5 9.5"/><path d="M9 9c-2.5-1-5 .5-5.5 3S5 17 7.5 18.5 13 20 14 17.5s-.5-4.5-.5-4.5L18 8.5"/><path d="M3 21 12 12"/>';
  static hint = 'Left hand: move up and down the fingerboard to choose the note. Right hand: move sideways through the bow area to bow. Faster bowing is louder; stop bowing and the note stops.';
  static settings = [
    { key: 'kind', label: 'Instrument', type: 'select', options: Object.entries(BOWED_KINDS).map(([k, v]) => [k, v.label]), default: 'violin' },
    { key: 'notes', label: 'Notes', type: 'select', options: [['scale', 'Snap to the scale'], ['chromatic', 'Every semitone'], ['free', 'Slide freely']], default: 'scale' },
    { key: 'vibrato', label: 'Automatic vibrato', type: 'toggle', default: true },
  ];

  constructor(app) {
    super(app);
    this.voice = null;
    this.midi = 64;
    this.level = 0;
    this.heldSince = 0;
    this.bowX = null;
    this.bowY = null;
    this.phase = 0;
  }

  settingsChanged() {
    if (this.voice) this.voice.stop();
    this.voice = null;
    this.resetChannel();
    this.layout();
  }

  deactivate() {
    if (this.voice) this.voice.stop();
    this.voice = null;
    super.deactivate();
  }

  get kind() { return BOWED_KINDS[this.opts.kind] || BOWED_KINDS.violin; }

  layout() {
    const { W } = this;
    const st = this.stage;
    const lefty = this.global.lefty;
    this.top = st.top + 30;
    this.bottom = st.bottom - 20;
    this.board = lefty ? [W * 0.62, W * 0.96] : [W * 0.04, W * 0.38];
    this.bow = lefty ? [W * 0.04, W * 0.56] : [W * 0.44, W * 0.96];
    const low = this.kind.low;
    this.low = low;
    this.high = low + 24;
    const g = this.global;
    this.ladder = this.opts.notes === 'scale' ? scaleRange(g.key, g.scale, low, this.high) : Array.from({ length: 25 }, (_, i) => low + i);
    this.strY = [0, 1, 2, 3].map((i) => this.top + (this.bottom - this.top) * (0.3 + i * 0.13));
  }

  yFor(m) { return this.bottom - ((m - this.low) / (this.high - this.low)) * (this.bottom - this.top); }

  update(hands, dt, t = 0) {
    if (!this.voice && this.channel) this.voice = new BowedVoice(this.engine, this.channel.input, this.opts.kind);
    const lefty = this.global.lefty;
    const inBoard = (p) => p.x >= this.board[0] - 30 && p.x <= this.board[1] + 30;
    const inBow = (p) => p.x >= this.bow[0] - 30 && p.x <= this.bow[1] + 30;
    let pitchHand = null, bowHand = null;
    const ptr = hands.find((h) => h.virtual);
    if (ptr) {
      pitchHand = bowHand = ptr; // mouse: height picks the note, sideways movement bows
    } else {
      for (const h of hands) {
        const p = h.points[8];
        if (!pitchHand && inBoard(p)) pitchHand = h;
        else if (!bowHand && inBow(h.center)) bowHand = h;
      }
      if (!pitchHand && hands.length === 2) {
        const sorted = [...hands].sort((a, b) => a.center.x - b.center.x);
        pitchHand = lefty ? sorted[1] : sorted[0];
        bowHand = lefty ? sorted[0] : sorted[1];
      }
    }

    if (pitchHand) {
      const y = pitchHand.points[8].y;
      const cont = this.low + clamp((this.bottom - y) / (this.bottom - this.top), 0, 1) * (this.high - this.low);
      let m = cont;
      if (this.opts.notes === 'scale') m = snapToScale(cont, this.global.key, this.global.scale);
      else if (this.opts.notes === 'chromatic') m = Math.round(cont);
      if (Math.round(m) !== Math.round(this.midi)) this.heldSince = t;
      this.midi = m;
    }

    let target = 0;
    if (bowHand) {
      const p = bowHand.virtual ? bowHand.points[8] : bowHand.center;
      const vx = bowHand.virtual ? bowHand.vel[8].x : bowHand.vel[9].x;
      const speed = Math.abs(vx) / this.W; // screen widths per second
      target = clamp((speed - 0.03) / 0.55, 0, 1) ** 0.8;
      this.bowX = p.x;
      this.bowY = p.y;
    } else {
      this.bowX = null;
    }
    const k = Math.min(1, dt * (target > this.level ? 30 : 9));
    this.level += (target - this.level) * k;
    this.phase += dt * 30 * (0.2 + this.level);

    const vib = this.opts.vibrato && t - this.heldSince > 0.3 ? 16 * this.level : 0;
    const played = this.midi + (this.app.faceBend || 0);
    if (this.voice) this.voice.set(midiToFreq(played), this.level, 0.35 + 0.65 * this.level, vib);
    this.report(played, this.level, t);
  }

  report(midi, level, t) {
    const last = this.lastReport;
    const changed = !last || Math.abs(midi - last.midi) > 0.04 || Math.abs(level - last.level) > 0.04;
    if (!changed || (last && t - last.t < 0.035 && level > 0.02)) return;
    if (last && last.level < 0.02 && level < 0.02) return;
    this.lastReport = { midi, level, t };
    this.emit({ type: 'cont', key: 'bow', midi, level, x: this.bowX ?? this.W / 2, y: this.yFor(midi) });
  }

  playEvent(evt, when = 0) {
    if (evt.type !== 'cont' || !this.channel) return;
    if (!this.pbVoice) this.pbVoice = new BowedVoice(this.engine, this.channel.input, this.opts.kind);
    later(when, () => { if (this.pbVoice) this.pbVoice.set(midiToFreq(evt.midi), evt.level, 0.35 + 0.65 * evt.level, 10 * evt.level); });
  }

  stopPlayback() {
    if (this.pbVoice) this.pbVoice.stop();
    this.pbVoice = null;
  }

  draw(ctx) {
    const [b0, b1] = this.board;
    const [w0, w1] = this.bow;
    const { top, bottom } = this;
    // Fingerboard with one line per note
    ctx.fillStyle = 'rgba(18, 20, 43, 0.5)';
    roundRect(ctx, b0, top - 14, b1 - b0, bottom - top + 28, 16);
    ctx.fill();
    ctx.font = `600 12px ${FONT}`;
    ctx.textBaseline = 'middle';
    const current = Math.round(this.midi);
    for (const m of this.ladder) {
      const y = this.yFor(m);
      const on = m === current && this.level > 0.05;
      const root = pitchClass(m) === this.global.key;
      ctx.strokeStyle = noteColor(m, on ? 0.95 : root ? 0.4 : 0.2);
      ctx.lineWidth = on ? 4 : root ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(b0 + 12, y);
      ctx.lineTo(b1 - 48, y);
      ctx.stroke();
      ctx.fillStyle = noteColor(m, on ? 1 : 0.7, 78);
      ctx.textAlign = 'right';
      ctx.fillText(noteName(m), b1 - 10, y);
    }
    // The bow area: four strings and a bow that follows your hand
    ctx.fillStyle = 'rgba(18, 20, 43, 0.35)';
    roundRect(ctx, w0, this.strY[0] - 40, w1 - w0, this.strY[3] - this.strY[0] + 80, 18);
    ctx.fill();
    this.strY.forEach((y, i) => {
      const amp = this.level * 4 * (i === 1 ? 1 : 0.4);
      ctx.strokeStyle = this.level > 0.05 && i === 1 ? noteColor(current, 0.85, 72) : 'rgba(226, 222, 255, 0.5)';
      ctx.lineWidth = 2.6 - i * 0.4;
      ctx.beginPath();
      for (let s = 0; s <= 30; s++) {
        const x = w0 + 20 + ((w1 - w0 - 40) * s) / 30;
        const yy = y + Math.sin(Math.PI * s / 30) * Math.sin(this.phase + i) * amp;
        if (s === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    });
    if (this.bowX != null) {
      const y = clamp(this.bowY, this.strY[0] - 30, this.strY[3] + 30);
      const half = (w1 - w0) * 0.32;
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(255, 209, 102, ${0.55 + 0.45 * this.level})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(this.bowX - half, y - 8);
      ctx.lineTo(this.bowX + half, y - 8);
      ctx.stroke();
      ctx.strokeStyle = `rgba(243, 240, 255, ${0.5 + 0.5 * this.level})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.bowX - half, y);
      ctx.lineTo(this.bowX + half, y);
      ctx.stroke();
    }
    // Big note name and loudness
    if (this.level > 0.05) {
      ctx.fillStyle = noteColor(current, 1, 80);
      ctx.font = `800 ${Math.round(Math.min(56, this.H * 0.07))}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(noteName(current), (w0 + w1) / 2, this.strY[0] - 56);
    }
    ctx.fillStyle = 'rgba(237, 235, 255, 0.55)';
    ctx.font = `600 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('Bow here: move sideways', (w0 + w1) / 2, this.strY[3] + 62);
    ctx.fillText('Fingerboard: up and down', (b0 + b1) / 2, bottom + 4);
  }
}
