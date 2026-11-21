// Building blocks shared by several instruments: vibrating strings that can be
// plucked by crossing them, and strike detection for drums and mallets.
import { noteColor, noteName, clamp } from '../audio/music.js';

let nextStringId = 1;

export function signedDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  return ((p.x - a.x) * dy - (p.y - a.y) * dx) / L;
}

export function projectT(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy || 1;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
}

export class VString {
  constructor(a, b, midi, { width = 2 } = {}) {
    this.id = nextStringId++;
    this.a = a;
    this.b = b;
    this.midi = midi;
    this.width = width;
    this.amp = 0;
    this.glow = 0;
    this.phase = Math.random() * 6;
    this.muted = false;
    this.voice = null;
    this.lastPluck = -1;
  }

  get length() { return Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y); }

  excite(v) {
    this.amp = Math.min(1, Math.max(this.amp, 0.35 + 0.65 * v));
    this.glow = 1;
  }

  step(dt) {
    this.amp *= Math.exp(-dt * 1.5);
    this.glow *= Math.exp(-dt * 2.4);
    this.phase += dt * 2 * Math.PI * (11 + (this.midi % 12) * 0.35);
  }

  draw(ctx, { rest = 'rgba(226, 222, 255, 0.5)', colorAtRest = false, label = false, maxDisp = 14 } = {}) {
    const { a, b } = this;
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const disp = this.amp * Math.min(maxDisp, L * 0.05);
    const segs = 32;
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i <= segs; i++) {
        const s = i / segs;
        const o = disp * (Math.sin(Math.PI * s) * Math.sin(this.phase) + 0.3 * Math.sin(2 * Math.PI * s) * Math.sin(this.phase * 1.7));
        const x = a.x + dx * s + nx * o, y = a.y + dy * s + ny * o;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    };
    ctx.save();
    ctx.lineCap = 'round';
    if (this.muted) ctx.setLineDash([4, 8]);
    path();
    ctx.strokeStyle = this.muted ? 'rgba(226, 222, 255, 0.22)' : colorAtRest ? noteColor(this.midi, 0.6) : rest;
    ctx.lineWidth = this.width;
    ctx.stroke();
    if (this.glow > 0.02 && !this.muted) {
      ctx.strokeStyle = noteColor(this.midi, 0.28 * this.glow);
      ctx.lineWidth = this.width + 12 * this.glow;
      ctx.stroke();
      ctx.strokeStyle = noteColor(this.midi, Math.min(1, 0.4 + this.glow), 74);
      ctx.lineWidth = this.width + 0.5;
      ctx.stroke();
    }
    ctx.restore();
    if (label) {
      const m = { x: (a.x + b.x) / 2 + nx * 18, y: (a.y + b.y) / 2 + ny * 18 };
      ctx.fillStyle = noteColor(this.midi, 0.9, 78);
      ctx.font = '600 13px Recursive, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(noteName(this.midi), m.x, m.y);
    }
  }
}

/**
 * Detects fingertips crossing strings. Each (hand, fingertip, string) remembers which
 * side of the string it was on; a pluck happens when that side flips. A small dead zone
 * around the string keeps a resting finger from re-triggering.
 */
export class CrossingDetector {
  constructor(margin = 5) {
    this.margin = margin;
    this.sides = new Map();
  }

  reset() { this.sides.clear(); }

  detect(strings, hands, tips) {
    const hits = [];
    const alive = new Set();
    for (const hand of hands) {
      if (!hand.present || !hand.points) continue;
      for (const tip of hand.activeTips(tips)) {
        const p = hand.points[tip], q = hand.prev[tip];
        for (const s of strings) {
          const key = `${hand.id}:${tip}:${s.id}`;
          alive.add(key);
          const d = signedDistance(p, s.a, s.b);
          if (Math.abs(d) < this.margin) continue;
          const side = d > 0 ? 1 : -1;
          const old = this.sides.get(key);
          this.sides.set(key, side);
          if (old === undefined || old === side) continue;
          const tp = projectT(p, s.a, s.b), tq = projectT(q, s.a, s.b);
          if ((tp < -0.02 || tp > 1.02) && (tq < -0.02 || tq > 1.02)) continue; // went around the end
          const dq = signedDistance(q, s.a, s.b);
          const u = dq !== d ? clamp(dq / (dq - d), 0, 1) : 0;
          const normalSpeed = Math.abs(d - dq) / Math.max(hand.sampleDt, 1 / 120);
          hits.push({ string: s, hand, tip, u, normalSpeed, point: p });
        }
      }
    }
    if (this.sides.size > alive.size + 200) {
      for (const k of this.sides.keys()) if (!alive.has(k)) this.sides.delete(k);
    }
    hits.sort((a, b) => a.u - b.u);
    return hits;
  }
}

/** Velocity (0..1) from how fast a fingertip crossed, in screen heights per second. */
export const pluckVelocity = (normalSpeed, H) => clamp(0.3 + (normalSpeed / H) * 0.4, 0.3, 1);

/**
 * Drum-style strikes: a fast downward movement followed by a sudden slowdown is a hit,
 * like a stick bouncing off a drum head. Mouse and touch hit on press.
 */
export class StrikeDetector {
  constructor() { this.state = new Map(); }

  detect(hands, tips, H, zoneAt, sensitivity = 1) {
    const hits = [];
    const down = 0.7 / sensitivity; // screen heights per second
    const travel = 0.05 / sensitivity; // a stroke must move down at least this far
    for (const hand of hands) {
      if (!hand.present) continue;
      for (const tip of hand.activeTips(tips)) {
        const p = hand.points[tip];
        if (hand.virtual) {
          if (hand.tap) {
            const zone = zoneAt(p);
            if (zone) hits.push({ zone, hand, tip, velocity: 0.8, point: p });
          }
          continue;
        }
        if (!hand.fresh) continue;
        const key = `${hand.id}:${tip}`;
        let st = this.state.get(key);
        if (!st) this.state.set(key, (st = { stroke: false, peak: 0, zone: null, startY: 0 }));
        const vy = hand.vel[tip].y / H; // positive = moving down
        const zone = zoneAt(p);
        if (!st.stroke) {
          if (vy > down) Object.assign(st, { stroke: true, peak: vy, zone, startY: hand.prev[tip].y });
        } else {
          st.peak = Math.max(st.peak, vy);
          if (zone) st.zone = zone;
          if (vy < st.peak * 0.45 || vy < 0.25) {
            const hitZone = zone || st.zone;
            const moved = (p.y - st.startY) / H;
            if (hitZone && moved >= travel) {
              hits.push({ zone: hitZone, hand, tip, velocity: clamp(0.3 + (st.peak - 0.7) * 0.35, 0.3, 1), point: p });
            }
            Object.assign(st, { stroke: false, peak: 0, zone: null });
          }
        }
      }
    }
    if (this.state.size > 64) this.state.clear();
    return hits;
  }
}

/** Rounded rectangle path helper. */
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export const FONT = 'Recursive, system-ui, sans-serif';
