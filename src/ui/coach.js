// First-time tutorials: a few short steps per instrument, each with an animated ghost hand
// showing the gesture. A step finishes by itself as soon as you do it for real.
// Also hosts the piano's tap calibration.
import { ghostPoints, drawGhost } from './ghostHand.js';

const ease = (u) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));
const SEEN = 'virtual-music:coached:v1';

const TUTORIALS = {
  guitar: [
    { text: 'Hold your left hand over a chord name on the neck.',
      demo: (t, g) => { const c = g.cells[Math.floor(t / 1.4) % g.cells.length]; return [ghostPoints((c.x0 + c.x1) / 2, (g.top + g.bottom) / 2, 58)]; },
      done: (s) => s.hover > 0.5 || s.chordChanges > 0 },
    { text: 'Now strum down across the strings with your right index finger.',
      demo: (t, g) => [ghostPoints((g.strum[0] + g.strum[1]) / 2, g.top - 40 + (g.bottom - g.top + 80) * ease((t % 1.3) / 0.9), 58)],
      done: (s) => s.strums > 0 },
    { text: 'Pick a different chord with your left hand and strum again.',
      demo: (t, g) => { const c = g.cells[(Math.floor(t / 1.4) + 1) % g.cells.length]; return [ghostPoints((c.x0 + c.x1) / 2, (g.top + g.bottom) / 2, 58), ghostPoints((g.strum[0] + g.strum[1]) / 2, g.top - 40 + (g.bottom - g.top + 80) * ease((t % 1.4) / 0.9), 58)]; },
      done: (s) => s.strumsAfterChange > 0 },
  ],
  strings: [
    { text: 'Pinch thumb and index finger on both hands, close together.',
      demo: (t, i, app) => { const d = 40 + 30 * Math.sin(t * 2); return [ghostPoints(app.W / 2 - d, app.H * 0.45, 58, 'pinch', 0, true), ghostPoints(app.W / 2 + d, app.H * 0.45, 58, 'pinch')]; },
      done: (s, inst) => !!inst.draft },
    { text: 'Pull your hands apart, then let go to keep the string.',
      demo: (t, i, app) => { const d = 40 + 220 * ease((t % 2) / 1.5); return [ghostPoints(app.W / 2 - d, app.H * 0.45, 58, 'pinch', 0, true), ghostPoints(app.W / 2 + d, app.H * 0.45 - d * 0.3, 58, 'pinch')]; },
      done: (s) => s.stringsMade > 0 },
    { text: 'Swipe a fingertip across your string to pluck it.',
      demo: (t, i, app) => [ghostPoints(app.W / 2 + 60 * Math.sin(t * 4), app.H * 0.4 + 120 * Math.sin(t * 2), 58)],
      done: (s) => s.hits > 0 },
  ],
  harp: [
    { text: 'Sweep your fingers sideways across the strings.',
      demo: (t, h, app) => [ghostPoints(app.W * (0.3 + 0.4 * ease((t % 2) / 1.6)), app.H * 0.5, 58)],
      done: (s) => s.hits >= 4 },
  ],
  piano: [
    { text: 'Hold your hands over the keys, palms down and fingers relaxed.',
      demo: (t, p) => { const r = p.rows[0].rect; return [ghostPoints(r.x + r.w * 0.45, r.y + r.h * 0.35 + 6 * Math.sin(t * 2), 62, 'down')]; },
      done: (s) => s.hover > 0.6 },
    { text: 'Tap one finger down, like pressing a real key.',
      demo: (t, p) => { const r = p.rows[0].rect; const f = Math.max(0, Math.sin(t * 5)); return [ghostPoints(r.x + r.w * 0.45, r.y + r.h * 0.35, 62, 'down', f)]; },
      done: (s) => s.ons > 0 },
    { text: 'Keep the finger down and slide sideways to run across the keys.',
      demo: (t, p) => { const r = p.rows[0].rect; return [ghostPoints(r.x + r.w * (0.35 + 0.25 * ease((t % 2) / 1.6)), r.y + r.h * 0.75, 62, 'down', 1)]; },
      done: (s) => s.slides > 0 },
  ],
  drums: [
    { text: 'Strike down onto the snare and stop, as if holding a stick.',
      demo: (t, d) => { const p = d.pads.find((x) => x.id === 'snare'); const u = (t % 1) / 1; return p ? [ghostPoints(p.cx, p.cy - 90 + 90 * (u < 0.25 ? u / 0.25 : 1 - (u - 0.25) * 0.4), 58)] : []; },
      done: (s) => s.pads.has('snare') },
    { text: 'Now hit the hi-hat and the kick drum.',
      demo: (t, d) => { const ids = ['hihat', 'kick']; const p = d.pads.find((x) => x.id === ids[Math.floor(t) % 2]); const u = t % 1; return p ? [ghostPoints(p.cx, p.cy - 90 + 90 * (u < 0.25 ? u / 0.25 : 1 - (u - 0.25) * 0.4), 58)] : []; },
      done: (s) => s.pads.has('hihat') && s.pads.has('kick') },
  ],
  marimba: [
    { text: 'Tap down onto three different bars, like striking with a mallet.',
      demo: (t, m) => { const b = m.bars[(Math.floor(t) * 3) % m.bars.length]; const u = t % 1; return b ? [ghostPoints(b.x + b.w / 2, b.y + b.h / 2 - 80 + 80 * (u < 0.25 ? u / 0.25 : 1 - (u - 0.25) * 0.4), 58)] : []; },
      done: (s) => s.keys.size >= 3 },
  ],
  theremin: [
    { text: 'Raise and lower your right hand to change the pitch.',
      demo: (t, th, app) => [ghostPoints(app.W * 0.72, app.H * (0.5 + 0.25 * Math.sin(t * 1.6)), 58)],
      done: (s) => s.range >= 7 },
    { text: 'Raise your left hand for more volume, lower it for less.',
      demo: (t, th, app) => [ghostPoints(app.W * 0.25, app.H * (0.5 + 0.25 * Math.sin(t * 1.6)), 58, 'point', 0, true), ghostPoints(app.W * 0.72, app.H * 0.45, 58)],
      done: (s) => s.levelRange > 0.4 },
  ],
  violin: [
    { text: 'Move your right hand sideways through the bow area to bow.',
      demo: (t, v) => [ghostPoints((v.bow[0] + v.bow[1]) / 2 + 140 * Math.sin(t * 3), (v.strY[0] + v.strY[3]) / 2, 58)],
      done: (s) => s.bowing > 0.8 },
    { text: 'While bowing, move your left hand up and down the fingerboard.',
      demo: (t, v) => [ghostPoints((v.board[0] + v.board[1]) / 2, (v.top + v.bottom) / 2 + 150 * Math.sin(t * 1.4), 58, 'point', 0, true), ghostPoints((v.bow[0] + v.bow[1]) / 2 + 140 * Math.sin(t * 3), (v.strY[0] + v.strY[3]) / 2, 58)],
      done: (s) => s.range >= 5 },
  ],
  launchpad: [
    { text: 'Tap down on the Beat pad to start a drum loop.',
      demo: (t, l) => { const p = l.pads.find((x) => x.id === 'beat'); const u = t % 1; return p ? [ghostPoints(p.x + p.s / 2, p.y + p.s / 2 - 70 + 70 * (u < 0.25 ? u / 0.25 : 1 - (u - 0.25) * 0.4), 58)] : []; },
      done: (s) => [...s.keys].some((k) => ['beat', 'groove', 'break', 'hats'].includes(k)) },
    { text: 'Add a bass loop from the second row.',
      demo: (t, l) => { const p = l.pads.find((x) => x.id === 'root'); const u = t % 1; return p ? [ghostPoints(p.x + p.s / 2, p.y + p.s / 2 - 70 + 70 * (u < 0.25 ? u / 0.25 : 1 - (u - 0.25) * 0.4), 58)] : []; },
      done: (s) => [...s.keys].some((k) => ['root', 'bounce', 'walk', 'sub'].includes(k)) },
  ],
};

export class Coach {
  constructor(app) {
    this.app = app;
    this.run = null;
    try { this.seen = JSON.parse(localStorage.getItem(SEEN)) || {}; } catch (e) { this.seen = {}; }
    this.panel = document.getElementById('coach');
    this.stepEl = document.getElementById('coachStep');
    this.textEl = document.getElementById('coachText');
    document.getElementById('coachSkip').addEventListener('click', () => this.end(true));
    app.bus.on((e) => this.onEvent(e));
  }

  get active() { return !!this.run; }

  /** Start the tutorial automatically the first time an instrument is played on camera. */
  maybeStart(id) {
    if (!this.app.camera.on || this.seen[id] || this.run || this.app.game.playing || this.app.replay.play) return;
    setTimeout(() => { if (this.app.instrument && this.app.instrument.id === id && !this.run) this.start(id); }, 700);
  }

  start(id) {
    const steps = TUTORIALS[id];
    if (!steps) return;
    this.run = { id, steps, i: 0, t: 0, nice: 0, s: this.#fresh() };
    this.#show();
  }

  #fresh() {
    return { hover: 0, chordChanges: 0, strums: 0, strumsAfterChange: 0, stringsMade: 0, hits: 0, ons: 0, slides: 0, pads: new Set(), keys: new Set(), range: 0, lo: 1e9, hi: -1e9, levelRange: 0, lv0: 1, lv1: 0, bowing: 0, lastChord: null, firstChord: null, burst: [] };
  }

  #show() {
    const r = this.run;
    this.panel.hidden = false;
    this.stepEl.textContent = r.custom ? r.title : `How to play the ${this.app.instrument.constructor.label.toLowerCase()}: step ${r.i + 1} of ${r.steps.length}`;
    this.textEl.textContent = r.steps[r.i].text;
    this.panel.classList.remove('nice');
  }

  end(skipped = false) {
    if (!this.run) return;
    if (!this.run.custom) {
      this.seen[this.run.id] = true;
      try { localStorage.setItem(SEEN, JSON.stringify(this.seen)); } catch (e) { /* ignore */ }
    }
    this.run = null;
    this.panel.hidden = true;
    if (!skipped) this.app.toast('You’re ready. Have fun!', 1800);
  }

  onEvent(e) {
    const r = this.run;
    if (!r || e.playback || !this.app.instrument || e.inst !== this.app.instrument.id) return;
    const s = r.s;
    if (e.type === 'hit' || e.type === 'pad') {
      s.hits++;
      if (e.pad) s.pads.add(e.pad);
      s.keys.add(e.key);
      if (e.inst === 'guitar') {
        const now = performance.now();
        s.burst = s.burst.filter((b) => now - b < 150);
        s.burst.push(now);
        if (s.burst.length === 3) {
          s.strums++;
          if (s.firstChord == null) s.firstChord = e.chord;
          else if (e.chord !== s.firstChord) s.strumsAfterChange++;
        }
        if (s.lastChord && e.chord !== s.lastChord) s.chordChanges++;
        s.lastChord = e.chord;
      }
    } else if (e.type === 'on') {
      s.ons++;
      if (e.slide) s.slides++;
    } else if (e.type === 'cont' && e.level > 0.2) {
      s.lo = Math.min(s.lo, e.midi);
      s.hi = Math.max(s.hi, e.midi);
      s.range = s.hi - s.lo;
      s.lv0 = Math.min(s.lv0, e.level);
      s.lv1 = Math.max(s.lv1, e.level);
      s.levelRange = s.lv1 - s.lv0;
    }
  }

  update(dt) {
    const r = this.run;
    if (!r) return;
    const inst = this.app.instrument;
    if (!inst || (!r.custom && inst.id !== r.id)) { this.run = null; this.panel.hidden = true; return; }
    r.t += dt;
    const s = r.s;
    if (inst.id === 'guitar' && inst.hoverIndex >= 0) s.hover += dt;
    if (inst.id === 'piano' && inst.cursors && inst.cursors.length >= 2) s.hover += dt;
    if (inst.id === 'violin' && inst.level > 0.3) s.bowing += dt;
    if (inst.id === 'strings') s.stringsMade = Math.max(s.stringsMade, inst.strings.length - (r.startStrings ?? (r.startStrings = inst.strings.length)));
    if (r.custom && r.tick) r.tick(dt, inst, r);
    if (r.nice > 0) {
      r.nice -= dt;
      if (r.nice <= 0) {
        r.i++;
        if (r.i >= r.steps.length) { if (r.onDone) r.onDone(); this.end(); return; }
        r.t = 0;
        this.#show();
      }
      return;
    }
    if (r.steps[r.i].done(s, inst, r)) {
      r.nice = 0.8;
      this.textEl.textContent = 'Nice!';
      this.panel.classList.add('nice');
    }
  }

  draw(ctx) {
    const r = this.run;
    if (!r || r.nice > 0) return;
    const step = r.steps[r.i];
    if (!step.demo) return;
    try {
      for (const P of step.demo(r.t, this.app.instrument, this.app)) drawGhost(ctx, P, 0.75);
    } catch (err) { /* layout not ready yet */ }
  }

  /** Piano: measure your resting jitter and your taps, then set the tap sensitivity. */
  calibratePiano() {
    const app = this.app;
    if (!app.camera.on) { app.toast('Turn on the camera first: calibration measures your real taps.', 3500); return; }
    const data = { still: 0, noise: 0, peaks: [], cur: 0, inTap: false };
    const index = (inst) => (inst.cursors || []).filter((c) => c.finger === 1);
    this.run = {
      custom: true, id: 'piano', title: 'Calibrating taps', i: 0, t: 0, nice: 0, s: this.#fresh(),
      steps: [
        { text: 'Rest one hand over the keys, fingers relaxed, and keep it still for two seconds.',
          demo: (t, p) => { const r = p.rows[0].rect; return [ghostPoints(r.x + r.w * 0.45, r.y + r.h * 0.35, 62, 'down')]; },
          done: () => data.still > 2 },
        { text: 'Now tap your index finger down four times, at a comfortable size.',
          demo: (t, p) => { const r = p.rows[0].rect; return [ghostPoints(r.x + r.w * 0.45, r.y + r.h * 0.35, 62, 'down', Math.max(0, Math.sin(t * 5)))]; },
          done: () => data.peaks.length >= 4 },
      ],
      tick: (dt, inst, r) => {
        const c = index(inst);
        if (r.i === 0) {
          if (c.length) { data.still += dt; data.noise = Math.max(data.noise, ...c.map((x) => Math.abs(x.eff || 0))); }
        } else {
          const e = c.length ? Math.max(...c.map((x) => x.eff || 0)) : 0;
          const on = data.noise + 0.05;
          if (!data.inTap && e > on) { data.inTap = true; data.cur = e; }
          if (data.inTap) {
            data.cur = Math.max(data.cur, e);
            if (e < on * 0.8) { data.inTap = false; data.peaks.push(data.cur); }
          }
        }
      },
      onDone: () => {
        const sorted = [...data.peaks].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] || 0.3;
        const threshold = Math.max(data.noise * 2.2 + 0.03, median * 0.45);
        const sens = Math.round(Math.max(0.5, Math.min(2, 0.16 / threshold)) * 20) / 20;
        app.updateSetting('piano', 'sensitivity', sens);
        app.toast(`Tap sensitivity set to ${sens.toFixed(2)}. You can fine-tune it in Settings.`, 4000);
      },
    };
    this.#show();
  }
}
