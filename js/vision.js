// Core screening logic (no DOM). Same rules as the Python prototype in ../eyesight-app/vision.py.

export const CARD_WIDTH_MM = 85.6;       // ISO/IEC 7810 ID-1 card width
export const IRIS_DIAMETER_MM = 11.7;    // average horizontal visible iris diameter
export const LEVELS = [0.1, 0.125, 0.16, 0.2, 0.25, 0.32, 0.4, 0.5, 0.63, 0.8, 1.0, 1.25];
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

export function usableLevels(distanceM, pxPerMm) {
  return LEVELS.filter((lv) => letterHeightMm(lv, distanceM) * pxPerMm >= MIN_LETTER_PX);
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
