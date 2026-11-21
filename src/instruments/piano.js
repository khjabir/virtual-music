// Piano: 49 to 88 keys, zoom and pan, one or two stacked keyboards, key labels,
// sampled sounds, sustain, note trails, and three ways to play: finger taps on camera,
// mouse/touch, and the computer keyboard.
import { Instrument } from './base.js';
import { FONT } from './common.js';
import { noteColor, clamp } from '../audio/music.js';
import { keyNote } from '../audio/synths.js';
import { KEYBOARD_SOUNDS, sampleSet } from '../audio/sampler.js';
import { KeyboardRow, ZOOM_STEPS } from './piano/keyboardRow.js';
import { FingerTaps, DipPress } from './piano/fingerPress.js';

const SOUND_OPTIONS = Object.entries(KEYBOARD_SOUNDS).map(([k, v]) => [k, v.label]);
const RANGES = { 49: [36, 84], 61: [36, 96], 76: [28, 103], 88: [21, 108] };
const FINGER_SETS = { all: [0, 1, 2, 3, 4], four: [1, 2, 3, 4], index: [1] };
const LABEL_CYCLE = ['off', 'c', 'white', 'all'];
const LABEL_TEXT = { off: 'Labels off', c: 'C labels', white: 'White key labels', all: 'All labels' };
// Computer keyboard: the home row plays from the first C on screen, the bottom row an octave lower.
const KEYMAP = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17 };
const LOWMAP = { KeyZ: 0, KeyX: 2, KeyC: 4, KeyV: 5, KeyB: 7, KeyN: 9, KeyM: 11 };
const ICON_LEFT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const ICON_RIGHT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5"/></svg>';
const ICON_MINUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5"/></svg>';

export class Piano extends Instrument {
  static id = 'piano';
  static label = 'Piano';
  static icon = '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7.5 13v6M12 13v6M16.5 13v6"/><path d="M6.5 5h2v8h-2zM11 5h2v8h-2zM15.5 5h2v8h-2z" fill="currentColor"/>';
  static hint = 'Hover your fingertips over the keys, then tap one finger down to play, as on a real piano. Moving your hand around does not play. Pinch the strip at the top and drag to scroll.';
  static settings = [
    { key: 'sound', label: 'Sound', type: 'select', options: SOUND_OPTIONS, default: 'grand' },
    { key: 'mode', label: 'Layout', type: 'select', options: [['single', 'One keyboard'], ['double', 'Two keyboards, stacked']], default: 'single' },
    { key: 'sound2', label: 'Lower keyboard sound', type: 'select', options: [['same', 'Same as the upper keyboard'], ...SOUND_OPTIONS], default: 'same' },
    { key: 'size', label: 'Keyboard size', type: 'select', options: [[49, '49 keys (C2 to C6)'], [61, '61 keys (C2 to C7)'], [76, '76 keys (E1 to G7)'], [88, '88 keys (A0 to C8)']], default: 61 },
    { key: 'labels', label: 'Key labels', type: 'select', options: LABEL_CYCLE.map((k) => [k, { off: 'Off', c: 'C keys only', white: 'White keys', all: 'All keys' }[k]]), default: 'c' },
    { key: 'notation', label: 'Label style', type: 'select', options: [['octave', 'C4, D4, E4'], ['letters', 'C, D, E'], ['solfege', 'Do, Re, Mi']], default: 'octave' },
    { key: 'press', label: 'Press keys by', type: 'select', options: [['tap', 'Tapping a finger down (recommended)'], ['dip', 'Lowering fingertips into the keys']], default: 'tap' },
    { key: 'fingers', label: 'Play with', type: 'select', options: [['all', 'All five fingers'], ['four', 'Four fingers, no thumbs'], ['index', 'Index fingers only']], default: 'all' },
    { key: 'sensitivity', label: 'Tap sensitivity', type: 'range', min: 0.5, max: 2, step: 0.05, default: 1 },
    { key: 'velocity', label: 'Touch response', type: 'select', options: [['dynamic', 'Faster taps play louder'], ['fixed', 'Every note the same loudness']], default: 'dynamic' },
    { key: 'sustain', label: 'Sustain pedal', type: 'toggle', default: false },
    { key: 'trails', label: 'Note trails', type: 'toggle', default: true },
  ];

  constructor(app) {
    super(app);
    this.rows = [];
    this.taps = new FingerTaps();
    this.dip = new DipPress();
    this.fingerKeys = new Map(); // press id -> { row, midi, x }
    this.held = new Map(); // "row:midi" -> fingers holding it
    this.voices = new Map(); // "row:midi" -> voice
    this.sustained = [];
    this.flash = new Map();
    this.hover = new Set();
    this.trails = [];
    this.cursors = [];
    this.pedal = false;
    this.grabs = new Map(); // hand id -> row index while pinch-dragging the overview
    this.pinchSince = new Map();
    this.keysDown = new Map();
    this.nav = null;
    this.lastSampleCheck = 0;
    this.camHandsSeen = false;
  }

  /* ---------- structure ---------- */

  buildRows() {
    const size = Number(this.opts.size) in RANGES ? Number(this.opts.size) : 61;
    const [lo, hi] = RANGES[size];
    const n = this.opts.mode === 'double' ? 2 : 1;
    const saved = this.app.settings.raw(this.id, 'views');
    this.rows = Array.from({ length: n }, (_, i) => {
      const row = new KeyboardRow(lo, hi, i);
      const v = saved && saved.size === size && saved.rows && saved.rows[i];
      if (v) {
        row.count = clamp(v.count, 5, row.nWhite);
        row.setStart(v.start, true);
      } else {
        // About 60 px per white key: three octaves on a laptop, one on a phone.
        row.count = clamp(Math.round(this.W / 60), 7, Math.min(21, row.nWhite));
        const centre = row.byMidi.get(i === 0 ? 60 : 48) || row.whites[Math.floor(row.nWhite / 2)];
        row.setStart(centre.wi - row.count / 2 + 0.5, true);
      }
      return row;
    });
    this.builtFor = `${size}:${n}`;
  }

  saveViews() {
    const size = Number(this.opts.size);
    this.app.settings.set(this.id, 'views', { size, rows: this.rows.map((r) => ({ start: r.target, count: r.count })) });
  }

  layout() {
    const want = `${Number(this.opts.size) in RANGES ? Number(this.opts.size) : 61}:${this.opts.mode === 'double' ? 2 : 1}`;
    if (!this.rows.length || this.builtFor !== want) {
      this.releaseAll();
      this.buildRows();
    }
    this.mountNav();
    const navBottom = this.nav ? this.nav.getBoundingClientRect().bottom : this.stage.top;
    const st = this.stage;
    const top = navBottom + 16;
    const x = this.W * 0.03, w = this.W * 0.94;
    const bottom = st.bottom - 6;
    if (this.rows.length === 1) {
      const h = clamp(Math.min(this.H * 0.34, bottom - top - 70), 110, 300);
      this.rows[0].setRect(x, bottom - h, w, h);
    } else {
      const h = clamp((bottom - top - 40 - 30) / 2, 80, 230);
      this.rows[1].setRect(x, bottom - h, w, h);
      this.rows[0].setRect(x, bottom - h - 30 - h, w, h);
    }
    this.trailTop = top;
  }

  activate() {
    this.layout();
    this.onWheel = (e) => this.wheel(e);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    this.ensureSamples(true);
  }

  audioReady() { this.ensureSamples(true); }

  deactivate() {
    this.releaseAll();
    this.taps.reset();
    this.dip.reset();
    this.unmountNav();
    if (this.onWheel) window.removeEventListener('wheel', this.onWheel);
    super.deactivate();
  }

  settingsChanged() {
    if (!this.sustainOn) this.releaseSustained();
    this.layout();
    this.updateNav();
    this.ensureSamples(true);
  }

  get sustainOn() { return this.opts.sustain || this.pedal; }

  soundFor(row) {
    const o = this.opts;
    return row === 1 && o.sound2 !== 'same' ? o.sound2 : o.sound;
  }

  ensureSamples(force = false) {
    if (!this.engine.ctx || !this.rows.length) return;
    const now = performance.now();
    if (!force && now - this.lastSampleCheck < 500) return;
    this.lastSampleCheck = now;
    this.rows.forEach((row, i) => {
      const id = this.soundFor(i);
      if (KEYBOARD_SOUNDS[id] && !KEYBOARD_SOUNDS[id].synth) {
        const centre = row.whites[clamp(Math.round(row.target + row.count / 2), 0, row.nWhite - 1)].midi;
        sampleSet(this.engine, id).load(row.lo, row.hi, centre);
      }
    });
  }

  /* ---------- navigation bar (DOM, so it works with mouse, touch and fingertip hover) ---------- */

  mountNav() {
    const want = String(this.rows.length);
    if (this.nav && this.nav.dataset.rows === want) return;
    this.unmountNav();
    const nav = document.createElement('div');
    nav.className = 'piano-nav instrument-ui';
    nav.dataset.rows = want;
    const rowsHtml = this.rows.map((r, i) => `
      <div class="nav-row">
        <button class="nav-btn" type="button" data-dwell data-act="left" data-row="${i}" aria-label="Scroll ${this.rows.length > 1 ? (i ? 'lower' : 'upper') + ' keyboard ' : ''}left">${ICON_LEFT}</button>
        <canvas class="overview" data-row="${i}" role="slider" aria-label="${this.rows.length > 1 ? (i ? 'Lower' : 'Upper') + ' keyboard' : 'Keyboard'} position. Drag to scroll."></canvas>
        <button class="nav-btn" type="button" data-dwell data-act="right" data-row="${i}" aria-label="Scroll ${this.rows.length > 1 ? (i ? 'lower' : 'upper') + ' keyboard ' : ''}right">${ICON_RIGHT}</button>
      </div>`).join('');
    nav.innerHTML = `
      <div class="nav-rows">${rowsHtml}</div>
      <div class="nav-tools">
        <button class="nav-btn" type="button" data-dwell data-act="zoomin" aria-label="Zoom in: fewer, wider keys" title="Zoom in (+)">${ICON_PLUS}</button>
        <button class="nav-btn" type="button" data-dwell data-act="zoomout" aria-label="Zoom out: more keys" title="Zoom out (−)">${ICON_MINUS}</button>
        <button class="chip" type="button" data-dwell data-act="sustain" aria-pressed="false" title="Sustain (hold Space)">Sustain</button>
        <button class="chip" type="button" data-dwell data-act="labels">C labels</button>
        <select class="chip-select" aria-label="Sound">${SOUND_OPTIONS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <span class="nav-status" aria-live="polite"></span>
      </div>`;
    document.body.append(nav);
    this.nav = nav;
    nav.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => this.navAction(b.dataset.act, Number(b.dataset.row || 0))));
    nav.querySelector('select').addEventListener('change', (e) => this.app.updateSetting(this.id, 'sound', e.target.value));
    nav.querySelectorAll('canvas.overview').forEach((cv) => {
      const row = () => this.rows[Number(cv.dataset.row)];
      const seek = (e) => {
        const r = cv.getBoundingClientRect();
        row().centerOn(clamp((e.clientX - r.left) / r.width, 0, 1));
      };
      cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); seek(e); });
      cv.addEventListener('pointermove', (e) => { if (cv.hasPointerCapture(e.pointerId)) seek(e); });
      cv.addEventListener('pointerup', () => this.saveViews());
    });
    this.updateNav();
  }

  unmountNav() {
    if (this.nav) this.nav.remove();
    this.nav = null;
  }

  updateNav() {
    if (!this.nav) return;
    const o = this.opts;
    const sus = this.nav.querySelector('[data-act="sustain"]');
    sus.setAttribute('aria-pressed', String(!!o.sustain));
    this.nav.querySelector('[data-act="labels"]').textContent = LABEL_TEXT[o.labels] || 'Labels';
    this.nav.querySelector('select').value = o.sound;
  }

  navAction(act, rowIndex) {
    const row = this.rows[rowIndex];
    if (act === 'left' || act === 'right') {
      const stepKeys = Math.max(1, Math.min(7, Math.round(row.count / 2)));
      row.pan(act === 'left' ? -stepKeys : stepKeys);
      this.saveViews();
    } else if (act === 'zoomin' || act === 'zoomout') {
      this.zoom(act === 'zoomin' ? -1 : 1);
    } else if (act === 'sustain') {
      this.app.updateSetting(this.id, 'sustain', !this.opts.sustain);
    } else if (act === 'labels') {
      const next = LABEL_CYCLE[(LABEL_CYCLE.indexOf(this.opts.labels) + 1) % LABEL_CYCLE.length];
      this.app.updateSetting(this.id, 'labels', next);
    }
  }

  /** dir < 0 zooms in (fewer, wider keys); dir > 0 zooms out. */
  zoom(dir, anchorX) {
    for (const row of this.rows) {
      const steps = [...new Set([...ZOOM_STEPS.filter((n) => n < row.nWhite), row.nWhite])].sort((a, b) => a - b);
      const next = dir < 0
        ? [...steps].reverse().find((n) => n < row.count - 0.01) ?? steps[0]
        : steps.find((n) => n > row.count + 0.01) ?? steps[steps.length - 1];
      row.setZoom(next, anchorX);
    }
    this.saveViews();
    this.app.toast(`${Math.round(this.rows[0].count)} white keys on screen`, 1400);
  }

  wheel(e) {
    const row = this.rows.find((r) => r.contains(e.clientX, e.clientY, 20));
    if (!row) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.wheelZoom = (this.wheelZoom || 0) + e.deltaY;
      if (Math.abs(this.wheelZoom) > 40) { this.zoom(Math.sign(this.wheelZoom), e.clientX); this.wheelZoom = 0; }
    } else {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      row.setStart(row.target + d / row.ww);
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.saveViews(), 300);
    }
  }

  /* ---------- notes ---------- */

  noteOn(row, midi, vel, t) {
    const k = `${row}:${midi}`;
    const n = (this.held.get(k) || 0) + 1;
    this.held.set(k, n);
    if (n > 1) return;
    const old = this.voices.get(k);
    if (old) {
      old.release();
      this.sustained = this.sustained.filter((v) => v !== old);
    }
    const v = this.playSound(row, midi, vel);
    if (v) this.voices.set(k, v); else this.voices.delete(k);
    this.flash.set(k, 1);
    if (this.opts.trails && row === 0) this.trails.push({ midi, t0: t, t1: null, k });
  }

  noteOff(row, midi, t) {
    const k = `${row}:${midi}`;
    const n = (this.held.get(k) || 1) - 1;
    if (n > 0) { this.held.set(k, n); return; }
    this.held.delete(k);
    for (let i = this.trails.length - 1; i >= 0; i--) {
      if (this.trails[i].k === k && this.trails[i].t1 == null) { this.trails[i].t1 = t; break; }
    }
    const v = this.voices.get(k);
    if (!v) return;
    if (this.sustainOn) {
      this.sustained.push(v);
      if (this.sustained.length > 96) this.sustained.shift().release();
    } else {
      v.release();
      this.voices.delete(k);
    }
  }

  playSound(row, midi, vel) {
    const ch = this.channel;
    if (!ch) return null;
    const id = this.soundFor(row);
    const def = KEYBOARD_SOUNDS[id] || KEYBOARD_SOUNDS.grand;
    const pan = clamp((midi - 66) / 40, -0.7, 0.7);
    if (!def.synth) {
      const v = sampleSet(this.engine, id).play(midi, vel, ch.input, pan);
      if (v) return v;
    }
    return keyNote(this.engine, ch, midi, vel, def.synth || def.fallback || 'grand');
  }

  releaseSustained() {
    for (const v of this.sustained) v.release();
    const gone = new Set(this.sustained);
    for (const [k, v] of this.voices) if (gone.has(v) && !this.held.has(k)) this.voices.delete(k);
    this.sustained = [];
  }

  releaseAll() {
    this.voices.forEach((v) => v.release());
    this.voices.clear();
    this.held.clear();
    this.fingerKeys.clear();
    this.keysDown.clear();
    this.sustained = [];
    const now = performance.now() / 1000;
    this.trails.forEach((tr) => { if (tr.t1 == null) tr.t1 = now; });
  }

  /* ---------- input ---------- */

  rowAt(x, y, slack = 0) {
    return this.rows.find((r) => r.contains(x, y, r.rect.h * slack)) || null;
  }

  keydown(e) {
    if (e.code === 'Space') { this.pedal = true; return true; }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      this.rows[0].pan((e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 7 : 1));
      this.saveViews();
      return true;
    }
    if (e.key === '+' || e.key === '=') { this.zoom(-1); return true; }
    if (e.key === '-' || e.key === '_') { this.zoom(1); return true; }
    const hi = KEYMAP[e.code], lo = LOWMAP[e.code];
    if (hi === undefined && lo === undefined) return false;
    if (e.repeat || this.keysDown.has(e.code)) return true;
    const rowIndex = lo !== undefined && this.rows.length > 1 ? 1 : 0;
    const row = this.rows[rowIndex];
    const base = row.firstVisibleC() + (lo !== undefined && this.rows.length === 1 ? -12 : 0);
    const midi = base + (hi !== undefined ? hi : lo);
    if (!row.byMidi.has(midi)) return true;
    this.keysDown.set(e.code, { row: rowIndex, midi });
    this.noteOn(rowIndex, midi, 0.75, performance.now() / 1000);
    return true;
  }

  keyup(e) {
    if (e.code === 'Space') {
      this.pedal = false;
      if (!this.sustainOn) this.releaseSustained();
      return true;
    }
    const k = this.keysDown.get(e.code);
    if (!k) return false;
    this.keysDown.delete(e.code);
    this.noteOff(k.row, k.midi, performance.now() / 1000);
    return true;
  }

  /** Pinch the overview strip with a hand and drag to scroll. */
  handleGrabs(cam, t) {
    if (!this.nav) return;
    const strips = [...this.nav.querySelectorAll('canvas.overview')].map((cv) => cv.getBoundingClientRect());
    const ids = new Set(cam.map((h) => h.id));
    for (const id of this.grabs.keys()) if (!ids.has(id)) this.grabs.delete(id);
    for (const h of cam) {
      if (!h.pinching) {
        this.pinchSince.delete(h.id);
        if (this.grabs.has(h.id)) { this.grabs.delete(h.id); this.saveViews(); }
        continue;
      }
      if (!this.pinchSince.has(h.id)) this.pinchSince.set(h.id, t);
      const p = h.pinchPoint;
      let row = this.grabs.get(h.id);
      if (row === undefined && t - this.pinchSince.get(h.id) > 0.12) {
        const i = strips.findIndex((r) => p.x >= r.left - 20 && p.x <= r.right + 20 && p.y >= r.top - 24 && p.y <= r.bottom + 24);
        if (i >= 0) { row = i; this.grabs.set(h.id, i); }
      }
      if (row !== undefined) {
        const r = strips[row];
        this.rows[row].centerOn(clamp((p.x - r.left) / r.width, 0, 1));
      }
    }
  }

  update(hands, dt, t) {
    this.rows.forEach((r) => r.step(dt));
    this.ensureSamples();
    const cam = hands.filter((h) => !h.virtual);
    const ptr = hands.filter((h) => h.virtual);
    this.camHandsSeen = cam.length > 0;

    this.handleGrabs(cam, t);
    const players = cam.filter((h) => !this.grabs.has(h.id));
    const enabled = FINGER_SETS[this.opts.fingers] || FINGER_SETS.all;
    const dip = this.opts.press === 'dip';
    const res = dip
      ? this.dip.update(players, enabled, t, this.H, (x, y) => { const r = this.rowAt(x, y); return r ? { top: r.rect.y } : null; })
      : this.taps.update(players, enabled, t, 0.16 / Number(this.opts.sensitivity || 1));

    for (const ev of res.events) {
      if (ev.type === 'down') {
        const row = this.rowAt(ev.x, ev.y, dip ? 0 : 0.35);
        const key = row && row.keyAt(ev.x, ev.y);
        if (!key) continue;
        const vel = this.opts.velocity === 'fixed' ? 0.7 : clamp(0.22 + ev.speed * 0.2, 0.18, 1);
        this.fingerKeys.set(ev.id, { row: row.index, midi: key.midi, x: ev.x });
        this.noteOn(row.index, key.midi, vel, t);
      } else {
        const fk = this.fingerKeys.get(ev.id);
        if (fk) { this.noteOff(fk.row, fk.midi, t); this.fingerKeys.delete(ev.id); }
      }
    }

    this.hover.clear();
    this.cursors = [];
    for (const c of res.cursors) {
      const fk = this.fingerKeys.get(c.id);
      if (fk && Math.abs(c.x - fk.x) > this.rows[fk.row].ww * 1.5) {
        // Sliding well off a held key lifts it.
        this.noteOff(fk.row, fk.midi, t);
        this.fingerKeys.delete(c.id);
      }
      const row = this.rowAt(c.x, c.y, dip ? 0.2 : 0.35);
      if (!row) continue;
      const k = row.keyAt(c.x, c.y);
      if (k && !c.down) this.hover.add(`${row.index}:${k.midi}`);
      this.cursors.push(c);
    }

    // Mouse and touch: press a key, slide along the keys while pressed.
    const live = new Set();
    for (const h of ptr) {
      live.add(h.id);
      const p = h.points[8];
      const cur = this.fingerKeys.get(h.id);
      const row = this.rowAt(p.x, p.y);
      const k = row && row.keyAt(p.x, p.y);
      if ((h.pressing || h.tap) && k) {
        if (!cur || cur.midi !== k.midi || cur.row !== row.index) {
          if (cur) this.noteOff(cur.row, cur.midi, t);
          this.fingerKeys.set(h.id, { row: row.index, midi: k.midi, x: p.x, ptr: true });
          this.noteOn(row.index, k.midi, 0.75, t);
        }
      } else {
        if (cur) { this.noteOff(cur.row, cur.midi, t); this.fingerKeys.delete(h.id); }
        if (k) this.hover.add(`${row.index}:${k.midi}`);
      }
    }
    for (const [id, fk] of this.fingerKeys) {
      if (fk.ptr && !live.has(id)) { this.noteOff(fk.row, fk.midi, t); this.fingerKeys.delete(id); }
    }

    for (const [k, f] of this.flash) {
      const nf = f * Math.exp(-dt * 4);
      if (nf < 0.02) this.flash.delete(k); else this.flash.set(k, nf);
    }
    this.now = t;
  }

  /* ---------- drawing ---------- */

  draw(ctx, t) {
    if (!this.rows.length) return;
    const o = this.opts;
    this.drawTrails(ctx, t);
    this.rows.forEach((row, i) => {
      row.draw(ctx, {
        held: (m) => this.held.has(`${i}:${m}`),
        flash: (m) => this.flash.get(`${i}:${m}`) || 0,
        hover: (m) => this.hover.has(`${i}:${m}`),
        labels: o.labels,
        notation: o.notation,
        pressLine: o.press === 'dip',
      });
    });

    // Fingertip rings: they fill up as a finger drops toward a press.
    for (const c of this.cursors) {
      ctx.beginPath();
      ctx.arc(c.tip.x, c.tip.y, 12, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(18, 20, 43, 0.55)';
      ctx.lineWidth = 4;
      ctx.stroke();
      if (c.down) {
        ctx.fillStyle = 'rgba(255, 209, 102, 0.85)';
        ctx.fill();
      } else if (c.progress > 0.02) {
        ctx.beginPath();
        ctx.arc(c.tip.x, c.tip.y, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c.progress);
        ctx.strokeStyle = '#FFD166';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }

    if (this.camHandsSeen && !this.cursors.length && this.app.camera.on) {
      const r = this.rows[0].rect;
      ctx.fillStyle = 'rgba(237, 235, 255, 0.8)';
      ctx.font = `650 ${Math.round(clamp(this.W * 0.018, 15, 22))}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Bring your fingertips over the keys, then tap a finger down', r.x + r.w / 2, r.y - 26);
    }

    this.drawOverviews();
  }

  drawTrails(ctx, t) {
    const row = this.rows[0];
    const base = row.rect.y - 10;
    const top = this.trailTop;
    const speed = 160;
    ctx.save();
    ctx.beginPath();
    ctx.rect(row.rect.x, top, row.rect.w, base - top);
    ctx.clip();
    for (const tr of this.trails) {
      const key = row.byMidi.get(tr.midi);
      if (!key) continue;
      const kr = row.keyRect(key);
      const yTop = base - (t - tr.t0) * speed;
      const yBot = tr.t1 == null ? base : base - (t - tr.t1) * speed;
      if (yBot < top) { tr.dead = true; continue; }
      const alpha = clamp((yBot - top) / 140, 0, 1) * 0.85;
      const w = Math.max(4, kr.w * (key.white ? 0.62 : 0.8));
      ctx.fillStyle = noteColor(tr.midi, alpha, 66);
      const h = Math.max(4, yBot - Math.max(yTop, top - 10));
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(kr.x + (kr.w - w) / 2, yBot - h, w, h, Math.min(6, w / 2)) : ctx.rect(kr.x + (kr.w - w) / 2, yBot - h, w, h);
      ctx.fill();
    }
    ctx.restore();
    if (this.trails.length > 200 || this.trails.some((tr) => tr.dead)) this.trails = this.trails.filter((tr) => !tr.dead).slice(-200);
  }

  drawOverviews() {
    if (!this.nav) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.nav.querySelectorAll('canvas.overview').forEach((cv) => {
      const i = Number(cv.dataset.row);
      const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
      if (!w || !h) return;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const c = cv.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      this.rows[i].drawOverview(c, w, h, (m) => this.held.has(`${i}:${m}`));
      if (this.grabs.size && [...this.grabs.values()].includes(i)) {
        c.strokeStyle = 'rgba(255, 209, 102, 0.9)';
        c.lineWidth = 4;
        c.strokeRect(2, 2, w - 4, h - 4);
      }
    });
    const status = this.nav.querySelector('.nav-status');
    const msgs = [];
    for (let i = 0; i < this.rows.length; i++) {
      const id = this.soundFor(i);
      const def = KEYBOARD_SOUNDS[id];
      if (!def || def.synth || !this.engine.ctx) continue;
      const s = sampleSet(this.engine, id);
      if (s.unavailable) msgs.push(`${def.label} could not download, so the built-in sound is playing`);
      else if (s.loading) msgs.push(`Loading ${def.label.toLowerCase()} ${Math.round(s.progress * 100)}%`);
    }
    const text = [...new Set(msgs)].join('. ');
    if (status.textContent !== text) status.textContent = text;
  }
}
