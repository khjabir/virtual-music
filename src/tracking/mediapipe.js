// Shared loader for Google's MediaPipe vision tasks (hands, body, face, background
// segmentation). The library and models load from public CDNs the first time a feature
// needs them, and the browser caches them after that.

export const TASKS_VERSION = '1.2.3';
export const BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/vision_bundle.mjs`;
export const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const M = 'https://storage.googleapis.com/mediapipe-models';
export const MODELS = {
  hand: `${M}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
  segmenter: `${M}/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite`,
  face: `${M}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
  pose: `${M}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
};

let visionPromise = null;
let filesetPromise = null;

export function loadVision() {
  if (!visionPromise) visionPromise = import(/* webpackIgnore: true */ BUNDLE_URL);
  return visionPromise;
}

export async function fileset() {
  const vision = await loadVision();
  if (!filesetPromise) filesetPromise = vision.FilesetResolver.forVisionTasks(WASM_URL);
  return filesetPromise;
}

/** Add ?cpu to the address to keep MediaPipe off the GPU (some graphics drivers misbehave). */
export const forceCpu = () => new URLSearchParams(location.search).has('cpu');

/** Creates a task (e.g. 'HandLandmarker'), on the GPU when possible. */
export async function createTask(kind, options) {
  const vision = await loadVision();
  const fs = await fileset();
  const make = (delegate) => vision[kind].createFromOptions(fs, { ...options, baseOptions: { ...options.baseOptions, delegate } });
  if (!forceCpu()) {
    try {
      return { task: await make('GPU'), delegate: 'GPU' };
    } catch (err) {
      console.warn(`${kind}: GPU unavailable, using the CPU`, err);
    }
  }
  return { task: await make('CPU'), delegate: 'CPU' };
}

/** Timestamps per task must strictly increase. */
export function stamper() {
  let last = 0;
  return () => {
    let ts = performance.now();
    if (ts <= last) ts = last + 1;
    last = ts;
    return ts;
  };
}
