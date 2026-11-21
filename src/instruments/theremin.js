import { Instrument } from './base.js';
import { FONT } from './common.js';
import { scaleRange, snapToScale, noteColor, noteName, midiToFreq, pitchClass, clamp } from '../audio/music.js';
import { ThereminVoice, THEREMIN_KINDS } from '../audio/synths.js';

export class Theremin extends Instrument {
  static id = 'theremin';
  static label = 'Theremin';
  static icon = '<path d="M18.5 21V3"/><path d="M3 14c1.6-4 3.1-4 4.6 0s3 4 4.6 0"/><path d="M15 21h7"/>';
  static hint = 'Raise or lower your right hand to change the pitch; your left hand’s height sets the volume (flip sides in Settings). Pinch to go silent. With a mouse, hold the button down.';
  static settings = [
    { key: 'kind', label: 'Sound', type: 'select', options: Object.entries(THEREMIN_KINDS), default: 'classic' },
    { key: 'mode', label: 'Pitch', type: 'select', options: [['glide', 'Glide freely'], ['snap', 'Snap to scale notes']], default: 'glide' },
    { key: 'range', label: 'Range', type: 'select', options: [[24, '2 octaves'], [36, '3 octaves']], default: 24 },
  ];

  constructor(app) {
    super(app);
    this.voice = null;
    this.midi = 60;
    this.level = 0;
    this.trail = [];
    this.wave = new Float32Array(1024);
  }

  layout() {
    const st = this.stage;
    this.top = st.top + 20;
    this.bottom = st.bottom - 20;
    const range = Number(this.opts.range);
    this.low = 48 + this.global.key - (this.global.key > 6 ? 12 : 0);
    this.high = this.low + range;
    this.ladder = scaleRange(this.global.key, this.global.scale, this.low, this.high);
  }

  settingsChanged() {
    this.stopVoice();
    this.resetChannel();
    this.layout();
  }

  yFor(midi) { return this.bottom - ((midi - this.low) / (this.high - this.low)) * (this.bottom - this.top); }

  stopVoice() {
    if (this.voice) this.voice.stop();
    this.voice = null;
  }

  deactivate() {
    this.stopVoice();
    super.deactivate();
  }

  update(hands, dt) {
    if (!this.voice && this.channel) this.voice = new ThereminVoice(this.engine, this.channel, this.opts.kind);
    const lefty = this.global.lefty;
    const sorted = [...hands].sort((a, b) => a.points[8].x - b.points[8].x);
    let pitchHand = null, volHand = null;
    if (sorted.length >= 2) {
      pitchHand = lefty ? sorted[0] : sorted[sorted.length - 1];
      volHand = lefty ? sorted[sorted.length - 1] : sorted[0];
    } else if (sorted.length === 1) {
      pitchHand = sorted[0];
    }

    let target = 0;
    if (pitchHand) {
      const p = pitchHand.points[8];
      const norm = clamp((this.bottom - p.y) / (this.bottom - this.top), 0, 1);
      const cont = this.low + norm * (this.high - this.low);
      this.midi = this.opts.mode === 'snap' ? snapToScale(cont, this.global.key, this.global.scale) : cont;
      if (pitchHand.virtual) target = pitchHand.pressing ? 0.85 : 0;
      else if (pitchHand.pinching) target = 0;
      else if (volHand && !volHand.virtual) target = clamp((this.bottom - volHand.points[8].y) / (this.bottom - this.top), 0, 1);
      else target = 0.75;
      this.trail.push({ x: p.x, y: p.y });
    } else if (this.trail.length) {
      this.trail.shift();
    }
    if (this.trail.length > 36) this.trail.shift();
    this.level += (target - this.level) * Math.min(1, dt * 12);
    this.pitchPoint = pitchHand ? pitchHand.points[8] : null;
    if (this.voice) this.voice.set(midiToFreq(this.midi), target);
  }

  draw(ctx) {
    const { W } = this;
    const lefty = this.global.lefty;
    // Pitch ladder: one line per scale note
    ctx.font = `600 12px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = lefty ? 'left' : 'right';
    const lx = lefty ? 16 : W - 16;
    for (const m of this.ladder) {
      const y = this.yFor(m);
      const root = pitchClass(m) === this.global.key;
      ctx.strokeStyle = noteColor(m, root ? 0.38 : 0.16);
      ctx.lineWidth = root ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(lefty ? 60 : 0, y);
      ctx.lineTo(lefty ? W : W - 60, y);
      ctx.stroke();
      ctx.fillStyle = noteColor(m, root ? 0.95 : 0.6, 78);
      ctx.fillText(noteName(m), lx, y);
    }

    // Oscilloscope of what you hear
    const an = this.engine.analyser;
    if (an && this.level > 0.01) {
      an.getFloatTimeDomainData(this.wave);
      ctx.beginPath();
      const mid = this.top + (this.bottom - this.top) * 0.5;
      const amp = (this.bottom - this.top) * 0.18;
      for (let i = 0; i < this.wave.length; i++) {
        const x = (i / (this.wave.length - 1)) * W;
        const y = mid - this.wave[i] * amp * 2.5;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = noteColor(this.midi, 0.3 * Math.min(1, this.level * 2), 75);
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Trail and current pitch
    if (this.trail.length > 1) {
      ctx.beginPath();
      this.trail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = noteColor(this.midi, 0.5, 70);
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    if (this.pitchPoint) {
      const y = this.yFor(this.midi);
      ctx.strokeStyle = noteColor(this.midi, 0.25 + 0.6 * this.level, 72);
      ctx.lineWidth = 2 + 4 * this.level;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      const p = this.pitchPoint;
      const r = 14 + 22 * this.level;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2);
      grad.addColorStop(0, noteColor(this.midi, 0.9, 80));
      grad.addColorStop(1, noteColor(this.midi, 0, 60));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2, 0, Math.PI * 2);
      ctx.fill();
      const nearest = Math.round(this.midi);
      const cents = Math.round((this.midi - nearest) * 100);
      ctx.fillStyle = noteColor(nearest, 1, 82);
      ctx.font = `800 30px ${FONT}`;
      ctx.textAlign = lefty ? 'left' : 'right';
      ctx.textBaseline = 'bottom';
      const tx = lefty ? p.x + 40 : p.x - 40;
      ctx.fillText(noteName(nearest), tx, p.y - 8);
      if (this.opts.mode !== 'snap') {
        ctx.font = `600 15px ${FONT}`;
        ctx.fillStyle = 'rgba(237, 235, 255, 0.7)';
        ctx.textBaseline = 'top';
        ctx.fillText(`${cents >= 0 ? '+' : '−'}${Math.abs(cents)} cents`, tx, p.y - 2);
      }
    }

    // Volume meter
    const mx = lefty ? W - 34 : 22;
    ctx.fillStyle = 'rgba(18, 20, 43, 0.5)';
    ctx.fillRect(mx, this.top, 12, this.bottom - this.top);
    const h = (this.bottom - this.top) * this.level;
    ctx.fillStyle = 'rgba(255, 209, 102, 0.85)';
    ctx.fillRect(mx, this.bottom - h, 12, h);
    ctx.save();
    ctx.translate(mx + 28 * (lefty ? -1 : 1) + (lefty ? 12 : 0), (this.top + this.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(237, 235, 255, 0.6)';
    ctx.font = `600 12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Volume', 0, 0);
    ctx.restore();
  }
}
