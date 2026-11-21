// Hand tracking with MediaPipe's HandLandmarker, either on the page (simplest) or in a
// background worker, which keeps drawing and sound smooth on slower computers because
// the page never waits for the model.
import { createTask, stamper, MODELS, BUNDLE_URL, WASM_URL, forceCpu } from './mediapipe.js';

const OPTIONS = (numHands) => ({
  baseOptions: { modelAssetPath: MODELS.hand },
  runningMode: 'VIDEO',
  numHands,
  minHandDetectionConfidence: 0.6,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

export class HandTracker {
  constructor() {
    this.landmarker = null;
    this.loading = null;
    this.delegate = null;
    this.numHands = 2;
    this.mode = 'main';
    this.worker = null;
    this.busy = false;
    this.onResult = null; // (result, frameTime) for worker mode
    this.ts = stamper();
  }

  /** Ready when either the page model or the worker is ready. */
  get ready() { return this.mode === 'worker' ? !!this.worker && this.workerReady : !!this.landmarker; }

  init(numHands = 2) {
    this.numHands = numHands;
    if (!this.loading) {
      this.loading = createTask('HandLandmarker', OPTIONS(numHands)).then(({ task, delegate }) => {
        this.landmarker = task;
        this.delegate = delegate;
        return this;
      });
    }
    return this.loading;
  }

  async setNumHands(n) {
    this.numHands = n;
    if (this.landmarker) await this.landmarker.setOptions({ numHands: n });
    if (this.worker) this.worker.postMessage({ type: 'options', numHands: n });
  }

  /** Switch between 'main' and 'worker'. Falls back to the page if the worker can't start. */
  async setMode(mode) {
    if (mode === this.mode) return this.mode;
    if (mode === 'worker') {
      try {
        await this.#startWorker();
        this.mode = 'worker';
      } catch (err) {
        console.warn('Tracking worker unavailable, staying on the page', err);
        this.#stopWorker();
        this.mode = 'main';
      }
    } else {
      this.#stopWorker();
      this.mode = 'main';
    }
    return this.mode;
  }

  #startWorker() {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL('./handWorker.js', import.meta.url), { type: 'module' });
      const timer = setTimeout(() => reject(new Error('Worker took too long to start')), 30000);
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') { clearTimeout(timer); this.workerReady = true; this.workerDelegate = m.delegate; resolve(); }
        else if (m.type === 'error') { clearTimeout(timer); reject(new Error(m.message)); }
        else if (m.type === 'result') {
          this.busy = false;
          if (this.onResult) this.onResult(m, m.frameTime);
        }
      };
      w.onerror = (e) => { clearTimeout(timer); reject(e); };
      this.worker = w;
      this.workerReady = false;
      w.postMessage({ type: 'init', bundle: BUNDLE_URL, wasm: WASM_URL, model: MODELS.hand, numHands: this.numHands, cpu: forceCpu() });
    });
  }

  #stopWorker() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.workerReady = false;
    this.busy = false;
  }

  /** Page mode: returns MediaPipe's result for this frame right away. */
  detect(source) {
    if (!this.landmarker) return null;
    return this.landmarker.detectForVideo(source, this.ts());
  }

  /** Worker mode: hands a downscaled frame to the worker; the result arrives via onResult. */
  async submit(source, frameTime) {
    if (!this.worker || !this.workerReady || this.busy) return false;
    this.busy = true;
    try {
      const w = source.videoWidth || source.width, h = source.videoHeight || source.height;
      const scale = Math.min(1, 960 / w);
      const bitmap = await createImageBitmap(source, { resizeWidth: Math.round(w * scale), resizeHeight: Math.round(h * scale), resizeQuality: 'low' });
      this.worker.postMessage({ type: 'frame', bitmap, ts: this.ts(), frameTime }, [bitmap]);
      return true;
    } catch (err) {
      this.busy = false;
      return false;
    }
  }
}
