// The 10 Sloan optotypes (C D H K N O R S V Z), drawn as strokes on a 5x5 grid with stroke width 1,
// so every letter is 5 units tall and its strokes are 1 unit thick (the clinical 5:1 proportion).
// Shapes approximate the standard Sloan design; they are drawn by hand, not copied from a font.
export const SLOAN = ["C", "D", "H", "K", "N", "O", "R", "S", "V", "Z"];

const SHAPES = {
  C: '<path d="M4.436 2 A2 2 0 1 0 4.436 3"/>',
  D: '<path d="M0.5 0.5 H2.5 A2 2 0 0 1 2.5 4.5 H0.5 Z"/>',
  H: '<path d="M0.5 0 V5 M4.5 0 V5 M0.5 2.5 H4.5"/>',
  K: '<path d="M0.5 0 V5 M4.8 -0.1 L1 2.7 M1.9 1.9 L4.8 5.1"/>',
  N: '<path d="M0.5 5 V0 L4.5 5 V0"/>',
  O: '<circle cx="2.5" cy="2.5" r="2"/>',
  R: '<path d="M0.5 5 V0.5 H3 A1.25 1.25 0 0 1 3 3 H0.5 M2.3 3 L4.5 5"/>',
  S: '<path d="M4.4 1.2 C4.2 0.7 3.5 0.5 2.5 0.5 C1.4 0.5 0.5 1 0.5 1.7 C0.5 2.6 1.6 2.5 2.5 2.5 C3.6 2.5 4.5 2.4 4.5 3.3 C4.5 4 3.6 4.5 2.5 4.5 C1.5 4.5 0.8 4.3 0.6 3.8"/>',
  V: '<path d="M0.3 0 L2.5 4.7 L4.7 0"/>',
  Z: '<path d="M0.2 0.5 H4.8 L0.2 4.5 H4.8"/>',
};

export function letterSvg(ch, px) {
  const size = Math.max(Math.round(px), 1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5" width="${size}" height="${size}" ` +
    `fill="none" stroke="#000" stroke-width="1" stroke-linejoin="miter" stroke-miterlimit="10">${SHAPES[ch]}</svg>`;
}
