// Effects hand: one hand plays, the other shapes the sound.
//   height  -> low-pass filter (raise it to open the sound, lower it to muffle)
//   inward  -> echo (move it toward the middle of the screen for more)
//   pinch   -> reverb wash
import { FONT } from '../instruments/common.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class FxHand {
  constructor(app) {
    this.app = app;
    this.v = { filter: 1, echo: 0, wash: 0 };
    this.hud = null;
    this.engaged = false;
  }

  /** Takes the effects hand out of the list the instrument sees. */
  filterHands(hands, dt) {
    const side = this.app.settings.global.fxHand;
    const { W, H } = this.app;
    let fx = null;
    if (side === 'left' || side === 'right') {
      const cam = hands.filter((h) => !h.virtual);
      if (cam.length >= 2) {
        fx = cam.reduce((a, b) => ((side === 'left' ? b.center.x < a.center.x : b.center.x > a.center.x) ? b : a));
      } else if (cam.length === 1) {
        const x = cam[0].center.x;
        if (side === 'left' ? x < W * 0.4 : x > W * 0.6) fx = cam[0];
      }
    }
    const k = Math.min(1, dt * 10);
    let target;
    if (fx) {
      const p = fx.center;
      const inward = side === 'left' ? p.x / (W * 0.45) : (W - p.x) / (W * 0.45);
      target = {
        filter: clamp(1 - (p.y - H * 0.18) / (H * 0.62), 0, 1),
        echo: clamp(inward - 0.15, 0, 1),
        wash: fx.pinching ? 1 : 0,
      };
      this.hud = { x: p.x, y: p.y, side };
    } else {
      // Ease back to a clean sound when the effects hand leaves.
      target = { filter: 1, echo: 0, wash: 0 };
      this.hud = null;
    }
    const slow = fx ? 1 : 0.15;
    for (const key of Object.keys(this.v)) this.v[key] += (target[key] - this.v[key]) * k * slow;
    const active = side !== 'off';
    if (active || this.engaged) {
      const a = this.app.audio;
      a.setFilter(this.v.filter);
      a.setEcho(this.v.echo);
      a.setWash(this.v.wash);
      this.engaged = active || this.v.filter < 0.999 || this.v.echo > 0.001 || this.v.wash > 0.001;
    }
    return fx ? hands.filter((h) => h !== fx) : hands;
  }

  draw(ctx) {
    if (!this.hud) return;
    const { x, y, side } = this.hud;
    const ox = side === 'left' ? x + 70 : x - 70 - 120;
    const top = y - 60;
    const items = [['Filter', this.v.filter], ['Echo', this.v.echo], ['Wash', this.v.wash]];
    ctx.save();
    ctx.fillStyle = 'rgba(18, 20, 43, 0.72)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(ox - 4, top - 28, 128, 150, 12) : ctx.rect(ox - 4, top - 28, 128, 150);
    ctx.fill();
    ctx.font = `650 11px ${FONT}`;
    ctx.textAlign = 'center';
    items.forEach(([label, v], i) => {
      const cx = ox + 20 + i * 40;
      ctx.fillStyle = 'rgba(237, 235, 255, 0.18)';
      ctx.fillRect(cx - 4, top, 8, 90);
      ctx.fillStyle = '#FFD166';
      ctx.fillRect(cx - 4, top + 90 * (1 - v), 8, 90 * v);
      ctx.fillStyle = 'rgba(237, 235, 255, 0.9)';
      ctx.save();
      ctx.translate(cx, top + 108);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    });
    ctx.fillStyle = 'rgba(237, 235, 255, 0.95)';
    ctx.font = `700 12px ${FONT}`;
    ctx.fillText('Effects', ox + 60, top - 10);
    ctx.restore();
  }
}
