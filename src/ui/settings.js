// Settings: stored in localStorage, rendered from small schemas so instruments
// only need to describe their options.
import { NOTE_NAMES, SCALES } from '../audio/music.js';

export const GLOBAL_SCHEMA = [
  { key: 'volume', label: 'Volume', type: 'range', min: 0, max: 1, step: 0.01, default: 0.8 },
  { key: 'reverb', label: 'Reverb', type: 'range', min: 0, max: 1, step: 0.01, default: 0.35 },
  { key: 'key', label: 'Key', type: 'select', options: NOTE_NAMES.map((n, i) => [i, n]), default: 0 },
  { key: 'scale', label: 'Scale', type: 'select', options: Object.entries(SCALES).map(([k, v]) => [k, v.label]), default: 'pentaMajor' },
  { key: 'camera', label: 'Camera brightness', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'skeleton', label: 'Show hand outline', type: 'toggle', default: true },
  { key: 'lefty', label: 'Left-handed layout', type: 'toggle', default: false },
];

const STORAGE_KEY = 'virtual-music:settings:v1';

export class Settings {
  constructor() {
    this.data = { global: {}, instruments: {}, last: null };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch (e) { /* storage unavailable: settings last for this visit only */ }
  }

  #fill(schema, stored) {
    const out = {};
    for (const s of schema) out[s.key] = stored && s.key in stored ? stored[s.key] : s.default;
    return out;
  }

  get global() { return this.#fill(GLOBAL_SCHEMA, this.data.global); }

  instrument(id, schema) { return this.#fill(schema, this.data.instruments[id]); }

  set(scope, key, value) {
    if (scope === 'global') this.data.global[key] = value;
    else (this.data.instruments[scope] ||= {})[key] = value;
    this.save();
  }

  /** Extra values an instrument stores for itself (not shown as controls). */
  raw(scope, key) {
    const bag = scope === 'global' ? this.data.global : this.data.instruments[scope];
    return bag ? bag[key] : undefined;
  }

  get lastInstrument() { return this.data.last; }
  set lastInstrument(id) { this.data.last = id; this.save(); }

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  }
}

/** Builds form controls for a schema. onChange(key, value) fires with typed values. */
export function renderControls(container, schema, values, onChange) {
  container.replaceChildren();
  for (const s of schema) {
    const id = `set-${Math.random().toString(36).slice(2, 8)}`;
    const row = document.createElement('div');
    row.className = `control control-${s.type}`;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = s.label;
    let input;
    if (s.type === 'select') {
      input = document.createElement('select');
      for (const [v, text] of s.options) {
        const o = document.createElement('option');
        o.value = String(v);
        o.textContent = text;
        input.append(o);
      }
      input.value = String(values[s.key]);
      input.addEventListener('change', () => onChange(s.key, typeof s.default === 'number' ? Number(input.value) : input.value));
    } else if (s.type === 'range') {
      input = document.createElement('input');
      input.type = 'range';
      Object.assign(input, { min: s.min, max: s.max, step: s.step });
      input.value = values[s.key];
      input.addEventListener('input', () => onChange(s.key, Number(input.value)));
    } else {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('role', 'switch');
      input.checked = !!values[s.key];
      input.addEventListener('change', () => onChange(s.key, input.checked));
    }
    input.id = id;
    if (s.type === 'toggle') row.append(input, label);
    else row.append(label, input);
    container.append(row);
  }
}
