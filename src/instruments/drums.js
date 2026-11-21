import { Instrument } from './base.js';
import { StrikeDetector, FONT } from './common.js';
import { DRUMS } from '../audio/synths.js';

// Positions are fractions of the screen; the layout mirrors for left-handed players.
const PADS = [
  { id: 'crash', label: 'Crash', x: 0.14, y: 0.3, rx: 0.115, ry: 0.085, hue: 42, cymbal: true },
  { id: 'tomHigh', label: 'High tom', x: 0.38, y: 0.29, rx: 0.09, ry: 0.07, hue: 194 },
  { id: 'tomMid', label: 'Mid tom', x: 0.62, y: 0.29, rx: 0.09, ry: 0.07, hue: 214 },
  { id: 'ride', label: 'Ride', x: 0.86, y: 0.3, rx: 0.115, ry: 0.085, hue: 42, cymbal: true },
  { id: 'hihat', label: 'Hi-hat', x: 0.12, y: 0.55, rx: 0.1, ry: 0.075, hue: 62, cymbal: true },
  { id: 'snare', label: 'Snare', x: 0.33, y: 0.57, rx: 0.105, ry: 0.08, hue: 272 },
  { id: 'kick', label: 'Kick', x: 0.5, y: 0.74, rx: 0.12, ry: 0.075, hue: 350 },
  { id: 'tomFloor', label: 'Floor tom', x: 0.67, y: 0.57, rx: 0.105, ry: 0.08, hue: 172 },
  { id: 'clap', label: 'Clap', x: 0.88, y: 0.55, rx: 0.09, ry: 0.07, hue: 140 },
];

export class Drums extends Instrument {
  static id = 'drums';
  static label = 'Drums';
  static icon = '<ellipse cx="12" cy="10" rx="8" ry="3"/><path d="M4 10v6.5c0 1.7 3.6 3 8 3s8-1.3 8-3V10"/><path d="M14 3.5 10.5 9M19.5 4.5 15 9.5"/>';
  static hint = 'Strike downward with your index fingers and stop on a drum, as if holding sticks. With a mouse, click a drum.';
  static settings = [
    { key: 'sensitivity', label: 'Sensitivity', type: 'range', min: 0.5, max: 2, step: 0.05, default: 1 },
    { key: 'sticks', label: 'Hit with', type: 'select', options: [['index', 'Index fingertips'], ['palm', 'Whole hand']], default: 'index' },
  ];

  constructor(app) {
    super(app);
    this.strikes = new StrikeDetector();
    this.pads = [];
    this.ripples = [];
  }

  layout() {
    const { W, H } = this;
    const st = this.stage;
    const lefty = this.global.lefty;
    this.pads = PADS.map((p) => {
      const rx = p.rx * W;
      const ry = Math.min(p.ry * H, rx * 0.62);
      const cy = Math.min(Math.max(p.y * H, st.top + ry + 8), st.bottom - ry - 8);
      return { ...p, cx: (lefty ? 1 - p.x : p.x) * W, cy, rx, ry, flash: 0 };
    });
  }

  padAt(p) {
    let best = null, bestD = 1.25;
    for (const pad of this.pads) {
      const d = Math.hypot((p.x - pad.cx) / pad.rx, (p.y - pad.cy) / pad.ry);
      if (d < bestD) { bestD = d; best = pad; }
    }
    return best;
  }

  update(hands, dt) {
    const tips = this.opts.sticks === 'palm' ? [9] : [8];
    const hits = this.strikes.detect(hands, tips, this.H, (p) => this.padAt(p), Number(this.opts.sensitivity));
    for (const hit of hits) {
      const pad = hit.zone;
      if (this.channel) DRUMS[pad.id](this.engine, this.channel.input, hit.velocity, this.engine.now);
      pad.flash = 1;
      this.ripples.push({ pad, age: 0, v: hit.velocity });
    }
    this.pads.forEach((p) => { p.flash *= Math.exp(-dt * 6); });
    this.ripples.forEach((r) => { r.age += dt; });
    this.ripples = this.ripples.filter((r) => r.age < 0.5);
  }

  draw(ctx) {
    for (const p of this.pads) {
      const col = (a, l = 64) => `hsla(${p.hue}, 90%, ${l}%, ${a})`;
      ctx.beginPath();
      ctx.ellipse(p.cx, p.cy, p.rx, p.ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(18, 20, 43, 0.5)';
      ctx.fill();
      if (p.flash > 0.02) {
        ctx.fillStyle = col(0.55 * p.flash);
        ctx.fill();
      }
      ctx.lineWidth = 3;
      ctx.strokeStyle = col(0.55 + 0.45 * p.flash);
      ctx.stroke();
      if (p.cymbal) {
        for (const k of [0.66, 0.33]) {
          ctx.beginPath();
          ctx.ellipse(p.cx, p.cy, p.rx * k, p.ry * k, 0, 0, Math.PI * 2);
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = col(0.3);
          ctx.stroke();
        }
      } else {
        // Drum shell below the head, to suggest depth
        ctx.beginPath();
        ctx.ellipse(p.cx, p.cy + p.ry * 0.35, p.rx, p.ry, 0, 0.15, Math.PI - 0.15);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = col(0.3);
        ctx.stroke();
      }
      ctx.fillStyle = `rgba(237, 235, 255, ${0.8 + 0.2 * p.flash})`;
      ctx.font = `650 ${Math.round(Math.min(18, p.rx * 0.2))}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.label, p.cx, p.cy);
    }
    for (const r of this.ripples) {
      const k = r.age / 0.5;
      ctx.beginPath();
      ctx.ellipse(r.pad.cx, r.pad.cy, r.pad.rx * (1 + 0.45 * k), r.pad.ry * (1 + 0.45 * k), 0, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${r.pad.hue}, 90%, 70%, ${(1 - k) * 0.7 * r.v})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}
