// Replay links: a performance (every note, plus where your fingertips moved) is packed
// into the page address itself, compressed. Whoever opens the link watches "ghost hands"
// play it back on the same instrument, then gets to try it. No server involved.

const KEEP = ['type', 'inst', 'key', 'row', 'midi', 'vel', 'pad', 'string', 'level', 'x', 'y'];
const MAX_MS = 60000;

const round = (v, d) => (typeof v === 'number' ? Math.round(v * 10 ** d) / 10 ** d : v);

async function pack(obj) {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  let bytes = json, mark = 'j';
  if (typeof CompressionStream !== 'undefined') {
    const cs = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    bytes = new Uint8Array(await new Response(cs).arrayBuffer());
    mark = 'z';
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return mark + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function unpack(code) {
  const mark = code[0];
  const b64 = code.slice(1).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  let bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (mark === 'z') {
    const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    bytes = new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export class Replay {
  constructor(app) {
    this.app = app;
    this.cap = null;
    this.play = null;
    app.bus.on((e) => this.capture(e));
  }

  get capturing() { return !!this.cap; }

  startCapture() {
    const app = this.app;
    const inst = app.instrument;
    this.cap = {
      t0: performance.now(),
      inst: inst.id,
      g: { key: app.settings.global.key, scale: app.settings.global.scale, lefty: app.settings.global.lefty },
      o: { [inst.id]: { ...inst.opts } },
      views: inst.id === 'piano' ? inst.rows.map((r) => [round(r.target, 2), r.count]) : null,
      ev: [],
      gh: [],
      lastGhost: -1e9,
      lastInst: inst.id,
    };
  }

  capture(e) {
    if (!this.cap || e.playback || this.play) return;
    const ms = Math.round(performance.now() - this.cap.t0 + (e.delay || 0) * 1000);
    if (ms > MAX_MS) return;
    const { W, H } = this.app;
    const o = {};
    for (const k of KEEP) if (e[k] !== undefined) o[k] = e[k];
    if (o.x != null) { o.x = Math.round((o.x / W) * 1000); o.y = Math.round((o.y / H) * 1000); }
    o.vel = round(o.vel, 2);
    o.level = round(o.level, 2);
    o.midi = round(o.midi, 2);
    this.cap.ev.push([ms, o]);
    if (e.inst !== this.cap.lastInst) {
      this.cap.lastInst = e.inst;
      const inst = this.app.instances.get(e.inst);
      if (inst && !this.cap.o[e.inst]) this.cap.o[e.inst] = { ...inst.opts };
    }
  }

  /** Called every frame while capturing: samples fingertip positions ten times a second. */
  frame(hands) {
    if (!this.cap) return;
    const ms = performance.now() - this.cap.t0;
    if (ms > MAX_MS || ms - this.cap.lastGhost < 100) return;
    this.cap.lastGhost = ms;
    const { W, H } = this.app;
    const pts = [];
    for (const h of hands.slice(0, 4)) pts.push(Math.round((h.points[8].x / W) * 1000), Math.round((h.points[8].y / H) * 1000));
    this.cap.gh.push([Math.round(ms), ...pts]);
  }

  async stopCapture() {
    const c = this.cap;
    this.cap = null;
    if (!c || !c.ev.length) return null;
    const data = { v: 1, inst: c.inst, g: c.g, o: c.o, views: c.views, ev: c.ev, gh: c.gh };
    const code = await pack(data);
    return `${location.origin}${location.pathname}#replay=${code}`;
  }

  static fromLocation() {
    const m = location.hash.match(/replay=([^&]+)/);
    return m ? m[1] : null;
  }

  static async decode(code) {
    try { return await unpack(code); } catch (err) { console.warn('Replay link could not be read', err); return null; }
  }

  /** Play a decoded performance. Settings are borrowed for the replay, not saved. */
  start(data, onDone) {
    const app = this.app;
    app.settings.override = { global: data.g || {}, instruments: data.o || {} };
    app.setInstrument(data.inst);
    const inst = app.instrument;
    if (inst.id === 'piano' && data.views) data.views.forEach(([s, c], i) => { if (inst.rows[i]) { inst.rows[i].count = c; inst.rows[i].setStart(s, true); } });
    if (inst.settingsChanged) inst.layout();
    const t0 = performance.now() + 600;
    this.play = { data, t0, timers: [], onDone };
    const { W, H } = app;
    for (const [ms, o] of data.ev) {
      const evt = { ...o, x: o.x != null ? (o.x / 1000) * W : undefined, y: o.y != null ? (o.y / 1000) * H : undefined };
      this.play.timers.push(setTimeout(() => {
        if (evt.inst !== app.instrument.id && evt.type !== 'cont') app.setInstrument(evt.inst);
        const target = app.instances.get(evt.inst) || app.instrument;
        target.playEvent(evt, 0);
        app.bus.emit({ ...evt, playback: true, t: app.audio.now });
      }, t0 - performance.now() + ms));
    }
    const end = Math.max(data.ev.length ? data.ev[data.ev.length - 1][0] : 0, data.gh.length ? data.gh[data.gh.length - 1][0] : 0) + 1500;
    this.play.timers.push(setTimeout(() => this.finish(), t0 - performance.now() + end));
  }

  finish() {
    if (!this.play) return;
    this.play.timers.forEach(clearTimeout);
    const done = this.play.onDone;
    this.play = null;
    this.app.instances.forEach((i) => i.stopPlayback());
    this.app.settings.override = null;
    if (this.app.instrument) { this.app.instrument.settingsChanged(); }
    history.replaceState(null, '', location.pathname + location.search);
    if (done) done();
  }

  /** Ghost fingertips, drawn while a replay plays. */
  draw(ctx) {
    if (!this.play) return;
    const gh = this.play.data.gh;
    if (!gh.length) return;
    const ms = performance.now() - this.play.t0;
    let i = gh.findIndex((g) => g[0] > ms);
    if (i < 0) i = gh.length;
    const a = gh[Math.max(0, i - 1)], b = gh[Math.min(gh.length - 1, i)];
    const span = b[0] - a[0];
    const k = span > 0 ? Math.max(0, Math.min(1, (ms - a[0]) / span)) : 0;
    const { W, H } = this.app;
    const n = Math.min(a.length, b.length);
    ctx.save();
    for (let j = 1; j + 1 < n; j += 2) {
      const x = ((a[j] + (b[j] - a[j]) * k) / 1000) * W;
      const y = ((a[j + 1] + (b[j + 1] - a[j + 1]) * k) / 1000) * H;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 34);
      g.addColorStop(0, 'rgba(160, 240, 255, 0.85)');
      g.addColorStop(1, 'rgba(160, 240, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#EDEBFF';
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(18, 20, 43, 0.7)';
    ctx.fillRect(W / 2 - 110, 128, 220, 34);
    ctx.fillStyle = '#EDEBFF';
    ctx.font = '700 15px Recursive, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Replay  ${Math.max(0, Math.min(ms, 999999) / 1000).toFixed(1)} s`, W / 2, 145);
  }
}
