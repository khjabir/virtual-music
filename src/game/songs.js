// Songs for song mode. Piano melodies are traditional or long out of copyright, written as
// [midi note, length in beats] (0 = rest). Drum charts are grooves; guitar charts are chord
// progressions with a strumming pattern.

const C = (seq) => {
  const notes = [];
  let beat = 0;
  for (const [midi, len] of seq) {
    if (midi) notes.push({ beat, midi, dur: len });
    beat += len;
  }
  return notes;
};

const rep = (arr, n) => Array.from({ length: n }, () => arr).flat();

/* Piano melodies (C4 = 60) */

const twinkle = C([
  [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
  [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
  [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
  [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
  [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
  [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
]);

const mary = C([
  [64, 1], [62, 1], [60, 1], [62, 1], [64, 1], [64, 1], [64, 2],
  [62, 1], [62, 1], [62, 2], [64, 1], [67, 1], [67, 2],
  [64, 1], [62, 1], [60, 1], [62, 1], [64, 1], [64, 1], [64, 1], [64, 1],
  [62, 1], [62, 1], [64, 1], [62, 1], [60, 4],
]);

const ode = C([
  [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
  [60, 1], [60, 1], [62, 1], [64, 1], [64, 1.5], [62, 0.5], [62, 2],
  [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
  [60, 1], [60, 1], [62, 1], [64, 1], [62, 1.5], [60, 0.5], [60, 2],
]);

const frere = C([
  [60, 1], [62, 1], [64, 1], [60, 1], [60, 1], [62, 1], [64, 1], [60, 1],
  [64, 1], [65, 1], [67, 2], [64, 1], [65, 1], [67, 2],
  [67, 0.5], [69, 0.5], [67, 0.5], [65, 0.5], [64, 1], [60, 1],
  [67, 0.5], [69, 0.5], [67, 0.5], [65, 0.5], [64, 1], [60, 1],
  [60, 1], [55, 1], [60, 2], [60, 1], [55, 1], [60, 2],
]);

const birthday = C([
  [55, 0.75], [55, 0.25], [57, 1], [55, 1], [60, 1], [59, 2],
  [55, 0.75], [55, 0.25], [57, 1], [55, 1], [62, 1], [60, 2],
  [55, 0.75], [55, 0.25], [67, 1], [64, 1], [60, 1], [59, 1], [57, 2],
  [65, 0.75], [65, 0.25], [64, 1], [60, 1], [62, 1], [60, 3],
]);

const jingle = C([
  [64, 1], [64, 1], [64, 2], [64, 1], [64, 1], [64, 2],
  [64, 1], [67, 1], [60, 1.5], [62, 0.5], [64, 4],
  [65, 1], [65, 1], [65, 1.5], [65, 0.5], [65, 1], [64, 1], [64, 1], [64, 0.5], [64, 0.5],
  [64, 1], [62, 1], [62, 1], [64, 1], [62, 2], [67, 2],
  [64, 1], [64, 1], [64, 2], [64, 1], [64, 1], [64, 2],
  [64, 1], [67, 1], [60, 1.5], [62, 0.5], [64, 4],
  [65, 1], [65, 1], [65, 1.5], [65, 0.5], [65, 1], [64, 1], [64, 1], [64, 0.5], [64, 0.5],
  [67, 1], [67, 1], [65, 1], [62, 1], [60, 4],
]);

const saints = C([
  [0, 1], [60, 1], [64, 1], [65, 1], [67, 4],
  [0, 1], [60, 1], [64, 1], [65, 1], [67, 4],
  [0, 1], [60, 1], [64, 1], [65, 1], [67, 2], [64, 2], [60, 2], [64, 2], [62, 4],
  [0, 1], [64, 1], [64, 1], [62, 1], [60, 3], [60, 1], [64, 2], [67, 1], [67, 1], [65, 3],
  [64, 1], [65, 1], [67, 2], [64, 2], [60, 2], [62, 2], [60, 4],
]);

const minuet = C([
  [74, 1], [67, 0.5], [69, 0.5], [71, 0.5], [72, 0.5], [74, 1], [67, 1], [67, 1],
  [76, 1], [72, 0.5], [74, 0.5], [76, 0.5], [78, 0.5], [79, 1], [67, 1], [67, 1],
  [72, 1], [74, 0.5], [72, 0.5], [71, 0.5], [69, 0.5], [71, 1], [72, 0.5], [71, 0.5], [69, 0.5], [67, 0.5],
  [66, 1], [67, 0.5], [69, 0.5], [71, 0.5], [67, 0.5], [69, 3],
]);

const elise = C([
  [76, 0.5], [75, 0.5], [76, 0.5], [75, 0.5], [76, 0.5], [71, 0.5], [74, 0.5], [72, 0.5], [69, 1.5],
  [60, 0.5], [64, 0.5], [69, 0.5], [71, 1.5], [64, 0.5], [68, 0.5], [71, 0.5], [72, 1.5],
  [64, 0.5], [76, 0.5], [75, 0.5], [76, 0.5], [75, 0.5], [76, 0.5], [71, 0.5], [74, 0.5], [72, 0.5], [69, 1.5],
  [60, 0.5], [64, 0.5], [69, 0.5], [71, 1.5], [64, 0.5], [72, 0.5], [71, 0.5], [69, 2],
]);

const canon = C(rep([[78, 2], [76, 2], [74, 2], [73, 2], [71, 2], [69, 2], [71, 2], [73, 2]], 2));

/* Drum charts: steps of a 16-step bar, [step, pad] */

const drumChart = (bars, pattern, fill) => {
  const notes = [];
  for (let b = 0; b < bars; b++) {
    const pat = fill && b % 4 === 3 ? fill : pattern;
    for (const [step, pad] of pat) notes.push({ beat: b * 4 + step / 4, pad, dur: 0.25 });
  }
  return notes;
};

const steady = drumChart(8, [[0, 'kick'], [4, 'snare'], [8, 'kick'], [12, 'snare']]);
const rockBeat = drumChart(8,
  [[0, 'kick'], [0, 'hihat'], [4, 'snare'], [4, 'hihat'], [8, 'kick'], [8, 'hihat'], [12, 'snare'], [12, 'hihat']],
  [[0, 'kick'], [4, 'snare'], [8, 'tomHigh'], [10, 'tomMid'], [12, 'tomFloor'], [14, 'tomFloor']]);
const disco = drumChart(8,
  [[0, 'kick'], [2, 'hihat'], [4, 'kick'], [4, 'clap'], [6, 'hihat'], [8, 'kick'], [10, 'hihat'], [12, 'kick'], [12, 'clap'], [14, 'hihat']],
  [[0, 'kick'], [0, 'crash'], [4, 'kick'], [4, 'clap'], [8, 'kick'], [12, 'snare'], [14, 'snare']]);
const boomBap = drumChart(8,
  [[0, 'kick'], [4, 'snare'], [7, 'kick'], [10, 'kick'], [12, 'snare'], [2, 'hihat'], [6, 'hihat'], [14, 'hihat']],
  [[0, 'kick'], [4, 'snare'], [7, 'kick'], [10, 'kick'], [12, 'snare'], [14, 'crash']]);

/* Guitar charts: one chord per bar; strums at beat offsets, 'D' down or 'U' up */

const guitarChart = (chords, beatsPerBar, pattern) => {
  const notes = [];
  chords.forEach((chord, b) => {
    for (const [off, dir] of pattern) notes.push({ beat: b * beatsPerBar + off, chord, dir, dur: 0.25 });
  });
  return notes;
};

export const SONGS = [
  { id: 'twinkle', title: 'Twinkle, Twinkle, Little Star', by: 'Traditional', inst: 'piano', bpm: 92, level: 1, notes: twinkle },
  { id: 'mary', title: 'Mary Had a Little Lamb', by: 'Traditional', inst: 'piano', bpm: 100, level: 1, notes: mary },
  { id: 'ode', title: 'Ode to Joy', by: 'Beethoven', inst: 'piano', bpm: 100, level: 1, notes: ode },
  { id: 'frere', title: 'Frère Jacques', by: 'Traditional', inst: 'piano', bpm: 100, level: 1, notes: frere },
  { id: 'birthday', title: 'Happy Birthday', by: 'Traditional', inst: 'piano', bpm: 96, level: 2, notes: birthday },
  { id: 'canon', title: 'Canon in D (theme)', by: 'Pachelbel', inst: 'piano', bpm: 76, level: 2, notes: canon },
  { id: 'jingle', title: 'Jingle Bells', by: 'James Lord Pierpont', inst: 'piano', bpm: 112, level: 2, notes: jingle },
  { id: 'saints', title: 'When the Saints Go Marching In', by: 'Traditional', inst: 'piano', bpm: 120, level: 2, notes: saints },
  { id: 'minuet', title: 'Minuet in G', by: 'Christian Petzold', inst: 'piano', bpm: 96, level: 3, notes: minuet },
  { id: 'elise', title: 'Für Elise (opening)', by: 'Beethoven', inst: 'piano', bpm: 120, level: 3, notes: elise },

  { id: 'steady', title: 'Steady beat', by: 'Kick and snare', inst: 'drums', bpm: 80, level: 1, notes: steady },
  { id: 'rock', title: 'Rock beat with fills', by: 'Kick, snare, hi-hat, toms', inst: 'drums', bpm: 76, level: 2, notes: rockBeat },
  { id: 'disco', title: 'Four on the floor', by: 'Kick, clap, hi-hat', inst: 'drums', bpm: 96, level: 2, notes: disco },
  { id: 'boombap', title: 'Boom bap', by: 'Hip-hop groove', inst: 'drums', bpm: 84, level: 3, notes: boomBap },

  { id: 'fourchords', title: 'Four chords: C, G, Am, F', by: 'Strumming practice', inst: 'guitar', bpm: 84, level: 1, chords: ['C', 'G', 'Am', 'F'],
    notes: guitarChart(['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F'], 4, [[0, 'D'], [2, 'D']]) },
  { id: 'grace', title: 'Amazing Grace', by: 'John Newton (words), traditional tune', inst: 'guitar', bpm: 80, level: 1, chords: ['G', 'C', 'D'],
    notes: guitarChart(['G', 'G', 'C', 'G', 'G', 'G', 'D', 'D', 'G', 'G', 'C', 'G', 'G', 'D', 'G', 'G'], 3, [[0, 'D']]) },
  { id: 'risingsun', title: 'The House of the Rising Sun', by: 'Traditional', inst: 'guitar', bpm: 90, level: 2, chords: ['Am', 'C', 'D', 'F', 'E'],
    notes: guitarChart(['Am', 'C', 'D', 'F', 'Am', 'C', 'E', 'E', 'Am', 'C', 'D', 'F', 'Am', 'E', 'Am', 'Am'], 3, [[0, 'D'], [2, 'U']]) },
  { id: 'blues', title: 'Twelve-bar blues in E', by: 'Blues shuffle', inst: 'guitar', bpm: 88, level: 3, chords: ['E7', 'A7', 'B7'],
    notes: guitarChart(['E7', 'E7', 'E7', 'E7', 'A7', 'A7', 'E7', 'E7', 'B7', 'A7', 'E7', 'B7'], 4, [[0, 'D'], [1, 'D'], [2, 'D'], [3, 'U']]) },
];

/** The same song for everyone on a given day. */
export function dailySong(date = new Date()) {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { key, song: SONGS[h % SONGS.length] };
}
