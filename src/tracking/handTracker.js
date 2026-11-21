// Thin wrapper around MediaPipe's HandLandmarker (runs fully in the browser).
// The library and model are fetched from public CDNs on first use, then cached by the browser.

const TASKS_VERSION = '1.2.3';
const BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/vision_bundle.mjs`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandTracker {
  constructor() {
    this.landmarker = null;
    this.loading = null;
    this.lastTs = 0;
    this.delegate = null;
  }

  init() {
    if (!this.loading) this.loading = this.#load();
    return this.loading;
  }

  async #load() {
    const vision = await import(/* webpackIgnore: true */ BUNDLE_URL);
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    // Add ?cpu to the page address to skip the GPU (useful if tracking misbehaves on some graphics drivers).
    const forceCpu = new URLSearchParams(location.search).has('cpu');
    try {
      if (forceCpu) throw new Error('CPU requested');
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, options('GPU'));
      this.delegate = 'GPU';
    } catch (err) {
      console.warn('GPU hand tracking unavailable, using CPU', err);
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, options('CPU'));
      this.delegate = 'CPU';
    }
    return this;
  }

  /** Returns MediaPipe's result for the current video frame. */
  detect(video) {
    if (!this.landmarker) return null;
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1; // timestamps must strictly increase
    this.lastTs = ts;
    return this.landmarker.detectForVideo(video, ts);
  }
}
