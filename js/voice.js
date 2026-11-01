// Spoken guidance (browser text-to-speech) for people who cannot read the screen comfortably.
const KEY = "voice";
let enabled = true;
try { enabled = localStorage.getItem(KEY) !== "off"; } catch { /* storage blocked */ }
let lastText = "";
let lastAt = 0;
const supported = typeof window !== "undefined" && "speechSynthesis" in window;

export const isSupported = () => supported;
export const isEnabled = () => enabled && supported;

export function setEnabled(value) {
  enabled = value;
  try { localStorage.setItem(KEY, value ? "on" : "off"); } catch { /* storage blocked */ }
  if (!value && supported) window.speechSynthesis.cancel();
}

// Same sentence is not repeated within 8 s unless `force` is set.
export function speak(text, force = false) {
  if (!isEnabled()) return;
  const now = performance.now();
  if (!force && text === lastText && now - lastAt < 8000) return;
  lastText = text;
  lastAt = now;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  u.lang = "en-US";
  window.speechSynthesis.speak(u);
}
