// The interface around the stage: the band dock (tempo, backing, loop station), song mode
// screens, clip recording and sharing, and the MIDI and "your own sounds" settings.
import { INSTRUMENTS } from '../instruments/index.js';
import { STYLES } from '../band/patterns.js';
import { SONGS, dailySong } from '../game/songs.js';
import { downloadBlob } from '../audio/midi.js';
import { noteName } from '../audio/music.js';

const $ = (id) => document.getElementById(id);
const icon = (id) => {
  const Cls = INSTRUMENTS.find((c) => c.id === id);
  return Cls ? `<svg viewBox="0 0 24 24" aria-hidden="true">${Cls.icon}</svg>` : '';
};
const label = (id) => (INSTRUMENTS.find((c) => c.id === id) || { label: id }).label;

/* ------------------------------------------------------------------ */
/* Band dock                                                           */
/* ------------------------------------------------------------------ */

export function installBandPanel(app) {
  const panel = $('bandPanel');
  const btn = $('bandBtn');
  const { transport: t, looper, backing } = app;

  const sel = $('backingSelect');
  sel.innerHTML = '<option value="off">Off</option>' + Object.entries(STYLES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

  const toggle = (open = panel.hidden) => {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    app.measure();
  };
  btn.addEventListener('click', () => toggle());
  $('bandClose').addEventListener('click', () => toggle(false));

  const needAudio = () => {
    if (!app.audio.ctx) { app.toast('Choose how to play on the start screen first.'); return true; }
    return false;
  };

  $('bandPlay').addEventListener('click', () => {
    if (needAudio()) return;
    if (t.playing) t.stop(); else t.start(0);
  });
  $('bpmDown').addEventListener('click', () => t.setBpm(t.bpm - 4));
  $('bpmUp').addEventListener('click', () => t.setBpm(t.bpm + 4));
  $('tapTempo').addEventListener('click', () => {
    const now = performance.now();
    const taps = (app._taps || []).filter((x) => now - x < 2500);
    taps.push(now);
    app._taps = taps;
    if (taps.length >= 3) {
      const gaps = taps.slice(1).map((x, i) => x - taps[i]);
      t.setBpm(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
    }
  });
  $('metroBtn').addEventListener('click', () => { t.metronome = !t.metronome; render(); });
  sel.addEventListener('change', () => { if (!needAudio()) backing.setStyle(sel.value); render(); });
  $('loopRec').addEventListener('click', () => { if (!needAudio()) looper.record(); });
  $('loopBars').addEventListener('change', (e) => {
    if (!looper.setBars(Number(e.target.value))) { e.target.value = String(looper.bars); app.toast('Clear the loop to change its length.'); }
  });
  $('loopQuant').addEventListener('change', (e) => { looper.quantize = e.target.value; });
  $('loopUndo').addEventListener('click', () => looper.undo());
  $('loopClear').addEventListener('click', () => looper.clear());
  $('loopMidi').addEventListener('click', () => { if (!looper.exportMidi()) app.toast('Record a loop first, then export it as MIDI.'); });

  function render() {
    $('bandPlay').textContent = t.playing ? 'Stop' : 'Play';
    $('bandPlay').setAttribute('aria-pressed', String(t.playing));
    $('bpmValue').textContent = String(t.bpm);
    $('metroBtn').setAttribute('aria-pressed', String(t.metronome));
    sel.value = backing.style;
    $('nowChord').textContent = backing.on && backing.chord ? `Chord: ${backing.chord}` : '';
    const rec = $('loopRec');
    rec.classList.toggle('live', looper.state !== 'idle');
    rec.textContent = looper.state === 'countin' ? 'Get ready…' : looper.state === 'recording' ? 'Recording… (tap to cancel)' : looper.hasLoop ? 'Record another layer' : 'Record a loop';
    $('loopBars').value = String(looper.bars);
    $('loopBars').disabled = looper.hasLoop;
    const list = $('loopLayers');
    list.replaceChildren(...looper.layers.map((l) => {
      const chip = document.createElement('span');
      chip.className = 'layer' + (l.muted ? ' muted' : '');
      chip.innerHTML = `<button type="button" class="layer-main" data-dwell title="${l.muted ? 'Unmute' : 'Mute'} this layer">${icon(l.inst)}<span>${label(l.inst)}</span></button><button type="button" class="layer-x" data-dwell aria-label="Delete this layer">×</button>`;
      chip.querySelector('.layer-main').addEventListener('click', () => looper.toggleMute(l.id));
      chip.querySelector('.layer-x').addEventListener('click', () => looper.remove(l.id));
      return chip;
    }));
    $('loopEmpty').hidden = looper.layers.length > 0;
    btn.classList.toggle('active', t.playing);
  }

  looper.onChange(render);
  backing.onChange(render);
  t.on(render);
  render();

  return {
    toggle,
    tick() {
      if (panel.hidden) return;
      const bar = $('loopProgress');
      if (!t.playing) { bar.style.width = '0%'; return; }
      const L = looper.loopBeats;
      const pos = (((t.beat - looper.origin) % L) + L) % L;
      bar.style.width = `${(pos / L) * 100}%`;
      bar.dataset.state = looper.state;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Song mode                                                           */
/* ------------------------------------------------------------------ */

export function installSongsUi(app) {
  const modal = $('songsModal');
  let tab = 'piano';
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

  function open() {
    if (!app.audio.ctx) { app.toast('Choose how to play on the start screen first.'); return; }
    if (app.instrument && ['piano', 'drums', 'guitar'].includes(app.instrument.id)) tab = app.instrument.id;
    render();
    modal.hidden = false;
  }
  const close = () => { modal.hidden = true; };

  function play(song, daily = null) {
    close();
    $('resultsModal').hidden = true;
    app.game.start(song, { mode: $('songMode').value, speed: Number($('songSpeed').value), guide: $('songGuide').checked, daily });
  }

  function render() {
    const { key, song } = dailySong();
    const best = app.game.scores.daily[key];
    $('dailyCard').innerHTML = `<span class="daily-label">Today’s challenge</span><b>${song.title}</b><span>${label(song.inst)}${best ? `, your best today: ${best.score}` : ''}</span>`;
    $('dailyCard').onclick = () => play(song, key);
    document.querySelectorAll('#songTabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.inst === tab)));
    $('songModeRow').hidden = tab !== 'piano';
    $('songGuideRow').hidden = tab !== 'piano';
    const list = $('songList');
    list.replaceChildren(...SONGS.filter((s) => s.inst === tab).map((s) => {
      const li = document.createElement('li');
      const b = app.game.best(s.id);
      li.innerHTML = `<div class="song-meta"><b>${s.title}</b><span>${s.by}, ${s.bpm} BPM, ${['', 'easy', 'medium', 'harder'][s.level]}</span></div><span class="song-stars" aria-label="${b ? b.stars : 0} of 3 stars">${stars(b ? b.stars : 0)}</span><button class="btn primary small" type="button" data-dwell>Play</button>`;
      li.querySelector('button').addEventListener('click', () => play(s));
      return li;
    }));
  }

  document.querySelectorAll('#songTabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.inst; render(); }));
  $('songsBtn').addEventListener('click', open);
  $('songsClose').addEventListener('click', close);

  // Game bar and results
  const bar = $('gameBar');
  app.onGameChange = () => {
    bar.hidden = !app.game.playing;
    if (app.game.playing) $('gamePause').textContent = app.game.s.paused ? 'Resume' : 'Pause';
  };
  $('gamePause').addEventListener('click', () => app.game.pause());
  $('gameRestart').addEventListener('click', () => app.game.restart());
  $('gameQuit').addEventListener('click', () => app.game.stop());

  let last = null;
  app.showResults = (r) => {
    last = r;
    $('resSong').textContent = `${r.song.title}${r.speed !== 1 ? ` at ${Math.round(r.speed * 100)}% speed` : ''}${r.mode === 'wait' ? ', learning mode' : ''}`;
    $('resTitle').textContent = r.stars === 3 ? 'Brilliant!' : r.stars === 2 ? 'Great playing!' : r.stars === 1 ? 'Nice work!' : 'Keep practising!';
    $('resStars').textContent = stars(r.stars);
    $('resStats').innerHTML = `
      <div><dt>Score</dt><dd>${r.score}${r.newBest && r.score > 0 ? ' <em>New best</em>' : ''}</dd></div>
      <div><dt>Accuracy</dt><dd>${Math.round(r.acc * 100)}%</dd></div>
      <div><dt>Longest run</dt><dd>${r.maxCombo}</dd></div>
      <div><dt>Perfect, good, OK, missed</dt><dd>${r.counts.perfect}, ${r.counts.good}, ${r.counts.ok}, ${r.counts.miss}</dd></div>
      ${r.daily ? `<div><dt>Today’s challenge best</dt><dd>${r.dailyBest}</dd></div>` : ''}`;
    $('resultsModal').hidden = false;
  };
  $('resAgain').addEventListener('click', () => { $('resultsModal').hidden = true; if (last) app.game.start(last.song, { mode: last.mode, speed: last.speed, guide: $('songGuide').checked, daily: last.daily }); });
  $('resSongs').addEventListener('click', () => { $('resultsModal').hidden = true; open(); });
  $('resClose').addEventListener('click', () => { $('resultsModal').hidden = true; });

  return {
    tick() {
      // Keep the song controls just under the score card, and the coach clear of the piano bar.
      const hud = app.game.hud;
      if (!bar.hidden && hud) {
        bar.style.top = `${hud.y + (hud.h - 36) / 2}px`;
        bar.style.left = `${hud.x + hud.w - hud.buttons - 10}px`;
      }
      const coach = $('coach');
      if (!coach.hidden) {
        const nav = document.querySelector('.piano-nav');
        const top = nav ? nav.getBoundingClientRect().bottom + 8 : null;
        coach.style.top = top ? `${top}px` : '';
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Recording and sharing                                               */
/* ------------------------------------------------------------------ */

export function installRecordUi(app) {
  const btn = $('recordBtn');
  const menu = $('recordMenu');
  let mode = null; // 'vertical' | 'landscape' | 'replay'
  let timer = null;
  let result = null;

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  btn.addEventListener('click', () => {
    if (mode) { app.stopRecording(); return; }
    if (!app.audio.ctx) { app.toast('Choose how to play on the start screen first.'); return; }
    if (menu.hidden) {
      const r = btn.getBoundingClientRect();
      menu.style.top = `${r.bottom + 8}px`;
      menu.style.left = `${Math.max(12, Math.min(window.innerWidth - menu.offsetWidth - 12, r.right - 320))}px`;
    }
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) menu.hidden = true;
  });

  menu.querySelectorAll('[data-rec]').forEach((b) => b.addEventListener('click', async () => {
    menu.hidden = true;
    const kind = b.dataset.rec;
    if (kind !== 'replay' && !app.recorder.supported) { app.toast('This browser can’t record video. Try Chrome, Edge or Safari.', 4000); return; }
    await countdown();
    if (kind !== 'replay') app.recorder.start(kind);
    app.replay.startCapture();
    mode = kind;
    btn.classList.add('live');
    const t0 = performance.now();
    timer = setInterval(() => { $('recordLabel').textContent = `Stop ${fmt((performance.now() - t0) / 1000)}`; }, 250);
  }));

  function countdown() {
    const el = $('countdown');
    return new Promise((resolve) => {
      let n = 3;
      el.hidden = false;
      el.textContent = String(n);
      const iv = setInterval(() => {
        n--;
        if (n <= 0) { clearInterval(iv); el.hidden = true; resolve(); }
        else el.textContent = String(n);
      }, 750);
    });
  }

  app.stopRecording = async () => {
    if (!mode) return;
    clearInterval(timer);
    btn.classList.remove('live');
    $('recordLabel').textContent = 'Record';
    const kind = mode;
    mode = null;
    const clip = kind !== 'replay' ? await app.recorder.stop() : null;
    const link = await app.replay.stopCapture();
    result = { clip, link, kind };
    showClip();
  };

  function showClip() {
    const { clip, link } = result;
    const v = $('clipVideo');
    if (v.src) URL.revokeObjectURL(v.src);
    v.hidden = !clip;
    if (clip) { v.src = URL.createObjectURL(clip.blob); v.play().catch(() => {}); }
    $('clipTitle').textContent = clip ? 'Your clip is ready' : 'Your replay link is ready';
    const size = clip ? `${(clip.blob.size / 1048576).toFixed(1)} MB` : '';
    $('clipInfo').textContent = clip
      ? `${Math.round(clip.seconds)} seconds, ${clip.ext.toUpperCase()}, ${size}.${link ? ' The replay link lets anyone watch your hands play it back in their browser.' : ''}`
      : link ? 'Anyone who opens this link watches your performance replayed by ghost hands, then gets to try it.' : 'Nothing was played, so there is nothing to share yet.';
    $('clipDownload').hidden = !clip;
    $('clipShare').hidden = !(clip ? navigator.canShare && navigator.canShare({ files: [new File([clip.blob], `clip.${clip.ext}`, { type: clip.type })] }) : link && navigator.share);
    $('clipLink').hidden = !link;
    if (link && link.length > 8000) $('clipInfo').textContent += ' This performance was long, so the link is long too; some apps may cut it off.';
    $('clipModal').hidden = false;
  }

  const filename = () => `virtual-music-${app.instrument ? app.instrument.id : 'clip'}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;

  $('clipDownload').addEventListener('click', () => {
    const { clip } = result;
    if (clip) downloadBlob(clip.blob, `${filename()}.${clip.ext}`);
  });
  $('clipShare').addEventListener('click', async () => {
    const { clip, link } = result;
    try {
      if (clip) await navigator.share({ files: [new File([clip.blob], `${filename()}.${clip.ext}`, { type: clip.type })], title: 'Virtual Music', text: link ? `Watch my hands play it: ${link}` : 'Played in the air with Virtual Music' });
      else await navigator.share({ url: link, title: 'Virtual Music replay' });
    } catch (err) { /* share sheet closed */ }
  });
  $('clipLink').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(result.link);
      app.toast('Replay link copied');
    } catch (err) {
      prompt('Copy this replay link:', result.link);
    }
  });
  $('clipClose').addEventListener('click', () => { $('clipModal').hidden = true; $('clipVideo').pause(); });
}

/* ------------------------------------------------------------------ */
/* Settings extras: MIDI and your own sounds                           */
/* ------------------------------------------------------------------ */

const PADS = [['kick', 'Kick'], ['snare', 'Snare'], ['hihat', 'Hi-hat'], ['crash', 'Crash'], ['ride', 'Ride'], ['tomHigh', 'High tom'], ['tomMid', 'Mid tom'], ['tomFloor', 'Floor tom'], ['clap', 'Clap']];

export function installExtras(app) {
  const box = $('extraSettings');
  box.innerHTML = `
    <h3>MIDI</h3>
    <p class="note">Send everything you play to a synth, a music app like GarageBand or Ableton, or a hardware instrument. Each instrument uses its own MIDI channel, with drums on channel 10.</p>
    <div class="control"><button class="btn wide-inline" type="button" id="midiConnect">Connect MIDI</button></div>
    <div class="control" id="midiRow" hidden><label for="midiOut">Send to</label><select id="midiOut"></select></div>
    <h3>Your own sounds</h3>
    <p class="note">Replace any drum with your own sound file (or drag a file onto a drum), or record your voice and play it on the piano as “My recorded sound”. Saved in this browser only.</p>
    <div class="pads-list" id="padList"></div>
    <div class="control"><label>Piano: my recorded sound</label>
      <div class="row-btns"><button class="chip" type="button" id="voiceRec">Record 2 seconds</button><button class="chip" type="button" id="voiceFile">Choose a file</button><button class="chip" type="button" id="voiceClear">Remove</button></div>
      <p class="note" id="voiceInfo"></p>
    </div>
    <input type="file" id="soundFile" accept="audio/*" hidden>`;

  // MIDI
  const midi = app.midi;
  const outSel = $('midiOut');
  const fill = () => {
    const outs = midi.outputs();
    outSel.innerHTML = '<option value="">Nowhere (off)</option>' + outs.map((o) => `<option value="${o.id}">${o.name}</option>`).join('');
    outSel.value = midi.output ? midi.output.id : '';
    $('midiRow').hidden = false;
    $('midiConnect').textContent = outs.length ? 'MIDI connected' : 'No MIDI devices found. Connect one and try again';
  };
  $('midiConnect').addEventListener('click', async () => {
    try {
      await midi.connect();
      midi.onchange = fill;
      fill();
    } catch (err) {
      const blocked = err && (err.name === 'SecurityError' || err.name === 'NotAllowedError' || /permission/i.test(err.message));
      app.toast(blocked ? 'MIDI access was blocked. Allow MIDI for this site in your browser’s site settings.' : (err.message || 'MIDI is not available in this browser.'), 4500);
    }
  });
  outSel.addEventListener('change', () => midi.select(outSel.value));

  // Own sounds
  const us = app.userSounds;
  const fileInput = $('soundFile');
  let target = null;
  const pick = (t) => { target = t; fileInput.value = ''; fileInput.click(); };
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f || !target) return;
    if (!app.audio.ctx) { app.toast('Choose how to play on the start screen first.'); return; }
    try {
      if (target === 'voice') await us.setVoiceFromFile(f);
      else await us.setPadFromFile(target, f);
      app.toast('Sound saved');
    } catch (err) {
      app.toast('That file could not be read as audio.', 3500);
    }
  });

  function renderPads() {
    const list = $('padList');
    list.replaceChildren(...PADS.map(([id, name]) => {
      const row = document.createElement('div');
      row.className = 'pad-row';
      const custom = us.names.get(`pad:${id}`);
      row.innerHTML = `<span><b>${name}</b>${custom ? `<small>${custom}</small>` : ''}</span><button class="chip" type="button">Choose file</button>${custom ? '<button class="chip" type="button">Reset</button>' : ''}`;
      const [choose, reset] = row.querySelectorAll('button');
      choose.addEventListener('click', () => pick(id));
      if (reset) reset.addEventListener('click', () => us.resetPad(id));
      return row;
    }));
    $('voiceInfo').textContent = us.voice ? `Using “${us.voice.name}”, pitched around ${noteName(us.voice.root)}. Choose “My recorded sound” as the piano sound.` : 'No sound recorded yet.';
    $('voiceClear').hidden = !us.voice;
  }
  us.onChange(renderPads);
  renderPads();

  $('voiceFile').addEventListener('click', () => pick('voice'));
  $('voiceClear').addEventListener('click', () => us.clearVoice());
  $('voiceRec').addEventListener('click', async () => {
    if (!app.audio.ctx) { app.toast('Choose how to play on the start screen first.'); return; }
    const b = $('voiceRec');
    b.disabled = true;
    try {
      b.textContent = 'Sing or play a note now…';
      await us.recordVoice(2, (lvl) => { b.style.setProperty('--lvl', String(Math.min(1, lvl * 1.5))); });
      app.toast('Recorded. Pick “My recorded sound” in the piano’s sound list.', 4000);
    } catch (err) {
      app.toast('The microphone could not start. Allow it in your browser’s site settings.', 4000);
    }
    b.disabled = false;
    b.textContent = 'Record 2 seconds';
  });

  // Drag a sound file onto a drum
  window.addEventListener('dragover', (e) => { if (app.instrument && app.instrument.id === 'drums') e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    const inst = app.instrument;
    if (!inst || inst.id !== 'drums') return;
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    const pad = inst.padAt({ x: e.clientX, y: e.clientY });
    if (!f || !pad) { app.toast('Drop the file right onto a drum.'); return; }
    if (!app.audio.ctx) { app.toast('Choose how to play on the start screen first.'); return; }
    try {
      await us.setPadFromFile(pad.id, f);
      app.toast(`${pad.label} now plays “${f.name}”`);
    } catch (err) {
      app.toast('That file could not be read as audio.', 3500);
    }
  });
}
