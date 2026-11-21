// One Euro filter (Casiez et al.): smooths jitter when the hand is still,
// stays responsive when it moves fast (important for strumming).

class LowPass {
  constructor() { this.y = null; }
  filter(x, a) {
    this.y = this.y === null ? x : a * x + (1 - a) * this.y;
    return this.y;
  }
}

const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

export class OneEuro {
  constructor(minCutoff = 1.5, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPass();
    this.dx = new LowPass();
    this.last = null;
    this.t = null;
  }

  filter(x, t) {
    if (this.t === null || t <= this.t) {
      this.t = t;
      this.last = x;
      this.x.y = x;
      this.dx.y = 0;
      return x;
    }
    const dt = t - this.t;
    this.t = t;
    const dx = (x - this.last) / dt;
    this.last = x;
    const edx = this.dx.filter(dx, alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(x, alpha(cutoff, dt));
  }
}
