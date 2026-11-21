// Records what you see and hear into a video clip, ready to post. Vertical clips (9:16, for
// Reels, Shorts and TikTok) put the stage in the middle of a blurred copy of your camera
// with a title above and the site address below; landscape clips are a straight copy.

const MIME = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export class ClipRecorder {
  constructor(app, { stage, layer, video }) {
    this.app = app;
    this.stage = stage;
    this.layer = layer;
    this.video = video;
    this.rec = null;
    this.canvas = null;
    this.startedAt = 0;
    this.maxSeconds = 90;
  }

  get supported() { return typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream; }
  get recording() { return !!this.rec; }
  get seconds() { return this.rec ? (performance.now() - this.startedAt) / 1000 : 0; }

  start(format = 'vertical') {
    if (!this.supported || this.rec) return false;
    this.format = format;
    const [w, h] = format === 'vertical' ? [1080, 1920] : [1920, 1080];
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.compose();
    const stream = this.canvas.captureStream(30);
    const audio = this.app.audio.recordStream();
    if (audio) audio.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    this.mime = MIME.find((m) => MediaRecorder.isTypeSupported(m)) || '';
    this.chunks = [];
    this.rec = new MediaRecorder(stream, this.mime ? { mimeType: this.mime, videoBitsPerSecond: 8_000_000 } : undefined);
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start(500);
    this.startedAt = performance.now();
    return true;
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.rec) { resolve(null); return; }
      const rec = this.rec;
      const seconds = this.seconds;
      rec.onstop = () => {
        const type = (rec.mimeType || this.mime || 'video/webm').split(';')[0];
        const blob = new Blob(this.chunks, { type });
        resolve({ blob, type, ext: type.includes('mp4') ? 'mp4' : 'webm', seconds });
      };
      rec.stop();
      this.rec = null;
    });
  }

  /** Called after each frame is drawn on screen. */
  frame() {
    if (!this.rec) return;
    this.compose();
    if (this.seconds > this.maxSeconds) this.app.stopRecording();
  }

  #camera(ctx, x, y, w, h, blur = false) {
    const { app } = this;
    if (!app.camera.on || app.settings.global.cameraView === 'off') return false;
    // With a background scene on, the (already mirrored) scene layer is the camera picture.
    const layer = app.background && app.background.active;
    const src = layer ? this.layer : this.video;
    const sw = layer ? src.width : src.videoWidth, sh = layer ? src.height : src.videoHeight;
    if (!sw || !sh) return false;
    const s = Math.max(w / sw, h / sh);
    const dw = sw * s, dh = sh * s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    if (blur && 'filter' in ctx) ctx.filter = 'blur(36px) brightness(0.55)';
    if (layer) {
      ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    ctx.restore();
    return true;
  }

  compose() {
    const ctx = this.ctx;
    const cw = this.canvas.width, ch = this.canvas.height;
    const { W, H } = this.app;
    ctx.fillStyle = '#1B1A3F';
    ctx.fillRect(0, 0, cw, ch);
    // Fit the whole screen into the clip
    const s = Math.min(cw / W, (this.format === 'vertical' ? ch * 0.62 : ch) / H);
    const rw = W * s, rh = H * s;
    const rx = (cw - rw) / 2, ry = this.format === 'vertical' ? (ch - rh) / 2 : (ch - rh) / 2;
    if (this.format === 'vertical') {
      this.#camera(ctx, 0, 0, cw, ch, true);
      ctx.fillStyle = 'rgba(18, 20, 43, 0.45)';
      ctx.fillRect(0, 0, cw, ch);
    }
    this.#camera(ctx, rx, ry, rw, rh);
    ctx.drawImage(this.stage, rx, ry, rw, rh);
    const host = location.host || 'virtual-music';
    if (this.format === 'vertical') {
      const inst = this.app.instrument ? this.app.instrument.constructor.label : '';
      ctx.fillStyle = '#EDEBFF';
      ctx.textAlign = 'center';
      ctx.font = '900 92px Recursive, system-ui, sans-serif';
      ctx.fillText('Air ' + inst.toLowerCase(), cw / 2, ry - 120);
      ctx.font = '600 42px Recursive, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(237, 235, 255, 0.8)';
      ctx.fillText('No instrument. Just my hands and a webcam.', cw / 2, ry - 50);
      ctx.fillStyle = '#FFD166';
      ctx.font = '800 48px Recursive, system-ui, sans-serif';
      ctx.fillText('Play it yourself', cw / 2, ry + rh + 110);
      ctx.fillStyle = '#EDEBFF';
      ctx.font = '650 40px Recursive, system-ui, sans-serif';
      ctx.fillText(host, cw / 2, ry + rh + 170);
    } else {
      ctx.font = '700 30px Recursive, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(18, 20, 43, 0.6)';
      const tw = ctx.measureText(host).width;
      ctx.fillRect(cw - tw - 52, ch - 74, tw + 32, 48);
      ctx.fillStyle = '#EDEBFF';
      ctx.fillText(host, cw - 36, ch - 40);
    }
  }
}
