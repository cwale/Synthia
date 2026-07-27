/* Shared helpers: maths, music theory, platform sniffing. */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dbToGain = (db) => Math.pow(10, db / 20);

/** Equal-tempered frequency for a MIDI note number. */
export const noteToFreq = (n) => 440 * Math.pow(2, (n - 69) / 12);

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const pitchClassName = (n) => NOTE_NAMES[((n % 12) + 12) % 12];
export const noteLabel = (n) => `${pitchClassName(n)}${Math.floor(n / 12) - 1}`;
export const isBlackKey = (n) => [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12);

export const SCALES = {
  chromatic: { name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  majorPentatonic: { name: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  minorPentatonic: { name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  major: { name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'Natural minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  mixolydian: { name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  lydian: { name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  blues: { name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  hirajoshi: { name: 'Hirajoshi', steps: [0, 2, 3, 7, 8] },
  wholeTone: { name: 'Whole tone', steps: [0, 2, 4, 6, 8, 10] },
};

/**
 * Bend a note onto a scale.
 *  - 'snap' finds the nearest scale tone, keeping the player in the same register.
 *    Adjacent keys can collide on one pitch, which is exactly what you want when a
 *    toddler is playing: the register stays sane and nothing sounds wrong.
 *  - 'fold' maps each chromatic step to the next scale degree, so every key is a
 *    distinct rising pitch. Musical, but sweeps a much wider range.
 */
export function quantiseToScale(note, rootPc = 0, scaleKey = 'majorPentatonic', mode = 'snap') {
  const scale = SCALES[scaleKey] || SCALES.chromatic;
  const steps = scale.steps;
  if (steps.length === 12) return note;

  if (mode === 'fold') {
    const base = 36;
    const idx = note - base;
    const n = steps.length;
    const oct = Math.floor(idx / n);
    const deg = ((idx % n) + n) % n;
    return base + rootPc + steps[deg] + 12 * oct;
  }

  // snap: search outwards for the closest pitch in the scale, rounding down on ties
  for (let d = 0; d <= 6; d++) {
    for (const cand of d === 0 ? [note] : [note - d, note + d]) {
      const pc = (((cand - rootPc) % 12) + 12) % 12;
      if (steps.includes(pc)) return cand;
    }
  }
  return note;
}

/** Velocity curves. Returns 0..1. */
export function shapeVelocity(vel, curve = 'linear', fixed = 100, scale = 1) {
  let v = clamp(vel / 127, 0, 1);
  switch (curve) {
    case 'fixed': v = clamp(fixed / 127, 0, 1); break;
    case 'soft': v = Math.pow(v, 0.6); break;   // easier to play loud
    case 'hard': v = Math.pow(v, 1.8); break;   // more dynamic range up top
    case 'linear': default: break;
  }
  return clamp(v * scale, 0, 1);
}

export function debounce(fn, ms = 200) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const uid = () => Math.random().toString(36).slice(2, 10);

/* ---- platform detection -------------------------------------------------- */

const ua = navigator.userAgent || '';

export const platform = {
  /** iPadOS 13+ reports as Mac, so also check for touch. */
  isIOS: /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1),
  isAndroid: /Android/.test(ua),
  /** True inside a real Safari/WebKit shell (includes Chrome-on-iOS). */
  isWebKitOnly: /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua),
  hasWebMidi: typeof navigator.requestMIDIAccess === 'function',
  hasWebBluetooth: !!(navigator.bluetooth && navigator.bluetooth.requestDevice),
  standalone:
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true,
  /** Known third-party iOS browsers that fill the gaps Safari leaves. */
  isBluefy: /Bluefy/i.test(ua),
  isWebMidiBrowser: /WebMIDIBrowser/i.test(ua),
};

export function describePlatform() {
  if (platform.hasWebMidi && platform.hasWebBluetooth) return 'full';
  if (platform.hasWebMidi) return 'webmidi-only';
  if (platform.hasWebBluetooth) return 'bluetooth-only';
  return 'touch-only';
}

/** Short haptic tick, where supported. Silently ignored elsewhere. */
export function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}
