import { Instrument } from './base.js';
import { VString, CrossingDetector, pluckVelocity, FONT } from './common.js';
import { scaleNotes, noteColor, pitchClassName } from '../audio/music.js';
import { pluck, pluckChannel, prewarmPluck } from '../audio/synths.js';

const FINGER_SETS = { one: [8], two: [8, 12], all: [4, 8, 12, 16, 20] };

export class Harp extends Instrument {
  static id = 'harp';
  static label = 'Harp';
  static icon = '<path d="M6 21V4c4.5 0 8.5 3.5 13 3.5"/><path d="M6 21h12.5L19 7.5"/><path d="M10 5.3V21M14 6.8V21" opacity=".7"/>';
  static hint = 'Sweep your fingers sideways across the strings. Low notes are on the left. Key and scale are in Settings.';
  static settings = [
    { key: 'count', label: 'Strings', type: 'select', options: [[12, '12'], [16, '16'], [20, '20'], [24, '24']], default: 16 },
    { key: 'fingers', label: 'Pluck with', type: 'select', options: [['one', 'Index finger'], ['two', 'Index and middle'], ['all', 'All fingers']], default: 'two' },
    { key: 'sound', label: 'Sound', type: 'select', options: [['harp', 'Concert harp'], ['koto', 'Koto'], ['nylon', 'Nylon guitar']], default: 'harp' },
  ];

  constructor(app) {
    super(app);
    this.crossing = new CrossingDetector(5);
    this.strings = [];
  }

  makeChannel() { return pluckChannel(this.engine, this.opts.sound); }
  activate() { this.prewarm(); }
  audioReady() { this.prewarm(); }
  prewarm() { prewarmPluck(this.engine, this.notes(), this.opts.sound); }

  notes() {
    const g = this.global;
    const n = Number(this.opts.count);
    return scaleNotes(g.key, g.scale, n >= 20 ? 36 : 45, n);
  }

  settingsChanged() { this.resetChannel(); this.prewarm(); this.layout(); }

  layout() {
    const { W } = this;
    const st = this.stage;
    const notes = this.notes();
    const n = notes.length;
    const x0 = W * 0.07, x1 = W * 0.93;
    this.base = st.bottom - 34;
    this.strings = notes.map((m, i) => {
      const f = n > 1 ? i / (n - 1) : 0;
      const x = x0 + (x1 - x0) * f;
      const topY = st.top + 30 + (this.base - st.top) * 0.42 * f;
      return new VString({ x, y: topY }, { x, y: this.base }, m, { width: 3.2 - 1.8 * f });
    });
    this.crossing.reset();
  }

  update(hands, dt, t) {
    const tips = FINGER_SETS[this.opts.fingers] || FINGER_SETS.two;
    for (const hit of this.crossing.detect(this.strings, hands, tips)) {
      const s = hit.string;
      if (t - s.lastPluck < 0.13) continue; // fingers crossing together count once
      s.lastPluck = t;
      const vel = pluckVelocity(hit.normalSpeed, this.H);
      if (s.voice) s.voice.stop(0.04);
      s.voice = pluck(this.engine, this.channel, s.midi, {
        velocity: vel,
        preset: this.opts.sound,
        when: hit.u * Math.min(hit.hand.sampleDt, 0.05),
        pan: (s.a.x / this.W - 0.5) * 1.3,
      });
      s.excite(vel);
    }
    this.strings.forEach((s) => s.step(dt));
  }

  draw(ctx) {
    if (!this.strings.length) return;
    const first = this.strings[0], last = this.strings[this.strings.length - 1];
    // Neck curve along the string tops and the soundboard along the bottom
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.45)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(first.a.x - 24, first.a.y - 6);
    const mid = this.strings[Math.floor(this.strings.length / 2)];
    ctx.quadraticCurveTo(mid.a.x, mid.a.y - 40, last.a.x + 24, last.a.y - 6);
    ctx.stroke();
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.3)';
    ctx.beginPath();
    ctx.moveTo(first.b.x - 24, this.base + 4);
    ctx.lineTo(last.b.x + 24, this.base + 4);
    ctx.stroke();

    this.strings.forEach((s) => s.draw(ctx, { colorAtRest: true, maxDisp: 10 }));

    ctx.font = `600 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    this.strings.forEach((s) => {
      ctx.fillStyle = noteColor(s.midi, 0.85, 78);
      ctx.fillText(pitchClassName(s.midi), s.b.x, this.base + 14);
    });
  }
}
