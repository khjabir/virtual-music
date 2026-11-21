// Song mode: notes fall onto the piano keys, rings close in on drum pads, strum markers slide
// to the guitar's strum line. Play in time for points; the piano also has a "wait for me" mode
// that pauses on each note until you play it.
import { SONGS, dailySong } from './songs.js';
import { noteColor, noteName, clamp } from '../audio/music.js';
import { FONT, roundRect } from '../instruments/common.js';

const WIN = { perfect: 0.08, good: 0.16, ok: 0.25 };
const POINTS = { perfect: 300, good: 150, ok: 60 };
const LABEL = { perfect: 'Perfect', good: 'Good', ok: 'OK', miss: 'Miss' };
const KEY = 'virtual-music:scores:v1';

export class Game {
  constructor(app) {
    this.app = app;
    this.s = null;
    this.popups = [];
    try { this.scores = JSON.parse(localStorage.getItem(KEY)) || { songs: {}, daily: {} }; } catch (e) { this.scores = { songs: {}, daily: {} }; }
    app.bus.on((e) => this.input(e));
  }

  get playing() { return !!this.s; }
  best(id) { return this.scores.songs[id] || null; }

  start(song, { mode = 'play', speed = 1, guide = true, daily = null } = {}) {
    const app = this.app;
    this.stop();
    app.setInstrument(song.inst);
    const inst = app.instrument;
    if (song.inst === 'guitar') inst.setSongChords(song.chords);
    if (song.inst === 'piano') this.#fitPiano(inst, song);
    inst.gameMode = true;
    const spb = 60 / (song.bpm * speed);
    const notes = song.notes.map((n, i) => ({ ...n, i, judged: null, t: n.beat * spb }));
    const last = notes[notes.length - 1];
    this.s = {
      song, mode: song.inst === 'piano' ? mode : 'play', speed, guide, spb, notes, daily,
      time: -4 * spb, score: 0, combo: 0, maxCombo: 0,
      counts: { perfect: 0, good: 0, ok: 0, miss: 0 },
      waiting: null, paused: false, guideIdx: 0, strum: null,
      end: last.t + last.dur * spb + 1.2,
    };
    this.popups = [];
    if (app.onGameChange) app.onGameChange();
  }

  #fitPiano(inst, song) {
    const row = inst.rows[0];
    const midis = song.notes.map((n) => n.midi);
    const wiOf = (m) => {
      const k = row.byMidi.get(m);
      return k ? k.wi : m < row.lo ? 0 : row.nWhite - 1;
    };
    const lo = wiOf(Math.min(...midis)), hi = wiOf(Math.max(...midis));
    const count = clamp(hi - lo + 4, 10, row.nWhite);
    row.count = count;
    row.setStart((lo + hi + 1) / 2 - count / 2, true);
  }

  pause(on = !this.s?.paused) { if (this.s) this.s.paused = on; if (this.app.onGameChange) this.app.onGameChange(); }
  restart() { if (this.s) { const { song, mode, speed, guide, daily } = this.s; this.start(song, { mode, speed, guide, daily }); } }

  stop() {
    if (!this.s) return;
    const inst = this.app.instances.get(this.s.song.inst);
    if (inst) {
      inst.gameMode = false;
      if (inst.setSongChords) inst.setSongChords(null);
      inst.stopPlayback();
    }
    this.s = null;
    if (this.app.onGameChange) this.app.onGameChange();
  }

  input(e) {
    const s = this.s;
    if (!s || s.paused || e.playback || e.inst !== s.song.inst) return;
    const at = s.time + (e.delay || 0);
    if (s.song.inst === 'piano' && e.type === 'on') this.#match((n) => n.midi === e.midi, at);
    else if (s.song.inst === 'drums' && e.type === 'hit') this.#match((n) => n.pad === e.pad, at);
    else if (s.song.inst === 'guitar' && e.type === 'hit') {
      if (!s.strum || at - s.strum.t > 0.12) {
        this.#resolveStrum();
        s.strum = { t: at, strings: [e.string], chord: e.chord };
      } else {
        s.strum.strings.push(e.string);
      }
    }
  }

  #resolveStrum() {
    const s = this.s;
    const st = s.strum;
    s.strum = null;
    if (!st || st.strings.length < 2) return;
    const dir = st.strings[0] <= st.strings[st.strings.length - 1] ? 'D' : 'U';
    const near = s.notes.filter((n) => !n.judged && Math.abs(n.t - st.t) <= WIN.ok).sort((a, b) => Math.abs(a.t - st.t) - Math.abs(b.t - st.t))[0];
    if (!near) return;
    if (near.chord !== st.chord) { this.#judge(near, 'miss', 'Wrong chord'); return; }
    let kind = this.#grade(Math.abs(near.t - st.t));
    if (dir !== near.dir && kind === 'perfect') kind = 'good';
    this.#judge(near, kind);
  }

  #grade(dt) { return dt <= WIN.perfect ? 'perfect' : dt <= WIN.good ? 'good' : 'ok'; }

  #match(pred, at) {
    const s = this.s;
    if (s.mode === 'wait') {
      const target = (s.waiting || []).find((n) => !n.judged && pred(n))
        || s.notes.find((n) => !n.judged && pred(n) && n.t - s.time < 0.3 && n.t - s.time >= -0.05);
      if (target) this.#judge(target, 'perfect');
      return;
    }
    const cand = s.notes.filter((n) => !n.judged && pred(n) && Math.abs(n.t - at) <= WIN.ok)
      .sort((a, b) => Math.abs(a.t - at) - Math.abs(b.t - at))[0];
    if (cand) this.#judge(cand, this.#grade(Math.abs(cand.t - at)));
  }

  #judge(n, kind, label) {
    const s = this.s;
    n.judged = kind;
    s.counts[kind]++;
    if (kind === 'miss') s.combo = 0;
    else {
      s.combo++;
      s.maxCombo = Math.max(s.maxCombo, s.combo);
      s.score += POINTS[kind] * (1 + Math.min(3, Math.floor(s.combo / 10)));
    }
    const p = this.#pos(n);
    this.popups.push({ x: p.x, y: p.y - 20, text: label || LABEL[kind], kind, age: 0 });
  }

  #pos(n) {
    const inst = this.app.instrument;
    if (this.s.song.inst === 'piano') {
      const row = inst.rows[0], k = row.byMidi.get(n.midi);
      return k ? { x: row.centerX(k), y: row.rect.y } : { x: this.app.W / 2, y: row.rect.y };
    }
    if (this.s.song.inst === 'drums') {
      const pad = inst.pads.find((p) => p.id === n.pad);
      return pad ? { x: pad.cx, y: pad.cy - pad.ry } : { x: this.app.W / 2, y: this.app.H / 2 };
    }
    return { x: this.#guitarTarget().x, y: inst.top - 20 };
  }

  #guitarTarget() {
    const g = this.app.instrument;
    return { x: (g.strum[0] + g.strum[1]) / 2, top: g.top, bottom: g.bottom };
  }

  update(dt) {
    const s = this.s;
    this.popups.forEach((p) => { p.age += dt; p.y -= dt * 40; });
    this.popups = this.popups.filter((p) => p.age < 0.9);
    if (!s || s.paused) return;
    if (s.mode === 'wait' && s.time >= 0) {
      const next = s.notes.find((n) => !n.judged);
      if (next && s.time >= next.t) {
        s.waiting = s.notes.filter((n) => !n.judged && Math.abs(n.t - next.t) < 0.02);
        s.time = next.t;
      } else {
        s.waiting = null;
        s.time += dt;
      }
    } else {
      s.time += dt;
    }
    // A quiet guide melody helps you learn the tune (piano, play-along mode).
    if (s.guide && s.mode === 'play' && s.song.inst === 'piano') {
      const inst = this.app.instrument;
      while (s.guideIdx < s.notes.length && s.notes[s.guideIdx].t <= s.time) {
        const n = s.notes[s.guideIdx++];
        inst.playEvent({ type: 'on', row: 0, midi: n.midi, vel: 0.22 }, 0);
        setTimeout(() => inst.playEvent({ type: 'off', row: 0, midi: n.midi }, 0), n.dur * s.spb * 900);
      }
    }
    if (s.strum && s.time - s.strum.t > 0.12) this.#resolveStrum();
    if (s.mode === 'play') for (const n of s.notes) if (!n.judged && s.time - n.t > WIN.ok) this.#judge(n, 'miss');
    if (s.time > s.end || (s.mode === 'wait' && s.notes.every((n) => n.judged))) this.#finish();
  }

  #finish() {
    const s = this.s;
    const total = s.notes.length;
    const acc = (s.counts.perfect + s.counts.good * 0.7 + s.counts.ok * 0.4) / total;
    const stars = acc >= 0.9 ? 3 : acc >= 0.75 ? 2 : acc >= 0.5 ? 1 : 0;
    const prev = this.scores.songs[s.song.id];
    const newBest = !prev || s.score > prev.score;
    if (newBest) this.scores.songs[s.song.id] = { score: s.score, stars: Math.max(stars, prev ? prev.stars : 0), acc };
    else if (prev && stars > prev.stars) prev.stars = stars;
    let dailyBest = null;
    if (s.daily) {
      const d = this.scores.daily[s.daily] || { score: 0 };
      if (s.score > d.score) this.scores.daily[s.daily] = { song: s.song.id, score: s.score };
      dailyBest = this.scores.daily[s.daily].score;
    }
    try { localStorage.setItem(KEY, JSON.stringify(this.scores)); } catch (e) { /* storage full or blocked */ }
    const result = { song: s.song, score: s.score, acc, stars, counts: { ...s.counts }, maxCombo: s.maxCombo, newBest, daily: s.daily, dailyBest, mode: s.mode, speed: s.speed };
    this.stop();
    if (this.app.showResults) this.app.showResults(result);
  }

  /* ---------- drawing ---------- */

  draw(ctx) {
    const s = this.s;
    if (s) {
      const inst = this.app.instrument;
      if (inst && inst.id === s.song.inst) {
        if (s.song.inst === 'piano') this.#drawPiano(ctx, inst);
        else if (s.song.inst === 'drums') this.#drawDrums(ctx, inst);
        else this.#drawGuitar(ctx, inst);
      }
      this.#drawHud(ctx);
    }
    for (const p of this.popups) {
      const a = 1 - p.age / 0.9;
      ctx.font = `800 ${p.kind === 'perfect' ? 24 : 20}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = p.kind === 'perfect' ? `rgba(255, 209, 102, ${a})` : p.kind === 'miss' ? `rgba(237, 235, 255, ${a * 0.6})` : `rgba(94, 230, 200, ${a})`;
      ctx.fillText(p.text, p.x, p.y);
    }
  }

  #drawPiano(ctx, inst) {
    const s = this.s;
    const row = inst.rows[0];
    const base = row.rect.y - 8;
    const top = inst.trailTop || 140;
    const ppb = (base - top) / 4; // pixels per beat
    ctx.save();
    ctx.beginPath();
    ctx.rect(row.rect.x, top, row.rect.w, base - top + 2);
    ctx.clip();
    for (const n of s.notes) {
      const dtBeats = (n.t - s.time) / s.spb;
      if (dtBeats > 4.5 || dtBeats + n.dur < -0.5) continue;
      const k = row.byMidi.get(n.midi);
      if (!k) continue;
      const kr = row.keyRect(k);
      const yb = base - dtBeats * ppb;
      const h = Math.max(10, n.dur * ppb - 4);
      const w = Math.max(8, kr.w * (k.white ? 0.7 : 0.85));
      const done = n.judged && n.judged !== 'miss';
      ctx.fillStyle = n.judged === 'miss' ? 'rgba(237, 235, 255, 0.18)' : noteColor(n.midi, done ? 0.35 : 0.92, done ? 80 : 64);
      roundRect(ctx, kr.x + (kr.w - w) / 2, yb - h, w, h, Math.min(8, w / 2));
      ctx.fill();
      if (!n.judged && h > 22 && w > 20) {
        ctx.fillStyle = 'rgba(18, 20, 43, 0.85)';
        ctx.font = `700 ${Math.round(clamp(w * 0.32, 10, 14))}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(noteName(n.midi).replace(/\d+$/, ''), kr.x + kr.w / 2, yb - 4);
      }
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(255, 209, 102, 0.9)';
    ctx.fillRect(row.rect.x, base - 2, row.rect.w, 3);
    if (s.waiting) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);
      for (const n of s.waiting) {
        const k = row.byMidi.get(n.midi);
        if (!k) continue;
        const kr = row.keyRect(k);
        ctx.strokeStyle = `rgba(255, 209, 102, ${0.5 + 0.5 * pulse})`;
        ctx.lineWidth = 4;
        roundRect(ctx, kr.x + 2, kr.y + 2, kr.w - 4, kr.h - 4, 8);
        ctx.stroke();
      }
    }
  }

  #drawDrums(ctx, inst) {
    const s = this.s;
    const look = 1.5; // beats of warning
    for (const n of s.notes) {
      const dtB = (n.t - s.time) / s.spb;
      if (n.judged || dtB > look || dtB < -0.3) continue;
      const pad = inst.pads.find((p) => p.id === n.pad);
      if (!pad) continue;
      const k = 1 + Math.max(0, dtB) / look * 1.3;
      const a = clamp(1 - dtB / look, 0.15, 1);
      ctx.beginPath();
      ctx.ellipse(pad.cx, pad.cy, pad.rx * k, pad.ry * k, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${pad.hue}, 95%, 70%, ${a})`;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }

  #drawGuitar(ctx, inst) {
    const s = this.s;
    const tg = this.#guitarTarget();
    const ppb = (inst.strum[1] - inst.strum[0]) / 4;
    const midY = (tg.top + tg.bottom) / 2;
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(tg.x, tg.top - 24);
    ctx.lineTo(tg.x, tg.bottom + 24);
    ctx.stroke();
    let nextChord = null;
    for (const n of s.notes) {
      const dtB = (n.t - s.time) / s.spb;
      if (!n.judged && dtB >= -0.3 && !nextChord) nextChord = n.chord;
      if (dtB > 4 || dtB < -0.5) continue;
      const x = tg.x + dtB * ppb;
      const a = n.judged ? 0.25 : 1;
      ctx.fillStyle = n.judged === 'miss' ? `rgba(237, 235, 255, 0.25)` : `rgba(255, 209, 102, ${a})`;
      ctx.font = `800 34px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.dir === 'U' ? '↑' : '↓', x, midY);
      ctx.font = `700 15px ${FONT}`;
      ctx.fillText(n.chord, x, tg.top - 36);
    }
    if (nextChord) {
      const i = inst.chords.indexOf(nextChord);
      const c = inst.cells && inst.cells[i];
      if (c && i !== inst.chordIndex) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 140);
        ctx.strokeStyle = `rgba(94, 230, 200, ${0.5 + 0.5 * pulse})`;
        ctx.lineWidth = 3;
        roundRect(ctx, c.x0 + 4, inst.top - 22, c.x1 - c.x0 - 8, inst.bottom - inst.top + 44, 14);
        ctx.stroke();
      }
    }
  }

  /** Score strip: under the top bar, or under the keyboard on the piano so the falling notes stay clear.
   *  The right end is left free for the Pause, Restart and Quit buttons laid over it. */
  #drawHud(ctx) {
    const s = this.s;
    const inst = this.app.instrument;
    const { W, H } = this.app;
    const w = Math.min(760, W - 24), h = 58;
    const x = (W - w) / 2;
    let y = (this.app.topInset || 64) + 12;
    if (inst && inst.id === 'piano' && inst.rows) {
      const r = inst.rows[inst.rows.length - 1].rect;
      if (r) y = r.y + r.h + 14;
    }
    this.hud = { x, y, w, h, buttons: 230 };
    ctx.fillStyle = 'rgba(18, 20, 43, 0.8)';
    roundRect(ctx, x, y, w, h, 16);
    ctx.fill();
    const judged = s.notes.filter((n) => n.judged).length;
    const acc = judged ? (s.counts.perfect + s.counts.good * 0.7 + s.counts.ok * 0.4) / judged : 1;
    const right = x + w - 230 - 6; // where the buttons begin
    const narrow = w < 600;
    // Title and progress
    const titleW = narrow ? 0 : Math.max(0, right - x - 250);
    if (titleW > 60) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(237, 235, 255, 0.8)';
      ctx.font = `620 13px ${FONT}`;
      let title = s.song.title;
      while (title.length > 4 && ctx.measureText(title).width > titleW) title = title.slice(0, -2);
      if (title !== s.song.title) title = title.trimEnd() + '…';
      ctx.fillText(title, x + 16, y + 24);
      const progress = clamp(s.time / s.end, 0, 1);
      ctx.fillStyle = 'rgba(237, 235, 255, 0.15)';
      ctx.fillRect(x + 16, y + 36, titleW, 4);
      ctx.fillStyle = '#FFD166';
      ctx.fillRect(x + 16, y + 36, titleW * progress, 4);
    }
    // Score, run and accuracy
    const sx = narrow ? x + 14 : right - 230;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#EDEBFF';
    ctx.font = `800 26px ${FONT}`;
    ctx.fillText(String(s.score), sx, y + h / 2 + 1);
    ctx.textAlign = 'right';
    ctx.font = `650 13px ${FONT}`;
    ctx.fillStyle = s.combo >= 10 ? '#FFD166' : 'rgba(237, 235, 255, 0.85)';
    const cx = narrow ? right : right - 8;
    if (!narrow || w > 470) {
      ctx.fillText(`${s.combo} in a row${s.combo >= 10 ? `  ×${1 + Math.min(3, Math.floor(s.combo / 10))}` : ''}`, cx, y + 21);
      ctx.fillStyle = 'rgba(237, 235, 255, 0.75)';
      ctx.fillText(`${Math.round(acc * 100)}% accuracy`, cx, y + 39);
    }

    if (s.time < 0) {
      const n = Math.ceil(-s.time / s.spb);
      ctx.fillStyle = 'rgba(255, 209, 102, 0.95)';
      ctx.font = `900 ${Math.round(H * 0.16)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n > 3 ? 'Get ready' : String(n), W / 2, H * 0.42);
    }
    if (s.paused) {
      ctx.fillStyle = 'rgba(18, 20, 43, 0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#EDEBFF';
      ctx.font = `800 48px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Paused', W / 2, H * 0.45);
    }
    if (s.waiting && s.waiting.length && s.song.inst === 'piano') {
      ctx.fillStyle = '#FFD166';
      ctx.font = `800 22px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(`Play ${s.waiting.map((n) => noteName(n.midi)).join(' + ')}`, x + 12, y + h + 30);
    }
  }
}

export { SONGS, dailySong };
