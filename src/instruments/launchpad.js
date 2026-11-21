import { Instrument } from './base.js';
import { StrikeDetector, roundRect, FONT } from './common.js';
import { DRUMS, bassNote, chordVoice, mallet } from '../audio/synths.js';
import { STYLES, progression, parseChord, degree } from '../band/patterns.js';
import { clamp } from '../audio/music.js';

// Four rows: drum loops, bass loops, keys loops (one loop per row at a time), and one-shots.
// Loops start and stop on the next bar, so everything always lands in time.
const ROWS = [
  { name: 'Drums', hue: 350, pads: [['beat', 'Beat'], ['groove', 'Groove'], ['break', 'Breakbeat'], ['hats', 'Hats']] },
  { name: 'Bass', hue: 42, pads: [['root', 'Root'], ['bounce', 'Bounce'], ['walk', 'Walk'], ['sub', 'Sub']] },
  { name: 'Keys', hue: 194, pads: [['pad', 'Pad'], ['stabs', 'Stabs'], ['arpUp', 'Arp up'], ['arpDown', 'Arp down']] },
  { name: 'Hits', hue: 272, pads: [['clapRoll', 'Clap roll'], ['riser', 'Riser'], ['impact', 'Impact'], ['hey', 'Hey!']] },
];

const BREAK = {
  kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0.4, 0, 0.6, 0, 0, 1, 0, 0, 0.3],
  hihat: [0.6, 0.3, 0.6, 0.3, 0.6, 0.3, 0.6, 0.3, 0.6, 0.3, 0.6, 0.3, 0.6, 0.3, 0.6, 0.3],
};

export class Launchpad extends Instrument {
  static id = 'launchpad';
  static label = 'Launchpad';
  static icon = '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" fill="currentColor"/>';
  static hint = 'Tap down on a pad to start a loop; it joins on the next bar. Tap it again to stop. One loop per row plays at a time. The bottom row plays one-off hits.';
  static settings = [
    { key: 'sensitivity', label: 'Tap sensitivity', type: 'range', min: 0.5, max: 2, step: 0.05, default: 1 },
  ];

  constructor(app) {
    super(app);
    this.strikes = new StrikeDetector();
    this.active = [null, null, null]; // playing pad id per loop row
    this.queued = [undefined, undefined, undefined]; // pad id to start (or null to stop) at the next bar
    this.flash = new Map();
    this.pads = [];
    app.transport.addScheduler((from, until) => this.schedule(from, until));
    app.transport.on((type) => { if (type === 'stop') this.stopPlayback(); });
  }

  layout() {
    const st = this.stage;
    const size = Math.min((this.W * 0.8) / 4, (st.bottom - st.top - 40) / 4) - 12;
    const gx = (this.W - (size + 12) * 4 + 12) / 2;
    const gy = st.top + (st.bottom - st.top - (size + 12) * 4 + 12) / 2;
    this.pads = [];
    ROWS.forEach((row, r) => row.pads.forEach(([id, label], c) => {
      this.pads.push({ id, label, row: r, col: c, hue: row.hue, x: gx + c * (size + 12), y: gy + r * (size + 12), s: size });
    }));
    this.grid = { x: gx, y: gy, size };
  }

  padAt(p) {
    return this.pads.find((q) => p.x >= q.x - 6 && p.x <= q.x + q.s + 6 && p.y >= q.y - 10 && p.y <= q.y + q.s + 6) || null;
  }

  get channelIn() { return this.channel && this.channel.input; }

  press(pad) {
    const t = this.app.transport;
    if (!this.engine.ctx) return;
    if (!t.playing) t.start(0);
    this.flash.set(pad.id, 1);
    if (pad.row === 3) {
      this.oneShot(pad.id, t.timeAt(Math.ceil(t.beat * 2 - 1e-6) / 2)); // on the next eighth note
    } else {
      const r = pad.row;
      const playing = this.queued[r] !== undefined ? this.queued[r] : this.active[r];
      this.queued[r] = playing === pad.id ? null : pad.id;
    }
    this.emit({ type: 'pad', key: pad.id, x: pad.x + pad.s / 2, y: pad.y + pad.s / 2, vel: 0.8 });
  }

  update(hands, dt) {
    const hits = this.strikes.detect(hands, [8], this.H, (p) => this.padAt(p), Number(this.opts.sensitivity));
    for (const hit of hits) this.press(hit.zone);
    for (const [k, f] of this.flash) {
      const n = f * Math.exp(-dt * 5);
      if (n < 0.02) this.flash.delete(k); else this.flash.set(k, n);
    }
  }

  chordAt(bar) {
    const g = this.global;
    const prog = progression(g.key, g.scale);
    return parseChord(prog[((bar % 4) + 4) % 4]);
  }

  schedule(from, until) {
    const t = this.app.transport;
    if (!this.channelIn) return;
    const step = 0.25;
    for (let s = Math.ceil(t.beatAt(from) / step - 1e-6); t.timeAt(s * step) < until; s++) {
      if (s < 0) continue;
      const i = s % 16;
      const bar = Math.floor(s / 16);
      const time = t.timeAt(s * step);
      if (i === 0) {
        for (let r = 0; r < 3; r++) {
          if (this.queued[r] !== undefined) { this.active[r] = this.queued[r]; this.queued[r] = undefined; }
        }
      }
      const chord = this.chordAt(bar);
      this.#loopStep(this.active[0], this.active[1], this.active[2], i, bar, time, chord);
    }
  }

  #loopStep(drum, bass, keys, i, bar, time, chord) {
    const e = this.engine, dest = this.channelIn;
    if (drum) {
      const pat = drum === 'beat' ? STYLES.pop.drums : drum === 'groove' ? STYLES.funk.drums : drum === 'break' ? BREAK : { hihat: STYLES.funk.drums.hihat };
      for (const [pad, steps] of Object.entries(pat)) if (steps[i]) DRUMS[pad](e, dest, steps[i] * 0.85, time);
    }
    const spb = this.app.transport.spb;
    if (bass) {
      const pat = bass === 'root' ? STYLES.pop.bass : bass === 'bounce' ? STYLES.funk.bass : bass === 'walk' ? [[0, 'R', 4], [4, '3', 4], [8, '5', 4], [12, '8', 4]] : [[0, 'R', 16]];
      for (const [st, deg, len] of pat) {
        if (st !== i) continue;
        const midi = 36 + ((chord.root + 2) % 12) - 2 + degree(deg, chord);
        bassNote(e, dest, midi, 0.85, time, len * 0.25 * spb * 0.95, bass === 'bounce' ? 'pluck' : 'round');
      }
    }
    if (keys) {
      const base = 48 + chord.root + (chord.root < 5 ? 12 : 0);
      const tones = chord.tones.map((x) => base + x);
      const when = Math.max(0, time - e.now);
      if (keys === 'pad' && i === 0) chordVoice(e, dest, tones, 0.9, time, 4 * spb * 0.95, 'pad');
      if (keys === 'stabs' && [2, 6, 11, 14].includes(i)) chordVoice(e, dest, tones, 0.8, time, 0.25 * spb, 'stab');
      if (keys === 'arpUp' || keys === 'arpDown') {
        const seq = [...tones, tones[0] + 12];
        const idx = keys === 'arpUp' ? i % seq.length : seq.length - 1 - (i % seq.length);
        mallet(e, this.channel, seq[idx] + 12, { velocity: i % 4 === 0 ? 0.75 : 0.5, kind: 'vibes', when });
      }
    }
  }

  oneShot(id, time) {
    const e = this.engine, ctx = e.ctx, dest = this.channelIn;
    const spb = this.app.transport.spb;
    if (id === 'clapRoll') {
      for (let k = 0; k < 8; k++) DRUMS.clap(e, dest, 0.4 + k * 0.07, time + spb * (1 - Math.pow(0.78, k)) * 1.6);
    } else if (id === 'impact') {
      DRUMS.kick(e, dest, 1, time);
      DRUMS.crash(e, dest, 0.9, time);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(70, time);
      o.frequency.exponentialRampToValueAtTime(28, time + 1.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.8, time + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 1.6);
      o.connect(g).connect(dest);
      o.start(time);
      o.stop(time + 1.7);
    } else if (id === 'riser') {
      const dur = spb * 4;
      const src = e.noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 3;
      bp.frequency.setValueAtTime(300, time);
      bp.frequency.exponentialRampToValueAtTime(7000, time + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.45, time + dur);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur + 0.05);
      src.connect(bp).connect(g).connect(dest);
      src.start(time);
      src.stop(time + dur + 0.1);
    } else if (id === 'hey') {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(260, time);
      o.frequency.exponentialRampToValueAtTime(190, time + 0.25);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.5, time + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);
      const mix = ctx.createGain();
      for (const [f, q, gain] of [[700, 6, 1], [1220, 8, 0.7], [2600, 10, 0.3]]) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f;
        bp.Q.value = q;
        const bg = ctx.createGain();
        bg.gain.value = gain * 2.5;
        o.connect(bp).connect(bg).connect(mix);
      }
      mix.connect(g).connect(dest);
      o.start(time);
      o.stop(time + 0.35);
    }
  }

  // Loops keep playing when you switch to another instrument, so you can jam over them.
  // They stop when the band is stopped.
  deactivate() {}

  stopPlayback() {
    this.active = [null, null, null];
    this.queued = [undefined, undefined, undefined];
  }

  draw(ctx) {
    const t = this.app.transport;
    const beat = t.playing ? t.beat : 0;
    const pulse = t.playing ? 1 - (((beat % 1) + 1) % 1) : 0;
    const blink = Math.floor(beat * 2) % 2 === 0;
    ctx.font = `650 13px ${FONT}`;
    ROWS.forEach((row, r) => {
      const p = this.pads[r * 4];
      if (!p) return;
      ctx.fillStyle = 'rgba(237, 235, 255, 0.7)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(row.name, p.x - 14, p.y + p.s / 2);
    });
    for (const p of this.pads) {
      const isActive = p.row < 3 && this.active[p.row] === p.id;
      const isQueued = p.row < 3 && this.queued[p.row] === p.id;
      const stopping = p.row < 3 && isActive && this.queued[p.row] === null;
      const f = this.flash.get(p.id) || 0;
      roundRect(ctx, p.x, p.y, p.s, p.s, Math.min(18, p.s * 0.14));
      let light = 0.12 + 0.5 * f;
      if (isActive) light = 0.45 + 0.35 * pulse * (stopping && !blink ? 0 : 1);
      if (isQueued && blink) light = 0.5;
      ctx.fillStyle = `hsla(${p.hue}, 85%, ${isActive ? 58 : 50}%, ${clamp(light, 0, 1)})`;
      ctx.fill();
      ctx.strokeStyle = `hsla(${p.hue}, 90%, 70%, ${isActive || isQueued ? 0.95 : 0.45})`;
      ctx.lineWidth = isActive ? 3 : 1.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(243, 240, 255, 0.95)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.round(clamp(p.s * 0.13, 11, 17))}px ${FONT}`;
      ctx.fillText(p.label, p.x + p.s / 2, p.y + p.s / 2);
      if (isQueued || stopping) {
        ctx.font = `600 ${Math.round(clamp(p.s * 0.09, 10, 13))}px ${FONT}`;
        ctx.fillStyle = 'rgba(243, 240, 255, 0.8)';
        ctx.fillText(isQueued ? 'Starts next bar' : 'Stops next bar', p.x + p.s / 2, p.y + p.s * 0.75);
      }
    }
    // Beat lights
    if (this.grid) {
      const { x, y, size } = this.grid;
      const total = (size + 12) * 4 - 12;
      for (let b = 0; b < 4; b++) {
        const on = t.playing && Math.floor(((beat % 4) + 4) % 4) === b;
        ctx.fillStyle = on ? '#FFD166' : 'rgba(237, 235, 255, 0.2)';
        ctx.beginPath();
        ctx.arc(x + total / 2 + (b - 1.5) * 22, y - 18, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
