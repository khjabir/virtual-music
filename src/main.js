// Virtual Music: wires camera, hand tracking, instruments, audio and the interface together.
import { AudioEngine } from './audio/engine.js';
import { HandTracker } from './tracking/handTracker.js';
import { HandSet, PointerHands } from './tracking/hands.js';
import { INSTRUMENTS } from './instruments/index.js';
import { Settings, GLOBAL_SCHEMA, renderControls } from './ui/settings.js';
import { Dwell } from './ui/dwell.js';
import { drawHands } from './ui/overlay.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('stage');
const ctx = canvas.getContext('2d');

// Over a bright camera picture, light canvas text gets a thin dark outline so it stays readable.
// Dark text (used on piano keys) is left alone.
let textHalo = false;
const plainFillText = ctx.fillText.bind(ctx);
ctx.fillText = (text, x, y, maxWidth) => {
  const style = typeof ctx.fillStyle === 'string' ? ctx.fillStyle : '';
  const alpha = /^(rgba|hsla)\(/.test(style) ? parseFloat(style.split(',').pop()) : 1;
  if (textHalo && alpha >= 0.5 && !/^rgba?\((18|24|30),/.test(style.replace(/\s/g, ''))) {
    ctx.save();
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(18, 20, 43, 0.7)';
    ctx.strokeText(text, x, y, maxWidth);
    ctx.restore();
  }
  return maxWidth === undefined ? plainFillText(text, x, y) : plainFillText(text, x, y, maxWidth);
};
const UI_SELECTOR = '.topbar, .drawer, .start-card, .actions, .toast, .instrument-ui';

const app = {
  audio: new AudioEngine(),
  settings: new Settings(),
  tracker: new HandTracker(),
  camHands: new HandSet('cam'),
  pointerHands: new PointerHands((el) => !!(el && el.closest && el.closest(UI_SELECTOR))),
  dwell: new Dwell(1000),
  W: window.innerWidth,
  H: window.innerHeight,
  instrument: null,
  instances: new Map(),
  camera: { on: false, stream: null },
  started: false,
  lastVideoTime: -1,
  fps: 0,
  updateSetting,
  toast,
  setInstrument,
};
window.virtualMusic = app; // for poking around in the browser console

/* ---------- camera view ---------- */

// How much the camera image is shaded so the instruments stay readable.
const CAMERA_VIEWS = {
  clear: { label: 'Clear', shade: 0, vignette: 0 },
  soft: { label: 'Soft', shade: 0.16, vignette: 0.45 },
  dim: { label: 'Dimmed', shade: 0.5, vignette: 1 },
  off: { label: 'Hidden', shade: 1, vignette: 1 },
};
const VIEW_ORDER = ['clear', 'soft', 'dim', 'off'];
const QUALITY = { 720: [1280, 720], 1080: [1920, 1080], max: [3840, 2160] };

function cameraConstraints() {
  const [width, height] = QUALITY[app.settings.global.cameraQuality] || QUALITY[1080];
  return { video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 }, facingMode: 'user' }, audio: false };
}

// Hand tracking does not need more than 720p, so larger frames are scaled down for it.
const detectCanvas = document.createElement('canvas');
const detectCtx = detectCanvas.getContext('2d');
function detectionSource() {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (vw <= 1280) return video;
  const w = 1280, h = Math.round((vh * 1280) / vw);
  if (detectCanvas.width !== w || detectCanvas.height !== h) { detectCanvas.width = w; detectCanvas.height = h; }
  detectCtx.drawImage(video, 0, 0, w, h);
  return detectCanvas;
}

function applyCameraView() {
  const view = app.settings.global.cameraView;
  document.body.classList.toggle('camera-on', app.camera.on && view !== 'off');
  const btn = $('viewBtn');
  btn.hidden = !app.camera.on;
  btn.title = `Camera view: ${(CAMERA_VIEWS[view] || CAMERA_VIEWS.soft).label}. Click to change.`;
}

function updateCameraInfo() {
  const el = $('cameraInfo');
  const track = app.camera.stream && app.camera.stream.getVideoTracks()[0];
  if (!app.camera.on || !track) { el.textContent = ''; return; }
  const s = track.getSettings();
  const w = s.width || video.videoWidth, h = s.height || video.videoHeight;
  const fps = s.frameRate ? ` at ${Math.round(s.frameRate)} fps` : '';
  el.textContent = `Your camera is sending ${w} × ${h}${fps}. Hand tracking runs at ${Math.round(app.fps)} fps.`;
}

/** Switch resolution without reloading hand tracking. */
async function restartCamera() {
  if (!app.camera.on) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(cameraConstraints());
  } catch (err) {
    toast(`That camera quality is not available here (${err.name}). Keeping the current one.`, 4000);
    return;
  }
  const old = app.camera.stream;
  video.srcObject = stream;
  try { await video.play(); } catch (e) { /* muted video may autoplay */ }
  if (old) old.getTracks().forEach((tr) => tr.stop());
  app.camera.stream = stream;
  app.lastVideoTime = -1;
  const s = stream.getVideoTracks()[0].getSettings();
  toast(`Camera now ${s.width || video.videoWidth} × ${s.height || video.videoHeight}`);
  updateCameraInfo();
}

/* ---------- layout ---------- */

/** Height taken by the instruction text at the bottom, so instruments stay clear of it. */
function measureInsets() {
  const bar = document.querySelector('.bottombar');
  app.bottomInset = bar ? bar.getBoundingClientRect().height : 0;
}

let vignette = null;
function resize() {
  measureInsets();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  app.W = window.innerWidth;
  app.H = window.innerHeight;
  canvas.width = Math.round(app.W * dpr);
  canvas.height = Math.round(app.H * dpr);
  canvas.style.width = `${app.W}px`;
  canvas.style.height = `${app.H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  vignette = ctx.createRadialGradient(app.W / 2, app.H * 0.55, Math.min(app.W, app.H) * 0.2, app.W / 2, app.H / 2, Math.max(app.W, app.H) * 0.75);
  vignette.addColorStop(0, 'rgba(27, 26, 63, 0.15)');
  vignette.addColorStop(1, 'rgba(18, 20, 43, 0.75)');
  if (app.instrument) app.instrument.resize(app.W, app.H);
}

/* ---------- instruments ---------- */

function buildTabs() {
  const nav = $('instrumentTabs');
  INSTRUMENTS.forEach((Cls, i) => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.type = 'button';
    b.dataset.dwell = '';
    b.dataset.id = Cls.id;
    b.title = `${Cls.label} (key ${i + 1})`;
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${Cls.icon}</svg><span>${Cls.label}</span>`;
    b.addEventListener('click', () => setInstrument(Cls.id));
    nav.append(b);
  });
}

function setInstrument(id) {
  const Cls = INSTRUMENTS.find((c) => c.id === id) || INSTRUMENTS[0];
  if (app.instrument && app.instrument.id === Cls.id) return;
  if (app.instrument) app.instrument.deactivate();
  let inst = app.instances.get(Cls.id);
  if (!inst) {
    inst = new Cls(app);
    app.instances.set(Cls.id, inst);
  }
  app.instrument = inst;
  $('hint').textContent = Cls.hint;
  measureInsets();
  inst.resize(app.W, app.H);
  inst.activate();
  app.settings.lastInstrument = Cls.id;
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === Cls.id)));
  if (app.started && window.matchMedia('(max-width: 640px)').matches) toast(Cls.hint, 5000);
  document.title = `${Cls.label}: Virtual Music`;
  renderInstrumentSettings();
  renderActions();
}

function renderActions() {
  const box = $('instrumentActions');
  box.replaceChildren();
  const actions = app.instrument.constructor.actions;
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ghost';
    b.dataset.dwell = '';
    b.textContent = a.label;
    if (a.key) b.title = `${a.label} (${a.key === ' ' ? 'Space' : a.key})`;
    b.addEventListener('click', () => app.instrument.action(a.id));
    box.append(b);
  }
  box.hidden = !actions.length;
}

/* ---------- settings ---------- */

function renderGlobalSettings() {
  renderControls($('globalSettings'), GLOBAL_SCHEMA, app.settings.global, (k, v) => updateSetting('global', k, v, true));
}

function renderInstrumentSettings() {
  const Cls = app.instrument.constructor;
  $('instSettingsTitle').textContent = Cls.label;
  $('instSettingsTitle').hidden = !Cls.settings.length;
  renderControls($('instrumentSettings'), Cls.settings, app.settings.instrument(Cls.id, Cls.settings), (k, v) => updateSetting(Cls.id, k, v, true));
}

function updateSetting(scope, key, value, fromUi = false) {
  app.settings.set(scope, key, value);
  if (scope === 'global') {
    if (key === 'volume') app.audio.setVolume(value);
    else if (key === 'reverb') app.audio.setReverb(value);
    else if (key === 'cameraView') applyCameraView();
    else if (key === 'cameraQuality') restartCamera();
    else if (key !== 'skeleton' && app.instrument) app.instrument.settingsChanged();
    if (!fromUi) renderGlobalSettings();
  } else if (app.instrument && scope === app.instrument.id) {
    app.instrument.settingsChanged();
    if (!fromUi) renderInstrumentSettings();
  }
}

function toggleDrawer(open) {
  const drawer = $('drawer');
  const next = open === undefined ? drawer.hidden : open;
  drawer.hidden = !next;
  $('settingsBtn').setAttribute('aria-expanded', String(next));
  if (next) drawer.querySelector('select, input, button')?.focus({ preventScroll: true });
}

let toastTimer = null;
function toast(msg, ms = 2400) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------- audio, camera, start ---------- */

async function unlockAudio() {
  await app.audio.start();
  const g = app.settings.global;
  app.audio.setVolume(g.volume);
  app.audio.setReverb(g.reverb);
  app.instances.forEach((inst) => inst.audioReady());
}

function cameraErrorText(err) {
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access is blocked. Allow the camera for this page in your browser’s site settings, then choose Turn on camera again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found. Connect a webcam, or play with the mouse.';
    case 'NotReadableError':
      return 'The camera is busy in another app. Close it there, then try again.';
    default:
      return `The camera could not start (${(err && err.message) || 'unknown error'}).`;
  }
}

async function startCamera(report) {
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    report('The camera only works on a secure page. Open the app at http://localhost (see the README) or over https.', true);
    return false;
  }
  const trackerReady = app.tracker.init();
  trackerReady.catch(() => {});
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(cameraConstraints());
  } catch (err) {
    report(cameraErrorText(err), true);
    return false;
  }
  video.srcObject = stream;
  try { await video.play(); } catch (e) { /* autoplay is allowed for muted video */ }
  report('Loading hand tracking. The first time takes a few seconds.');
  try {
    await trackerReady;
  } catch (err) {
    console.error(err);
    stream.getTracks().forEach((tr) => tr.stop());
    video.srcObject = null;
    app.tracker.loading = null;
    report('Hand tracking could not load. It downloads about 20 MB the first time, so check your internet connection and try again, or play with the mouse.', true);
    return false;
  }
  app.camera = { on: true, stream };
  updateCameraButton();
  applyCameraView();
  updateCameraInfo();
  return true;
}

function stopCamera() {
  if (app.camera.stream) app.camera.stream.getTracks().forEach((tr) => tr.stop());
  video.srcObject = null;
  app.camera = { on: false, stream: null };
  app.camHands.clear();
  updateCameraButton();
  applyCameraView();
  updateCameraInfo();
}

function updateCameraButton() {
  $('cameraToggle').textContent = app.camera.on ? 'Turn camera off' : 'Turn camera on';
}

function startMessage(text, isError = false) {
  const el = $('startMsg');
  el.textContent = text;
  el.classList.toggle('error', isError);
  document.querySelectorAll('.start-actions button').forEach((b) => { b.disabled = !isError && text !== ''; });
}

function hideStart() {
  app.started = true;
  if (window.matchMedia('(max-width: 640px)').matches) setTimeout(() => toast(app.instrument.constructor.hint, 5000), 3800);
  $('start').classList.add('gone');
  setTimeout(() => { $('start').hidden = true; }, 450);
  updateStatus();
}

$('startCamera').addEventListener('click', async () => {
  startMessage('Starting the camera…');
  try { await unlockAudio(); } catch (e) { console.error(e); }
  const ok = await startCamera((msg, err) => startMessage(msg, err));
  if (ok) hideStart();
  else document.querySelectorAll('.start-actions button').forEach((b) => { b.disabled = false; });
});

$('startMouse').addEventListener('click', async () => {
  try { await unlockAudio(); } catch (e) { console.error(e); }
  hideStart();
  toast('Playing with mouse or touch. You can turn on the camera in Settings.', 3600);
});

$('cameraToggle').addEventListener('click', async () => {
  if (app.camera.on) { stopCamera(); toast('Camera off'); return; }
  $('cameraToggle').disabled = true;
  const ok = await startCamera((msg) => toast(msg, 5000));
  $('cameraToggle').disabled = false;
  if (ok) toast('Camera on. Show your hands.');
});

$('settingsBtn').addEventListener('click', () => toggleDrawer());
$('viewBtn').addEventListener('click', () => {
  const cur = app.settings.global.cameraView;
  const next = VIEW_ORDER[(VIEW_ORDER.indexOf(cur) + 1) % VIEW_ORDER.length];
  updateSetting('global', 'cameraView', next);
  toast(`Camera view: ${CAMERA_VIEWS[next].label}`, 1500);
});
$('drawerClose').addEventListener('click', () => toggleDrawer(false));

window.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const n = Number(e.key);
  if (e.key !== ' ' && n >= 1 && n <= INSTRUMENTS.length) { setInstrument(INSTRUMENTS[n - 1].id); return; }
  if (e.key === ',') { toggleDrawer(); return; }
  if (e.key === 'Escape') { toggleDrawer(false); return; }
  if (app.instrument && app.instrument.keydown && app.instrument.keydown(e)) { e.preventDefault(); return; }
  const action = app.instrument && app.instrument.constructor.actions.find((a) => a.key === e.key);
  if (action) { e.preventDefault(); app.instrument.action(action.id); }
});

window.addEventListener('keyup', (e) => {
  if (app.instrument && app.instrument.keyup && app.instrument.keyup(e)) e.preventDefault();
});

/* ---------- main loop ---------- */

function coverMap() {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const s = Math.max(app.W / vw, app.H / vh);
  const dw = vw * s, dh = vh * s;
  return { dw, dh, ox: (app.W - dw) / 2, oy: (app.H - dh) / 2 };
}

/** MediaPipe occasionally reports the same hand twice; drop detections that mostly overlap another. */
function dedupe(dets) {
  const boxes = dets.map((d) => {
    const xs = d.points.map((p) => p.x), ys = d.points.map((p) => p.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
  const area = (b) => Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
  return dets.filter((d, i) => !boxes.some((b, j) => {
    if (j >= i) return false;
    const a = boxes[i];
    const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
    const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    return (ix * iy) / Math.min(area(a), area(b)) > 0.5;
  }));
}

function updateStatus() {
  const el = $('status');
  const n = app.camHands.present.length;
  let text, state;
  if (app.camera.on) {
    text = n ? `Tracking ${n} hand${n > 1 ? 's' : ''}` : 'Show your hands to the camera';
    state = n ? 'ok' : 'wait';
    el.title = `Hand tracking at ${Math.round(app.fps)} frames per second (${app.tracker.delegate})`;
  } else {
    text = app.started ? 'Mouse and touch' : 'Ready';
    state = 'idle';
    el.title = '';
  }
  $('statusText').textContent = text;
  el.dataset.state = state;
}

let lastT = performance.now() / 1000;
let fpsCount = 0, fpsT0 = lastT, lastStatus = 0, errorLogged = false;

function frame(nowMs) {
  const t = nowMs / 1000;
  const dt = Math.min(0.05, Math.max(0, t - lastT));
  lastT = t;

  let fresh = false;
  if (app.camera.on && app.tracker.landmarker && video.readyState >= 2 && video.currentTime !== app.lastVideoTime) {
    app.lastVideoTime = video.currentTime;
    try {
      const res = app.tracker.detect(detectionSource());
      const m = coverMap();
      const dets = (res ? res.landmarks : []).map((lm, i) => ({
        points: lm.map((p) => ({ x: m.ox + (1 - p.x) * m.dw, y: m.oy + p.y * m.dh, z: p.z })),
        label: res.handedness && res.handedness[i] && res.handedness[i][0] ? res.handedness[i][0].categoryName : null,
      }));
      app.camHands.ingest(dedupe(dets), t);
      fresh = true;
      fpsCount++;
    } catch (err) {
      if (!errorLogged) { console.error('Hand tracking failed on a frame', err); errorLogged = true; }
    }
  }
  if (!fresh) app.camHands.idle();
  if (t - fpsT0 >= 1) { app.fps = fpsCount / (t - fpsT0); fpsCount = 0; fpsT0 = t; }
  if (t - lastStatus > 0.25) {
    updateStatus();
    if (!$('drawer').hidden) updateCameraInfo();
    lastStatus = t;
  }

  const hands = [...app.camHands.present, ...app.pointerHands.frame(t)];
  try {
    if (app.instrument) app.instrument.update(hands, dt, t);
  } catch (err) {
    if (!errorLogged) { console.error(err); errorLogged = true; }
  }
  if (app.started) app.dwell.update(app.camHands.present, t);
  render(hands, t);
  requestAnimationFrame(frame);
}

function render(hands, t) {
  const { W, H } = app;
  const g = app.settings.global;
  const showCamera = app.camera.on && g.cameraView !== 'off';
  const view = showCamera ? CAMERA_VIEWS[g.cameraView] || CAMERA_VIEWS.soft : CAMERA_VIEWS.off;
  // The camera itself is the <video> element underneath; here we only shade it.
  textHalo = showCamera && view.shade < 0.3;
  ctx.clearRect(0, 0, W, H);
  if (view.shade > 0) {
    ctx.fillStyle = `rgba(27, 26, 63, ${view.shade})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (view.vignette > 0) {
    ctx.globalAlpha = view.vignette;
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  if (app.instrument) app.instrument.draw(ctx, t);
  drawHands(ctx, hands, { skeleton: g.skeleton });
  app.dwell.draw(ctx);
}

/* ---------- boot ---------- */

buildTabs();
renderGlobalSettings();
resize();
window.addEventListener('resize', resize);
setInstrument(app.settings.lastInstrument || 'guitar');
updateCameraButton();
applyCameraView();
updateStatus();
requestAnimationFrame(frame);
