// Grooves for the backing tracks and the launchpad: drum patterns (16 steps per bar,
// numbers are loudness), bass lines and chord rhythms, plus chord helpers.
import { NOTE_NAMES } from '../audio/music.js';

export const STYLES = {
  lofi: {
    label: 'Lo-fi', bpm: 78, swing: 0.2,
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0.9, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.75, 0, 0, 0, 0, 0, 0, 0, 0.75, 0, 0, 0.25],
      hihat: [0.45, 0, 0.3, 0, 0.45, 0, 0.3, 0, 0.45, 0, 0.3, 0, 0.45, 0, 0.3, 0.2],
    },
    bass: [[0, 'R', 6], [7, '5', 2], [10, 'R', 5]],
    comp: { sound: 'epiano', hits: [[0, 7], [8, 6]], vel: 0.45 },
  },
  pop: {
    label: 'Pop', bpm: 108,
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0.6, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      clap: [0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0],
      hihat: [0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0],
    },
    bass: [[0, 'R', 2], [2, 'R', 2], [4, 'R', 2], [6, 'R', 2], [8, 'R', 2], [10, 'R', 2], [12, '5', 2], [14, '8', 2]],
    comp: { sound: 'grand', hits: [[0, 3], [4, 3], [8, 3], [12, 3]], vel: 0.42 },
  },
  rock: {
    label: 'Rock', bpm: 120, crashEvery: 4,
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hihat: [0.7, 0, 0.7, 0, 0.7, 0, 0.7, 0, 0.7, 0, 0.7, 0, 0.7, 0, 0.7, 0],
    },
    bass: [[0, 'R', 2], [2, 'R', 2], [4, 'R', 2], [6, 'R', 2], [8, 'R', 2], [10, 'R', 2], [12, 'R', 2], [14, '5', 2]],
    comp: { sound: 'stab', hits: [[0, 6], [6, 2], [8, 6], [14, 2]], vel: 0.5, power: true },
  },
  funk: {
    label: 'Funk', bpm: 100,
    drums: {
      kick: [1, 0, 0, 0.6, 0, 0, 0.8, 0, 0, 0, 1, 0, 0, 0.5, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0.3, 0, 0.3, 0, 0, 1, 0, 0, 0.4],
      hihat: [0.6, 0.3, 0.45, 0.3, 0.6, 0.3, 0.45, 0.3, 0.6, 0.3, 0.45, 0.3, 0.6, 0.3, 0.45, 0.3],
    },
    bass: [[0, 'R', 1], [3, '8', 1], [6, 'R', 1], [8, 'R', 1], [10, '5', 1], [11, '8', 1], [14, '7', 2]],
    comp: { sound: 'stab', hits: [[2, 1], [6, 1], [11, 1], [14, 1]], vel: 0.45 },
  },
  bossa: {
    label: 'Bossa nova', bpm: 128,
    drums: {
      kick: [1, 0, 0, 0.5, 1, 0, 0, 0.5, 1, 0, 0, 0.5, 1, 0, 0, 0.5],
      clap: [0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0.5, 0, 0],
      hihat: [0.35, 0.2, 0.35, 0.2, 0.35, 0.2, 0.35, 0.2, 0.35, 0.2, 0.35, 0.2, 0.35, 0.2, 0.35, 0.2],
    },
    bass: [[0, 'R', 3], [3, '5', 1], [8, '5', 3], [11, 'R', 1]],
    comp: { sound: 'epiano', hits: [[0, 2], [3, 2], [6, 2], [10, 2], [13, 2]], vel: 0.4 },
  },
};

const MINORISH = new Set(['minor', 'dorian', 'harmonicMinor', 'pentaMinor', 'blues']);

/** Four-bar progression in the current key: I–V–vi–IV, or i–VI–III–VII for minor scales. */
export function progression(key, scale) {
  const name = (pc, minor) => NOTE_NAMES[((pc % 12) + 12) % 12] + (minor ? 'm' : '');
  if (MINORISH.has(scale)) return [name(key, true), name(key + 8), name(key + 3), name(key + 10)];
  return [name(key), name(key + 7), name(key + 9, true), name(key + 5)];
}

/** Root pitch class and chord tones (semitones above the root) from a name like "F♯m" or "E7". */
export function parseChord(nameIn) {
  const name = String(nameIn || 'C').replace('#', '♯').replace('b', '♭');
  let pc = NOTE_NAMES.indexOf(name.slice(0, 2));
  let rest = name.slice(2);
  if (pc < 0) { pc = NOTE_NAMES.indexOf(name[0]); rest = name.slice(1); }
  if (name[1] === '♭') { pc = (NOTE_NAMES.indexOf(name[0]) + 11) % 12; rest = name.slice(2); }
  if (pc < 0) pc = 0;
  const minor = rest.startsWith('m') && !rest.startsWith('maj');
  const tones = [0, minor ? 3 : 4, 7];
  if (rest.includes('7')) tones.push(rest.includes('maj') ? 11 : 10);
  return { root: pc, minor, tones };
}

/** Bass degree to semitones above the root. */
export function degree(d, chord) {
  return { R: 0, 3: chord.minor ? 3 : 4, 5: 7, 7: 10, 8: 12 }[d] ?? 0;
}
