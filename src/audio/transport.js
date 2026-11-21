// The shared musical clock: tempo, bars and beats, a look-ahead scheduler and the metronome.
// The loop station, backing tracks, launchpad and song mode all schedule against it,
// so everything stays in time with everything else.

export class Transport {
  constructor(engine) {
    this.engine = engine;
    this.bpm = 96;
    this.beatsPerBar = 4;
    this.playing = false;
    this.startTime = 0;
    this.metronome = false;
    this.schedulers = new Set();
    this.listeners = new Set();
    this.scheduledUntil = 0;
    this.timer = null;
  }

  get spb() { return 60 / this.bpm; }
  get now() { return this.engine.now; }
  /** Current position in beats (can be negative during a count-in). */
  get beat() { return this.playing ? this.beatAt(this.now) : 0; }
  beatAt(time) { return (time - this.startTime) / this.spb; }
  timeAt(beat) { return this.startTime + beat * this.spb; }
  /** Beat number where the next bar starts. */
  nextBar(fromBeat = this.beat) { return Math.ceil((fromBeat - 1e-6) / this.beatsPerBar) * this.beatsPerBar; }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  #emit(type) { this.listeners.forEach((fn) => fn(type, this)); }

  /** A scheduler is called with (fromTime, toTime) audio-clock windows and schedules notes inside them. */
  addScheduler(fn) { this.schedulers.add(fn); return () => this.schedulers.delete(fn); }

  start(atBeat = 0) {
    if (!this.engine.ctx) return;
    if (this.playing) return;
    this.startTime = this.now + 0.08 - atBeat * this.spb;
    this.scheduledUntil = this.now + 0.05;
    this.playing = true;
    this.timer = setInterval(() => this.#tick(), 25);
    this.#tick();
    this.#emit('start');
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    this.#emit('stop');
  }

  setBpm(bpm) {
    const b = Math.max(40, Math.min(220, Math.round(bpm)));
    if (b === this.bpm) return;
    if (this.playing) {
      const beat = this.beat;
      this.bpm = b;
      this.startTime = this.now - beat * this.spb;
    } else {
      this.bpm = b;
    }
    this.engine.setEchoTime(this.spb * 0.75);
    this.#emit('tempo');
  }

  #tick() {
    if (!this.playing) return;
    const until = this.now + 0.15;
    const from = Math.max(this.scheduledUntil, this.now);
    if (until <= from) return;
    if (this.metronome) this.#clicks(from, until);
    for (const fn of this.schedulers) {
      try { fn(from, until, this); } catch (err) { console.error('Scheduler failed', err); }
    }
    this.scheduledUntil = until;
  }

  #clicks(from, until) {
    const b0 = Math.ceil(this.beatAt(from) - 1e-6);
    for (let b = b0; this.timeAt(b) < until; b++) {
      click(this.engine, this.timeAt(b), b % this.beatsPerBar === 0);
    }
  }
}

/** A short metronome click straight to the speakers (not through the effects). */
export function click(engine, t, accent = false) {
  const ctx = engine.ctx;
  if (!ctx) return;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = accent ? 1760 : 1175;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.32, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  o.connect(g).connect(engine.direct);
  o.start(t);
  o.stop(t + 0.08);
}
