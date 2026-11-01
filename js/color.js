// Ishihara-style colour plates drawn on a canvas (red-green colour vision screening).
// Palettes were checked with a colour-blindness simulation: figure and background are clearly
// different for normal vision but nearly the same hue/lightness for red-green deficiency.
// Dot lightness is jittered so brightness alone cannot give the number away.

const PALETTES = {
  // everyone should read this one (high contrast, no red/green)
  control: { fig: ["#1f3f8f", "#2a4fa5", "#173373"], bg: ["#e8e2cf", "#f0ead8", "#ddd6bf"] },
  orangeOnGreen: { fig: ["#e8794a", "#d96a3c", "#f08f5f"], bg: ["#8aa84f", "#9db863", "#789a43", "#b3c47a"] },
  greenOnOrange: { fig: ["#8aa84f", "#9db863", "#789a43"], bg: ["#e8794a", "#d96a3c", "#f08f5f", "#e48a58"] },
  pinkOnGray: { fig: ["#d98a8a", "#c97777", "#e29c9c"], bg: ["#9a9a8a", "#aaaa9a", "#8a8a7a", "#b8b8a8"] },
};

// First plate is the practice plate; the rest are scored.
export const PLATES = [
  { number: "12", palette: "control", practice: true },
  { number: "8", palette: "orangeOnGreen" },
  { number: "29", palette: "greenOnOrange" },
  { number: "74", palette: "orangeOnGreen" },
  { number: "5", palette: "pinkOnGray" },
  { number: "45", palette: "greenOnOrange" },
  { number: "6", palette: "orangeOnGreen" },
  { number: "16", palette: "pinkOnGray" },
];
export const SCORED = PLATES.filter((p) => !p.practice).length;

export function scoreColor(correct) {
  if (correct >= SCORED - 1) {
    return { level: "green", title: "Normal colour vision (in this screening)", text: "You read almost all the plates correctly." };
  }
  if (correct >= SCORED - 3) {
    return { level: "yellow", title: "Possible mild red-green weakness", text: "You missed several plates. Repeat the test in bright light with the screen at full brightness and no night mode. If it happens again, ask an eye doctor for a proper colour test." };
  }
  return { level: "red", title: "Likely red-green colour vision difference", text: "You missed most of the plates. Please ask an eye doctor for a proper colour vision test." };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jitter(hex, rng) {
  const k = 0.88 + rng() * 0.24;
  const c = [1, 3, 5].map((i) => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// Draw `plate` into `canvas` at `size` CSS pixels.
export function drawPlate(canvas, plate, size, dpr = 1) {
  const rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  // Mask: the number in white on black, sampled at each dot centre.
  const mask = document.createElement("canvas");
  mask.width = mask.height = size;
  const mctx = mask.getContext("2d", { willReadFrequently: true });
  mctx.fillStyle = "#000";
  mctx.fillRect(0, 0, size, size);
  mctx.fillStyle = "#fff";
  const digits = plate.number.length;
  mctx.font = `bold ${size * (digits === 1 ? 0.8 : 0.6)}px Arial, Helvetica, sans-serif`;
  mctx.textAlign = "center";
  mctx.textBaseline = "middle";
  mctx.fillText(plate.number, size / 2, size / 2 + size * 0.03);
  const pixels = mctx.getImageData(0, 0, size, size).data;
  const inside = (x, y) => pixels[(Math.round(y) * size + Math.round(x)) * 4] > 128;

  // Dots: random circle packing (rejection sampling with a grid for fast overlap checks).
  const R = size / 2 - 2;
  const rMax = size * 0.034;
  const rMin = size * 0.011;
  const cell = rMax * 2.2;
  const grid = new Map();
  const dots = [];
  const key = (cx, cy) => `${cx},${cy}`;
  for (let attempt = 0; attempt < 30000; attempt++) {
    const r = rMin + (rMax - rMin) * rng() ** 1.6;
    const ang = rng() * Math.PI * 2;
    const dist = Math.sqrt(rng()) * (R - r);
    const x = size / 2 + Math.cos(ang) * dist;
    const y = size / 2 + Math.sin(ang) * dist;
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    let ok = true;
    for (let i = gx - 1; i <= gx + 1 && ok; i++) {
      for (let j = gy - 1; j <= gy + 1 && ok; j++) {
        for (const d of grid.get(key(i, j)) || []) {
          if (Math.hypot(d.x - x, d.y - y) < d.r + r + 1.2) { ok = false; break; }
        }
      }
    }
    if (!ok) continue;
    const dot = { x, y, r };
    dots.push(dot);
    const k = key(gx, gy);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(dot);
  }

  const pal = PALETTES[plate.palette];
  for (const d of dots) {
    const colors = inside(d.x, d.y) ? pal.fig : pal.bg;
    ctx.fillStyle = jitter(colors[Math.floor(rng() * colors.length)], rng);
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
}
