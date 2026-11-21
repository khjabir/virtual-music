// A tiny event bus. Instruments announce every note they play here; the loop station,
// replays, MIDI output, song scoring, tutorials and visual effects all listen.
export class Bus {
  constructor() { this.subs = new Set(); }

  on(fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  emit(evt) {
    for (const fn of this.subs) {
      try { fn(evt); } catch (err) { console.error('Event listener failed', err); }
    }
  }
}

/** Run fn after `when` seconds (0 = now). Used to line visuals up with scheduled sounds. */
export function later(when, fn) {
  if (when > 0.004) setTimeout(fn, when * 1000);
  else fn();
}
