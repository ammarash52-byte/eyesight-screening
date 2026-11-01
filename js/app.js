import * as V from "./vision.js";
import * as cam from "./camera.js";
import { SLOAN, letterSvg } from "./letters.js";
import * as voice from "./voice.js";
import * as color from "./color.js";
import * as ui from "./ui.js";

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
  const on = voice.isEnabled();
  $("b-voice").dataset.on = String(on);
  $("b-voice").querySelector("span").textContent = on ? "Voice on" : "Voice off";
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
  ui.setProgress(name);
  window.scrollTo(0, 0);
}

// ---- static artwork and distance rings ----------------------------------------
$("brand-mark").innerHTML = ui.brandMarkup();
$("hero-iris").innerHTML = ui.irisMarkup();
ui.mountFocus($("focus-setup"));
ui.mountFocus($("focus-near"));
ui.mountFocus($("focus-pause"), { compact: true });

// ---- screen calibration ----------------------------------------------------
$("b-welcome").onclick = () => {
  if (app.pxPerMm) $("card-slider").value = Math.round(app.pxPerMm * V.CARD_SHORT_MM);
  setBar($("card-slider").value);
  show("screen");
};
function setBar(px) { $("card-bar").style.width = `${px}px`; }
$("card-slider").oninput = (e) => setBar(e.target.value);
$("b-screen").onclick = async () => {
  app.pxPerMm = Number($("card-slider").value) / V.CARD_SHORT_MM;
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

function distanceMessage(status) {
  if (status === "near") return "Too close. Move back.";
  if (status === "far") return "Too far. Move closer.";
  return "Perfect. Hold still.";
}

function updateSetupUI() {
  const live = app.live;
  const faceVisible = performance.now() - live.lastFaceAt < 800 && live.mm != null;
  let distOk = false;
  if (live.light == null) {
    ui.setFocus($("focus-setup"), { status: "search", hint: "The camera is not sending video. Go back and press Retry camera." });
  } else if (!faceVisible) {
    ui.setFocus($("focus-setup"), { status: "search", hint: "Looking for your face..." });
  } else {
    const status = V.distanceStatus(live.mm, app.targetMm);
    distOk = status === "ok";
    ui.setFocus($("focus-setup"), { status, mm: live.mm, targetMm: app.targetMm, hint: distanceMessage(status) });
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
  lightEl.textContent = { dark: "Too dark. Turn on more light.", glare: "Too much glare. Reduce direct light.", ok: "Lighting looks fine." }[ls] || "";
  lightEl.className = `signal small ${ls === "ok" ? "ok" : ls ? "bad" : ""}`;
  if (distOk && ls === "ok") $("dist-signal").textContent = "";
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
    $("dist-signal").textContent = "This screen is too small for this distance. Choose a different distance.";
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
  pad.className = app.mode === "letters" ? "pad pad-letters" : "pad pad-e";
  pad.innerHTML = app.mode === "letters"
    ? SLOAN.map((c) => `<button data-a="${c}">${c}</button>`).join("") +
      `<button data-a="?" class="wide">I can't see this letter</button>`
    : `<button data-a="up" aria-label="Up">↑</button><button data-a="left" aria-label="Left">←</button><button data-a="right" aria-label="Right">→</button>
       <button data-a="down" aria-label="Down">↓</button><button data-a="?" class="wide">I can't see it</button>`;
}

function renderTest() {
  const t = app.test;
  const switching = t.phase === "switch";
  $("answers").hidden = switching;
  $("typed").hidden = switching || app.mode !== "letters";
  $("b-continue").hidden = !switching;
  $("letter-box").hidden = switching;
  $("test-info").classList.toggle("switch", switching);
  if (switching) {
    $("test-info").innerHTML = `<h3>Right eye done</h3>${ui.coverMarkup("right")}<p>Now cover your <b>right</b> eye with your palm, then press Continue.</p>`;
    return;
  }
  buildPad();
  const cover = t.eye === "Right" ? "left" : "right";
  const how = app.mode === "letters"
    ? "Read the 5 letters from left to right and tap each one below."
    : "Tap the direction the <b>E</b> points.";
  $("test-info").innerHTML = `${ui.coverMarkup(cover)}<p>Testing your <b>${t.eye.toLowerCase()}</b> eye. Cover your <b>${cover}</b> eye with your palm, without pressing. ${how}</p>`;
  const px = V.letterHeightMm(t.levels[t.li], app.targetMm / 1000) * app.pxPerMm;
  const box = $("letter");
  if (app.mode === "letters") {
    box.style.gap = `${px * V.GAP_FACTOR}px`;
    box.style.padding = `${Math.max(px * 0.5, 24)}px 10px`;
    box.innerHTML = t.seq.map((c) => letterSvg(c, px)).join("");
    ui.renderSlots($("typed"), t.typed, V.LETTERS_PER_LINE);
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
  let status = "search";
  if (faceLost) {
    text = "Can't see your face. Look at the screen and keep your head in view.";
  } else {
    status = V.distanceStatus(live.mm, app.targetMm);
    if (status !== "ok") text = distanceMessage(status);
  }
  msg.hidden = !text;
  $("pause-text").textContent = text;
  if (text) ui.setFocus($("focus-pause"), { status, mm: live.mm, targetMm: app.targetMm });
  if (text !== app.lastGuard) {
    if (text) {
      speak(faceLost ? "I can't see your face." : status === "near" ? "Too close. Move back." : "Too far. Move closer.");
    } else if (app.lastGuard) {
      speak("Good. Continue.");
    }
    app.lastGuard = text;
  }
  $("test-dist").textContent = live.mm ? `Distance ${Math.round(live.mm / 10)} cm` : "";
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
  if (!b) return;
  ui.tap(b);
  answer(b.dataset.a);
};
$("b-continue").onclick = () => beginEye("Left");

// ---- result ----------------------------------------------------------------
function gaugeFor(eye, acuity) {
  const r = V.plainResult(acuity);
  const percent = acuity == null ? 2 : Math.min(100, Math.round(Math.min(acuity, 1) * 100));
  return ui.gaugeMarkup({ percent, display: r.percentText, level: r.level, label: `${eye} eye`, verdict: r.title });
}

function meaningBlock(results) {
  const rows = ["Right", "Left"].map((eye) => `<li><b>${eye} eye:</b> ${V.plainResult(results[eye]).short}.</li>`).join("");
  return `<h3>What this means</h3><p>A person with normal sight can read these letters from 6 metres away.</p><ul class="eyes">${rows}</ul>`;
}

function showResult() {
  const { Right, Left } = app.test.results;
  const overall = V.compareEyes(Right, Left);
  const verdict = {
    green: "Your sight looks good.",
    yellow: "Your sight is a little weak. An eye check is a good idea.",
    red: "Your sight is weak. Please see an eye doctor.",
  }[overall.level];
  const differ = overall.differ ? "Your two eyes see quite differently, which is worth checking too." : "";
  const technical = ["Right", "Left"].map((eye) => `<span>${eye}: ${V.plainResult(app.test.results[eye]).technical}</span>`).join("");
  $("result").innerHTML =
    `<div class="verdict ${overall.level}"><span class="dot"></span><p>${verdict}${differ ? `<small>${differ}</small>` : ""}</p></div>` +
    `<div class="gauges">${gaugeFor("Right", Right)}${gaugeFor("Left", Left)}</div>` +
    `<div class="meaning">${meaningBlock(app.test.results)}</div>` +
    `<p class="doctor">For your doctor: ${technical}</p>`;
  show("result");
  ui.animateGauges($("result"));
  const sayEye = (eye, a) => { const r = V.plainResult(a); return `${eye} eye: ${r.title}, about ${r.percentText.replace("%+", " percent or more").replace("%", " percent")} of normal sight.`; };
  speak(`${verdict} ${sayEye("Right", Right)} ${sayEye("Left", Left)}`, true);
  $("near-result").innerHTML = "";
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
  ui.renderSlots($("near-typed"), n.typed, V.LETTERS_PER_LINE);
  if (!$("near-pad").dataset.built) {
    $("near-pad").dataset.built = "1";
    $("near-pad").innerHTML = SLOAN.map((c) => `<button data-a="${c}">${c}</button>`).join("") +
      `<button data-a="?" class="wide">I can't see this letter</button>`;
  }
}

function updateNearUI() {
  const live = app.live;
  const ring = $("focus-near");
  const faceVisible = performance.now() - live.lastFaceAt < 800 && live.mm != null;
  if (app.near.phase === "enter") {
    if (faceVisible) ui.setFocus(ring, { status: "ok", mm: live.mm, targetMm: app.near.capturedMm, hint: "Stay at this distance." });
    return;
  }
  if (live.light == null) {
    ui.setFocus(ring, { status: "search", hint: "The camera is not sending video." });
  } else if (!faceVisible) {
    ui.setFocus(ring, { status: "search", hint: "Looking for your face..." });
  } else if (live.mm < V.NEAR_MIN_MM) {
    ui.setFocus(ring, { status: "near", mm: live.mm, targetMm: 300, hint: "Too close to measure. Move back a little." });
    speak("Too close to measure. Move back a little.");
  } else {
    ui.setFocus(ring, { status: "info", mm: live.mm, targetMm: 300, hint: "Bring the phone closer until the letters are clear." });
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
  $("near-dist").textContent = `Measured distance: ${Math.round(mm / 10)} cm. Stay at this distance and tap the letters.`;
  $("near-dist").className = "signal ok";
  renderNear();
};

$("near-pad").onclick = (e) => {
  const b = e.target.closest("button");
  const n = app.near;
  if (!b || n.phase !== "enter") return;
  ui.tap(b);
  n.typed.push(b.dataset.a);
  if (n.typed.length < V.LETTERS_PER_LINE) return renderNear();
  const correct = n.typed.filter((c, i) => c === n.seq[i]).length;
  const nowMm = performance.now() - app.live.lastFaceAt < 1500 ? app.live.mm : null;
  const moved = nowMm != null && Math.abs(nowMm - n.capturedMm) / n.capturedMm > NEAR_STABLE_RATIO;
  if (correct >= V.LETTERS_PER_LINE - 1 && !moved) {
    $("near-result").innerHTML = nearResultHtml(n.capturedMm);
    show("result");
    $("near-result").scrollIntoView?.({ behavior: "smooth", block: "start" });
    return;
  }
  // Not accepted: new letters, ask the person to try again.
  app.near = { phase: "look", seq: V.newLetterLine(SLOAN), typed: [], capturedMm: null };
  renderNear();
  $("near-dist").textContent = moved
    ? "You moved while answering. Hold still at the distance where it first became clear, then try again."
    : "Not quite right. Bring the phone a little closer until the letters are really clear, then try again.";
  $("near-dist").className = "signal bad";
  speak(moved ? "You moved. Hold still and try again." : "Not quite right. Bring the phone a little closer and try again.", true);
};

function nearResultHtml(mm) {
  const cm = Math.round(mm / 10);
  const est = V.nearEstimate(mm);
  if (est.kind === "none") {
    speak("You read the tiny letters from arm's length, so strong nearsightedness is unlikely.", true);
    return `<div class="panel"><div class="panel-head"><h3><span class="dot green"></span>Nearsightedness: unlikely</h3></div>
      <p>You read the tiny letters clearly from about <b>${cm} cm</b>, which is arm's length.</p>
      <p class="fine">This test cannot detect farsightedness or astigmatism.</p></div>`;
  }
  const level = est.label === "mild" ? "yellow" : "red";
  speak(`You can see clearly only up to about ${cm} centimetres. This suggests ${est.label} nearsightedness.`, true);
  return `<div class="panel"><div class="panel-head"><h3><span class="dot ${level}"></span>Nearsightedness: ${est.label}</h3>
      <div class="big-number">-${est.d.toFixed(1)}<small>rough guess</small></div></div>
    <p>Without glasses, things farther than about <b>${cm} cm</b> look blurry to you.</p>
    <p>Rough range: <b>-${est.lo.toFixed(1)} to -${est.hi.toFixed(1)}</b>. An eye doctor can give the exact number.</p>
    <p class="fine">Only a rough guide for nearsightedness, not for farsightedness or astigmatism. Less reliable over age 40.</p></div>`;
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
    `<button data-a="back" aria-label="Delete">⌫</button><button data-a="none" class="wide">Nothing</button><button data-a="ok" class="ok">OK</button>`;
}

function showPlate() {
  const plate = color.PLATES[colorState.idx];
  $("color-progress").textContent = plate.practice
    ? "Practice plate. Everyone should see a number."
    : `Plate ${colorState.idx} of ${color.SCORED}`;
  color.drawPlate($("plate-canvas"), plate, Math.min(window.innerWidth - 36, 340), window.devicePixelRatio || 1);
  colorState.typed = "";
  ui.renderSlots($("color-typed"), [], 2);
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
  $("color-result-card").innerHTML = `<div class="color-result">
    ${ui.ringMarkup({ fraction: colorState.correct / color.SCORED, level: r.level, big: `${colorState.correct}/${color.SCORED}`, small: "plates" })}
    <div><h3>${r.title}</h3><p>${r.text}</p>${unreliable}</div></div>`;
  $("color-plate").hidden = true;
  $("color-result").hidden = false;
  ui.animateGauges($("color-result-card"));
  window.scrollTo(0, 0);
  speak(`${r.title}. You read ${colorState.correct} of ${color.SCORED} plates correctly.`, true);
}

$("color-pad").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const a = b.dataset.a;
  ui.tap(b);
  if (a === "back") colorState.typed = colorState.typed.slice(0, -1);
  else if (a === "none") { colorState.typed = ""; return submitPlate(); }
  else if (a === "ok") return submitPlate();
  else if (colorState.typed.length < 2) colorState.typed += a;
  ui.renderSlots($("color-typed"), [...colorState.typed], 2);
};

const leaveColor = () => show(colorState.from === "result" && app.test?.results?.Left !== undefined ? "result" : "welcome");
$("b-color-done").onclick = leaveColor;
$("b-color-intro-back").onclick = leaveColor;

// Test hook: open the page with ?debug to drive the app from automated checks.
if (new URLSearchParams(location.search).has("debug")) window.__eyesight = { app, show, renderNear, colorState, ui };
