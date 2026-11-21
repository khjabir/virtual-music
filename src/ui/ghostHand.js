// A drawn "ghost" hand that demonstrates gestures in the tutorials. It uses the same
// 21-point layout MediaPipe produces, so it looks like the tracked hand outline.
import { HAND_CONNECTIONS, FINGERTIPS } from '../tracking/hands.js';

/**
 * Points for a hand whose index fingertip is at (x, y).
 * pose: 'point' (index up), 'down' (palm down, fingers toward the keys), 'pinch'.
 * flex: how far the index finger is bent down (0..1), for tapping.
 */
export function ghostPoints(x, y, s, pose = 'point', flex = 0, mirror = false) {
  const P = [];
  const sx = mirror ? -1 : 1;
  if (pose === 'down') {
    // Palm down, fingers pointing down the screen; the index fingertip is the anchor.
    const cx = x + 0.36 * s * sx, cy = y - 1.35 * s;
    P[0] = [cx, cy];
    P[1] = [cx - 0.3 * s * sx, cy + 0.3 * s]; P[2] = [cx - 0.5 * s * sx, cy + 0.55 * s];
    P[3] = [cx - 0.62 * s * sx, cy + 0.78 * s]; P[4] = [cx - 0.7 * s * sx, cy + 0.95 * s];
    const mcp = [null, [-0.36, 0.95], [-0.12, 1.02], [0.12, 0.98], [0.33, 0.88]];
    for (let f = 1; f <= 4; f++) {
      const mi = 4 * f + 1;
      const m = [cx + mcp[f][0] * s * sx, cy + mcp[f][1] * s];
      P[mi] = m;
      const k = 0.45 + 0.6 * (f === 1 ? flex : 0);
      let yy = m[1];
      [0.42, 0.26, 0.2].forEach((l, j) => { yy += l * s * k; P[mi + 1 + j] = [m[0], yy]; });
    }
  } else {
    // Index finger pointing up, other fingers curled
    const cx = x + 0.15 * s * sx, cy = y + 1.75 * s;
    P[0] = [cx, cy];
    P[5] = [cx - 0.25 * s * sx, cy - 0.9 * s]; P[9] = [cx, cy - 0.95 * s]; P[13] = [cx + 0.22 * s * sx, cy - 0.88 * s]; P[17] = [cx + 0.4 * s * sx, cy - 0.75 * s];
    P[6] = [x - 0.08 * s * sx, y + 0.55 * s]; P[7] = [x - 0.03 * s * sx, y + 0.25 * s]; P[8] = [x, y];
    for (const [b, d] of [[9, 0], [13, 1], [17, 2]]) {
      P[b + 1] = [P[b][0] + 0.05 * s * sx, P[b][1] - 0.3 * s];
      P[b + 2] = [P[b][0] + 0.12 * s * sx, P[b][1] - 0.12 * s + d * 0.02 * s];
      P[b + 3] = [P[b][0] + 0.06 * s * sx, P[b][1] + 0.05 * s];
    }
    P[1] = [cx - 0.3 * s * sx, cy - 0.25 * s]; P[2] = [cx - 0.5 * s * sx, cy - 0.5 * s];
    if (pose === 'pinch') {
      P[3] = [x - 0.25 * s * sx, y + 0.3 * s]; P[4] = [x - 0.05 * s * sx, y + 0.05 * s];
      P[6] = [x - 0.25 * s * sx, y - 0.25 * s]; P[7] = [x - 0.1 * s * sx, y - 0.25 * s];
    } else {
      P[3] = [cx - 0.55 * s * sx, cy - 0.75 * s]; P[4] = [cx - 0.35 * s * sx, cy - 0.9 * s];
    }
  }
  return P;
}

export function drawGhost(ctx, P, alpha = 0.8) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(160, 240, 255, ${alpha * 0.8})`;
  ctx.lineWidth = 3;
  ctx.setLineDash([2, 5]);
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    if (!P[a] || !P[b]) continue;
    ctx.moveTo(P[a][0], P[a][1]);
    ctx.lineTo(P[b][0], P[b][1]);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  for (const i of FINGERTIPS) {
    if (!P[i]) continue;
    ctx.fillStyle = `rgba(160, 240, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(P[i][0], P[i][1], i === 8 ? 7 : 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
