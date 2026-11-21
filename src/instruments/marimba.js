import { Instrument } from './base.js';
import { StrikeDetector, roundRect, FONT } from './common.js';
import { scaleNotes, noteColor, pitchClassName, clamp } from '../audio/music.js';
import { mallet, MALLET_KINDS } from '../audio/synths.js';
import { later } from '../core/bus.js';

export class Marimba extends Instrument {
  static id = 'marimba';
  static label = 'Marimba';
  static icon = '<rect x="3" y="4" width="3.2" height="16" rx="1.2"/><rect x="8.2" y="5.5" width="3.2" height="13" rx="1.2"/><rect x="13.4" y="7" width="3.2" height="10" rx="1.2"/><rect x="18.6" y="8.5" width="2.6" height="7" rx="1.2"/>';
  static hint = 'Tap down onto the bars with your index fingers, like striking with mallets. Bars on the left are lower.';
  static settings = [
    { key: 'kind', label: 'Sound', type: 'select', options: Object.entries(MALLET_KINDS).map(([k, v]) => [k, v.label]), default: 'marimba' },
    { key: 'count', label: 'Bars', type: 'select', options: [[10, '10'], [15, '15'], [20, '20']], default: 15 },
    { key: 'sensitivity', label: 'Sensitivity', type: 'range', min: 0.5, max: 2, step: 0.05, default: 1 },
  ];

  constructor(app) {
    super(app);
    this.strikes = new StrikeDetector();
    this.bars = [];
  }

  layout() {
    const { W, H } = this;
    const st = this.stage;
    const g = this.global;
    const notes = scaleNotes(g.key, g.scale, 48, Number(this.opts.count));
    const n = notes.length;
    const x0 = W * 0.05, x1 = W * 0.95, gap = Math.max(4, W * 0.006);
    const bw = (x1 - x0 - gap * (n - 1)) / n;
    const cy = st.top + (st.bottom - st.top) * 0.58;
    const hMax = Math.min((st.bottom - st.top) * 0.62, H * 0.44);
    this.bars = notes.map((m, i) => {
      const f = n > 1 ? i / (n - 1) : 0;
      const h = hMax * (1 - 0.45 * f);
      return { midi: m, x: x0 + i * (bw + gap), y: cy - h / 2, w: bw, h, flash: 0 };
    });
  }

  barAt(p) {
    for (const b of this.bars) {
      if (p.x >= b.x - 3 && p.x <= b.x + b.w + 3 && p.y >= b.y - 24 && p.y <= b.y + b.h + 24) return b;
    }
    return null;
  }

  update(hands, dt) {
    const hits = this.strikes.detect(hands, [8], this.H, (p) => this.barAt(p), Number(this.opts.sensitivity));
    for (const hit of hits) {
      const b = hit.zone;
      mallet(this.engine, this.channel, b.midi, { velocity: hit.velocity, kind: this.opts.kind, pan: ((b.x + b.w / 2) / this.W - 0.5) * 1.2 });
      b.flash = 1;
      this.emit({ type: 'hit', key: b.midi, midi: b.midi, vel: hit.velocity, x: b.x + b.w / 2, y: b.y + b.h / 2 });
    }
    this.bars.forEach((b) => { b.flash *= Math.exp(-dt * 5); });
  }

  playEvent(evt, when = 0) {
    if (evt.type !== 'hit') return;
    mallet(this.engine, this.channel, evt.midi, { velocity: evt.vel, kind: this.opts.kind, when });
    const b = this.onScreen && this.bars.find((x) => x.midi === evt.midi);
    if (b) later(when, () => { b.flash = 1; });
  }

  draw(ctx) {
    if (!this.bars.length) return;
    const first = this.bars[0], last = this.bars[this.bars.length - 1];
    // Rails the bars rest on
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.35)';
    ctx.lineWidth = 3;
    for (const k of [0.22, 0.78]) {
      ctx.beginPath();
      ctx.moveTo(first.x - 14, first.y + first.h * k);
      ctx.lineTo(last.x + last.w + 14, last.y + last.h * k);
      ctx.stroke();
    }
    for (const b of this.bars) {
      roundRect(ctx, b.x, b.y, b.w, b.h, Math.min(10, b.w * 0.25));
      ctx.fillStyle = noteColor(b.midi, 0.3 + 0.6 * b.flash, 40 + 25 * b.flash);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = noteColor(b.midi, 0.8, 70);
      ctx.stroke();
      // Resonator tube below each bar, longer for lower notes
      const tubeTop = b.y + b.h + 10;
      const tubeLen = clamp(Math.min(b.h * 0.3, this.stage.bottom - tubeTop - 6), 0, 64);
      ctx.fillStyle = 'rgba(237, 235, 255, 0.12)';
      roundRect(ctx, b.x + b.w * 0.3, tubeTop, b.w * 0.4, tubeLen, b.w * 0.2);
      ctx.fill();
      ctx.fillStyle = 'rgba(237, 235, 255, 0.85)';
      ctx.font = `650 ${Math.round(clamp(b.w * 0.32, 11, 16))}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pitchClassName(b.midi), b.x + b.w / 2, b.y + b.h / 2);
    }
  }
}
