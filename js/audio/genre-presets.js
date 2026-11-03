/* The sounds that make a style, where nothing else in the list did.

   Funk is clavinet and a plucked electric bass; drum and bass is the Reese;
   techno is a squelching 303 line, a dub chord stab and the rave hoover. The
   two funk instruments are plucked strings, so they use the string model; the
   rest are synths, kept deliberately cheap — two or three oscillators each —
   because these are the patches people play fast and stack with drums. */

export const GENRE_PRESETS = [
  /* ---- funky ------------------------------------------------------------ */
  {
    id: 'clavinet',
    name: 'Clavinet',
    color: '#e0a23a',
    blurb: 'Hammered strings, bright pickups, dead short when you let go. Superstition.',
    engine: 'string',
    string: {
      // Struck right at the end of the string and picked up there: all upper
      // harmonics, the nasal snap that makes a clav funky.
      brightness: 1, velBright: 0.6, pickPosition: 0.06, damping: 0.12, decay: 1.8, decayTilt: 0.35, maxLength: 2.5,
      body: [{ hz: 120, q: 0.8, gain: -6 }, { hz: 1500, q: 1.3, gain: 6 }, { hz: 4200, q: 1, gain: 3 }],
    },
    gain: 0.3,
    // A yarn damper on every string: notes stop the moment the key comes up,
    // which is what makes clav rhythm parts sit so tight.
    damp: 0.05,
    pitchPan: 0.2,
    tone: { hz: 14000, q: 0.5 },
    send: { reverb: 0.08, delay: 0.06 },
    macroCutoff: 0.75,
  },
  {
    id: 'funk-bass',
    name: 'Funk Bass',
    color: '#d1563f',
    blurb: 'Electric bass, fingers near the bridge. Hit it hard for the slap pop.',
    engine: 'string',
    string: {
      brightness: 0.55, velBright: 0.9, pickPosition: 0.12, damping: 0.3, decay: 2.6, decayTilt: 0.3, maxLength: 3,
      body: [{ hz: 90, q: 1, gain: 4 }, { hz: 950, q: 1.2, gain: 5 }],
    },
    gain: 0.5,
    damp: 0.07,
    pitchPan: 0,
    tone: { hz: 9000, q: 0.5 },
    send: { reverb: 0.04, delay: 0 },
    macroCutoff: 0.75,
  },

  /* ---- drum & bass ------------------------------------------------------ */
  {
    id: 'reese-bass',
    name: 'Reese Bass',
    color: '#7a5cff',
    blurb: 'Two saws a hair apart, phasing against each other. The sound of jungle.',
    gain: 0.22,
    mono: true,
    glide: 0.04,
    oscs: [
      { type: 'sawtooth', semi: 0, cents: -16, level: 0.7 },
      { type: 'sawtooth', semi: 0, cents: 16, level: 0.7 },
    ],
    sub: { type: 'sine', level: 0.55, octave: -1 },
    noise: 0,
    filter: { type: 'lowpass', hz: 700, q: 2, env: 600, keytrack: 0.2, envA: 0.02, envD: 0.6, envS: 0.7, envR: 0.3 },
    amp: { a: 0.01, d: 0.3, s: 0.9, r: 0.25 },
    // A slow drift on the filter, half an octave either way: the Reese moves.
    lfo: { type: 'sine', rate: 0.3, target: 'filter', amount: 0.25, delay: 0 },
    vel: { amp: 0.4, filter: 0.4 },
    send: { reverb: 0.08, delay: 0 },
    macroCutoff: 0.7,
    panSpread: 0,
  },

  /* ---- techno ----------------------------------------------------------- */
  {
    id: 'acid-bass',
    name: 'Acid Bass',
    color: '#d7f542',
    blurb: 'A 303 line: one saw, a screaming filter, slides between notes. Ride the Tone knob.',
    gain: 0.2,
    mono: true,
    glide: 0.06,
    oscs: [{ type: 'sawtooth', semi: 0, cents: 0, level: 1 }],
    sub: { type: 'sine', level: 0, octave: -1 },
    noise: 0,
    filter: { type: 'lowpass', hz: 300, q: 12, env: 3200, keytrack: 0.3, envA: 0.002, envD: 0.18, envS: 0, envR: 0.1 },
    amp: { a: 0.002, d: 0.25, s: 0.6, r: 0.08 },
    // Velocity is the 303's accent: harder notes open the filter much further.
    vel: { amp: 0.4, filter: 0.9 },
    send: { reverb: 0.05, delay: 0.2 },
    macroCutoff: 0.55,
    panSpread: 0,
  },
  {
    id: 'dub-stab',
    name: 'Dub Chord Stab',
    color: '#3ec6c9',
    blurb: 'One key, a whole minor-seventh chord, swallowed by echo. Berlin at 4am.',
    gain: 0.11,
    oscs: [
      { type: 'sawtooth', semi: 0, cents: 0, level: 0.6 },
      { type: 'sawtooth', semi: 3, cents: 4, level: 0.5 },
      { type: 'sawtooth', semi: 7, cents: -3, level: 0.5 },
      { type: 'triangle', semi: 10, cents: 0, level: 0.45 },
    ],
    sub: { type: 'sine', level: 0, octave: -1 },
    noise: 0,
    filter: { type: 'lowpass', hz: 900, q: 3, env: 1800, keytrack: 0.3, envA: 0.003, envD: 0.25, envS: 0, envR: 0.2 },
    amp: { a: 0.003, d: 0.35, s: 0, r: 0.2 },
    vel: { amp: 0.6, filter: 0.6 },
    send: { reverb: 0.45, delay: 0.55 },
    macroCutoff: 0.72,
    panSpread: 0.3,
  },
  {
    id: 'hoover',
    name: 'Hoover',
    color: '#ff5fa2',
    blurb: 'The rave classic: fat detuned saws that scoop up into every note.',
    gain: 0.12,
    mono: true,
    glide: 0.12,
    oscs: [
      { type: 'sawtooth', semi: 0, cents: -25, level: 0.6 },
      { type: 'sawtooth', semi: 0, cents: 25, level: 0.6 },
      { type: 'sawtooth', semi: -12, cents: 0, level: 0.4 },
    ],
    sub: { type: 'sine', level: 0, octave: -1 },
    noise: 0,
    pitchEnv: { semis: -3, time: 0.12 },
    filter: { type: 'lowpass', hz: 3500, q: 1, env: 1500, keytrack: 0.2, envA: 0.01, envD: 0.4, envS: 0.7, envR: 0.4 },
    amp: { a: 0.01, d: 0.3, s: 0.85, r: 0.4 },
    lfo: { type: 'sine', rate: 5, target: 'pitch', amount: 0.1, delay: 0.3 },
    vel: { amp: 0.5, filter: 0.4 },
    chorus: 0.6,
    send: { reverb: 0.3, delay: 0.15 },
    macroCutoff: 0.75,
    panSpread: 0,
  },
];
