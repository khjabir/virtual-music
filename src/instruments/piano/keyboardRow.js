// One on-screen keyboard: the full key range, a zoomable/pannable window onto it,
// hit testing, and drawing. The window is measured in white keys.
import { roundRect, FONT } from '../common.js';
import { noteColor, clamp } from '../../audio/music.js';

const WHITE_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);
const LETTERS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const SOLFEGE = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];

export const ZOOM_STEPS = [7, 10, 12, 15, 17, 21, 24, 29, 36, 52];

export function keyLabel(midi, notation) {
  const pc = midi % 12;
  if (notation === 'solfege') return SOLFEGE[pc];
  if (notation === 'letters') return LETTERS[pc];
  return LETTERS[pc] + (Math.floor(midi / 12) - 1);
}

export class KeyboardRow {
  constructor(lo, hi, index = 0) {
    this.index = index;
    this.lo = lo;
    this.hi = hi;
    this.keys = [];
    let wi = -1;
    for (let m = lo; m <= hi; m++) {
      const white = WHITE_PCS.has(m % 12);
      if (white) wi++;
      this.keys.push({ midi: m, white, wi: white ? wi : wi + 1 }); // black keys sit at the left edge of white key `wi`
    }
    this.nWhite = wi + 1;
    this.whites = this.keys.filter((k) => k.white);
    this.blacks = this.keys.filter((k) => !k.white);
    this.byMidi = new Map(this.keys.map((k) => [k.midi, k]));
    this.count = Math.min(15, this.nWhite);
    this.start = 0;
    this.target = 0;
    this.rect = { x: 0, y: 0, w: 100, h: 100 };
  }

  setRect(x, y, w, h) { this.rect = { x, y, w, h }; }

  get ww() { return this.rect.w / this.count; }

  /** Show `count` white keys, keeping the key under anchorX (screen) or the centre in place. */
  setZoom(count, anchorX) {
    const c = clamp(count, 5, this.nWhite);
    const ax = anchorX ?? this.rect.x + this.rect.w / 2;
    const frac = (ax - this.rect.x) / this.rect.w;
    const at = this.target + frac * this.count;
    this.count = c;
    this.setStart(at - frac * c, true);
  }

  setStart(s, immediate = false) {
    this.target = clamp(s, 0, Math.max(0, this.nWhite - this.count));
    if (immediate) this.start = this.target;
  }

  pan(whiteKeys) { this.setStart(this.target + whiteKeys); }

  /** Centre the window on a fraction (0..1) of the whole keyboard. */
  centerOn(frac) { this.setStart(frac * this.nWhite - this.count / 2); }

  /** First C inside the window. */
  firstVisibleC() {
    const k = this.whites.find((w) => w.wi >= Math.floor(this.target + 0.01) && w.midi % 12 === 0);
    return k ? k.midi : this.whites[Math.round(this.target)].midi;
  }

  step(dt) {
    this.start += (this.target - this.start) * (1 - Math.exp(-dt * 14));
    if (Math.abs(this.target - this.start) < 0.001) this.start = this.target;
  }

  keyRect(k) {
    const { x, y, h } = this.rect;
    const ww = this.ww;
    if (k.white) return { x: x + (k.wi - this.start) * ww, y, w: ww, h };
    const bw = ww * 0.58;
    return { x: x + (k.wi - this.start) * ww - bw / 2, y, w: bw, h: h * 0.62 };
  }

  contains(px, py, slackTop = 0) {
    const r = this.rect;
    return px >= r.x && px <= r.x + r.w && py >= r.y - slackTop && py <= r.y + r.h;
  }

  /** Key under a screen point (black keys win in the upper part). */
  keyAt(px, py) {
    const r = this.rect;
    if (px < r.x || px > r.x + r.w) return null;
    const yy = Math.max(py, r.y + 1);
    if (yy < r.y + r.h * 0.62) {
      for (const k of this.blacks) {
        const kr = this.keyRect(k);
        if (px >= kr.x && px <= kr.x + kr.w) return k;
      }
    }
    const wi = Math.floor(this.start + (px - r.x) / this.ww);
    return this.whites[clamp(wi, 0, this.nWhite - 1)] || null;
  }

  centerX(k) {
    const kr = this.keyRect(k);
    return kr.x + kr.w / 2;
  }

  /**
   * @param state { held: (midi) => bool, flash: (midi) => 0..1, hover: (midi) => bool,
   *                labels: 'off'|'c'|'white'|'all', notation, felt: bool }
   */
  draw(ctx, state) {
    const { x, y, w, h } = this.rect;
    ctx.fillStyle = 'rgba(18, 20, 43, 0.6)';
    roundRect(ctx, x - 10, y - 14, w + 20, h + 24, 16);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y - 2, w, h + 6);
    ctx.clip();

    const ww = this.ww;
    const first = Math.max(0, Math.floor(this.start) - 1);
    const last = Math.min(this.nWhite - 1, Math.ceil(this.start + this.count) + 1);
    const showLabel = (k) => state.labels === 'all' || (state.labels === 'white' && k.white) || (state.labels === 'c' && k.midi % 12 === 0);

    for (let i = first; i <= last; i++) {
      const k = this.whites[i];
      const r = this.keyRect(k);
      const down = state.held(k.midi);
      const sink = down ? 3 : 0;
      roundRect(ctx, r.x + 1.2, r.y + sink, r.w - 2.4, r.h - sink, Math.min(8, ww * 0.18));
      if (down) {
        const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
        g.addColorStop(0, noteColor(k.midi, 1, 80));
        g.addColorStop(1, noteColor(k.midi, 1, 62));
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = 'rgb(240, 238, 252)';
      }
      ctx.fill();
      const f = state.flash(k.midi);
      if (f > 0.02 && !down) { ctx.fillStyle = noteColor(k.midi, f * 0.55, 70); ctx.fill(); }
      if (!down && state.hover(k.midi)) { ctx.fillStyle = 'rgba(255, 209, 102, 0.45)'; ctx.fill(); }
      // Shadow at the bottom edge gives the keys some depth
      ctx.fillStyle = down ? 'rgba(18, 20, 43, 0.12)' : 'rgba(18, 20, 43, 0.1)';
      ctx.fillRect(r.x + 1.2, r.y + r.h - 7, r.w - 2.4, 7);
      if (showLabel(k) || (down && state.labels !== 'off')) {
        const fs = Math.round(clamp(ww * 0.3, 9, 16));
        ctx.font = `${down ? 760 : 620} ${fs}px ${FONT}`;
        ctx.fillStyle = down ? 'rgba(18, 20, 43, 0.95)' : k.midi % 12 === 0 ? 'rgba(18, 20, 43, 0.7)' : 'rgba(18, 20, 43, 0.5)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(keyLabel(k.midi, state.notation), r.x + r.w / 2, r.y + r.h - 12);
      }
    }

    for (const k of this.blacks) {
      if (k.wi < first || k.wi > last + 1) continue;
      const r = this.keyRect(k);
      const down = state.held(k.midi);
      roundRect(ctx, r.x, r.y - 4, r.w, r.h + 4 + (down ? 2 : 0), Math.min(6, r.w * 0.2));
      ctx.fillStyle = down ? noteColor(k.midi, 1, 58) : 'rgb(30, 32, 66)';
      ctx.fill();
      if (!down) {
        // Highlight along the top of the key
        ctx.fillStyle = 'rgba(237, 235, 255, 0.07)';
        ctx.fillRect(r.x + r.w * 0.22, r.y, r.w * 0.56, r.h * 0.85);
      }
      const f = state.flash(k.midi);
      if (f > 0.02 && !down) {
        roundRect(ctx, r.x, r.y - 4, r.w, r.h + 4, Math.min(6, r.w * 0.2));
        ctx.fillStyle = noteColor(k.midi, f * 0.8, 58);
        ctx.fill();
      }
      if (!down && state.hover(k.midi)) {
        roundRect(ctx, r.x, r.y - 4, r.w, r.h + 4, Math.min(6, r.w * 0.2));
        ctx.fillStyle = 'rgba(255, 209, 102, 0.6)';
        ctx.fill();
      }
      if (state.labels === 'all' && r.w >= 16) {
        const fs = Math.round(clamp(r.w * 0.3, 8, 12));
        ctx.font = `620 ${fs}px ${FONT}`;
        ctx.fillStyle = down ? 'rgba(18, 20, 43, 0.95)' : 'rgba(237, 235, 255, 0.75)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const label = keyLabel(k.midi, state.notation === 'octave' ? 'letters' : state.notation);
        ctx.fillText(label, r.x + r.w / 2, r.y + r.h - 8);
      }
    }
    ctx.restore();

    // Felt strip along the back of the keys, like a real piano
    ctx.fillStyle = 'rgba(120, 30, 60, 0.9)';
    ctx.fillRect(x, y - 6, w, 5);
    if (state.pressLine) {
      ctx.fillStyle = 'rgba(255, 209, 102, 0.9)';
      ctx.fillRect(x, y - 2, w, 2);
    }
  }

  /** Mini map of the whole keyboard with the visible window outlined. */
  drawOverview(ctx, W, H, held) {
    ctx.clearRect(0, 0, W, H);
    const kw = W / this.nWhite;
    ctx.fillStyle = 'rgba(240, 238, 252, 0.9)';
    ctx.fillRect(0, 0, W, H);
    for (const k of this.whites) {
      if (held(k.midi)) {
        ctx.fillStyle = noteColor(k.midi, 1, 62);
        ctx.fillRect(k.wi * kw, 0, kw, H);
      }
      ctx.fillStyle = 'rgba(18, 20, 43, 0.25)';
      ctx.fillRect(k.wi * kw, 0, 1, H);
      if (k.midi % 12 === 0 && kw * 7 > 28) {
        ctx.fillStyle = 'rgba(18, 20, 43, 0.55)';
        ctx.font = `650 ${Math.round(Math.min(11, H * 0.32))}px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`C${Math.floor(k.midi / 12) - 1}`, k.wi * kw + 2, H - 2);
      }
    }
    for (const k of this.blacks) {
      ctx.fillStyle = held(k.midi) ? noteColor(k.midi, 1, 58) : 'rgb(30, 32, 66)';
      ctx.fillRect(k.wi * kw - kw * 0.3, 0, kw * 0.6, H * 0.58);
    }
    // Dim what is off screen and outline the visible window
    const x0 = this.start * kw, x1 = (this.start + this.count) * kw;
    ctx.fillStyle = 'rgba(18, 20, 43, 0.55)';
    ctx.fillRect(0, 0, x0, H);
    ctx.fillRect(x1, 0, W - x1, H);
    ctx.strokeStyle = '#FFD166';
    ctx.lineWidth = 3;
    ctx.strokeRect(x0 + 1.5, 1.5, x1 - x0 - 3, H - 3);
  }
}
