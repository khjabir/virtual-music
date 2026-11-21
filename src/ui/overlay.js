import { HAND_CONNECTIONS, FINGERTIPS } from '../tracking/hands.js';

/** Draws tracked hands: a light outline plus fingertip markers. */
export function drawHands(ctx, hands, { skeleton = true } = {}) {
  for (const h of hands) {
    if (!h.present || !h.points) continue;
    const p = h.points;
    if (h.virtual) {
      ctx.beginPath();
      ctx.arc(p[8].x, p[8].y, h.pressing ? 9 : 12, 0, Math.PI * 2);
      ctx.strokeStyle = '#FFD166';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (h.pressing) {
        ctx.fillStyle = 'rgba(255, 209, 102, 0.5)';
        ctx.fill();
      }
      continue;
    }
    if (skeleton) {
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo(p[a].x, p[a].y);
        ctx.lineTo(p[b].x, p[b].y);
      }
      ctx.strokeStyle = 'rgba(18, 20, 43, 0.35)';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(237, 235, 255, 0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    for (const i of FINGERTIPS) {
      ctx.beginPath();
      ctx.arc(p[i].x, p[i].y, i === 8 ? 7 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = i === 8 ? '#FFD166' : 'rgba(237, 235, 255, 0.85)';
      ctx.fill();
    }
    if (h.pinching) {
      ctx.beginPath();
      ctx.arc(h.pinchPoint.x, h.pinchPoint.y, 13, 0, Math.PI * 2);
      ctx.strokeStyle = '#FFD166';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }
}
