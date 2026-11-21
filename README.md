# Virtual Music

Play instruments in the air. Your webcam tracks your hands, and the instruments are drawn on screen. You can strum guitar strings, draw your own strings and pluck them, sweep a harp, press piano keys, hit drums, tap a marimba or play a theremin.

Everything runs in the browser. Hand tracking uses Google's [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker), and every sound is synthesised live with the Web Audio API, so there are no sample files. Video never leaves your computer.

## Run it

The app is plain HTML, CSS and JavaScript modules with no build step. Browsers only allow camera access and JS modules from a web server, so serve the folder locally:

```bash
cd virtual-music
python3 -m http.server 8000
```

Then open <http://localhost:8000> in Chrome, Edge, Safari or Firefox. If you prefer Node, run `npm start` instead.

The first time you turn on the camera, the browser downloads the hand-tracking engine and model (about 20 MB, from jsDelivr and Google). The piano's sampled sounds download when you first use them: about 8 MB for the grand piano and under 1 MB for each other sound. After that the browser serves everything from its cache.

To share it, put the folder on any static host with HTTPS, such as GitHub Pages, Netlify or Vercel.

## The instruments

| Key | Instrument | How to play |
| --- | --- | --- |
| 1 | **Guitar** | Hold your left hand over the neck to pick a chord (C, G, Am, F, Dm, Em by default). Strum across the six strings with your right index finger. Strum speed sets the loudness, and the direction (down or up) sets the order the strings sound in. |
| 2 | **Draw strings** | Pinch thumb and index finger on both hands, then pull your hands apart to stretch a string between them, and let go to keep it. Pinching with one hand never draws, so you can't draw by accident while playing. You can switch to one-hand drawing in Settings. Longer strings play lower notes, snapped to the current key and scale. Swipe across a string to pluck it. |
| 3 | **Harp** | 12 to 24 strings tuned to the current scale. Sweep your fingers sideways across them. |
| 4 | **Piano** | A full 61-key keyboard (49, 76 or 88 keys in Settings) that you can zoom and scroll. Hover your fingertips over the keys and tap one finger down to play. See [The piano](#the-piano) below. |
| 5 | **Drums** | Kick, snare, hi-hat, three toms, crash, ride and clap. Strike downward with your index fingers and stop on a drum, as if you were holding sticks. Harder strokes play louder. |
| 6 | **Marimba** | Strike the bars the same way as the drums. Vibraphone, glockenspiel and steel drum sounds are in Settings. |
| 7 | **Theremin** | Your right hand's height sets the pitch and your left hand's height sets the volume. Pinch to go silent. You can glide freely or snap to the scale. |

Each note name has its own colour, and that colour is the same on every instrument, so a C is always red and a G is always blue.

### Controls

- **Hands-free buttons:** hold your index fingertip over any button (instrument tabs, settings, Undo or Clear) for one second to press it. A gold ring fills up while you wait.
- **Keyboard:** keys 1 to 7 switch instruments, and the comma key opens Settings. Backspace and C undo or clear drawn strings. On the piano, see the shortcuts below.
- **Mouse and touch:** every instrument also works without a camera. Choose "Play with mouse or touch" on the start screen. Click or tap to strike, hover across strings to pluck, and drag to draw strings (on a touch screen, touch with two fingers to stretch a string between them). On a touch screen you can play several piano keys at once.
- **Settings:** volume, reverb, key and scale (shared by the harp, drawn strings, marimba and theremin), camera brightness, the hand outline, a left-handed layout that flips the guitar, drums and theremin, and options for each instrument. Settings are remembered in your browser.

### The piano

**Playing with your hands.** Hold your hands over the keys as you would on a real piano: palms down, fingers relaxed, fingertips over the keys you want. Then tap one finger down. A key plays only when a single finger moves down relative to its own knuckle, so moving your hands around, lowering them, or tilting the whole hand plays nothing. Each fingertip over the keyboard shows a ring that fills up as the finger goes down, and the key under it glows. Hold the finger down to hold the note and lift it to let go. Faster taps play louder.

If taps don't register, raise **Tap sensitivity** in Settings, or zoom out so each key is about as wide as the gap between your fingertips. If your camera angle makes taps hard to see, switch **Press keys by** to "Lowering fingertips into the keys". In that mode a key plays when a fingertip moves down into it from above the gold line, and sliding sideways inside the keys does not play new notes.

**Zooming and scrolling.** The strip at the top shows the whole keyboard, with the part on screen outlined in gold.
- To scroll, drag the strip with the mouse or a finger, or pinch it with your hand and move sideways. You can also use the arrow buttons, the arrow keys, or the mouse wheel over the keys.
- To zoom between 7 white keys and the whole keyboard, use the magnifier buttons, the + and − keys, or Ctrl plus the mouse wheel (or a trackpad pinch).

Your zoom and position are remembered.

**Layouts and labels** (in the bar and in Settings):
- **One keyboard or two stacked keyboards.** Each stacked keyboard scrolls on its own and can have its own sound, for example bass on the bottom and electric piano on top.
- **Key labels:** off, C keys only, white keys, or all keys.
- **Label style:** C4 style, letters only, or Do Re Mi.

**Sounds:**
- **Sampled:** grand piano (recorded at two loudness levels, so soft and hard notes sound different), bright piano, electric piano, FM electric piano, harpsichord, music box, vibraphone, jazz organ, church organ, strings, choir, warm pad and nylon guitar. These download on first use.
- **Built-in:** piano, electric piano, organ and synth. They need no download and work offline. If a sampled sound can't download, the matching built-in sound plays instead.

**Sustain:** the Sustain button holds notes after you lift your fingers, like the right pedal. You can also hold the Space bar.

**Computer keyboard:**
- The home row plays from the first C on screen: A W S E D F T G Y H U J K O L P ; ' are the white and black keys, like a piano keyboard laid out on the letters.
- Z X C V B N M play the white keys an octave lower, or the lower keyboard in stacked mode.
- Arrow keys scroll (hold Shift to scroll a full octave), + and − zoom, and Space is the sustain pedal.

### Tips for good tracking

- Use even, front-facing light. A bright window behind you makes your hands hard to see.
- Sit about an arm's length from the camera, so your whole hand, including the wrist, stays in view while you play.
- A plain background helps, as do sleeves that don't match your skin tone.
- If tracking is jittery or slow on your computer, try adding `?cpu` to the address (for example `http://localhost:8000/?cpu`) to skip the GPU.

## How it works

```
camera ──▶ MediaPipe HandLandmarker ──▶ HandSet ──▶ instrument.update(hands) ──▶ Web Audio synths
            (21 points per hand)        (tracking IDs,       │
                                         smoothing,          └──▶ instrument.draw(canvas)
                                         velocity, pinch)
mouse / touch ──▶ PointerHands (virtual one-finger hands) ──┘
```

- **Tracking** (`src/tracking/`): the landmarks are mirrored to match the selfie view and mapped onto the screen. A One Euro filter smooths jitter without adding lag to fast strums. Each hand keeps an ID between frames, so the app knows where every fingertip was on the previous frame and how fast it is moving.
- **Plucking** (`CrossingDetector` in `src/instruments/common.js`): each fingertip remembers which side of each string it is on, and a pluck happens when that side flips. Fast movements can't skip a string, a small dead zone stops a resting finger from re-triggering, and in a strum the strings sound in the order your finger crossed them.
- **Striking** (`StrikeDetector`): a hit is a fast downward movement followed by a sudden stop, which is what a drumstick does. The speed of the stroke sets the velocity.
- **Piano taps** (`src/instruments/piano/fingerPress.js`): each finger's fingertip is measured against its own knuckle, as a fraction of the hand's size. That makes the measurement independent of where the hand is and how far it is from the camera. To ignore tilting the whole hand, each finger's drop is compared with the least-dropped of the other fingers. Each finger slowly learns its resting position, so any comfortable pose works. A press needs a quick drop past the threshold, and a release needs the finger back above half of it.
- **Sound** (`src/audio/`): Karplus-Strong plucked strings (rendered once per note and cached), analogue-style drum synthesis, modal mallet synthesis and a continuous theremin voice. Piano sounds use recorded samples (`sampler.js`). Samples are spaced three semitones apart and each is pitch-shifted at most one semitone, with built-in synth fallbacks. Everything passes through a shared reverb and limiter.

### Project layout

```
index.html              page shell, start screen, settings panel
styles.css              all styling
src/main.js             camera, main loop, UI wiring
src/tracking/           MediaPipe wrapper, hand tracking and gestures, One Euro filter
src/audio/              audio engine, synthesisers, sample player, scales and chords
src/instruments/        one file per instrument, plus shared helpers
src/instruments/piano/  piano helpers: keyboard rows and finger-tap detection
src/ui/                 settings, hands-free buttons, hand overlay
```

## Add your own instrument

Create a file in `src/instruments/`, extend `Instrument`, and add the class to the list in `src/instruments/index.js`. Here is a minimal example: a row of pads that each play a note when you strike them.

```js
import { Instrument } from './base.js';
import { StrikeDetector } from './common.js';
import { mallet } from '../audio/synths.js';

export class Pads extends Instrument {
  static id = 'pads';
  static label = 'Pads';
  static icon = '<rect x="4" y="4" width="16" height="16" rx="3"/>'; // SVG for the toolbar
  static hint = 'Strike a pad.';
  static settings = [{ key: 'kind', label: 'Sound', type: 'select', options: [['marimba', 'Marimba']], default: 'marimba' }];

  strikes = new StrikeDetector();

  layout() {        // called on resize and when settings change
    this.pads = [60, 64, 67].map((midi, i) => ({ midi, x: this.W * (0.2 + i * 0.25), y: this.H * 0.5, r: 80 }));
  }

  update(hands) {   // called every frame with all tracked hands
    const at = (p) => this.pads.find((pad) => Math.hypot(p.x - pad.x, p.y - pad.y) < pad.r);
    for (const hit of this.strikes.detect(hands, [8], this.H, at)) {
      mallet(this.engine, this.channel, hit.zone.midi, { velocity: hit.velocity, kind: this.opts.kind });
    }
  }

  draw(ctx) {       // called every frame
    for (const p of this.pads) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.strokeStyle = '#FFD166'; ctx.stroke(); }
  }
}
```

Each hand has `points` (21 screen positions; 4 is the thumb tip, 8 is the index fingertip), `prev` (the positions on the previous frame), `vel`, `pinching`, `pinchPoint` and `extended` (which fingers are straight).

## Troubleshooting

- **"Camera access is blocked":** allow the camera for `localhost` in your browser's site settings, then reload. On macOS, also check System Settings, then Privacy & Security, then Camera.
- **The page shows a message about a local web server:** you opened `index.html` directly. Run the server command above instead.
- **No sound:** check the volume slider in Settings and your system volume. Audio starts after your first click on the start screen.
- **Hands aren't detected:** improve the lighting, move back so your whole hand is in view, or try `?cpu`.
- **Piano taps don't play, or play by themselves:** adjust **Tap sensitivity** in Settings, zoom so keys match your finger spacing, or try the "Lowering fingertips into the keys" mode.
- **"Could not download" next to a piano sound:** the samples come from jsDelivr. Check your connection, or pick one of the built-in sounds, which work offline.

## Credits

- Hand tracking: [MediaPipe Tasks Vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) (Apache 2.0), loaded from jsDelivr
- Typeface: [Recursive](https://www.recursive.design/) (SIL Open Font License), loaded from Google Fonts
- Grand piano samples: [Salamander Grand Piano V3](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm (CC BY 3.0), packaged as [@audio-samples/piano-mp3](https://github.com/darosh/samples-piano-mp3) and loaded from jsDelivr
- Other keyboard sounds: the FluidR3 General MIDI sound font by Frank Wen (CC BY 3.0), as converted in [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) and loaded from jsDelivr
