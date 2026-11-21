import { Instrument } from './base.js';
import { VString, CrossingDetector, pluckVelocity, projectT, signedDistance, FONT } from './common.js';
import { scaleNotes, noteColor, noteName, clamp } from '../audio/music.js';
import { pluck, pluckChannel, prewarmPluck } from '../audio/synths.js';
import { later } from '../core/bus.js';

const MAX_STRINGS = 14;
const RANGES = { low: 36, mid: 45, high: 55 };

/**
 * Draw your own strings in the air. Pinch and drag to stretch a string (or pinch with
 * both hands and pull them apart); its length sets the note. Swipe across to pluck.
 */
export class StringCanvas extends Instrument {
  static id = 'strings';
  static label = 'Draw strings';
  static icon = '<path d="M4 18 18 5"/><path d="M5 9.5 11.5 4" opacity=".55"/><path d="M11 20l9-7" opacity=".55"/><circle cx="4" cy="18" r="1.6"/><circle cx="18" cy="5" r="1.6"/>';
  static hint = 'Pinch thumb and index finger on both hands, then pull your hands apart to stretch a string between them. Let go to keep it. Longer strings play lower notes. Swipe a fingertip across a string to pluck it.';
  static settings = [
    { key: 'sound', label: 'Sound', type: 'select', options: [['harp', 'Harp'], ['acoustic', 'Guitar'], ['koto', 'Koto'], ['electric', 'Electric with overdrive']], default: 'harp' },
    { key: 'range', label: 'Range', type: 'select', options: [['low', 'Low'], ['mid', 'Middle'], ['high', 'High']], default: 'mid' },
    { key: 'drawWith', label: 'Draw strings with', type: 'select', options: [['two', 'Both hands pinching (recommended)'], ['one', 'One hand pinching']], default: 'two' },
  ];
  static actions = [{ id: 'undo', label: 'Undo string', key: 'Backspace' }, { id: 'clear', label: 'Clear strings', key: 'c' }];

  constructor(app) {
    super(app);
    this.crossing = new CrossingDetector(6);
    this.strings = [];
    this.draft = null;
    this.blocked = new Set(); // hands that must release their pinch before drawing again
    this.pinchSince = new Map(); // a pinch only counts once it has been held briefly
    this.waiting = null; // a hand pinching alone, waiting for the other hand
  }

  makeChannel() { return pluckChannel(this.engine, this.opts.sound); }
  activate() { this.prewarm(); }
  audioReady() { this.prewarm(); }
  prewarm() { prewarmPluck(this.engine, this.notes(), this.opts.sound); }

  notes() {
    const g = this.global;
    return scaleNotes(g.key, g.scale, RANGES[this.opts.range] || 45, 15);
  }

  settingsChanged() {
    this.resetChannel();
    this.prewarm();
    this.layout();
  }

  layout() {
    // Re-tune existing strings when the key, scale or range changes.
    this.strings.forEach((s) => { s.midi = this.noteForLength(s.length); });
  }

  noteForLength(L) {
    const notes = this.notes();
    const diag = Math.hypot(this.W, this.H);
    const x = clamp((L - diag * 0.06) / (diag * 0.62), 0, 1);
    return notes[Math.round((1 - x) * (notes.length - 1))];
  }

  action(id) {
    if (id === 'undo') this.strings.pop();
    if (id === 'clear') this.strings = [];
    this.crossing.reset();
  }

  commit(a, b, owner) {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const diag = Math.hypot(this.W, this.H);
    if (L < diag * 0.05) {
      // A tap rather than a drag: pluck the nearest string (handy on touch screens).
      if (owner && owner.virtual) {
        const near = this.strings.find((s) => Math.abs(signedDistance(b, s.a, s.b)) < 24 && projectT(b, s.a, s.b) >= 0 && projectT(b, s.a, s.b) <= 1);
        if (near) this.play(near, 0.7, 0);
      }
      return;
    }
    const s = new VString({ ...a }, { ...b }, this.noteForLength(L), { width: 2.4 });
    this.strings.push(s);
    if (this.strings.length > MAX_STRINGS) this.strings.shift();
    this.play(s, 0.5, 0);
  }

  play(s, vel, when) {
    if (s.voice) s.voice.stop(0.03);
    s.voice = pluck(this.engine, this.channel, s.midi, { velocity: vel, preset: this.opts.sound, when, pan: ((s.a.x + s.b.x) / 2 / this.W - 0.5) * 1.2 });
    s.excite(vel);
    this.emit({ type: 'hit', key: s.midi, midi: s.midi, vel, delay: when, x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 });
  }

  playEvent(evt, when = 0) {
    if (evt.type !== 'hit') return;
    pluck(this.engine, this.channel, evt.midi, { velocity: evt.vel, preset: this.opts.sound, when });
    if (this.onScreen) later(when, () => this.strings.filter((x) => x.midi === evt.midi).forEach((x) => x.excite(evt.vel)));
  }

  update(hands, dt, t) {
    const byId = new Map(hands.map((h) => [h.id, h]));
    for (const id of this.blocked) {
      const h = byId.get(id);
      if (!h || !h.pinching) this.blocked.delete(id);
    }
    for (const h of hands) {
      if (!h.pinching) this.pinchSince.delete(h.id);
      else if (!this.pinchSince.has(h.id)) this.pinchSince.set(h.id, t);
    }
    for (const id of this.pinchSince.keys()) if (!byId.has(id)) this.pinchSince.delete(id);
    // Camera pinches must be held for a moment, so a thumb brushing the index finger
    // while plucking never starts a string. Mouse and touch count at once.
    const steady = (h) => h.pinching && (h.virtual || t - this.pinchSince.get(h.id) >= 0.18);
    const pinchers = hands.filter((h) => steady(h) && !this.blocked.has(h.id));
    const twoHanded = this.opts.drawWith !== 'one';
    this.waiting = null;

    if (this.draft) {
      const owners = this.draft.owners.map((id) => byId.get(id));
      const still = owners.every((h) => h && h.pinching);
      if (this.draft.two) {
        if (still) {
          this.draft.a = { ...owners[0].pinchPoint };
          this.draft.b = { ...owners[1].pinchPoint };
        } else {
          this.commit(this.draft.a, this.draft.b, null);
          owners.forEach((h) => h && h.pinching && this.blocked.add(h.id));
          this.draft = null;
        }
      } else if (still) {
        const owner = owners[0];
        this.draft.b = { ...owner.pinchPoint };
        // A second hand pinching early turns this into a two-hand stretch.
        const other = pinchers.find((h) => h.id !== owner.id);
        const len = Math.hypot(this.draft.b.x - this.draft.a.x, this.draft.b.y - this.draft.a.y);
        if (other && len < 60) {
          this.draft = { two: true, owners: [owner.id, other.id], a: { ...owner.pinchPoint }, b: { ...other.pinchPoint } };
        }
      } else {
        this.commit(this.draft.a, this.draft.b, owners[0]);
        this.draft = null;
      }
    } else if (pinchers.length >= 2) {
      const [h1, h2] = pinchers;
      this.draft = { two: true, owners: [h1.id, h2.id], a: { ...h1.pinchPoint }, b: { ...h2.pinchPoint } };
    } else if (pinchers.length === 1) {
      const h = pinchers[0];
      if (h.virtual || !twoHanded) {
        this.draft = { two: false, owners: [h.id], a: { ...h.pinchPoint }, b: { ...h.pinchPoint } };
      } else {
        this.waiting = h;
      }
    }

    // Every hand that is not stretching a string can pluck, even if it briefly looks pinched.
    const drawing = new Set(this.draft ? this.draft.owners : []);
    const players = hands.filter((h) => !drawing.has(h.id) && !(h.virtual && h.pinching));
    for (const hit of this.crossing.detect(this.strings, players, [8])) {
      this.play(hit.string, pluckVelocity(hit.normalSpeed, this.H), hit.u * Math.min(hit.hand.sampleDt, 0.05));
    }
    this.strings.forEach((s) => s.step(dt));
    this.t = t;
  }

  draw(ctx) {
    const { W, H } = this;
    if (!this.strings.length && !this.draft) {
      ctx.fillStyle = 'rgba(237, 235, 255, 0.72)';
      ctx.font = `700 ${Math.round(Math.min(40, W * 0.045))}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.opts.drawWith === 'one' ? 'Pinch and drag to draw your first string' : 'Pinch with both hands and pull them apart', W / 2, H * 0.48);
      ctx.font = `500 17px ${FONT}`;
      ctx.fillStyle = 'rgba(237, 235, 255, 0.55)';
      ctx.fillText('With a mouse, click and drag. On a touch screen, touch with two fingers or drag one.', W / 2, H * 0.48 + 40);
    }

    for (const s of this.strings) {
      s.draw(ctx, { colorAtRest: true, label: true });
      for (const end of [s.a, s.b]) {
        ctx.fillStyle = noteColor(s.midi, 0.9, 74);
        ctx.beginPath();
        ctx.arc(end.x, end.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (this.waiting && !this.draft) {
      const p = this.waiting.pinchPoint;
      const pulse = 0.5 + 0.5 * Math.sin((this.t || 0) * 6);
      ctx.strokeStyle = `rgba(255, 209, 102, ${0.5 + 0.4 * pulse})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 14 + 4 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(237, 235, 255, 0.9)';
      ctx.font = `650 15px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Now pinch with your other hand', p.x, p.y - 26);
    }

    if (this.draft) {
      const { a, b } = this.draft;
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const tooShort = L < Math.hypot(W, H) * 0.05;
      const midi = this.noteForLength(L);
      ctx.save();
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = tooShort ? 'rgba(237, 235, 255, 0.4)' : noteColor(midi, 0.85, 74);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
      for (const p of [a, b]) {
        ctx.strokeStyle = '#FFD166';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (!tooShort) {
        ctx.fillStyle = noteColor(midi, 1, 80);
        ctx.font = `800 26px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(noteName(midi), (a.x + b.x) / 2, Math.min(a.y, b.y) - 14);
      }
    }
  }
}
