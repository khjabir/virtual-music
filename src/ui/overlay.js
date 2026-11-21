import { HAND_CONNECTIONS, FINGERTIPS } from '../tracking/hands.js';

// How tracked hands are drawn:
//   outline   — light skeleton and fingertips (default)
//   trails    — outline plus glowing light trails behind the fingertips
//   hologram  — glowing wireframe with depth, scanlines and colour fringes
//   minimal   — fingertips only
// With two players, hands on the left are gold and hands on the right are teal.

const trails = new Map(); // hand id -> { tip index -> [{x, y, t}] }
const PLAYER = ['255, 209, 102', '94, 230, 200'];

function colourFor(h, players, W) {
  if (players < 2) return PLAYER[0];
  return h.center && h.center.x > W / 2 ? PLAYER[1] : PLAYER[0];
}

function drawTrails(ctx, h, rgb, t) {
  let tr = trails.get(h.id);
  if (!tr) trails.set(h.id, (tr = {}));
  for (const i of FINGERTIPS) {
    const list = tr[i] || (tr[i] = []);
    const p = h.points[i];
    list.push({ x: p.x, y: p.y, t });
    while (list.length && t - list[0].t > 0.35) list.shift();
    if (list.length < 3) continue;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let k = 1; k < list.length; k++) {
      const a = k / list.length;
      ctx.strokeStyle = `rgba(${rgb}, ${a * (i === 8 ? 0.85 : 0.45)})`;
      ctx.lineWidth = (i === 8 ? 9 : 5) * a;
      ctx.beginPath();
      ctx.moveTo(list[k - 1].x, list[k - 1].y);
      ctx.lineTo(list[k].x, list[k].y);
      ctx.stroke();
    }
  }
}

function drawHologram(ctx, h, rgb, t) {
  const p = h.points;
  const zs = p.map((q) => q.z || 0);
  const zMin = Math.min(...zs), zMax = Math.max(...zs);
  const depth = (i) => (zMax - zMin > 1e-4 ? 1 - (zs[i] - zMin) / (zMax - zMin) : 0.5); // 1 = closest
  ctx.save();
  ctx.lineCap = 'round';
  // Colour fringes: draw offset in magenta and cyan, then the main glow
  for (const [dx, col, w] of [[-2, '255, 80, 220', 1.5], [2, '80, 240, 255', 1.5]]) {
    ctx.strokeStyle = `rgba(${col}, 0.35)`;
    ctx.lineWidth = w;
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.moveTo(p[a].x + dx, p[a].y);
      ctx.lineTo(p[b].x + dx, p[b].y);
    }
    ctx.stroke();
  }
  ctx.shadowColor = 'rgba(80, 240, 255, 0.9)';
  ctx.shadowBlur = 14;
  for (const [a, b] of HAND_CONNECTIONS) {
    const d = (depth(a) + depth(b)) / 2;
    ctx.strokeStyle = `rgba(150, 250, 255, ${0.45 + 0.5 * d})`;
    ctx.lineWidth = 1.5 + 3 * d;
    ctx.beginPath();
    ctx.moveTo(p[a].x, p[a].y);
    ctx.lineTo(p[b].x, p[b].y);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  // Joints as small diamonds, fingertips brighter
  for (let i = 0; i < 21; i++) {
    const s = FINGERTIPS.includes(i) ? 6 : 3.5;
    ctx.fillStyle = FINGERTIPS.includes(i) ? `rgba(${rgb}, 0.95)` : 'rgba(200, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.moveTo(p[i].x, p[i].y - s);
    ctx.lineTo(p[i].x + s, p[i].y);
    ctx.lineTo(p[i].x, p[i].y + s);
    ctx.lineTo(p[i].x - s, p[i].y);
    ctx.closePath();
    ctx.fill();
  }
  // Scanlines over the hand
  const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
  const x0 = Math.min(...xs) - 20, x1 = Math.max(...xs) + 20, y0 = Math.min(...ys) - 20, y1 = Math.max(...ys) + 20;
  ctx.fillStyle = 'rgba(120, 240, 255, 0.07)';
  const off = (t * 40) % 6;
  for (let y = y0 + off; y < y1; y += 6) ctx.fillRect(x0, y, x1 - x0, 2);
  ctx.restore();
}

/** Draws tracked hands in the chosen style. */
export function drawHands(ctx, hands, { style = 'outline', players = 1, W = 1280, t = 0 } = {}) {
  const live = new Set();
  for (const h of hands) {
    if (!h.present || !h.points) continue;
    live.add(h.id);
    const p = h.points;
    const rgb = colourFor(h, players, W);
    if (h.virtual) {
      ctx.beginPath();
      ctx.arc(p[8].x, p[8].y, h.pressing ? 9 : 12, 0, Math.PI * 2);
      ctx.strokeStyle = `rgb(${rgb})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (h.pressing) {
        ctx.fillStyle = `rgba(${rgb}, 0.5)`;
        ctx.fill();
      }
      continue;
    }
    if (style === 'trails' || style === 'hologram') drawTrails(ctx, h, style === 'hologram' ? '120, 240, 255' : rgb, t);
    if (style === 'hologram') {
      drawHologram(ctx, h, rgb, t);
    } else {
      if (style !== 'minimal') {
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
        ctx.fillStyle = i === 8 ? `rgb(${rgb})` : 'rgba(237, 235, 255, 0.85)';
        ctx.fill();
      }
    }
    if (h.pinching) {
      ctx.beginPath();
      ctx.arc(h.pinchPoint.x, h.pinchPoint.y, 13, 0, Math.PI * 2);
      ctx.strokeStyle = `rgb(${rgb})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }
  for (const id of trails.keys()) if (!live.has(id)) trails.delete(id);
}
