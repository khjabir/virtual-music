// Body percussion with MediaPipe's PoseLandmarker: nod your head to play the kick drum,
// or stomp a foot if your feet are in view. Works on the drum kit, alongside your hands.
import { createTask, stamper, MODELS } from './mediapipe.js';
import { FONT } from '../instruments/common.js';

export class BodyPercussion {
  constructor(app) {
    this.app = app;
    this.task = null;
    this.loading = null;
    this.ts = stamper();
    this.state = new Map();
    this.pulse = 0;
    this.marker = null;
    this.frameNo = 0;
  }

  get mode() {
    const inst = this.app.instrument;
    if (!inst || inst.id !== 'drums' || !this.app.camera.on) return 'hands';
    return inst.opts.kick || 'hands';
  }

  ensure() {
    if (this.task || this.loading) return;
    this.loading = createTask('PoseLandmarker', {
      baseOptions: { modelAssetPath: MODELS.pose },
      runningMode: 'VIDEO',
      numPoses: 1,
    }).then(({ task }) => { this.task = task; })
      .catch((err) => { console.error(err); this.app.toast('Body tracking could not load. Check your connection.', 4000); this.loading = null; });
  }

  /** A stroke detector for one value that moves down (positive) and stops. */
  #stroke(key, value, t, threshold) {
    let st = this.state.get(key);
    if (!st) { this.state.set(key, (st = { v: value, t, down: false, peak: 0 })); return null; }
    const dt = Math.max(1 / 60, t - st.t);
    const speed = (value - st.v) / dt;
    st.v = value;
    st.t = t;
    if (!st.down) {
      if (speed > threshold) { st.down = true; st.peak = speed; }
    } else {
      st.peak = Math.max(st.peak, speed);
      if (speed < st.peak * 0.35) {
        st.down = false;
        return Math.min(1, 0.4 + (st.peak / threshold - 1) * 0.3);
      }
    }
    return null;
  }

  frame(source, t, map) {
    const mode = this.mode;
    this.marker = null;
    if (mode === 'hands') return;
    this.ensure();
    if (!this.task) return;
    let res;
    try { res = this.task.detectForVideo(source, this.ts()); } catch (err) { return; }
    const lm = res.landmarks && res.landmarks[0];
    if (!lm) return;
    const drums = this.app.instrument;
    const L = (i) => lm[i];
    if (mode === 'nod') {
      const nose = L(0), ls = L(11), rs = L(12);
      const width = Math.max(0.05, Math.hypot(ls.x - rs.x, ls.y - rs.y));
      const rel = (nose.y - (ls.y + rs.y) / 2) / width; // head relative to shoulders, so moving your body doesn't count
      const v = this.#stroke('nod', rel, t, 1.2);
      if (v) { drums.hitPad('kick', v); this.pulse = 1; }
      this.marker = map(nose);
    } else if (mode === 'stomp') {
      for (const [i, key] of [[27, 'left'], [28, 'right']]) {
        const a = L(i);
        if ((a.visibility ?? 1) < 0.5) continue;
        const v = this.#stroke(key, a.y, t, 1.4);
        if (v) { drums.hitPad('kick', v); this.pulse = 1; }
        this.marker = map(a);
      }
    }
  }

  draw(ctx, dt) {
    this.pulse *= Math.exp(-dt * 6);
    const mode = this.mode;
    if (mode === 'hands') return;
    const { W } = this.app;
    const label = mode === 'nod' ? (this.task ? 'Nod your head: kick drum' : 'Loading body tracking…') : (this.task ? 'Stomp a foot: kick drum' : 'Loading body tracking…');
    ctx.save();
    ctx.font = `700 14px ${FONT}`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = `rgba(18, 20, 43, ${0.7})`;
    ctx.fillRect(W / 2 - tw / 2 - 14, 128, tw + 28, 30);
    ctx.fillStyle = this.pulse > 0.3 ? '#FFD166' : '#EDEBFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, W / 2, 143);
    if (this.marker) {
      ctx.strokeStyle = `rgba(255, 209, 102, ${0.5 + 0.5 * this.pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.marker.x, this.marker.y, 22 + 14 * this.pulse, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
