/* The parameters a physical knob or fader can drive.

   Twelve targets, all normalised 0..1 so any CC maps onto any of them. The
   first four are the on-screen knobs; the remaining eight exist for hardware
   with more controls than the phone has room to show.

   `neutral` is the value at which a target does nothing, which is what makes a
   half-open knob feel like "off" rather than "already doing something". */

export const MACRO_TARGETS = [
  { key: 'cutoff', name: 'Tone', blurb: 'Filter cutoff — the main brightness control.', neutral: 0.75, onScreen: true },
  { key: 'resonance', name: 'Bite', blurb: 'Filter resonance. Squelch at the top.', neutral: 0.18, onScreen: true },
  { key: 'reverb', name: 'Space', blurb: 'Reverb send.', neutral: 0.3, onScreen: true },
  { key: 'delay', name: 'Echo', blurb: 'Delay send, timed to the tempo.', neutral: 0.12, onScreen: true },

  { key: 'attack', name: 'Attack', blurb: 'Slows the start of every note. Off at zero.', neutral: 0 },
  { key: 'release', name: 'Release', blurb: 'How long notes ring after you let go.', neutral: 0.5 },
  { key: 'filterEnv', name: 'Sweep', blurb: 'How far the filter envelope opens.', neutral: 0.5 },
  { key: 'lfoRate', name: 'Wobble rate', blurb: 'Speed of the patch LFO.', neutral: 0.5 },
  { key: 'lfoDepth', name: 'Wobble', blurb: 'Adds vibrato/wobble to any patch.', neutral: 0 },
  { key: 'drive', name: 'Grit', blurb: 'Master overdrive. Gets nasty.', neutral: 0 },
  { key: 'width', name: 'Width', blurb: 'Chorus and stereo spread.', neutral: 0.5 },
  { key: 'volume', name: 'Volume', blurb: 'Master level.', neutral: 0.85 },
];

export const MACRO_BY_KEY = new Map(MACRO_TARGETS.map((m) => [m.key, m]));

/** The four that get an on-screen knob, in order. */
export const ON_SCREEN_MACROS = MACRO_TARGETS.filter((m) => m.onScreen);

export function defaultMacros() {
  const out = {};
  for (const m of MACRO_TARGETS) out[m.key] = m.neutral;
  return out;
}

/**
 * Factory CC assignments for an M-VAVE SMK-37, which is what this was built
 * for. Faders 1-4 drive the four on-screen knobs; K1-K8 drive the rest.
 *
 * The faders sit on CC64-67, which in the MIDI spec are the pedal controllers
 * (sustain, portamento, sostenuto, soft). A mapping here deliberately wins over
 * that built-in meaning — see MidiHub._controlChange.
 */
export const DEFAULT_CC_MAP = {
  64: 'cutoff',
  65: 'resonance',
  66: 'reverb',
  67: 'delay',

  48: 'attack',
  49: 'release',
  50: 'filterEnv',
  51: 'lfoRate',
  52: 'lfoDepth',
  53: 'drive',
  54: 'width',
  55: 'volume',
};

/* ---- how each target bends the patch --------------------------------------

   Applied per voice at note-on, except the ones marked live in main.js
   (cutoff, resonance, drive, volume and the two sends), which take effect
   immediately. Each returns a neutral result at the target's neutral value. */

export function shapeAmpEnvelope(amp, macros) {
  return {
    a: amp.a + (macros.attack ?? 0) * 1.6,
    d: amp.d,
    s: amp.s,
    r: amp.r * (0.3 + (macros.release ?? 0.5) * 1.4),
  };
}

export const filterEnvScale = (macros) => (macros.filterEnv ?? 0.5) * 2;
export const lfoRateScale = (macros) => 0.25 + (macros.lfoRate ?? 0.5) * 1.5;
export const lfoDepthBoost = (macros) => (macros.lfoDepth ?? 0) * 0.9;
export const widthScale = (macros) => (macros.width ?? 0.5) * 2;
