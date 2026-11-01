// Front camera + MediaPipe face landmarks -> iris size in pixels and frame brightness.
const VERSION = "0.10.14";
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Horizontal iris diameter = distance between these landmark pairs (one pair per eye).
const IRIS_PAIRS = [[469, 471], [474, 476]];

let landmarker = null;
let stream = null;
const probe = document.createElement("canvas");
probe.width = 32;
probe.height = 24;
const probeCtx = probe.getContext("2d", { willReadFrequently: true });

export async function loadLandmarker() {
  if (landmarker) return landmarker;
  const { FaceLandmarker, FilesetResolver } = await import(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`
  );
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  const make = (delegate) =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
    });
  try {
    landmarker = await make("GPU");
  } catch {
    landmarker = await make("CPU");
  }
  return landmarker;
}

export async function startCamera() {
  if (stream) return stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
  } catch (err) {
    // Some desktop cameras reject the facingMode hint; retry with no constraints at all.
    if (err.name !== "NotFoundError" && err.name !== "OverconstrainedError") throw err;
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
  return stream;
}

export async function cameraCount() {
  if (!navigator.mediaDevices?.enumerateDevices) return -1;
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput").length;
}

export function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

export function attach(video) {
  video.srcObject = stream;
  return video.play();
}

// Returns { irisPx, frameWidth } or null when no face / iris is found.
export function measureIris(video) {
  if (!landmarker || video.readyState < 2) return null;
  const res = landmarker.detectForVideo(video, performance.now());
  const lm = res.faceLandmarks && res.faceLandmarks[0];
  if (!lm || lm.length < 478) return null;
  const w = video.videoWidth;
  const h = video.videoHeight;
  const sizes = IRIS_PAIRS.map(([a, b]) =>
    Math.hypot((lm[a].x - lm[b].x) * w, (lm[a].y - lm[b].y) * h)
  ).filter((s) => s > 2);
  if (!sizes.length) return null;
  return { irisPx: sizes.reduce((x, y) => x + y, 0) / sizes.length, frameWidth: w };
}

export function brightness(video) {
  if (video.readyState < 2) return null;
  probeCtx.drawImage(video, 0, 0, probe.width, probe.height);
  const d = probeCtx.getImageData(0, 0, probe.width, probe.height).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return sum / (d.length / 4);
}
