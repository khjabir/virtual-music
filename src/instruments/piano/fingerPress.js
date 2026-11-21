// Detecting key presses from a webcam.
//
// FingerTaps (default): a key is pressed when ONE finger moves down relative to its own
// knuckle, quickly, like tapping a real key. Moving or lowering the whole hand changes
// nothing, because every point moves together. Tilting the whole hand (all fingers drop
// at once) is also ignored: each finger's drop is measured against the least-dropped of
// the other fingers. Each finger keeps a slowly adapting resting position, so any natural
// hand pose works.
//
// DipPress (alternative): a key is pressed when a fingertip crosses down into the top
// edge of a keyboard moving downward; sliding sideways inside the keys does not play
// new notes.

const FINGERS = [
  { tip: 4, ref: 2 }, // thumb tip vs thumb knuckle
  { tip: 8, ref: 5 },
  { tip: 12, ref: 9 },
  { tip: 16, ref: 13 },
  { tip: 20, ref: 17 },
];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Hand scale that stays stable when the hand points toward the camera. */
export function handScale(p) {
  return Math.max(20, dist(p[0], p[9]), dist(p[5], p[17]) * 1.25);
}

export class FingerTaps {
  constructor() {
    this.state = new Map(); // "hand:finger" -> state
  }

  reset() { this.state.clear(); }

  /**
   * @param hands camera hands
   * @param enabled finger indices allowed to play (0 = thumb … 4 = pinky)
   * @param t seconds
   * @param threshold drop needed, in hand sizes
   * @returns {{ events: Array, cursors: Array }}
   *   events: { type: 'down', id, hand, finger, x, y, speed } | { type: 'up', id }
   *   cursors: { id, finger, x, y, tip, progress, down } — x,y is where the fingertip rests
   */
  update(hands, enabled, t, threshold) {
    const events = [];
    const cursors = [];
    const seen = new Set();
    for (const h of hands) {
      if (h.virtual || !h.present || !h.points) continue;
      const p = h.points;
      const size = handScale(p);
      const rel = FINGERS.map((f) => (p[f.tip].y - p[f.ref].y) / size);
      const sts = FINGERS.map((f, i) => {
        const id = `${h.id}:${i}`;
        seen.add(id);
        let st = this.state.get(id);
        if (!st) {
          st = { base: rel[i], hist: [], down: false, lastT: t, eff: 0 };
          this.state.set(id, st);
        }
        return st;
      });

      if (h.fresh) {
        const drops = rel.map((r, i) => r - sts[i].base);
        sts.forEach((st, i) => {
          // Whole-hand movement shows up in every finger: subtract the smallest drop among
          // the other (non-thumb) fingers so only this finger's own movement counts.
          let common = Infinity;
          for (let j = 1; j < 5; j++) if (j !== i) common = Math.min(common, drops[j]);
          const eff = drops[i] - Math.max(0, common);
          st.eff = eff;
          st.hist.push({ t, eff });
          while (st.hist.length && st.hist[0].t < t - 0.3) st.hist.shift();
          let low = st.hist[0];
          for (const s of st.hist) if (s.t >= t - 0.25 && s.eff < low.eff) low = s;
          const rise = eff - low.eff;

          if (!st.down) {
            if (enabled.includes(i) && eff > threshold && rise > threshold * 0.6) {
              const rest = { x: p[FINGERS[i].tip].x, y: p[FINGERS[i].tip].y - eff * size };
              events.push({ type: 'down', id: `${h.id}:${i}`, hand: h, finger: i, x: rest.x, y: rest.y, speed: rise / Math.max(0.03, t - low.t) });
              st.down = true;
            }
          } else if (eff < threshold * 0.45) {
            events.push({ type: 'up', id: `${h.id}:${i}` });
            st.down = false;
          }

          // Resting position follows slowly; it snaps up quickly when the finger lifts.
          if (!st.down) {
            const dt = Math.max(0, t - st.lastT);
            const tau = rel[i] < st.base ? 0.12 : eff > threshold * 0.5 ? 2.5 : 0.7;
            st.base += (rel[i] - st.base) * Math.min(1, dt / tau);
          }
          st.lastT = t;
        });
      }

      for (const i of enabled) {
        const st = sts[i];
        const tip = p[FINGERS[i].tip];
        cursors.push({
          id: `${h.id}:${i}`,
          finger: i,
          x: tip.x,
          y: tip.y - Math.max(0, st.eff) * size,
          tip,
          progress: Math.max(0, Math.min(1, st.eff / threshold)),
          eff: st.eff,
          down: st.down,
        });
      }
    }
    for (const [id, st] of this.state) {
      if (seen.has(id)) continue;
      if (st.down) events.push({ type: 'up', id });
      this.state.delete(id);
    }
    return { events, cursors };
  }
}

export class DipPress {
  constructor() { this.state = new Map(); }

  reset() { this.state.clear(); }

  /** rowAt(x, y) returns { row, top } for the keyboard row under a point, or null. */
  update(hands, enabled, t, H, rowAt) {
    const events = [];
    const cursors = [];
    const seen = new Set();
    for (const h of hands) {
      if (h.virtual || !h.present || !h.points) continue;
      for (const i of enabled) {
        const f = FINGERS[i];
        const id = `${h.id}:${i}`;
        seen.add(id);
        const p = h.points[f.tip], q = h.prev[f.tip];
        let st = this.state.get(id);
        if (!st) this.state.set(id, (st = { down: false, row: null }));
        const r = rowAt(p.x, p.y) || rowAt(p.x, p.y + H * 0.08);
        if (h.fresh) {
          if (!st.down && r && q.y < r.top && p.y >= r.top + 2 && h.vel[f.tip].y / H > 0.35) {
            events.push({ type: 'down', id, hand: h, finger: i, x: p.x, y: p.y, speed: (h.vel[f.tip].y / H) * 2 });
            st.down = true;
            st.top = r.top;
          } else if (st.down && p.y < st.top - 6) {
            events.push({ type: 'up', id });
            st.down = false;
          }
        }
        cursors.push({ id, finger: i, x: p.x, y: p.y, tip: p, progress: st.down ? 1 : 0, down: st.down });
      }
    }
    for (const [id, st] of this.state) {
      if (seen.has(id)) continue;
      if (st.down) events.push({ type: 'up', id });
      this.state.delete(id);
    }
    return { events, cursors };
  }
}
