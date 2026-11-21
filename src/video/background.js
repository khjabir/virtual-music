// Background replacement: MediaPipe's selfie segmentation cuts you out of the camera image
// and puts you on a concert stage, a neon sunset, in space, in a studio, or in front of your
// own room, blurred. Scenes are drawn live and pulse with the music.
import { createTask, stamper, MODELS } from '../tracking/mediapipe.js';

export const BACKGROUNDS = {
  none: 'Your room',
  blur: 'Your room, blurred',
  stage: 'Concert stage',
  synthwave: 'Neon sunset',
  space: 'Outer space',
  studio: 'Cosy studio',
};

const rand = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

export class Background {
  constructor(app, layer, video) {
    this.app = app;
    this.layer = layer;
    this.ctx = layer.getContext('2d');
    this.video = video;
    this.seg = null;
    this.loading = null;
    this.ts = stamper();
    this.mask = document.createElement('canvas');
    this.maskCtx = this.mask.getContext('2d');
    this.person = document.createElement('canvas');
    this.personCtx = this.person.getContext('2d');
    this.small = document.createElement('canvas');
    this.smallCtx = this.small.getContext('2d');
    this.prevMask = null;
    this.hasMask = false;
    this.t = 0;
    const r = rand(7);
    this.stars = Array.from({ length: 260 }, () => ({ x: r(), y: r(), s: r() * 1.6 + 0.3, p: r() * 6 }));
    this.bokeh = Array.from({ length: 34 }, () => ({ x: r(), y: r() * 0.8, r: 20 + r() * 70, h: 25 + r() * 30, sp: 0.005 + r() * 0.02, p: r() * 6 }));
    this.crowd = Array.from({ length: 46 }, (_, i) => ({ x: (i + r() * 0.6) / 46, s: 0.8 + r() * 0.5, p: r() * 6, arm: r() > 0.55 }));
  }

  get mode() { return this.app.settings.global.background || 'none'; }

  get active() {
    return this.mode !== 'none' && this.app.camera.on && this.app.settings.global.cameraView !== 'off';
  }

  ensure() {
    if (this.seg || this.loading) return;
    this.loading = createTask('ImageSegmenter', {
      baseOptions: { modelAssetPath: MODELS.segmenter },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    }).then(({ task }) => { this.seg = task; })
      .catch((err) => { console.error(err); this.app.toast('The background feature could not load. Check your connection.', 4000); this.loading = null; });
  }

  resize(W, H) {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.layer.width = Math.round(W * dpr);
    this.layer.height = Math.round(H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Run segmentation on a new camera frame. */
  segment() {
    if (!this.active || this.mode === 'none') return;
    this.ensure();
    if (!this.seg) return;
    const v = this.video;
    const w = 256, h = Math.round((v.videoHeight / v.videoWidth) * 256) || 144;
    if (this.small.width !== w || this.small.height !== h) { this.small.width = w; this.small.height = h; }
    this.smallCtx.drawImage(v, 0, 0, w, h);
    let res;
    try { res = this.seg.segmentForVideo(this.small, this.ts()); } catch (err) { return; }
    const m = res.confidenceMasks && res.confidenceMasks[0];
    if (m) {
      const data = m.getAsFloat32Array();
      const mw = m.width, mh = m.height;
      if (this.mask.width !== mw || this.mask.height !== mh) {
        this.mask.width = mw;
        this.mask.height = mh;
        this.prevMask = new Float32Array(mw * mh);
        this.img = this.maskCtx.createImageData(mw, mh);
      }
      const px = this.img.data, prev = this.prevMask;
      for (let i = 0; i < data.length; i++) {
        // Smooth over time to stop the edges flickering, and sharpen the transition a little.
        const v2 = prev[i] * 0.35 + data[i] * 0.65;
        prev[i] = v2;
        const a = Math.max(0, Math.min(1, (v2 - 0.25) / 0.5));
        px[i * 4 + 3] = a * 255;
      }
      this.maskCtx.putImageData(this.img, 0, 0);
      this.hasMask = true;
    }
    res.close();
  }

  /** Draw the camera layer for this animation frame. */
  draw(dt, energy, hue) {
    const ctx = this.ctx;
    const { W, H } = this.app;
    this.t += dt;
    const v = this.video;
    if (!v.videoWidth) return;
    const s = Math.max(W / v.videoWidth, H / v.videoHeight);
    const dw = v.videoWidth * s, dh = v.videoHeight * s, ox = (W - dw) / 2, oy = (H - dh) / 2;

    if (this.mode === 'blur') this.#blurredRoom(ctx, W, H, ox, oy, dw, dh);
    else this.#scene(ctx, W, H, energy, hue);

    if (!this.hasMask) {
      // Until the segmentation model is ready, show the camera as it is.
      if (this.mode !== 'blur') this.#mirrored(ctx, v, ox, oy, dw, dh, this.seg ? 1 : 0.85);
      return;
    }
    // Cut the person out of the full-resolution frame with the (smooth, upscaled) mask.
    const pw = Math.min(1280, v.videoWidth), ph = Math.round((pw / v.videoWidth) * v.videoHeight);
    if (this.person.width !== pw || this.person.height !== ph) { this.person.width = pw; this.person.height = ph; }
    const p = this.personCtx;
    p.globalCompositeOperation = 'copy';
    p.drawImage(v, 0, 0, pw, ph);
    p.globalCompositeOperation = 'destination-in';
    p.imageSmoothingEnabled = true;
    p.imageSmoothingQuality = 'high';
    // The mask is small; blurring it while scaling up gives a soft edge instead of steps.
    if ('filter' in p) p.filter = `blur(${Math.max(1, pw / 400).toFixed(1)}px)`;
    p.drawImage(this.mask, 0, 0, pw, ph);
    if ('filter' in p) p.filter = 'none';
    p.globalCompositeOperation = 'source-over';
    // A soft rim light in the scene colour
    if (this.mode !== 'blur') {
      ctx.save();
      ctx.shadowColor = `hsla(${hue}, 90%, 60%, ${0.35 + energy * 0.4})`;
      ctx.shadowBlur = 24;
      this.#mirrored(ctx, this.person, ox, oy, dw, dh, 1);
      ctx.restore();
    } else {
      this.#mirrored(ctx, this.person, ox, oy, dw, dh, 1);
    }
  }

  #mirrored(ctx, img, ox, oy, dw, dh, alpha) {
    const { W } = this.app;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, W - ox - dw, oy, dw, dh);
    ctx.restore();
  }

  #blurredRoom(ctx, W, H, ox, oy, dw, dh) {
    // Cheap, browser-independent blur: draw tiny, then stretch back up with smoothing.
    const v = this.video;
    const bw = 64, bh = Math.round((v.videoHeight / v.videoWidth) * 64);
    if (!this.blurCanvas) { this.blurCanvas = document.createElement('canvas'); this.blurCtx = this.blurCanvas.getContext('2d'); }
    if (this.blurCanvas.width !== bw) { this.blurCanvas.width = bw; this.blurCanvas.height = bh; }
    this.blurCtx.drawImage(v, 0, 0, bw, bh);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    this.#mirrored(ctx, this.blurCanvas, ox, oy, dw, dh, 1);
    ctx.fillStyle = 'rgba(27, 26, 63, 0.18)';
    ctx.fillRect(0, 0, W, H);
  }

  #scene(ctx, W, H, energy, hue) {
    const t = this.t;
    if (this.mode === 'stage') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#07040f');
      g.addColorStop(0.7, '#170c2b');
      g.addColorStop(1, '#2a1240');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        const ox = W * (0.08 + i * 0.21);
        const ang = Math.sin(t * (0.5 + i * 0.13) + i * 1.7) * 0.45;
        const len = H * 1.25;
        const tx = ox + Math.sin(ang) * len, ty = Math.cos(ang) * len;
        const h2 = (hue + i * 55) % 360;
        const lg = ctx.createLinearGradient(ox, 0, tx, ty);
        lg.addColorStop(0, `hsla(${h2}, 95%, 65%, ${0.22 + energy * 0.45})`);
        lg.addColorStop(1, `hsla(${h2}, 95%, 65%, 0)`);
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.moveTo(ox - 10, 0);
        ctx.lineTo(tx - 90, ty);
        ctx.lineTo(tx + 90, ty);
        ctx.lineTo(ox + 10, 0);
        ctx.fill();
      }
      ctx.restore();
      const fg = ctx.createRadialGradient(W / 2, H, 0, W / 2, H, W * 0.6);
      fg.addColorStop(0, `hsla(${hue}, 80%, 55%, ${0.25 + energy * 0.35})`);
      fg.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, W, H);
      // Crowd silhouettes bobbing to the music
      ctx.fillStyle = '#05030a';
      for (const c of this.crowd) {
        const x = c.x * W;
        const bob = Math.abs(Math.sin(t * 4 + c.p)) * (4 + energy * 18);
        const y = H - 40 * c.s + 10 - bob;
        ctx.beginPath();
        ctx.arc(x, y - 30 * c.s, 13 * c.s, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x, y + 18 * c.s, 30 * c.s, 32 * c.s, 0, 0, Math.PI * 2);
        ctx.fill();
        if (c.arm && energy > 0.08) {
          ctx.strokeStyle = '#05030a';
          ctx.lineWidth = 7 * c.s;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x + 12 * c.s, y - 6 * c.s);
          ctx.lineTo(x + 26 * c.s, y - 62 * c.s - bob);
          ctx.stroke();
        }
      }
    } else if (this.mode === 'synthwave') {
      const horizon = H * 0.62;
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, '#120526');
      sky.addColorStop(0.55, '#4a0d5e');
      sky.addColorStop(1, '#d6336c');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, horizon);
      const r = H * 0.22 * (1 + energy * 0.06);
      const sun = ctx.createLinearGradient(0, horizon - r * 1.6, 0, horizon);
      sun.addColorStop(0, '#ffd166');
      sun.addColorStop(1, '#ff3d7f');
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, horizon - r * 0.35, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = sun;
      ctx.fillRect(W / 2 - r, horizon - r * 1.4, r * 2, r * 2);
      ctx.fillStyle = '#4a0d5e';
      for (let k = 0; k < 6; k++) {
        const y = horizon - r * 0.35 + k * r * 0.15;
        ctx.fillRect(W / 2 - r, y, r * 2, 2 + k * 2.2);
      }
      ctx.restore();
      ctx.fillStyle = '#1a0630';
      ctx.beginPath();
      ctx.moveTo(0, horizon);
      for (let x = 0; x <= W; x += W / 12) ctx.lineTo(x, horizon - (Math.sin(x * 0.011) * 0.5 + 0.6) * H * 0.09 * (1 + ((x * 7) % 3) * 0.2));
      ctx.lineTo(W, horizon);
      ctx.fill();
      const floor = ctx.createLinearGradient(0, horizon, 0, H);
      floor.addColorStop(0, '#2b0a3d');
      floor.addColorStop(1, '#09020f');
      ctx.fillStyle = floor;
      ctx.fillRect(0, horizon, W, H - horizon);
      ctx.strokeStyle = `hsla(${(hue + 300) % 360}, 95%, 65%, ${0.55 + energy * 0.4})`;
      ctx.lineWidth = 1.5;
      for (let k = 0; k < 14; k++) {
        const f = ((k + (t * 0.8) % 1) / 14);
        const y = horizon + (H - horizon) * f * f;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      for (let k = -12; k <= 12; k++) {
        ctx.beginPath();
        ctx.moveTo(W / 2 + k * 18, horizon);
        ctx.lineTo(W / 2 + k * W * 0.16, H);
        ctx.stroke();
      }
    } else if (this.mode === 'space') {
      ctx.fillStyle = '#03030c';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const cx = W * (0.25 + 0.25 * k + 0.05 * Math.sin(t * 0.07 + k));
        const cy = H * (0.35 + 0.2 * Math.cos(t * 0.05 + k * 2));
        const rr = Math.max(W, H) * (0.35 + 0.1 * k);
        const ng = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
        ng.addColorStop(0, `hsla(${(hue + k * 70) % 360}, 80%, 45%, ${0.22 + energy * 0.25})`);
        ng.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
        ctx.fillStyle = ng;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
      for (const s of this.stars) {
        const tw = 0.5 + 0.5 * Math.sin(t * 2 + s.p);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + 0.7 * tw})`;
        ctx.fillRect(((s.x + t * 0.003 * s.s) % 1) * W, s.y * H, s.s, s.s);
      }
    } else if (this.mode === 'studio') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1b120c');
      g.addColorStop(0.75, '#2c1d12');
      g.addColorStop(1, '#3b2614');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const b of this.bokeh) {
        const x = ((b.x + Math.sin(t * b.sp * 6 + b.p) * 0.02) % 1) * W;
        const y = b.y * H + Math.cos(t * b.sp * 4 + b.p) * 10;
        const rg = ctx.createRadialGradient(x, y, 0, x, y, b.r);
        rg.addColorStop(0, `hsla(${b.h}, 90%, 60%, ${0.14 + energy * 0.2})`);
        rg.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
        ctx.fillStyle = rg;
        ctx.fillRect(x - b.r, y - b.r, b.r * 2, b.r * 2);
      }
      ctx.restore();
    }
  }
}
