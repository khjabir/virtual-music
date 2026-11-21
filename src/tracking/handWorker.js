// Runs hand tracking off the main thread. Receives downscaled video frames as ImageBitmaps
// and replies with landmarks.
let landmarker = null;

// MediaPipe loads its WebAssembly glue code with importScripts(), which module workers
// don't allow. Load it synchronously and run it in the global scope instead.
self.importScripts = (...urls) => {
  for (const url of urls) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', String(url), false);
    xhr.send();
    if (xhr.status >= 400) throw new Error(`Could not load ${url}`);
    (0, eval)(`${xhr.responseText}\n//# sourceURL=${url}`);
  }
};

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const vision = await import(m.bundle);
      const fs = await vision.FilesetResolver.forVisionTasks(m.wasm);
      const options = (delegate) => ({
        baseOptions: { modelAssetPath: m.model, delegate },
        runningMode: 'VIDEO',
        numHands: m.numHands,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      let delegate = 'GPU';
      try {
        if (m.cpu) throw new Error('CPU requested');
        landmarker = await vision.HandLandmarker.createFromOptions(fs, options('GPU'));
      } catch (err) {
        delegate = 'CPU';
        landmarker = await vision.HandLandmarker.createFromOptions(fs, options('CPU'));
      }
      self.postMessage({ type: 'ready', delegate });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message || err) });
    }
  } else if (m.type === 'options' && landmarker) {
    await landmarker.setOptions({ numHands: m.numHands });
  } else if (m.type === 'frame') {
    let landmarks = [], handedness = [];
    try {
      if (landmarker) {
        const res = landmarker.detectForVideo(m.bitmap, m.ts);
        landmarks = res.landmarks;
        handedness = res.handedness.map((h) => (h[0] ? h[0].categoryName : null));
      }
    } catch (err) { /* skip this frame */ }
    m.bitmap.close();
    self.postMessage({ type: 'result', landmarks, handedness, frameTime: m.frameTime });
  }
};
