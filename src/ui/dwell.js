// Hands-free buttons: hold an index fingertip over any element marked
// data-dwell for a moment and it is pressed, so you never have to reach for the mouse.

export class Dwell {
  constructor(ms = 1000) {
    this.ms = ms;
    this.state = new Map(); // hand id -> { el, start, done }
    this.rings = [];
  }

  update(hands, t) {
    this.rings = [];
    const seen = new Set();
    for (const h of hands) {
      if (h.virtual || !h.present) continue;
      seen.add(h.id);
      const p = h.points[8];
      const hit = document.elementFromPoint(p.x, p.y);
      const el = hit && hit.closest('[data-dwell]');
      let st = this.state.get(h.id);
      if (!el || el.disabled || el.closest('[hidden]')) {
        if (st && st.el) st.el.classList.remove('dwelling');
        this.state.delete(h.id);
        continue;
      }
      if (!st || st.el !== el) {
        if (st && st.el) st.el.classList.remove('dwelling');
        st = { el, start: t, done: false };
        this.state.set(h.id, st);
        el.classList.add('dwelling');
      }
      const progress = Math.min(1, ((t - st.start) * 1000) / this.ms);
      if (!st.done) this.rings.push({ x: p.x, y: p.y, progress });
      if (progress >= 1 && !st.done) {
        st.done = true; // must move off the button before it can fire again
        el.classList.remove('dwelling');
        el.click();
      }
    }
    for (const [id, st] of this.state) {
      if (!seen.has(id)) {
        if (st.el) st.el.classList.remove('dwelling');
        this.state.delete(id);
      }
    }
  }

  draw(ctx) {
    for (const r of this.rings) {
      ctx.beginPath();
      ctx.arc(r.x, r.y, 20, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(18, 20, 43, 0.6)';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r.x, r.y, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * r.progress);
      ctx.strokeStyle = '#FFD166';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }
}
