// Turns raw landmark detections into stable "hands" with ids, previous positions,
// velocities and simple gestures (pinch, extended fingers). Also provides
// virtual hands driven by the mouse or touch, so every instrument works without a camera.
import { OneEuro } from './oneEuro.js';

export const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
export const FINGERTIPS = [4, 8, 12, 16, 20];
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const VEL_POINTS = [0, 4, 8, 9, 12, 16, 20];

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class Hand {
  /** Seconds of motion prediction (0 = off). Set from the tracking settings. */
  static lead = 0;

  constructor(id, virtual = false) {
    this.id = id;
    this.virtual = virtual;
    this.points = null;
    this.prev = null;
    this.filters = [];
    this.vel = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
    this.sampleDt = 1 / 30;
    this.lastSeen = 0;
    this.fresh = false;
    this.present = true;
    this.pinching = false;
    this.pressing = false; // virtual hands: mouse button / touch held
    this.tap = false; // virtual hands: pressed during this frame
    this.label = null;
    this.size = 60;
    this.age = 0;
  }

  /** Fingertips this hand plays with. A mouse or touch point only has one. */
  activeTips(list) { return this.virtual ? [TIP.index] : list; }

  update(raw, t, smooth = true) {
    const filtered = raw.map((p, i) => {
      if (!smooth) return { x: p.x, y: p.y, z: p.z || 0 };
      let f = this.filters[i];
      if (!f) f = this.filters[i] = [new OneEuro(), new OneEuro()];
      return { x: f[0].filter(p.x, t), y: f[1].filter(p.y, t), z: p.z || 0 };
    });
    const dt = this.points ? Math.max(1 / 240, t - this.lastSeen) : 1 / 30;
    // Motion prediction: camera and model add some delay, so fast-moving points are pushed
    // ahead along their motion by Hand.lead seconds. Slow or still points are left alone.
    let pts = filtered;
    if (Hand.lead > 0 && this.filtered && !this.virtual) {
      pts = filtered.map((p, i) => {
        const q = this.filtered[i];
        const vx = (p.x - q.x) / dt, vy = (p.y - q.y) / dt;
        const k = Math.max(0, Math.min(1, (Math.hypot(vx, vy) - 150) / 450)) * Hand.lead;
        return { x: p.x + vx * k, y: p.y + vy * k, z: p.z };
      });
    }
    this.filtered = filtered;
    this.prev = this.points || pts;
    this.points = pts;
    this.sampleDt = dt;
    for (const i of VEL_POINTS) {
      this.vel[i] = { x: (pts[i].x - this.prev[i].x) / dt, y: (pts[i].y - this.prev[i].y) / dt };
    }
    this.lastSeen = t;
    this.fresh = true;
    this.present = true;
    this.age++;
    this.#features();
  }

  /** Called on frames without a new detection: no movement this frame. */
  idle() {
    this.prev = this.points;
    this.fresh = false;
  }

  #features() {
    const p = this.points;
    if (this.virtual) {
      this.size = 60;
      this.center = p[8];
      this.pinchPoint = p[8];
      this.pinching = this.pressing;
      this.extended = [true, true, true, true, true];
      return;
    }
    this.size = Math.max(20, dist(p[0], p[9]));
    const c = [0, 5, 9, 13, 17].reduce((a, i) => ({ x: a.x + p[i].x / 5, y: a.y + p[i].y / 5 }), { x: 0, y: 0 });
    this.center = c;
    const pinchRatio = dist(p[4], p[8]) / this.size;
    this.pinchRatio = pinchRatio;
    this.pinching = this.pinching ? pinchRatio < 0.42 : pinchRatio < 0.28;
    this.pinchPoint = { x: (p[4].x + p[8].x) / 2, y: (p[4].y + p[8].y) / 2 };
    this.extended = [
      dist(p[4], p[17]) > dist(p[2], p[17]) * 1.25,
      dist(p[8], p[0]) > dist(p[6], p[0]) * 1.1,
      dist(p[12], p[0]) > dist(p[10], p[0]) * 1.1,
      dist(p[16], p[0]) > dist(p[14], p[0]) * 1.1,
      dist(p[20], p[0]) > dist(p[18], p[0]) * 1.1,
    ];
  }
}

/** Camera hands: matches each new detection to the nearest existing hand. */
export class HandSet {
  constructor(prefix = 'cam') {
    this.prefix = prefix;
    this.tracks = [];
    this.nextId = 1;
  }

  get present() { return this.tracks.filter((h) => h.present); }

  ingest(dets, t) {
    const centers = dets.map((d) => {
      const p = d.points;
      return [0, 5, 9, 13, 17].reduce((a, i) => ({ x: a.x + p[i].x / 5, y: a.y + p[i].y / 5 }), { x: 0, y: 0 });
    });
    const pairs = [];
    centers.forEach((c, di) => this.tracks.forEach((tr, ti) => pairs.push([dist(c, tr.center), di, ti])));
    pairs.sort((a, b) => a[0] - b[0]);
    const usedD = new Set(), usedT = new Set();
    for (const [d, di, ti] of pairs) {
      if (usedD.has(di) || usedT.has(ti)) continue;
      const tr = this.tracks[ti];
      if (d > Math.max(tr.size * 3, 180)) continue;
      usedD.add(di);
      usedT.add(ti);
      tr.update(dets[di].points, t);
      tr.label = dets[di].label;
    }
    const kept = [];
    this.tracks.forEach((tr, ti) => {
      if (usedT.has(ti)) kept.push(tr);
      else if (t - tr.lastSeen < 0.15) { tr.idle(); tr.present = false; kept.push(tr); }
    });
    dets.forEach((d, di) => {
      if (usedD.has(di)) return;
      const h = new Hand(`${this.prefix}${this.nextId++}`);
      h.update(d.points, t);
      h.label = d.label;
      kept.push(h);
    });
    this.tracks = kept;
  }

  idle() { this.tracks.forEach((h) => h.idle()); }

  clear() { this.tracks = []; }
}

/** Mouse and touch input as virtual one-finger hands. */
export class PointerHands {
  constructor(isUiTarget) {
    this.isUiTarget = isUiTarget;
    this.pointers = new Map(); // pointerId -> {x, y, pressing, tap, type, hand}
    const opts = { passive: true };
    window.addEventListener('pointermove', (e) => this.#move(e), opts);
    window.addEventListener('pointerdown', (e) => this.#down(e), opts);
    window.addEventListener('pointerup', (e) => this.#up(e), opts);
    window.addEventListener('pointercancel', (e) => this.#remove(e.pointerId), opts);
    document.addEventListener('pointerleave', (e) => this.#remove(e.pointerId), opts);
    window.addEventListener('blur', () => this.pointers.clear());
  }

  #get(e) {
    let p = this.pointers.get(e.pointerId);
    if (!p) {
      p = { x: e.clientX, y: e.clientY, pressing: false, tap: false, type: e.pointerType, hand: new Hand(`ptr${e.pointerId}`, true) };
      this.pointers.set(e.pointerId, p);
    }
    return p;
  }

  #move(e) {
    if (e.pointerType !== 'mouse' && !this.pointers.has(e.pointerId)) return;
    const p = this.#get(e);
    p.x = e.clientX;
    p.y = e.clientY;
    p.overUi = this.isUiTarget(e.target);
  }

  #down(e) {
    if (this.isUiTarget(e.target)) return;
    const p = this.#get(e);
    p.x = e.clientX;
    p.y = e.clientY;
    p.pressing = true;
    p.tap = true;
    p.overUi = false;
  }

  #up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.pressing = false;
    if (p.type !== 'mouse') this.pointers.delete(e.pointerId);
  }

  #remove(id) { this.pointers.delete(id); }

  /** Hands for this frame. */
  frame(t) {
    const out = [];
    for (const p of this.pointers.values()) {
      if (p.overUi && !p.pressing) continue;
      const h = p.hand;
      h.pressing = p.pressing;
      const pt = { x: p.x, y: p.y, z: 0 };
      h.update(Array.from({ length: 21 }, () => pt), t, false);
      h.tap = p.tap;
      p.tap = false;
      out.push(h);
    }
    return out;
  }
}
