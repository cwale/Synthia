/* Persistent settings plus a tiny event bus. */

import { debounce } from './util.js';
import { defaultMacros, DEFAULT_CC_MAP } from './audio/macros.js';

const STORAGE_KEY = 'synthia.settings.v2';

export const defaults = {
  version: 2,

  transport: 'auto',              // auto | webmidi | ble | none
  lastDevice: { id: '', name: '' },
  autoReconnect: true,

  // How incoming notes get split between the synth and the pads.
  split: {
    mode: 'channel',              // channel | range | padmap
    padChannel: 10,               // 1-16, as printed on the hardware
    padBaseNote: 36,              // pad 1 note when mode === 'channel'
    padRangeLo: 36,
    padRangeHi: 51,
  },
  padMap: {},                     // "channel:note" -> pad index, filled by Learn
  ccMap: { ...DEFAULT_CC_MAP },   // cc number -> macro name; Learn overwrites

  keyboard: {
    baseNote: 36,                 // leftmost key of the on-screen keyboard
    keyCount: 37,
    octave: 0,                    // on-screen octave shift, in octaves
    transpose: 0,                 // applied to everything, in semitones
    fitAll: false,
  },

  velocity: { curve: 'linear', fixed: 100, scale: 1 },

  scale: { lock: false, root: 0, name: 'majorPentatonic', mode: 'snap' },

  synth: { presetId: 'warm-keys' },

  pads: {
    kitId: 'studio',
    layout: 'mpc',              // mpc = pad 1 bottom-left
    autoAdopt: true,
    rescueZeroVelocity: true,   // treat note-on vel 0 on the pad channel as a hit
    zeroVelocityLevel: 100,
  },

  macros: defaultMacros(),

  master: { volume: 0.85, limiter: true, polyphony: 12 },

  groove: { on: false, patternId: 'boombap', tempo: 96, level: 0.7 },

  arp: { on: false, mode: 'up', rate: '1/8', gate: 0.55, octaves: 1, hold: false },

  bash: {
    soundSet: 'bells',
    maxVolume: 0.62,
    groove: true,
    tempo: 88,
    scaleName: 'majorPentatonic',
    root: 0,
    autoReleaseSec: 3.5,
    softenHighs: true,
    padsAreDrums: true,
  },

  ui: {
    view: 'both',                 // keys | pads | both
    showVisualizer: true,
    haptics: true,
    keepAwake: true,
    labelKeys: true,
  },

  onboarded: false,
  seenLatencyWarning: false,
};

/* ---- deep merge so new settings appear for existing users ---------------- */

function isPlain(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function merge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!isPlain(over)) return out;
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlain(base?.[k]) && isPlain(v) ? merge(base[k], v) : v;
  }
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaults);
    return merge(defaults, JSON.parse(raw));
  } catch {
    return structuredClone(defaults);
  }
}

export const settings = load();

const persist = debounce(() => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode / quota — settings simply won't survive a reload */
  }
}, 400);

/* ---- event bus ----------------------------------------------------------- */

class Emitter {
  #map = new Map();

  on(evt, fn) {
    if (!this.#map.has(evt)) this.#map.set(evt, new Set());
    this.#map.get(evt).add(fn);
    return () => this.off(evt, fn);
  }

  off(evt, fn) {
    this.#map.get(evt)?.delete(fn);
  }

  emit(evt, payload) {
    const set = this.#map.get(evt);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[bus] listener for "${evt}" threw`, err);
      }
    }
  }
}

export const bus = new Emitter();

/** Call after mutating `settings` so the change is saved and broadcast. */
export function commit(scope = '*') {
  persist();
  bus.emit('settings', scope);
}

export function resetSettings() {
  const fresh = structuredClone(defaults);
  for (const k of Object.keys(settings)) delete settings[k];
  Object.assign(settings, fresh);
  commit('reset');
}

export function exportSettings() {
  return JSON.stringify(settings, null, 2);
}

export function importSettings(json) {
  const parsed = JSON.parse(json);
  const merged = merge(defaults, parsed);
  for (const k of Object.keys(settings)) delete settings[k];
  Object.assign(settings, merged);
  commit('import');
}
