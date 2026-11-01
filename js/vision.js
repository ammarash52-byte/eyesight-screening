// Core screening logic (no DOM). Same rules as the Python prototype in ../eyesight-app/vision.py.

// Short side of an ISO/IEC 7810 ID-1 card (bank / ID card). The long side (85.6 mm) is wider than most phone screens.
export const CARD_SHORT_MM = 53.98;
export const IRIS_DIAMETER_MM = 11.7;    // average horizontal visible iris diameter
// 0.025-0.08 are extra-large lines (6/240 - 6/75) for very low vision.
export const LEVELS = [0.025, 0.04, 0.05, 0.063, 0.08, 0.1, 0.125, 0.16, 0.2, 0.25, 0.32, 0.4, 0.5, 0.63, 0.8, 1.0, 1.25];
export const GAP_FACTOR = 0.8;            // space between letters, as a fraction of letter size
export const NEAR_LETTER_MM = 1.5;        // fixed letter height for the nearsightedness test
export const NEAR_FAR_ENOUGH_MM = 550;    // reading the tiny letters from here = no real nearsightedness
export const NEAR_MIN_MM = 120;           // closer than this the camera measurement is not trustworthy
export const NEAR_RANGE_D = 0.5;          // +- diopters shown around the estimate
export const LETTERS_PER_LINE = 5;
export const MAX_WRONG_PER_LINE = 1;     // 2 wrong answers fail the line
export const MIN_LETTER_PX = 10;         // smaller is too pixelated to trust
export const DISTANCE_TOLERANCE = 0.08;  // +-8% of target counts as "in the green"
export const DIRECTIONS = ["right", "down", "left", "up"];
export const ROTATION = { right: 0, down: 90, left: 180, up: 270 };

// Decimal acuity 1.0 (6/6) subtends 5 arcmin.
export function letterHeightMm(decimalAcuity, distanceM) {
  const fiveArcminRad = (5 / 60) * Math.PI / 180;
  return (2 * distanceM * 1000 * Math.tan(fiveArcminRad / 2)) / decimalAcuity;
}

// Do `count` letters of `letterPx` fit in a box, wrapping onto extra rows when needed?
export function layoutFits(letterPx, count, boxW, boxH) {
  const gap = letterPx * GAP_FACTOR;
  if (letterPx > boxW) return false;
  const perRow = Math.max(1, Math.floor((boxW + gap) / (letterPx + gap)));
  const rows = Math.ceil(count / perRow);
  return rows * letterPx + (rows - 1) * gap <= boxH;
}

// A line is usable when its letters are sharp (physical pixels) and fit on screen (CSS pixels).
// `view` = { pxPerMm (CSS px), dpr, boxW, boxH, count }.
export function usableLevels(distanceM, view) {
  return LEVELS.filter((lv) => {
    const mm = letterHeightMm(lv, distanceM);
    return mm * view.pxPerMm * view.dpr >= MIN_LETTER_PX &&
      layoutFits(mm * view.pxPerMm, view.count, view.boxW, view.boxH);
  });
}

export function fraction(decimalAcuity) {
  return `6/${Number((6 / decimalAcuity).toFixed(1))}`;
}

// Random directions, never the same one three times in a row.
export function newLine() {
  const seq = [];
  while (seq.length < LETTERS_PER_LINE) {
    const d = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
    if (seq.length >= 2 && seq[seq.length - 1] === seq[seq.length - 2] && seq[seq.length - 1] === d) continue;
    seq.push(d);
  }
  return seq;
}

// Five different Sloan letters (standard charts never repeat a letter within a line).
export function newLetterLine(letters) {
  const pool = [...letters];
  const line = [];
  while (line.length < LETTERS_PER_LINE) line.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return line;
}

// Rough nearsightedness estimate from the distance at which tiny letters first become clear.
// Far point (m) = 1 / myopia (diopters). Only meaningful for nearsightedness.
export function nearEstimate(distanceMmValue) {
  if (distanceMmValue >= NEAR_FAR_ENOUGH_MM) return { kind: "none" };
  const d = 1000 / distanceMmValue;
  const label = d < 3 ? "mild" : d < 6 ? "moderate" : "high";
  return { kind: "myopia", d, lo: Math.max(0, d - NEAR_RANGE_D), hi: d + NEAR_RANGE_D, label };
}

function formatDistance(metres) {
  return metres >= 1 ? `${Number(metres.toFixed(1))} metres` : `${Math.round(metres * 100)} cm`;
}

const BELOW_LARGEST = 0.02; // stand-in decimal acuity when even the largest line could not be read

// Everyday-language version of one eye's result. `decimalAcuity` null = below the largest line.
export function plainResult(decimalAcuity) {
  const a = decimalAcuity ?? BELOW_LARGEST;
  const level = a >= 0.8 ? "green" : a >= 0.5 ? "yellow" : "red";
  const title = { green: "Good", yellow: "A little weak", red: "Weak" }[level];
  const advice = {
    green: "No sign of a problem in this screening.",
    yellow: "An eye check is a good idea - you may need glasses.",
    red: "Please see an eye doctor.",
  }[level];
  let sentence;
  if (decimalAcuity == null) sentence = "You could not read even the biggest letters at this distance.";
  else if (a >= 1) sentence = "Your sight is as good as, or better than, normal.";
  else sentence = `What a person with normal sight can read from 6 metres away, you need to come as close as ${formatDistance(6 * a)} to read.`;
  const percentText = decimalAcuity == null ? "under 3%" : a >= 1 ? "100%+" : `${Math.round(a * 100)}%`;
  const technical = decimalAcuity == null ? "below 6/240" : `${fraction(a)} (decimal ${a})`;
  // One-line form for side-by-side eyes (the 6-metre comparison is stated once above them).
  const short = decimalAcuity == null ? "could not read even the biggest letters"
    : a >= 1 ? "as good as normal, or better"
    : `you need to come as close as ${formatDistance(6 * a)}`;
  return { level, title, advice, sentence, short, percentText, technical };
}

// Overall verdict = the weaker eye; flags when the two eyes differ a lot (2x or more).
export function compareEyes(rightAcuity, leftAcuity) {
  const r = rightAcuity ?? BELOW_LARGEST;
  const l = leftAcuity ?? BELOW_LARGEST;
  const worst = Math.min(r, l);
  const level = worst >= 0.8 ? "green" : worst >= 0.5 ? "yellow" : "red";
  const differ = Math.max(r, l) / worst >= 2;
  return { level, differ };
}

// null means the person could not read even the largest line.
export function grade(decimalAcuity) {
  if (decimalAcuity == null) return ["Significantly reduced", "See an eye doctor soon."];
  if (decimalAcuity >= 0.8) return ["Normal range", "No sign of a problem in this screening."];
  if (decimalAcuity >= 0.5) return ["Mildly reduced", "You may benefit from an eye exam or glasses."];
  if (decimalAcuity >= 0.2) return ["Moderately reduced", "An eye exam is recommended."];
  return ["Significantly reduced", "See an eye doctor soon."];
}

// Pinhole camera model: distance = focal_px * real_size / size_in_pixels.
export function focalFromKnownDistance(irisPx, distanceMm) {
  return (irisPx * distanceMm) / IRIS_DIAMETER_MM;
}

export function distanceMm(focalPx, irisPx) {
  return (focalPx * IRIS_DIAMETER_MM) / irisPx;
}

// Returns "ok", "near" or "far" relative to the target distance.
export function distanceStatus(currentMm, targetMm) {
  const ratio = currentMm / targetMm;
  if (ratio < 1 - DISTANCE_TOLERANCE) return "near";
  if (ratio > 1 + DISTANCE_TOLERANCE) return "far";
  return "ok";
}

// Mean brightness 0-255 -> a rough lighting verdict (front camera auto-exposure makes this approximate).
export function lightStatus(meanBrightness) {
  if (meanBrightness < 70) return "dark";
  if (meanBrightness > 200) return "glare";
  return "ok";
}
