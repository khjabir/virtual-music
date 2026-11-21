// Every instrument extends this class. To add a new one, implement layout(),
// update() and draw(), describe its settings, and register it in instruments/index.js.

export class Instrument {
  static id = 'base';
  static label = 'Instrument';
  static icon = '';
  static hint = '';
  /** [{ key, label, type: 'select'|'range'|'toggle', options?, min?, max?, step?, default }] */
  static settings = [];
  /** [{ id, label, key? }] — buttons shown on stage; a fingertip held over one presses it. */
  static actions = [];

  constructor(app) {
    this.app = app;
    this.engine = app.audio;
    this.W = app.W;
    this.H = app.H;
    this._channel = null;
  }

  get id() { return this.constructor.id; }
  get opts() { return this.app.settings.instrument(this.id, this.constructor.settings); }
  get global() { return this.app.settings.global; }

  /** Audio channel, created once audio has been unlocked by a click. */
  get channel() {
    if (!this._channel && this.engine.ctx) this._channel = this.makeChannel();
    return this._channel;
  }

  makeChannel() { return this.engine.channel(); }

  resetChannel() {
    if (this._channel) this._channel.disconnect();
    this._channel = null;
  }

  /** Layout area that stays clear of the toolbars. */
  get stage() {
    const top = Math.max(92, this.H * 0.13);
    const bottom = this.H - Math.max(64, this.H * 0.08, (this.app.bottomInset || 0) + 8);
    return { top, bottom, left: this.W * 0.04, right: this.W * 0.96 };
  }

  get onScreen() { return this.app.instrument === this; }

  /**
   * Announce a note to the rest of the app (loop station, replays, MIDI, scoring, effects).
   * `delay` (seconds) marks notes scheduled slightly ahead, like the strings of a strum.
   */
  emit(evt) {
    evt.inst = this.id;
    evt.t = this.engine.now + (evt.delay || 0);
    this.app.bus.emit(evt);
  }

  /** Re-create a recorded event: its sound, plus its visuals when on screen. `when` is seconds from now. */
  playEvent(/* evt, when */) {}

  /** Silence anything started by playEvent (the loop stopped, a replay ended). */
  stopPlayback() {}

  activate() {}
  /** Called once audio has been unlocked (after the first click). */
  audioReady() {}
  deactivate() { this.resetChannel(); }
  resize(W, H) { this.W = W; this.H = H; this.layout(); }
  layout() {}
  /** Called when any setting changes (global or this instrument's). */
  settingsChanged() { this.layout(); }
  update(/* hands, dt, t */) {}
  draw(/* ctx, t */) {}
  action(/* id */) {}
}
