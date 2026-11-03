import { ACOUSTIC_PRESETS } from './acoustic-presets.js';
import { GENRE_PRESETS } from './genre-presets.js';

/* Synth patches. `send` values seed the reverb/delay macros when a patch is
   loaded, the way a hardware preset recalls its effect levels. */

const SYNTH_PRESETS = [
  {
    id: 'glass-bells',
    name: 'Glass Bells',
    category: 'Bells',
    color: '#63d7e8',
    blurb: 'FM bell that rings out. Toddler-proof — always pretty.',
    gain: 0.17,
    oscs: [{ type: 'sine', semi: 0, cents: 0, level: 1 }],
    sub: { type: 'sine', level: 0, octave: -1 },
    noise: 0,
    fm: { type: 'sine', ratio: 3.01, index: 820, decay: 0.55 },
    filter: { type: 'lowpass', hz: 6500, q: 0.7, env: 0, keytrack: 0.2, envA: 0.001, envD: 0.2, envS: 1, envR: 0.2 },
    amp: { a: 0.002, d: 1.7, s: 0, r: 0.7 },
    vel: { amp: 0.7, filter: 0 },
    chorus: 0.22,
    send: { reverb: 0.45, delay: 0.18 },
    macroCutoff: 0.85,
    panSpread: 0.3,
  },
  {
    id: 'velvet-pad',
    name: 'Velvet Pad',
    category: 'Pads',
    color: '#a98cf0',
    blurb: 'Slow swell, wide and lush. Hold a chord and float.',
    gain: 0.13,
    oscs: [
      { type: 'sawtooth', semi: 0, cents: -8, level: 0.55 },
      { type: 'sawtooth', semi: 0, cents: 9, level: 0.55 },
      { type: 'triangle', semi: 12, cents: 0, level: 0.25 },
    ],
    sub: { type: 'sine', level: 0.22, octave: -1 },
    noise: 0.015,
    filter: { type: 'lowpass', hz: 850, q: 2.4, env: 1400, keytrack: 0.25, envA: 0.6, envD: 1.4, envS: 0.6, envR: 1.2 },
    amp: { a: 0.55, d: 1.2, s: 0.75, r: 1.7 },
    lfo: { type: 'sine', rate: 0.28, target: 'filter', amount: 0.22, delay: 1.2 },
    unison: { voices: 3, spread: 13 },
    vel: { amp: 0.45, filter: 0.4 },
    chorus: 0.55,
    send: { reverb: 0.6, delay: 0.2 },
    macroCutoff: 0.66,
    panSpread: 0.5,
  },
  {
    id: 'rubber-bass',
    name: 'Rubber Bass',
    category: 'Bass',
    color: '#f06a7a',
    blurb: 'Mono, squelchy, with glide. Play it low.',
    gain: 0.26,
    mono: true,
    glide: 0.055,
    oscs: [
      { type: 'sawtooth', semi: 0, cents: 0, level: 0.8 },
      { type: 'square', semi: 0, cents: -6, level: 0.4 },
    ],
    sub: { type: 'sine', level: 0.5, octave: -1 },
    noise: 0,
    filter: { type: 'lowpass', hz: 420, q: 7, env: 2400, keytrack: 0.4, envA: 0.004, envD: 0.22, envS: 0.15, envR: 0.15 },
    amp: { a: 0.004, d: 0.2, s: 0.42, r: 0.16 },
    vel: { amp: 0.6, filter: 0.8 },
    send: { reverb: 0.06, delay: 0.04 },
    macroCutoff: 0.6,
    panSpread: 0,
  },
  {
    id: 'supersaw',
    name: 'Supersaw Lead',
    category: 'Lead',
    color: '#6ee7a0',
    blurb: 'Big detuned stack. Turn the delay up.',
    gain: 0.12,
    oscs: [
      { type: 'sawtooth', semi: 0, cents: 0, level: 0.7 },
      { type: 'sawtooth', semi: 0, cents: 12, level: 0.6 },
      { type: 'sawtooth', semi: -12, cents: -6, level: 0.3 },
    ],
    sub: { type: 'sine', level: 0.15, octave: -1 },
    noise: 0,
    filter: { type: 'lowpass', hz: 2600, q: 2, env: 4200, keytrack: 0.3, envA: 0.01, envD: 0.4, envS: 0.5, envR: 0.35 },
    amp: { a: 0.012, d: 0.3, s: 0.72, r: 0.32 },
    lfo: { type: 'sine', rate: 5.4, target: 'pitch', amount: 0.12, delay: 0.5 },
    // Two unison voices, not three: six saws per note instead of nine, the
    // single most expensive patch, and the chorus covers the difference.
    unison: { voices: 2, spread: 26 },
    vel: { amp: 0.7, filter: 0.6 },
    chorus: 0.35,
    send: { reverb: 0.3, delay: 0.3 },
    macroCutoff: 0.76,
    panSpread: 0.55,
  },
  {
    id: 'drawbar-organ',
    name: 'Drawbar Organ',
    category: 'Keys',
    color: '#f2854f',
    blurb: 'Additive sines, instant on and off.',
    gain: 0.14,
    oscs: [
      { type: 'sine', semi: 0, cents: 0, level: 1 },
      { type: 'sine', semi: 12, cents: 0, level: 0.55 },
      { type: 'sine', semi: 19, cents: 0, level: 0.3 },
      { type: 'sine', semi: 24, cents: 0, level: 0.2 },
    ],
    sub: { type: 'sine', level: 0.2, octave: -1 },
    noise: 0,
    filter: { type: 'lowpass', hz: 5200, q: 0.6, env: 0, keytrack: 0.3, envA: 0.001, envD: 0.1, envS: 1, envR: 0.1 },
    amp: { a: 0.008, d: 0.05, s: 0.95, r: 0.08 },
    lfo: { type: 'sine', rate: 6.2, target: 'pitch', amount: 0.09, delay: 0.2 },
    vel: { amp: 0.35, filter: 0.2 },
    send: { reverb: 0.22, delay: 0.05 },
    macroCutoff: 0.8,
    panSpread: 0.1,
  },
  {
    id: 'dream-choir',
    name: 'Dream Choir',
    category: 'Pads',
    color: '#8fb8ff',
    blurb: 'Breathy and distant. Very calming.',
    gain: 0.13,
    oscs: [
      { type: 'triangle', semi: 0, cents: -5, level: 0.7 },
      { type: 'sawtooth', semi: 0, cents: 7, level: 0.3 },
      { type: 'triangle', semi: 12, cents: 0, level: 0.2 },
    ],
    sub: { type: 'sine', level: 0.12, octave: -1 },
    noise: 0.03,
    filter: { type: 'lowpass', hz: 1150, q: 3.2, env: 900, keytrack: 0.3, envA: 0.45, envD: 1.1, envS: 0.55, envR: 1 },
    amp: { a: 0.4, d: 0.9, s: 0.8, r: 1.5 },
    lfo: { type: 'sine', rate: 4.6, target: 'pitch', amount: 0.16, delay: 0.8 },
    unison: { voices: 2, spread: 9 },
    vel: { amp: 0.4, filter: 0.35 },
    chorus: 0.5,
    send: { reverb: 0.72, delay: 0.16 },
    macroCutoff: 0.7,
    panSpread: 0.6,
  },
  {
    id: 'wobble-bass',
    name: 'Wobble Bass',
    category: 'Bass',
    color: '#c3f53c',
    blurb: 'LFO on the filter. Silly in the best way.',
    gain: 0.24,
    mono: true,
    glide: 0.03,
    oscs: [
      { type: 'sawtooth', semi: 0, cents: 0, level: 0.85 },
      { type: 'square', semi: -12, cents: 0, level: 0.35 },
    ],
    sub: { type: 'sine', level: 0.45, octave: -1 },
    noise: 0,
    filter: { type: 'lowpass', hz: 500, q: 9, env: 1200, keytrack: 0.2, envA: 0.01, envD: 0.3, envS: 0.4, envR: 0.2 },
    amp: { a: 0.008, d: 0.2, s: 0.7, r: 0.2 },
    lfo: { type: 'sine', rate: 4.2, target: 'filter', amount: 0.75, delay: 0 },
    vel: { amp: 0.5, filter: 0.6 },
    send: { reverb: 0.08, delay: 0.1 },
    macroCutoff: 0.55,
    panSpread: 0,
  },

  /* ---- experimental, fun and frankly silly ------------------------------ */

  {
    id: 'robot-burp',
    name: 'Robot Burp',
    category: 'Silly',
    color: '#7bd3a0',
    blurb: 'Gurgling ring-modulated belch. Toddlers approve.',
    gain: 0.2,
    oscs: [
      { type: 'sawtooth', semi: -12, cents: 0, level: 0.8 },
      { type: 'square', semi: -12, cents: 14, level: 0.4 },
    ],
    sub: { type: 'sine', level: 0.3, octave: -1 },
    noise: 0,
    ring: { ratio: 0.26, amount: 0.85 },
    pitchEnv: { semis: 5, time: 0.2 },
    filter: { type: 'lowpass', hz: 700, q: 9, env: 900, keytrack: 0.2, envA: 0.01, envD: 0.35, envS: 0.3, envR: 0.2 },
    amp: { a: 0.01, d: 0.25, s: 0.45, r: 0.2 },
    lfo: { type: 'triangle', rate: 22, target: 'amp', amount: 0.5, delay: 0 },
    vel: { amp: 0.6, filter: 0.5 },
    send: { reverb: 0.15, delay: 0.08 },
    macroCutoff: 0.55,
    panSpread: 0.3,
  },
];

/* The list as the picker shows it: two or three sounds per style, each one
   clearly unlike its neighbours. A category here overrides whatever an
   individual patch says, so the order lives in one place. */
const ORDER = [
  ['Classical & Easy', ['grand-piano', 'electric-piano', 'concert-harp']],
  ['Classic Synth', ['supersaw', 'velvet-pad', 'rubber-bass']],
  ['Funky', ['clavinet', 'drawbar-organ', 'funk-bass']],
  ['Drum & Bass', ['reese-bass', 'wobble-bass', 'dream-choir']],
  ['Techno', ['acid-bass', 'dub-stab', 'hoover']],
  ['Fun & Strange', ['backwards-piano', 'singing-bowl', 'robot-burp']],
];

/* Not in the picker, but Bash mode plays them: soft, can't-go-wrong sounds
   for small hands. */
const BASH_ONLY = ['glass-bells', 'marimba', 'music-box', 'toy-piano'];

const ALL = new Map([...SYNTH_PRESETS, ...ACOUSTIC_PRESETS, ...GENRE_PRESETS].map((p) => [p.id, p]));

export const PRESETS = ORDER.flatMap(([category, ids]) => ids.map((id) => {
  const preset = ALL.get(id);
  if (!preset) throw new Error(`presets: ORDER names unknown patch "${id}"`);
  preset.category = category;
  return preset;
}));

{
  const placed = new Set([...PRESETS.map((p) => p.id), ...BASH_ONLY]);
  const stray = [...ALL.keys()].filter((id) => !placed.has(id));
  if (stray.length) throw new Error(`presets: patches neither listed nor Bash-only: ${stray.join(', ')}`);
}

/** Every patch, including Bash mode's — so a saved or Bash choice still resolves. */
const BY_ID = ALL;

export function getPreset(id) {
  return BY_ID.get(id) || PRESETS[0];
}

/** Patches Bash mode may play that the picker doesn't show. */
export const ALL_PRESETS = [...ALL.values()];

export const PRESET_CATEGORIES = ORDER.map(([category]) => category);

/** Patches offered in Bash mode, in the order they appear on the big buttons. */
export const BASH_SOUNDS = [
  { id: 'bells', label: 'Bells', presetId: 'glass-bells', emoji: '🔔' },
  { id: 'marimba', label: 'Marimba', presetId: 'marimba', emoji: '🪵' },
  { id: 'musicbox', label: 'Music box', presetId: 'music-box', emoji: '🎁' },
  { id: 'space', label: 'Space', presetId: 'dream-choir', emoji: '🚀' },
  { id: 'piano', label: 'Toy piano', presetId: 'toy-piano', emoji: '🎹' },
  { id: 'organ', label: 'Organ', presetId: 'drawbar-organ', emoji: '🎪' },
];
