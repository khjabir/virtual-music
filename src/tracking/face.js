// Face control with MediaPipe's FaceLandmarker blendshapes:
//   open your mouth  -> talk-box filter (the sound "speaks" as your mouth opens)
//   raise eyebrows   -> bend the pitch up to two semitones (theremin, violin)
//   smile            -> echo
import { createTask, stamper, MODELS } from './mediapipe.js';
import { FONT } from '../instruments/common.js';

export class FaceControl {
  constructor(app) {
    this.app = app;
    this.task = null;
    this.loading = null;
    this.ts = stamper();
    this.v = { mouth: 0, brows: 0, smile: 0 };
    this.base = null; // resting brow height, learned in the first second
    this.seen = false;
    this.frameNo = 0;
    this.wasOn = false;
  }

  get enabled() { return this.app.settings.global.face === 'on' && this.app.camera.on; }

  ensure() {
    if (this.task || this.loading) return;
    this.loading = createTask('FaceLandmarker', {
      baseOptions: { modelAssetPath: MODELS.face },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
    }).then(({ task }) => { this.task = task; })
      .catch((err) => { console.error(err); this.app.toast('Face control could not load. Check your connection.', 4000); this.loading = null; });
  }

  /** Runs on every other camera frame to leave room for hand tracking. */
  frame(source) {
    if (!this.enabled) {
      if (this.wasOn) this.off();
      return;
    }
    this.wasOn = true;
    this.ensure();
    if (!this.task || this.frameNo++ % 2) return;
    let res;
    try { res = this.task.detectForVideo(source, this.ts()); } catch (err) { return; }
    const shapes = res.faceBlendshapes && res.faceBlendshapes[0];
    this.seen = !!shapes;
    if (!shapes) return;
    const get = (name) => (shapes.categories.find((c) => c.categoryName === name) || { score: 0 }).score;
    const mouth = Math.min(1, get('jawOpen') * 1.6);
    const browsRaw = get('browInnerUp') * 0.6 + (get('browOuterUpLeft') + get('browOuterUpRight')) * 0.2;
    if (this.base == null) this.base = browsRaw;
    this.base += (Math.min(this.base, browsRaw) - this.base) * 0.02; // resting level drifts down to your neutral face
    const brows = Math.max(0, Math.min(1, (browsRaw - this.base - 0.05) * 2.5));
    const smile = Math.max(0, Math.min(1, ((get('mouthSmileLeft') + get('mouthSmileRight')) / 2 - 0.15) * 1.6));
    for (const [k, val] of Object.entries({ mouth, brows, smile })) this.v[k] += (val - this.v[k]) * 0.5;
    const a = this.app.audio;
    a.setWah(this.v.mouth);
    this.app.faceBend = this.v.brows * 2;
    if (this.app.settings.global.fxHand === 'off') a.setEcho(this.v.smile * 0.8);
  }

  off() {
    this.wasOn = false;
    this.app.audio.setWah(null);
    this.app.faceBend = 0;
    if (this.app.settings.global.fxHand === 'off') this.app.audio.setEcho(0);
    this.v = { mouth: 0, brows: 0, smile: 0 };
  }

  draw(ctx) {
    if (!this.enabled) return;
    const x = 16, y = 92;
    ctx.save();
    ctx.fillStyle = 'rgba(18, 20, 43, 0.72)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, 196, 98, 12) : ctx.rect(x, y, 196, 98);
    ctx.fill();
    ctx.font = `700 12px ${FONT}`;
    ctx.fillStyle = '#EDEBFF';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.task ? (this.seen ? 'Face control' : 'Face control: look at the camera') : 'Face control: loading…', x + 12, y + 16);
    const rows = [['Mouth: talk filter', this.v.mouth], ['Eyebrows: pitch bend', this.v.brows], ['Smile: echo', this.v.smile]];
    ctx.font = `600 11px ${FONT}`;
    rows.forEach(([label, v], i) => {
      const yy = y + 38 + i * 20;
      ctx.fillStyle = 'rgba(237, 235, 255, 0.8)';
      ctx.fillText(label, x + 12, yy);
      ctx.fillStyle = 'rgba(237, 235, 255, 0.15)';
      ctx.fillRect(x + 128, yy - 4, 56, 8);
      ctx.fillStyle = '#FFD166';
      ctx.fillRect(x + 128, yy - 4, 56 * v, 8);
    });
    ctx.restore();
  }
}
