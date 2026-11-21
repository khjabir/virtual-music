// Visual effects that react to the music: particle bursts on every note, a glow that
// pulses with the sound, screen shake on drum hits, and light beams in party mode.
import { noteHue } from '../audio/music.js';
import { later } from '../core/bus.js';

const PAD_HUES = { kick: 350, snare: 272, hihat: 62, openhat: 62, crash: 42, ride: 42, tomHigh: 194, tomMid: 214, tomFloor: 172, clap: 140 };

export class Effects {
  constructor(app) {
    this.app = app;
    this.parts = [];
    this.shake = 0;
    this.energy = 0;
    this.hue = 270;
    this.flash = 0;
    this.wave = null;
    this.beamT = 0;
    app.bus.on((e) => this.onNote(e));
  }

  get level() { return this.app.settings.global.effects || 'normal'; }

  onNote(e) {
    if (this.level === 'off' || e.x == null) return;
    if (e.playback && e.inst !== (this.app.instrument && this.app.instrument.id)) return;
    if (e.type === 'off') return;
    const party = this.level === 'party';
    const hue = e.inst === 'drums' ? PAD_HUES[e.pad] ?? 42 : e.midi != null ? noteHue(e.midi) : 42;
    const vel = e.vel ?? e.level ?? 0.7;
    if (e.type === 'cont') {
      if (e.level > 0.15 && Math.random() < (party ? 0.6 : 0.3)) later(0, () => this.spawn(e.x, e.y, hue, party ? 3 : 1, 0.5));
      this.hue = hue;
      return;
    }
    later(e.delay || 0, () => {
      this.spawn(e.x, e.y, hue, Math.round((party ? 26 : 12) * (0.5 + vel)), vel);
      this.hue = hue;
      this.flash = Math.max(this.flash, vel);
      if (e.inst === 'drums' || e.type === 'pad') this.shake = Math.max(this.shake, (party ? 14 : 6) * vel * (e.pad === 'kick' || e.pad === 'crash' ? 1.4 : 1));
    });
  }

  spawn(x, y, hue, n, vel) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (60 + Math.random() * 240) * (0.4 + vel);
      this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 0.55 + Math.random() * 0.6, age: 0, r: 1.5 + Math.random() * 3.5, hue: hue + (Math.random() * 30 - 15) });
    }
    if (this.parts.length > 900) this.parts.splice(0, this.parts.length - 900);
  }

  update(dt) {
    for (const p of this.parts) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - dt * 1.6;
      p.vy = p.vy * (1 - dt * 1.6) + 160 * dt;
    }
    this.parts = this.parts.filter((p) => p.age < p.life);
    this.shake *= Math.exp(-dt * 18);
    this.flash *= Math.exp(-dt * 3);
    this.beamT += dt;
    const an = this.app.audio.analyser;
    if (an) {
      if (!this.wave) this.wave = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(this.wave);
      let sum = 0;
      for (let i = 0; i < this.wave.length; i += 4) sum += this.wave[i] * this.wave[i];
      const rms = Math.sqrt(sum / (this.wave.length / 4));
      this.energy += (Math.min(1, rms * 4) - this.energy) * Math.min(1, dt * 8);
    }
  }

  /** Screen-shake offset to apply while drawing the instrument. */
  get offset() {
    if (this.shake < 0.3 || this.level === 'off') return { x: 0, y: 0 };
    return { x: (Math.random() * 2 - 1) * this.shake, y: (Math.random() * 2 - 1) * this.shake };
  }

  /** Under the instrument: a glow that breathes with the music, plus beams in party mode. */
  drawUnder(ctx) {
    if (this.level === 'off') return;
    const { W, H } = this.app;
    const party = this.level === 'party';
    const a = Math.min(0.55, (this.energy * 0.9 + this.flash * 0.4) * (party ? 0.8 : 0.45));
    if (a > 0.01) {
      const g = ctx.createRadialGradient(W / 2, H * 1.05, 0, W / 2, H * 1.05, Math.max(W, H) * 0.8);
      g.addColorStop(0, `hsla(${this.hue}, 90%, 60%, ${a})`);
      g.addColorStop(1, `hsla(${this.hue}, 90%, 60%, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (party) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) {
        const ox = W * (0.1 + i * 0.27);
        const ang = Math.sin(this.beamT * (0.6 + i * 0.17) + i) * 0.5;
        const len = H * 1.3;
        const tx = ox + Math.sin(ang) * len, ty = Math.cos(ang) * len;
        const g = ctx.createLinearGradient(ox, 0, tx, ty);
        const hue = (this.hue + i * 60) % 360;
        g.addColorStop(0, `hsla(${hue}, 95%, 65%, ${0.12 + this.energy * 0.3})`);
        g.addColorStop(1, `hsla(${hue}, 95%, 65%, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(ox - 8, 0);
        ctx.lineTo(tx - 70, ty);
        ctx.lineTo(tx + 70, ty);
        ctx.lineTo(ox + 8, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** Over the instrument: particles, blended so overlapping ones glow. */
  drawOver(ctx) {
    if (!this.parts.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.parts) {
      const k = 1 - p.age / p.life;
      ctx.fillStyle = `hsla(${p.hue}, 95%, ${60 + 20 * k}%, ${k * 0.9})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.6 + 0.6 * k), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
