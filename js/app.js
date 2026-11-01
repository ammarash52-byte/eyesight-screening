import * as V from "./vision.js";
import * as cam from "./camera.js";

const $ = (id) => document.getElementById(id);
const CAL_DISTANCE_MM = 500;
const NO_FACE_GRACE_MS = 2500;

// ---- persisted calibration -------------------------------------------------
const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

const app = {
  screen: "welcome",
  pxPerMm: store.get("pxPerMm"),
  focal: store.get("focal"), // { px, frameWidth }
  targetMm: 500,
  live: { mm: null, light: null, lastFaceAt: 0, irisPx: null },
  test: null,
};

function show(name) {
  app.screen = name;
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === `s-${name}`));
}

// ---- screen calibration ----------------------------------------------------
$("b-welcome").onclick = () => {
  if (app.pxPerMm) $("card-slider").value = Math.round(app.pxPerMm * V.CARD_WIDTH_MM);
  setBar($("card-slider").value);
  show("screen");
};
function setBar(px) { $("card-bar").style.width = `${px}px`; }
$("card-slider").oninput = (e) => setBar(e.target.value);
$("b-screen").onclick = async () => {
  app.pxPerMm = Number($("card-slider").value) / V.CARD_WIDTH_MM;
  store.set("pxPerMm", app.pxPerMm);
  show("camera");
  await startCameraFlow($("cal-video"));
};

// ---- camera ----------------------------------------------------------------
const CAMERA_ERRORS = {
  NotAllowedError: "Camera permission is blocked. Click the camera/lock icon next to the address bar, choose Allow, then press Retry.",
  NotFoundError: "No camera was found on this device.",
  NotReadableError: "The camera is being used by another app or browser tab (Zoom, Teams, another tab...). Close it, then press Retry.",
  OverconstrainedError: "This camera does not support the requested settings.",
};

async function startCameraFlow(video) {
  $("cal-status").textContent = "Starting camera...";
  $("b-cal-retry").hidden = true;
  try {
    await cam.startCamera();
    await cam.attach(video);
    $("cal-status").textContent = "Loading face model (first time may take a few seconds)...";
    await cam.loadLandmarker();
    $("cal-status").textContent = "Looking for your face...";
    startLoop();
  } catch (err) {
    cam.stopCamera();
    const count = await cam.cameraCount().catch(() => -1);
    let text = CAMERA_ERRORS[err.name] || `Camera problem: ${err.name} ${err.message}`;
    if (err.name === "NotFoundError") {
      text += " Windows may be blocking it: open Settings > Privacy & security > Camera and turn on 'Camera access' and 'Let desktop apps access your camera'. Also check the laptop's camera key/switch.";
    }
    $("cal-status").textContent = `❌ ${text}`;
    $("debug").textContent = `${err.name} | cameras seen by browser: ${count}`;
    $("b-cal-retry").hidden = false;
  }
}
$("b-cal-retry").onclick = () => startCameraFlow($("cal-video"));

function currentFocalPx(frameWidth) {
  return app.focal.px * (frameWidth / app.focal.frameWidth);
}

let loopRunning = false;
function startLoop() {
  if (loopRunning) return;
  loopRunning = true;
  let last = 0;
  const tick = (now) => {
    if (!loopRunning) return;
    if (now - last > 120) {
      last = now;
      try {
        sample();
      } catch (err) {
        $("debug").textContent = `Detection error: ${err.message}`;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Detect on the video that is actually visible on the current screen (hidden videos may not decode frames).
const SCREEN_VIDEO = { camera: "cal-video", setup: "setup-video", test: "test-video" };

function sample() {
  const video = $(SCREEN_VIDEO[app.screen] || "setup-video");
  const m = cam.measureIris(video);
  $("debug").textContent = `video ${video.videoWidth}x${video.videoHeight}, ready=${video.readyState}, face=${m ? "yes" : "no"}`;
  const live = app.live;
  live.light = cam.brightness(video);
  if (m) {
    live.lastFaceAt = performance.now();
    live.irisPx = m.irisPx;
    if (app.focal) {
      const mm = V.distanceMm(currentFocalPx(m.frameWidth), m.irisPx);
      live.mm = live.mm == null ? mm : live.mm * 0.6 + mm * 0.4; // light smoothing
    }
    live.frameWidth = m.frameWidth;
  }
  if (app.screen === "camera") updateCalibrationUI(!!m);
  else if (app.screen === "setup") updateSetupUI();
  else if (app.screen === "test") updateTestGuard();
}

// ---- camera calibration ----------------------------------------------------
function updateCalibrationUI(faceNow) {
  $("b-cal").disabled = !faceNow;
  $("cal-status").textContent = faceNow
    ? "Face found. Sit at the measured distance and press Calibrate."
    : "Looking for your face...";
  $("b-cal-skip").hidden = !app.focal;
}

$("b-cal").onclick = async () => {
  $("b-cal").disabled = true;
  $("cal-status").textContent = "Hold still...";
  const samples = [];
  const started = performance.now();
  while (performance.now() - started < 2500) {
    await new Promise((r) => setTimeout(r, 120));
    if (performance.now() - app.live.lastFaceAt < 300) {
      samples.push({ px: app.live.irisPx, w: app.live.frameWidth });
    }
  }
  if (samples.length < 8) {
    $("cal-status").textContent = "Lost your face. Try again.";
    return;
  }
  samples.sort((a, b) => a.px - b.px);
  const median = samples[Math.floor(samples.length / 2)];
  app.focal = { px: V.focalFromKnownDistance(median.px, CAL_DISTANCE_MM), frameWidth: median.w };
  store.set("focal", app.focal);
  app.live.mm = null;
  goSetup();
};
$("b-cal-skip").onclick = () => goSetup();

// ---- setup + live guide ----------------------------------------------------
async function goSetup() {
  show("setup");
  await cam.attach($("setup-video"));
  app.targetMm = Number($("dist-select").value) * 1000;
}
$("dist-select").onchange = (e) => { app.targetMm = Number(e.target.value) * 1000; };

function distanceMessage(status, mm) {
  const now = `${Math.round(mm / 10)} cm`;
  if (status === "near") return `Too close (${now}) - move back`;
  if (status === "far") return `Too far (${now}) - move closer`;
  return `Perfect distance (${now}) ✅`;
}

function updateSetupUI() {
  const live = app.live;
  const sig = $("dist-signal");
  const faceVisible = performance.now() - live.lastFaceAt < 800 && live.mm != null;
  let distOk = false;
  if (!faceVisible) {
    sig.textContent = "Looking for your face...";
    sig.className = "signal";
  } else {
    const status = V.distanceStatus(live.mm, app.targetMm);
    distOk = status === "ok";
    sig.textContent = distanceMessage(status, live.mm);
    sig.className = `signal ${distOk ? "ok" : "bad"}`;
  }
  if (live.light == null) {
    sig.textContent = "Camera is not sending video - go back and press Retry camera.";
    sig.className = "signal bad";
  }
  const ls = live.light == null ? null : V.lightStatus(live.light);
  const lightEl = $("light-signal");
  lightEl.textContent = { dark: "💡 Too dark - turn on more light", glare: "💡 Very bright / glare - reduce direct light", ok: "💡 Lighting looks fine" }[ls] || "";
  lightEl.className = `signal small ${ls === "ok" ? "ok" : ls ? "bad" : ""}`;
  $("b-setup").disabled = !(distOk && ls === "ok");
}

$("b-setup").onclick = () => {
  // Judge sharpness in physical pixels (a phone packs 2-3 physical pixels into each CSS pixel).
  const levels = V.usableLevels(app.targetMm / 1000, app.pxPerMm * (window.devicePixelRatio || 1));
  app.test = { levels, results: {} };
  beginEye("Right");
};

// ---- the E test ------------------------------------------------------------
function beginEye(eye) {
  Object.assign(app.test, { eye, li: 0, lastPass: null, seq: V.newLine(), pos: 0, wrong: 0, phase: "test" });
  show("test");
  cam.attach($("test-video"));
  renderTest();
}

function eSvg(px, direction) {
  const size = Math.max(Math.round(px), 1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5" width="${size}" height="${size}"
    style="transform:rotate(${V.ROTATION[direction]}deg)">
    <rect x="0" y="0" width="1" height="5"/><rect x="0" y="0" width="5" height="1"/>
    <rect x="0" y="2" width="5" height="1"/><rect x="0" y="4" width="5" height="1"/></svg>`;
}

function renderTest() {
  const t = app.test;
  const switching = t.phase === "switch";
  $("answers").hidden = switching;
  $("b-continue").hidden = !switching;
  $("letter-box").hidden = switching;
  if (switching) {
    $("test-info").innerHTML = "<h3>Right eye done ✅</h3><p>Now cover your <b>right</b> eye with your palm, then press Continue.</p>";
    return;
  }
  const cover = t.eye === "Right" ? "left" : "right";
  $("test-info").innerHTML = `<p>Testing your <b>${t.eye.toLowerCase()}</b> eye. Cover your <b>${cover}</b> eye with your palm (don't press). Tap the direction the <b>E</b> points.</p>`;
  const lv = t.levels[t.li];
  const px = V.letterHeightMm(lv, app.targetMm / 1000) * app.pxPerMm;
  $("letter").innerHTML = eSvg(px, t.seq[t.pos]);
  $("letter").style.padding = `${Math.max(px, 40)}px`;
}

// While testing, hide the letter if the person is too near/far or the face is lost for a while.
function updateTestGuard() {
  const t = app.test;
  if (!t || t.phase !== "test") return;
  const live = app.live;
  const msg = $("pause-msg");
  const faceLost = performance.now() - live.lastFaceAt > NO_FACE_GRACE_MS;
  let text = "";
  if (faceLost) {
    text = "Can't see your face - look at the screen and keep your head in view.";
  } else {
    const status = V.distanceStatus(live.mm, app.targetMm);
    if (status !== "ok") text = distanceMessage(status, live.mm);
  }
  msg.hidden = !text;
  msg.textContent = text;
  $("test-dist").textContent = live.mm ? `Distance: ${Math.round(live.mm / 10)} cm` : "";
  $("test-dist").className = `signal small ${text ? "bad" : "ok"}`;
}

function finishEye() {
  const t = app.test;
  t.results[t.eye] = t.lastPass;
  if (t.eye === "Right") {
    t.phase = "switch";
    renderTest();
  } else {
    showResult();
  }
}

function answer(choice) {
  const t = app.test;
  if (t.phase !== "test" || !$("pause-msg").hidden) return; // ignore taps while paused
  if (choice !== t.seq[t.pos]) t.wrong += 1;
  t.pos += 1;
  if (t.wrong > V.MAX_WRONG_PER_LINE) return finishEye();
  if (t.pos === V.LETTERS_PER_LINE) {
    t.lastPass = t.levels[t.li];
    t.li += 1;
    if (t.li >= t.levels.length) return finishEye();
    t.seq = V.newLine();
    t.pos = 0;
    t.wrong = 0;
  }
  renderTest();
}

document.querySelectorAll("#answers button").forEach((b) => { b.onclick = () => answer(b.dataset.a); });
$("b-continue").onclick = () => beginEye("Left");

// ---- result ----------------------------------------------------------------
function showResult() {
  loopRunning = false;
  cam.stopCamera();
  const rows = ["Right", "Left"].map((eye) => {
    const acuity = app.test.results[eye];
    const [category, advice] = V.grade(acuity);
    const shown = acuity ? `${V.fraction(acuity)} (decimal ${acuity})` : "below the largest line";
    return `<p><b>${eye} eye:</b> ${category} - best line read: ${shown}. ${advice}</p>`;
  });
  $("result").innerHTML = rows.join("");
  show("result");
}

$("b-again").onclick = () => show("welcome");
