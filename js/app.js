import * as V from "./vision.js";
import * as cam from "./camera.js";
import { SLOAN, letterSvg } from "./letters.js";
import * as voice from "./voice.js";
import * as color from "./color.js";

const $ = (id) => document.getElementById(id);
const CAL_DISTANCE_MM = 500;
const NO_FACE_GRACE_MS = 2500;
const NEAR_STABLE_RATIO = 0.2; // must stay within 20% of the captured distance while answering

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
  mode: "letters", // "letters" | "e"
  pxPerMm: store.get("pxPerMm"),
  focal: store.get("focal"), // { px, frameWidth }
  targetMm: 500,
  live: { mm: null, light: null, lastFaceAt: 0, irisPx: null, history: [] },
  test: null,
  near: null,
};

// ---- voice guidance toggle ---------------------------------------------------
const speak = voice.speak;
function refreshVoiceButton() {
  $("b-voice").textContent = voice.isEnabled() ? "🔊 Voice on" : "🔇 Voice off";
}
if (voice.isSupported()) {
  $("b-voice").hidden = false;
  refreshVoiceButton();
  $("b-voice").onclick = () => {
    voice.setEnabled(!voice.isEnabled());
    refreshVoiceButton();
    speak("Voice guidance is on.", true);
  };
}

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
const SCREEN_VIDEO = { camera: "cal-video", setup: "setup-video", test: "test-video", near: "near-video" };

function sample() {
  const id = SCREEN_VIDEO[app.screen];
  if (!id) return;
  const video = $(id);
  const m = cam.measureIris(video);
  $("debug").textContent = `video ${video.videoWidth}x${video.videoHeight}, ready=${video.readyState}, face=${m ? "yes" : "no"}`;
  const live = app.live;
  const now = performance.now();
  live.light = cam.brightness(video);
  if (m) {
    live.lastFaceAt = now;
    live.irisPx = m.irisPx;
    if (app.focal) {
      const mm = V.distanceMm(currentFocalPx(m.frameWidth), m.irisPx);
      live.mm = live.mm == null ? mm : live.mm * 0.6 + mm * 0.4; // light smoothing
      live.history.push({ t: now, mm: live.mm });
    }
    live.frameWidth = m.frameWidth;
  }
  live.history = live.history.filter((h) => now - h.t < 3000);
  if (app.screen === "camera") updateCalibrationUI(!!m);
  else if (app.screen === "setup") updateSetupUI();
  else if (app.screen === "test") updateTestGuard();
  else if (app.screen === "near") updateNearUI();
}

// Median of the distance readings from the last `windowMs`, or null if there are too few.
function recentDistanceMm(windowMs) {
  const now = performance.now();
  const vals = app.live.history.filter((h) => now - h.t < windowMs).map((h) => h.mm).sort((a, b) => a - b);
  return vals.length >= 4 ? vals[Math.floor(vals.length / 2)] : null;
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
  app.live.history = [];
  goSetup();
};
$("b-cal-skip").onclick = () => goSetup();

// ---- setup + live guide ----------------------------------------------------
async function goSetup() {
  app.lastSpokenStatus = null;
  app.lastSpokenLight = null;
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
  if (faceVisible) {
    const status = V.distanceStatus(live.mm, app.targetMm);
    if (status !== app.lastSpokenStatus) {
      app.lastSpokenStatus = status;
      speak({ near: "Too close. Move back.", far: "Too far. Move closer.", ok: "Perfect. Hold still, then press Start test." }[status]);
    }
  }
  if (ls && ls !== "ok" && ls !== app.lastSpokenLight) speak(ls === "dark" ? "The room is too dark." : "There is too much glare.");
  app.lastSpokenLight = ls;
  const lightEl = $("light-signal");
  lightEl.textContent = { dark: "💡 Too dark - turn on more light", glare: "💡 Very bright / glare - reduce direct light", ok: "💡 Lighting looks fine" }[ls] || "";
  lightEl.className = `signal small ${ls === "ok" ? "ok" : ls ? "bad" : ""}`;
  $("b-setup").disabled = !(distOk && ls === "ok");
}

$("b-setup").onclick = () => {
  app.mode = $("mode-select").value;
  const view = {
    pxPerMm: app.pxPerMm,
    dpr: window.devicePixelRatio || 1, // sharpness is judged in physical pixels
    boxW: Math.min(window.innerWidth, 560) - 52,
    boxH: Math.round(window.innerHeight * 0.45),
    count: app.mode === "letters" ? V.LETTERS_PER_LINE : 1,
  };
  const levels = V.usableLevels(app.targetMm / 1000, view);
  if (levels.length < 3) {
    $("dist-signal").textContent = "This screen is too small for this distance - choose a different distance.";
    $("dist-signal").className = "signal bad";
    return;
  }
  app.test = { levels, results: {} };
  beginEye("Right");
};

// ---- the test --------------------------------------------------------------
function newSequence() {
  return app.mode === "letters" ? V.newLetterLine(SLOAN) : V.newLine();
}

function beginEye(eye) {
  app.lastGuard = "";
  Object.assign(app.test, { eye, li: 0, lastPass: null, seq: newSequence(), pos: 0, wrong: 0, typed: [], phase: "test" });
  show("test");
  cam.attach($("test-video"));
  renderTest();
  speak(`Testing your ${eye.toLowerCase()} eye. Cover your ${eye === "Right" ? "left" : "right"} eye with your palm.`, true);
}

function eSvg(px, direction) {
  const size = Math.max(Math.round(px), 1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5" width="${size}" height="${size}"
    style="transform:rotate(${V.ROTATION[direction]}deg)">
    <rect x="0" y="0" width="1" height="5"/><rect x="0" y="0" width="5" height="1"/>
    <rect x="0" y="2" width="5" height="1"/><rect x="0" y="4" width="5" height="1"/></svg>`;
}

function buildPad() {
  const pad = $("answers");
  if (pad.dataset.mode === app.mode) return;
  pad.dataset.mode = app.mode;
  pad.className = app.mode === "letters" ? "pad-letters" : "";
  pad.innerHTML = app.mode === "letters"
    ? SLOAN.map((c) => `<button data-a="${c}">${c}</button>`).join("") +
      `<button data-a="?" class="wide">🤷 Can't see this letter</button>`
    : `<button data-a="up">⬆️</button><button data-a="left">⬅️</button><button data-a="right">➡️</button>
       <button data-a="down">⬇️</button><button data-a="?" class="wide">🤷 Can't see</button>`;
}

function typedText(typed) {
  return Array.from({ length: V.LETTERS_PER_LINE }, (_, i) => typed[i] ?? "•").join(" ");
}

function renderTest() {
  const t = app.test;
  const switching = t.phase === "switch";
  $("answers").hidden = switching;
  $("typed").hidden = switching || app.mode !== "letters";
  $("b-continue").hidden = !switching;
  $("letter-box").hidden = switching;
  if (switching) {
    $("test-info").innerHTML = "<h3>Right eye done ✅</h3><p>Now cover your <b>right</b> eye with your palm, then press Continue.</p>";
    return;
  }
  buildPad();
  const cover = t.eye === "Right" ? "left" : "right";
  const how = app.mode === "letters"
    ? "Read the 5 letters from left to right and tap each one below (tap 🤷 if you can't see it)."
    : "Tap the direction the <b>E</b> points.";
  $("test-info").innerHTML = `<p>Testing your <b>${t.eye.toLowerCase()}</b> eye. Cover your <b>${cover}</b> eye with your palm (don't press). ${how}</p>`;
  const px = V.letterHeightMm(t.levels[t.li], app.targetMm / 1000) * app.pxPerMm;
  const box = $("letter");
  if (app.mode === "letters") {
    box.style.gap = `${px * V.GAP_FACTOR}px`;
    box.style.padding = `${Math.max(px * 0.5, 24)}px 10px`;
    box.innerHTML = t.seq.map((c) => letterSvg(c, px)).join("");
    $("typed").textContent = typedText(t.typed);
  } else {
    box.style.gap = "0";
    box.style.padding = `${Math.max(px * 0.4, 24)}px`;
    box.innerHTML = eSvg(px, t.seq[t.pos]);
  }
}

// While testing, hide the letters if the person is too near/far or the face is lost for a while.
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
  if (text !== app.lastGuard) {
    if (text) {
      const status = faceLost ? null : V.distanceStatus(live.mm, app.targetMm);
      speak(faceLost ? "I can't see your face." : status === "near" ? "Too close. Move back." : "Too far. Move closer.");
    } else if (app.lastGuard) {
      speak("Good. Continue.");
    }
    app.lastGuard = text;
  }
  $("test-dist").textContent = live.mm ? `Distance: ${Math.round(live.mm / 10)} cm` : "";
  $("test-dist").className = `signal small ${text ? "bad" : "ok"}`;
}

function finishEye() {
  const t = app.test;
  t.results[t.eye] = t.lastPass;
  if (t.eye === "Right") {
    t.phase = "switch";
    renderTest();
    speak("Right eye done. Now cover your right eye, then press Continue.", true);
  } else {
    showResult();
  }
}

function answer(choice) {
  const t = app.test;
  if (t.phase !== "test" || !$("pause-msg").hidden) return; // ignore taps while paused
  if (choice !== t.seq[t.pos]) t.wrong += 1;
  t.typed.push(choice === "?" ? "?" : choice);
  t.pos += 1;
  if (t.wrong > V.MAX_WRONG_PER_LINE) return finishEye();
  if (t.pos === V.LETTERS_PER_LINE) {
    t.lastPass = t.levels[t.li];
    t.li += 1;
    if (t.li >= t.levels.length) return finishEye();
    t.seq = newSequence();
    t.pos = 0;
    t.wrong = 0;
    t.typed = [];
  }
  renderTest();
}

$("answers").onclick = (e) => {
  const b = e.target.closest("button");
  if (b) answer(b.dataset.a);
};
$("b-continue").onclick = () => beginEye("Left");

// ---- result ----------------------------------------------------------------
const ICON = { green: "🟢", yellow: "🟡", red: "🔴" };

function eyeCard(eye, acuity) {
  const r = V.plainResult(acuity);
  return `<div class="card ${r.level}">
    <div class="card-head"><b>${ICON[r.level]} ${eye} eye: ${r.title}</b>
      <span class="pct">${r.percentText}<small>of normal sight</small></span></div>
    <p>${r.sentence}</p><p>${r.advice}</p>
    <p class="tech">For your doctor: ${r.technical}</p></div>`;
}

function showResult() {
  const { Right, Left } = app.test.results;
  const overall = V.compareEyes(Right, Left);
  const verdict = {
    green: "Overall: your sight looks good.",
    yellow: "Overall: your sight is a little weak - an eye check is a good idea.",
    red: "Overall: your sight is weak - please see an eye doctor.",
  }[overall.level];
  const differ = overall.differ ? " Your two eyes see quite differently, which is worth checking too." : "";
  $("result").innerHTML =
    `<div class="card overall ${overall.level}"><p><b>${ICON[overall.level]} ${verdict}</b>${differ}</p></div>` +
    eyeCard("Right", Right) + eyeCard("Left", Left);
  show("result");
  const sayEye = (eye, a) => { const r = V.plainResult(a); return `${eye} eye: ${r.title}, about ${r.percentText.replace("%+", " percent or more").replace("%", " percent")} of normal sight.`; };
  speak(`${verdict} ${sayEye("Right", Right)} ${sayEye("Left", Left)}`, true);
}

$("b-again").onclick = () => {
  loopRunning = false;
  cam.stopCamera();
  app.live.mm = null;
  app.live.history = [];
  $("near-result").innerHTML = "";
  show("welcome");
};

// ---- nearsightedness estimate (far-point method) ---------------------------
$("b-near").onclick = async () => {
  app.near = { phase: "look", seq: V.newLetterLine(SLOAN), typed: [], capturedMm: null };
  show("near");
  renderNear(); // draw the letters first so they never depend on the camera
  try {
    await cam.attach($("near-video"));
  } catch (err) {
    $("near-dist").textContent = `Camera problem: ${err.message}`;
  }
};

function renderNear() {
  const n = app.near;
  const px = V.NEAR_LETTER_MM * app.pxPerMm;
  const row = $("near-letters");
  row.style.gap = `${px * V.GAP_FACTOR}px`;
  row.innerHTML = n.seq.map((c) => letterSvg(c, px)).join("");
  $("near-entry").hidden = n.phase !== "enter";
  $("b-near-clear").hidden = n.phase !== "look";
  $("near-typed").textContent = typedText(n.typed);
  if (!$("near-pad").dataset.built) {
    $("near-pad").dataset.built = "1";
    $("near-pad").innerHTML = SLOAN.map((c) => `<button data-a="${c}">${c}</button>`).join("") +
      `<button data-a="?" class="wide">🤷 Can't see this letter</button>`;
  }
}

function updateNearUI() {
  const live = app.live;
  const sig = $("near-dist");
  if (app.near.phase === "enter") return; // keep the message from the capture step
  const faceVisible = performance.now() - live.lastFaceAt < 800 && live.mm != null;
  if (live.light == null) {
    sig.textContent = "Camera is not sending video.";
    sig.className = "signal bad";
  } else if (!faceVisible) {
    sig.textContent = "Looking for your face...";
    sig.className = "signal";
  } else if (live.mm < V.NEAR_MIN_MM) {
    sig.textContent = `Too close to measure (${Math.round(live.mm / 10)} cm) - move back a little`;
    sig.className = "signal bad";
    speak("Too close to measure. Move back a little.");
  } else {
    sig.textContent = `Distance: ${Math.round(live.mm / 10)} cm`;
    sig.className = "signal ok";
  }
}

$("b-near-clear").onclick = () => {
  const n = app.near;
  const mm = performance.now() - app.live.lastFaceAt < 1000 ? recentDistanceMm(1200) : null;
  if (mm == null) {
    $("near-dist").textContent = "Can't measure your distance - keep your face in view and try again.";
    $("near-dist").className = "signal bad";
    return;
  }
  if (mm < V.NEAR_MIN_MM) {
    $("near-dist").textContent = "Too close to measure - move back a little and try again.";
    $("near-dist").className = "signal bad";
    return;
  }
  n.capturedMm = mm;
  n.phase = "enter";
  n.typed = [];
  speak("Stay at this distance and tap the letters you can read.", true);
  $("near-dist").textContent = `Measured distance: ${Math.round(mm / 10)} cm. Stay at this distance and read the letters.`;
  $("near-dist").className = "signal ok";
  renderNear();
};

$("near-pad").onclick = (e) => {
  const b = e.target.closest("button");
  const n = app.near;
  if (!b || n.phase !== "enter") return;
  n.typed.push(b.dataset.a);
  if (n.typed.length < V.LETTERS_PER_LINE) return renderNear();
  const correct = n.typed.filter((c, i) => c === n.seq[i]).length;
  const nowMm = performance.now() - app.live.lastFaceAt < 1500 ? app.live.mm : null;
  const moved = nowMm != null && Math.abs(nowMm - n.capturedMm) / n.capturedMm > NEAR_STABLE_RATIO;
  if (correct >= V.LETTERS_PER_LINE - 1 && !moved) {
    $("near-result").innerHTML = nearResultHtml(n.capturedMm);
    return show("result");
  }
  // Not accepted: new letters, ask the person to try again.
  app.near = { phase: "look", seq: V.newLetterLine(SLOAN), typed: [], capturedMm: null };
  renderNear();
  $("near-dist").textContent = moved
    ? "You moved while answering. Hold still at the distance where it first became clear, then try again."
    : "Not quite right - bring the phone a little closer until the letters are really clear, then try again.";
  $("near-dist").className = "signal bad";
  speak(moved ? "You moved. Hold still and try again." : "Not quite right. Bring the phone a little closer and try again.", true);
};

function nearResultHtml(mm) {
  const cm = Math.round(mm / 10);
  const est = V.nearEstimate(mm);
  if (est.kind === "none") {
    speak("You read the tiny letters from arm's length, so strong nearsightedness is unlikely.", true);
    return `<div class="card green"><div class="card-head"><b>🟢 Nearsightedness: unlikely</b></div>
      <p>You read the tiny letters clearly from about <b>${cm} cm</b> (arm's length).</p>
      <p class="tech">This test cannot detect farsightedness or astigmatism.</p></div>`;
  }
  const level = est.label === "mild" ? "yellow" : "red";
  speak(`You can see clearly only up to about ${cm} centimetres. This suggests ${est.label} nearsightedness.`, true);
  return `<div class="card ${level}"><div class="card-head"><b>${ICON[level]} Nearsightedness: ${est.label}</b>
      <span class="pct">-${est.d.toFixed(1)}<small>rough guess</small></span></div>
    <p>Without glasses, things farther than about <b>${cm} cm</b> look blurry to you.</p>
    <p>Rough range: <b>-${est.lo.toFixed(1)} to -${est.hi.toFixed(1)}</b>. An eye doctor can give the exact number.</p>
    <p class="tech">Only a rough guide for nearsightedness (not farsightedness or astigmatism); less reliable over age 40.</p></div>`;
}

$("b-near-back").onclick = () => show("result");

// ---- colour blindness test -------------------------------------------------
const colorState = { idx: 0, typed: "", correct: 0, practiceOk: null, from: "welcome" };

function openColor(from) {
  colorState.from = from;
  $("color-intro").hidden = false;
  $("color-plate").hidden = true;
  $("color-result").hidden = true;
  show("color");
}
$("b-color-start").onclick = () => openColor("welcome");
$("b-color-from-result").onclick = () => openColor("result");

function buildColorPad() {
  const pad = $("color-pad");
  if (pad.dataset.built) return;
  pad.dataset.built = "1";
  pad.innerHTML = [..."1234567890"].map((d) => `<button data-a="${d}">${d}</button>`).join("") +
    `<button data-a="back">⌫</button><button data-a="none" class="wide">Nothing</button><button data-a="ok" class="ok">OK</button>`;
}

function showPlate() {
  const plate = color.PLATES[colorState.idx];
  $("color-progress").textContent = plate.practice
    ? "Practice plate - everyone should see a number"
    : `Plate ${colorState.idx} of ${color.SCORED}`;
  color.drawPlate($("plate-canvas"), plate, Math.min(window.innerWidth - 32, 340), window.devicePixelRatio || 1);
  colorState.typed = "";
  $("color-typed").textContent = "";
}

$("b-color-go").onclick = () => {
  Object.assign(colorState, { idx: 0, typed: "", correct: 0, practiceOk: null });
  $("color-intro").hidden = true;
  $("color-plate").hidden = false;
  buildColorPad();
  showPlate();
};

function submitPlate() {
  const plate = color.PLATES[colorState.idx];
  const right = colorState.typed === plate.number;
  if (plate.practice) colorState.practiceOk = right;
  else if (right) colorState.correct += 1;
  colorState.idx += 1;
  if (colorState.idx < color.PLATES.length) return showPlate();
  const r = color.scoreColor(colorState.correct);
  const unreliable = colorState.practiceOk === false
    ? "<p><b>You could not read the practice plate</b>, so this result may not be reliable. Check the screen brightness and lighting, then try again.</p>" : "";
  $("color-result-card").innerHTML = `<div class="card ${r.level}"><div class="card-head"><b>${ICON[r.level]} ${r.title}</b>
    <span class="pct">${colorState.correct}/${color.SCORED}<small>plates correct</small></span></div><p>${r.text}</p>${unreliable}</div>`;
  $("color-plate").hidden = true;
  $("color-result").hidden = false;
  speak(`${r.title}. You read ${colorState.correct} of ${color.SCORED} plates correctly.`, true);
}

$("color-pad").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const a = b.dataset.a;
  if (a === "back") colorState.typed = colorState.typed.slice(0, -1);
  else if (a === "none") { colorState.typed = ""; return submitPlate(); }
  else if (a === "ok") return submitPlate();
  else if (colorState.typed.length < 2) colorState.typed += a;
  $("color-typed").textContent = colorState.typed;
};

$("b-color-done").onclick = () => show(colorState.from === "result" && app.test?.results?.Left !== undefined ? "result" : "welcome");

// Test hook: open the page with ?debug to drive the app from automated checks.
if (new URLSearchParams(location.search).has("debug")) window.__eyesight = { app, show, renderNear, colorState };
