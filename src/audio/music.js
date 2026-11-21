// Music theory helpers shared by every instrument.

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const pitchClass = (m) => ((Math.round(m) % 12) + 12) % 12;
export const pitchClassName = (m) => NOTE_NAMES[pitchClass(m)];
export const noteName = (m) => pitchClassName(m) + (Math.floor(Math.round(m) / 12) - 1);

export const SCALES = {
  pentaMajor: { label: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  pentaMinor: { label: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  major: { label: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: 'Natural minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { label: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  harmonicMinor: { label: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  blues: { label: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  chromatic: { label: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

/** `count` ascending notes of the scale, starting at the first scale note >= lowMidi. */
export function scaleNotes(root, scaleKey, lowMidi, count) {
  const steps = (SCALES[scaleKey] || SCALES.major).steps;
  const notes = [];
  for (let m = lowMidi; notes.length < count && m < 128; m++) {
    if (steps.includes(((m - root) % 12 + 12) % 12)) notes.push(m);
  }
  return notes;
}

/** All scale notes within [lowMidi, highMidi]. */
export function scaleRange(root, scaleKey, lowMidi, highMidi) {
  const steps = (SCALES[scaleKey] || SCALES.major).steps;
  const notes = [];
  for (let m = lowMidi; m <= highMidi; m++) {
    if (steps.includes(((m - root) % 12 + 12) % 12)) notes.push(m);
  }
  return notes;
}

/** Nearest scale note to a continuous midi value. */
export function snapToScale(midi, root, scaleKey) {
  const steps = (SCALES[scaleKey] || SCALES.major).steps;
  let best = Math.round(midi), bestD = Infinity;
  for (let m = Math.floor(midi) - 2; m <= Math.ceil(midi) + 2; m++) {
    if (!steps.includes(((m - root) % 12 + 12) % 12)) continue;
    const d = Math.abs(m - midi);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

// Every pitch class gets its own hue, used consistently by all instruments,
// so a C glows the same colour on the harp, the piano and the theremin.
const PC_HUES = [350, 22, 42, 62, 92, 140, 172, 194, 214, 244, 272, 312];
export function noteHue(midi) { return PC_HUES[pitchClass(midi)]; }
export function noteColor(midi, alpha = 1, light = 66) {
  return `hsla(${noteHue(midi)}, 92%, ${light}%, ${alpha})`;
}

// Guitar: standard tuning, low E to high E.
export const GUITAR_TUNING = [40, 45, 50, 55, 59, 64];

// Fret numbers per string (low E first); null = string not played.
export const CHORDS = {
  C: [null, 3, 2, 0, 1, 0],
  G: [3, 2, 0, 0, 0, 3],
  D: [null, null, 0, 2, 3, 2],
  A: [null, 0, 2, 2, 2, 0],
  E: [0, 2, 2, 1, 0, 0],
  F: [1, 3, 3, 2, 1, 1],
  Am: [null, 0, 2, 2, 1, 0],
  Em: [0, 2, 2, 0, 0, 0],
  Dm: [null, null, 0, 2, 3, 1],
  Bm: [null, 2, 4, 4, 3, 2],
  'F♯m': [2, 4, 4, 2, 2, 2],
  B7: [null, 2, 1, 2, 0, 2],
  E7: [0, 2, 0, 1, 0, 0],
  A7: [null, 0, 2, 0, 2, 0],
};

export const CHORD_SETS = {
  pop: { label: 'Pop in C (C G Am F Dm Em)', chords: ['C', 'G', 'Am', 'F', 'Dm', 'Em'] },
  folk: { label: 'Folk in G (G C D Em Am Bm)', chords: ['G', 'C', 'D', 'Em', 'Am', 'Bm'] },
  rock: { label: 'Rock in A (A D E F♯m Bm E7)', chords: ['A', 'D', 'E', 'F♯m', 'Bm', 'E7'] },
  blues: { label: 'Blues in E (E7 A7 B7 E A Em)', chords: ['E7', 'A7', 'B7', 'E', 'A', 'Em'] },
};

export function chordNotes(name) {
  const frets = CHORDS[name];
  return GUITAR_TUNING.map((open, i) => (frets[i] == null ? null : open + frets[i]));
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
