// Visual building blocks: focus ring (distance guide), result gauges, answer slots, pictograms.

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---- iris artwork (welcome hero + brand mark) ------------------------------
export function irisMarkup() {
  const spokes = Array.from({ length: 72 }, (_, i) => {
    const a = (i / 72) * Math.PI * 2;
    const r1 = 40 + (i % 3) * 3;
    const r2 = 96 - (i % 4) * 4;
    const tone = i % 5 === 0 ? "#6f7ee6" : i % 3 === 0 ? "#4a5ac9" : "#2f3d99";
    return `<line x1="${(120 + Math.cos(a) * r1).toFixed(1)}" y1="${(120 + Math.sin(a) * r1).toFixed(1)}" x2="${(120 + Math.cos(a) * r2).toFixed(1)}" y2="${(120 + Math.sin(a) * r2).toFixed(1)}" stroke="${tone}" stroke-width="${i % 2 ? 2.2 : 3.2}" stroke-linecap="round"/>`;
  }).join("");
  const flecks = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2 + 0.08;
    return `<line x1="${(120 + Math.cos(a) * 44).toFixed(1)}" y1="${(120 + Math.sin(a) * 44).toFixed(1)}" x2="${(120 + Math.cos(a) * 58).toFixed(1)}" y2="${(120 + Math.sin(a) * 58).toFixed(1)}" stroke="#f0a030" stroke-width="3" stroke-linecap="round" opacity=".85"/>`;
  }).join("");
  return `<svg class="iris" viewBox="0 0 240 240" role="img" aria-label="Illustration of an eye focusing">
    <defs><radialGradient id="irisGlow" cx="50%" cy="50%" r="50%"><stop offset="55%" stop-color="#e4e8fb" stop-opacity="0"/><stop offset="100%" stop-color="#2f3d99" stop-opacity=".25"/></radialGradient></defs>
    <circle cx="120" cy="120" r="104" fill="#f4f6fd"/>
    <g class="iris-spokes">${spokes}${flecks}</g>
    <circle cx="120" cy="120" r="104" fill="url(#irisGlow)"/>
    <circle cx="120" cy="120" r="103" fill="none" stroke="#222d78" stroke-width="5"/>
    <circle class="iris-pupil" cx="120" cy="120" r="36" fill="#0d1520"/>
    <circle cx="106" cy="106" r="9" fill="#fff" opacity=".9"/>
    <circle class="iris-lock" cx="120" cy="120" r="112" fill="none" stroke="#f0a030" stroke-width="3"/>
  </svg>`;
}

export function brandMarkup() {
  return `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="#2f3d99"/><circle cx="16" cy="16" r="8" fill="none" stroke="#f0a030" stroke-width="2.5" stroke-dasharray="3 3"/><circle cx="16" cy="16" r="4" fill="#0d1520"/></svg>`;
}

// ---- focus ring: the distance guide ---------------------------------------
export function mountFocus(el, { compact = false } = {}) {
  el.innerHTML = `<div class="focus${compact ? " compact" : ""}" data-state="search">
    <div class="focus-dial">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle class="f-track" cx="100" cy="100" r="62"/>
        <circle class="f-halo" cx="100" cy="100" r="62"/>
        <g class="f-live"><circle class="f-ring" cx="100" cy="100" r="62"/></g>
      </svg>
      <div class="focus-readout"><b>-</b><span>cm</span></div>
    </div>
    <p class="focus-hint" aria-live="polite"></p>
  </div>`;
}

// status: "search" | "near" | "far" | "ok" | "info". The ring grows as the person comes closer.
export function setFocus(el, { status, mm = null, targetMm = null, hint = "" }) {
  const root = el.querySelector(".focus");
  if (!root) return;
  if (root.dataset.state !== status) root.dataset.state = status;
  const live = root.querySelector(".f-live");
  const reference = targetMm ?? 400;
  const scale = mm && status !== "search" ? clamp(reference / mm, 0.45, 1.6) : 1;
  live.style.transform = `scale(${scale.toFixed(3)})`;
  root.querySelector(".focus-readout b").textContent = mm && status !== "search" ? Math.round(mm / 10) : "-";
  root.querySelector(".focus-hint").textContent = hint;
}

// ---- result gauge ----------------------------------------------------------
const TICKS = [0.5, 0.8];

export function gaugeMarkup({ percent, display, level, label, verdict }) {
  const ticks = TICKS.map((p) => {
    const th = Math.PI * (1 - p);
    const x1 = 60 + Math.cos(th) * 43;
    const y1 = 60 - Math.sin(th) * 43;
    const x2 = 60 + Math.cos(th) * 57;
    const y2 = 60 - Math.sin(th) * 57;
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="g-tick"/>`;
  }).join("");
  const numeric = /^\d+%$/.test(display);
  const shown = numeric ? "0" : display.replace("%", "");
  return `<figure class="gauge ${level}" data-percent="${percent}">
    <div class="gauge-dial">
      <svg viewBox="0 0 120 68" aria-hidden="true">
        <path class="g-track" d="M10 60 A50 50 0 0 1 110 60"/>
        <path class="g-value" d="M10 60 A50 50 0 0 1 110 60" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
        ${ticks}
      </svg>
      <div class="gauge-num"><b${numeric ? ` data-count="${parseInt(display, 10)}"` : ""}>${shown}</b><small>%</small></div>
    </div>
    <figcaption><strong>${label}</strong><span class="pill ${level}">${verdict}</span></figcaption>
  </figure>`;
}

// Donut with a big label (used for the colour test score).
export function ringMarkup({ fraction, level, big, small }) {
  return `<div class="ring ${level}" data-fraction="${fraction}">
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle class="g-track" cx="50" cy="50" r="42" pathLength="100"/>
      <circle class="g-value" cx="50" cy="50" r="42" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" transform="rotate(-90 50 50)"/>
    </svg>
    <div class="ring-num"><b>${big}</b><small>${small}</small></div>
  </div>`;
}

function countUp(el, to) {
  if (reduceMotion()) { el.textContent = to; return; }
  const start = performance.now();
  const dur = 1000;
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    el.textContent = Math.round(to * (1 - (1 - t) ** 3));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Fill gauges/rings after they are in the DOM so the transition plays (a reveal triggered by finishing a test).
export function animateGauges(root) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelectorAll(".gauge").forEach((g) => {
      g.querySelector(".g-value").style.strokeDashoffset = String(100 - Number(g.dataset.percent));
      const b = g.querySelector("[data-count]");
      if (b) countUp(b, Number(b.dataset.count));
    });
    root.querySelectorAll(".ring").forEach((r) => {
      r.querySelector(".g-value").style.strokeDashoffset = String(100 - Number(r.dataset.fraction) * 100);
    });
  }));
}

// ---- answer slots ------------------------------------------------------------
export function renderSlots(el, items, total) {
  const previous = Number(el.dataset.len || 0);
  el.innerHTML = Array.from({ length: total }, (_, i) => {
    const cls = ["slot", i < items.length ? "filled" : "", i === items.length ? "next" : "", i === items.length - 1 && items.length > previous ? "pop" : ""].join(" ");
    return `<span class="${cls.trim()}">${items[i] ?? ""}</span>`;
  }).join("");
  el.dataset.len = items.length;
}

export function tap(button) {
  try { navigator.vibrate?.(8); } catch { /* not supported */ }
  button.classList.add("hit");
  setTimeout(() => button.classList.remove("hit"), 150);
}

// ---- which eye to cover ------------------------------------------------------
// Drawn like a mirror: the person's left eye is on the left of the picture.
export function coverMarkup(side) {
  const eye = (cx, covered) => covered
    ? `<g class="cv-hand"><rect x="${cx - 24}" y="14" width="48" height="40" rx="14"/><path d="M${cx - 12} 22v12M${cx} 20v16M${cx + 12} 22v12" /></g>`
    : `<g><path class="cv-eye" d="M${cx - 24} 34 Q${cx} 12 ${cx + 24} 34 Q${cx} 56 ${cx - 24} 34Z"/><circle cx="${cx}" cy="34" r="9" class="cv-iris"/><circle cx="${cx}" cy="34" r="4" class="cv-pupil"/></g>`;
  return `<svg class="cover" viewBox="0 0 150 68" role="img" aria-label="Cover your ${side} eye with your palm">
    ${eye(38, side === "left")}${eye(112, side === "right")}</svg>`;
}

// ---- progress ----------------------------------------------------------------
const STEP = { screen: 1, camera: 2, setup: 3, test: 4, result: 5 };

export function setProgress(screen) {
  const bar = document.getElementById("progress");
  if (!bar) return;
  const step = STEP[screen] ?? 0;
  bar.hidden = screen === "welcome" || screen === "near" || screen === "color";
  bar.setAttribute("aria-valuenow", String(step));
  bar.querySelectorAll("i").forEach((seg, i) => seg.classList.toggle("on", i < step));
}
