/* Acoustic percussion, modelled.

   Drums are membranes, and a membrane rings at a set of modes, just as a bar
   does — the ratios differ. An ideal circular drumhead sits at 1, 1.59, 2.14,
   2.30, 2.65… of its fundamental; a timpani's kettle shifts those onto
   near-harmonic 1, 1.5, 2, 2.44, 3, which is why it has a definite pitch when
   a tom does not. Cymbals ring at so many closely-packed modes that, past a
   point, filtered noise is the more accurate description, so they are a
   blend: noise for the wash, a handful of inharmonic partials for the ping.

   Every voice here takes velocity as more than loudness. Harder hits bring up
   the beater click, the upper modes and the snare wires, as they do on a real
   kit, which is most of what makes a programmed drum part sound played.

   Each function is handed a OneShot from drums.js and returns its length. */

import { clamp, noteToFreq } from '../util.js';
import { MODES } from './acoustic.js';

/* ---- building blocks ---------------------------------------------------- */

function filter(shot, type, hz, q = 1) {
  const f = shot.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = clamp(hz, 20, 20000);
  f.Q.value = q;
  return shot.add(f);
}

function gain(shot) {
  return shot.add(shot.ctx.createGain());
}

/** A sine at `hz` decaying to silence over `decay` (T60) seconds. */
function partial(shot, t, hz, amp, decay, { drop = 0, dropTime = 0.1, attack = 0.001, into = shot.out } = {}) {
  if (hz > 19000 || amp <= 0) return 0;
  const osc = shot.src(shot.ctx.createOscillator());
  osc.type = 'sine';
  if (drop) {
    osc.frequency.setValueAtTime(hz * (1 + drop), t);
    osc.frequency.exponentialRampToValueAtTime(hz, t + dropTime);
  } else {
    osc.frequency.value = hz;
  }
  const g = gain(shot);
  shot.env(g, t, amp, decay, attack);
  osc.connect(g).connect(into);
  return attack + decay;
}

/** Filtered noise with a percussive envelope. */
function burst(shot, t, { type = 'bandpass', hz = 3000, q = 1, amp = 0.3, decay = 0.05, attack = 0.001, into = shot.out, hp = 0 } = {}) {
  const n = shot.noise();
  const f = filter(shot, type, hz, q);
  let tail = n.connect(f);
  if (hp) tail = tail.connect(filter(shot, 'highpass', hp, 0.7));
  const g = gain(shot);
  shot.env(g, t, amp, decay, attack);
  tail.connect(g).connect(into);
  return attack + decay;
}

/** A struck membrane: a set of [ratio, level, decay] modes, with a pitch drop. */
function membrane(shot, t, f0, modes, vel, { decay = 1, drop = 0.06, dropTime = 0.06, bright = 0.5 } = {}) {
  let longest = 0;
  for (const [ratio, level, t60] of modes) {
    // Harder hits excite the higher modes more.
    const tilt = Math.pow(0.4 + clamp(bright + vel * 0.5, 0, 1) * 0.6, Math.log2(Math.max(1, ratio)) * 1.5);
    longest = Math.max(longest, partial(shot, t, f0 * ratio, vel * level * tilt, t60 * decay, { drop, dropTime }));
  }
  return longest;
}

/** A pitched bar or bell, reusing the tables the keyboard instruments use. */
function struck(shot, t, f0, table, vel, { decay = 1, hardness = 0.5 } = {}) {
  let longest = 0;
  const h = clamp(hardness + (vel - 0.6) * 0.6, 0.05, 1);
  const pitchDecay = Math.pow(440 / f0, 0.4) * decay;
  for (const [ratio, level, t60] of table) {
    const tilt = Math.pow(0.35 + h * 0.65, Math.max(0, Math.log2(ratio)));
    longest = Math.max(longest, partial(shot, t, f0 * ratio, vel * 0.5 * level * tilt, clamp(t60 * pitchDecay, 0.04, 10)));
  }
  return longest;
}

// Fixed, not random: a cymbal should sound like the same cymbal each time.
const CRASH_PARTIALS = [1530, 2210, 2870, 3420, 4150, 4980, 5730, 6620, 7410, 8390];
const RIDE_PARTIALS = [2390, 3160, 3920, 4610, 5380, 6250, 7080];
const RIDE_BELL = [[1, 1, 2.2], [2.08, 0.5, 1.6], [2.76, 0.35, 1.2], [3.94, 0.18, 0.8]];
const HAT_PARTIALS = [3170, 4730, 6490, 8120, 9890];
const TRIANGLE = [[1, 1, 3.6], [2.71, 0.6, 3.1], [3.89, 0.45, 2.7], [5.12, 0.35, 2.2], [6.33, 0.25, 1.8], [7.99, 0.16, 1.4]];
const AGOGO = [[1, 1, 0.55], [2.53, 0.42, 0.3], [3.62, 0.22, 0.18]];

const KICK_MODES = [[1, 1, 0.45], [1.59, 0.18, 0.14], [2.14, 0.08, 0.08]];
const TOM_MODES = [[1, 1, 0.55], [1.59, 0.3, 0.3], [2.14, 0.16, 0.2], [2.3, 0.12, 0.16]];
const SNARE_MODES = [[1, 1, 0.14], [1.59, 0.55, 0.1], [2.14, 0.3, 0.07], [2.65, 0.15, 0.05]];
const TIMPANI_MODES = [[1, 1, 3.4], [1.5, 0.5, 2.4], [1.99, 0.28, 1.8], [2.44, 0.14, 1.1], [2.98, 0.08, 0.8]];
const HAND_MODES = [[1, 1, 0.3], [1.59, 0.26, 0.14], [2.14, 0.14, 0.08], [2.65, 0.07, 0.05]];

/* ---- the voices ---------------------------------------------------------- */

export const PERCUSSION = {
  /* -- drum kit -- */

  akick(shot, def, vel, t) {
    const f = def.tune ?? 56;
    const len = membrane(shot, t, f, KICK_MODES, vel * 0.7, { decay: (def.decay ?? 1), drop: 0.55, dropTime: 0.035, bright: 0.2 });
    // The beater on the head: a felt thud plus, hit hard, a plastic click.
    burst(shot, t, { type: 'lowpass', hz: 2200 + vel * 2800, q: 0.7, amp: vel * vel * 0.25, decay: 0.012 });
    burst(shot, t, { type: 'bandpass', hz: 1100, q: 1.2, amp: vel * 0.08, decay: 0.03 });
    return len + 0.05;
  },

  asnare(shot, def, vel, t) {
    const f = def.tune ?? 190;
    const decay = def.decay ?? 1;
    const head = membrane(shot, t, f, SNARE_MODES, vel * 0.45, { decay, drop: 0.08, dropTime: 0.02, bright: 0.5 });
    // The wires under the bottom head: they buzz longer the harder it's hit.
    const wires = burst(shot, t, {
      type: 'bandpass', hz: 4800, q: 0.55, hp: 1500,
      amp: vel * (def.wires ?? 0.33), decay: (0.13 + vel * 0.14) * decay,
    });
    if (def.rim) {
      // Rimshot: stick on head and rim at once — a crack with a metallic ring.
      burst(shot, t, { type: 'bandpass', hz: 1050, q: 2.5, amp: vel * 0.3, decay: 0.035 });
      partial(shot, t, 560, vel * 0.11, 0.09);
      partial(shot, t, 1630, vel * 0.05, 0.06);
    }
    return Math.max(head, wires) + 0.03;
  },

  sidestick(shot, def, vel, t) {
    burst(shot, t, { type: 'bandpass', hz: 1750, q: 3.5, amp: vel * 0.6, decay: 0.03 });
    partial(shot, t, 520, vel * 0.3, 0.06);
    partial(shot, t, 1210, vel * 0.15, 0.04);
    return 0.12;
  },

  atom(shot, def, vel, t) {
    const f = def.tune ?? 140;
    const len = membrane(shot, t, f, TOM_MODES, vel * 0.7, { decay: def.decay ?? 1, drop: 0.12, dropTime: 0.12, bright: 0.35 });
    burst(shot, t, { type: 'lowpass', hz: 1800, q: 0.7, amp: vel * 0.12, decay: 0.015 });
    return len + 0.05;
  },

  ahat(shot, def, vel, t) {
    const decay = def.decay ?? 0.05;
    // Pedal hat is mostly the two plates meeting: a low "chick", little sizzle.
    const pedal = def.pedal;
    const wash = burst(shot, t, {
      type: 'bandpass', hz: 9500, q: 0.6, hp: 6500,
      amp: vel * (pedal ? 0.12 : 0.42), decay: decay * (0.8 + vel * 0.4),
    });
    for (const hz of HAT_PARTIALS) partial(shot, t, hz, vel * 0.025, decay * 0.7);
    if (pedal) burst(shot, t, { type: 'bandpass', hz: 950, q: 2, amp: 0.25, decay: 0.025 });
    return wash + 0.03;
  },

  crash(shot, def, vel, t) {
    const decay = def.decay ?? 2.2;
    const attack = def.swell ?? 0.002;
    const a = burst(shot, t, { type: 'highpass', hz: 2600, q: 0.6, amp: vel * 0.32, decay, attack });
    burst(shot, t, { type: 'bandpass', hz: 8800, q: 0.5, amp: vel * 0.2, decay: decay * 0.7, attack });
    CRASH_PARTIALS.forEach((hz, i) => {
      partial(shot, t, hz * (def.size ?? 1), vel * 0.035, decay * (0.5 + 0.06 * (CRASH_PARTIALS.length - i)), { attack });
    });
    // Clash cymbals: two plates meet a hair apart, which thickens the onset.
    if (def.pair) burst(shot, t + 0.006, { type: 'highpass', hz: 3000, q: 0.6, amp: vel * 0.25, decay: decay * 0.6 });
    return a + 0.05;
  },

  ride(shot, def, vel, t) {
    const decay = def.decay ?? 2.6;
    if (def.bell) {
      const len = struck(shot, t, def.tune ?? 760, RIDE_BELL, vel * 0.7, { hardness: 0.7 });
      burst(shot, t, { type: 'bandpass', hz: 6000, q: 1, amp: vel * 0.12, decay: 0.02 });
      return len;
    }
    const wash = burst(shot, t, { type: 'bandpass', hz: 7200, q: 0.5, hp: 3500, amp: vel * 0.13, decay });
    RIDE_PARTIALS.forEach((hz) => partial(shot, t, hz, vel * 0.05, decay * 0.8));
    // The stick on the bow: the "ping" that lets a ride keep time.
    burst(shot, t, { type: 'bandpass', hz: 4800, q: 2, amp: vel * 0.22, decay: 0.03 });
    return wash + 0.05;
  },

  tambourine(shot, def, vel, t) {
    // A shake of jingles, each a tiny bright burst a few milliseconds apart.
    const hits = 4;
    let len = 0;
    for (let i = 0; i < hits; i++) {
      const at = t + i * 0.009 + Math.random() * 0.004;
      len = Math.max(len, at - t + burst(shot, at, {
        type: 'bandpass', hz: 8200 + i * 700, q: 2.2, amp: vel * (0.32 - i * 0.05), decay: 0.11 + Math.random() * 0.05,
      }));
    }
    partial(shot, t, 5300, vel * 0.05, 0.18);
    partial(shot, t, 7150, vel * 0.04, 0.15);
    if (def.skin) partial(shot, t, 300, vel * 0.2, 0.08, { drop: 0.1, dropTime: 0.02 });
    return len + 0.03;
  },

  /* -- orchestra -- */

  timpani(shot, def, vel, t) {
    const f = noteToFreq(def.note ?? 43);
    const len = membrane(shot, t, f, TIMPANI_MODES, vel * 0.5, { decay: def.decay ?? 1, drop: 0.015, dropTime: 0.3, bright: 0.25 });
    // The (0,1) mode the kettle pushes below the note: a thump that dies fast.
    partial(shot, t, f * 0.72, vel * 0.27, 0.18);
    burst(shot, t, { type: 'lowpass', hz: 700, q: 0.7, amp: vel * 0.18, decay: 0.035 });
    return len;
  },

  bassdrum(shot, def, vel, t) {
    const f = def.tune ?? 46;
    const len = membrane(shot, t, f, [[1, 1, 2.6], [1.59, 0.35, 1.2], [2.14, 0.15, 0.7]], vel * 0.7, { decay: def.decay ?? 1, drop: 0.03, dropTime: 0.2, bright: 0.1 });
    burst(shot, t, { type: 'lowpass', hz: 320, q: 0.7, amp: vel * 0.3, decay: 0.08 });
    return len;
  },

  triangle(shot, def, vel, t) {
    const len = struck(shot, t, def.tune ?? 1240, TRIANGLE, vel * 0.55, { hardness: 0.8, decay: def.decay ?? 1 });
    burst(shot, t, { type: 'bandpass', hz: 7000, q: 2, amp: vel * 0.08, decay: 0.01 });
    return len;
  },

  gong(shot, def, vel, t) {
    // A tam-tam: dense low partials, then a shimmer that blooms after the hit.
    const base = def.tune ?? 82;
    const ratios = [1, 1.31, 1.62, 1.97, 2.41, 2.83, 3.37, 3.96, 4.61, 5.43];
    ratios.forEach((r, i) => partial(shot, t, base * r, vel * 0.12 / (1 + i * 0.25), 6 - i * 0.35, { drop: -0.01, dropTime: 1.2 }));
    burst(shot, t, { type: 'bandpass', hz: 3600, q: 0.6, amp: vel * 0.12, decay: 6, attack: 0.7 });
    burst(shot, t, { type: 'lowpass', hz: 400, q: 0.7, amp: vel * 0.25, decay: 0.12 });
    return 7;
  },

  mallet(shot, def, vel, t) {
    const table = MODES[def.modes] || MODES.glockenspiel;
    const len = struck(shot, t, noteToFreq(def.note ?? 84), table, vel, { hardness: def.hardness ?? 0.6, decay: def.decay ?? 1 });
    burst(shot, t, { type: 'bandpass', hz: def.click ?? 4000, q: 1.2, amp: vel * 0.12, decay: 0.008 });
    return len;
  },

  claves(shot, def, vel, t) {
    partial(shot, t, def.tune ?? 2480, vel * 0.5, 0.07);
    partial(shot, t, (def.tune ?? 2480) * 2.71, vel * 0.12, 0.025);
    burst(shot, t, { type: 'bandpass', hz: 3500, q: 3, amp: vel * 0.15, decay: 0.006 });
    return 0.12;
  },

  sleighbells(shot, def, vel, t) {
    let len = 0;
    for (let i = 0; i < 11; i++) {
      const at = t + Math.random() * 0.05;
      len = Math.max(len, at - t + burst(shot, at, { type: 'bandpass', hz: 6500 + Math.random() * 4000, q: 4, amp: vel * 0.16, decay: 0.09 + Math.random() * 0.08 }));
    }
    return len + 0.05;
  },

  castanets(shot, def, vel, t) {
    for (const [dt, amp] of [[0, 1], [0.013, 0.7]]) {
      burst(shot, t + dt, { type: 'bandpass', hz: 2300, q: 4, amp: vel * 0.5 * amp, decay: 0.02 });
      partial(shot, t + dt, 1480, vel * 0.15 * amp, 0.03);
    }
    return 0.1;
  },

  /* -- hand percussion -- */

  hand(shot, def, vel, t) {
    // Congas, bongos, djembe, cajon: open, slap, mute and bass are the same
    // drum struck differently — how long the head rings, and how much crack.
    const f = def.tune ?? 200;
    const stroke = def.stroke || 'open';
    const ring = { open: 1, bass: 1.4, mute: 0.22, slap: 0.35 }[stroke];
    const len = membrane(shot, t, f, HAND_MODES, vel * 0.68, { decay: ring * (def.decay ?? 1), drop: stroke === 'bass' ? 0.2 : 0.05, dropTime: 0.05, bright: stroke === 'slap' ? 0.9 : 0.4 });
    if (stroke === 'slap') {
      burst(shot, t, { type: 'bandpass', hz: def.crack ?? 2400, q: 1.4, amp: vel * 0.42, decay: 0.035 });
    } else {
      // Skin on skin.
      burst(shot, t, { type: 'bandpass', hz: 1200, q: 1, amp: vel * 0.12, decay: 0.012 });
    }
    // A cajon has snare wires against its front panel.
    if (def.wires) burst(shot, t, { type: 'bandpass', hz: 3400, q: 0.8, hp: 1500, amp: vel * def.wires, decay: 0.12 });
    return len + 0.05;
  },

  agogo(shot, def, vel, t) {
    const len = struck(shot, t, def.tune ?? 880, AGOGO, vel * 0.8, { hardness: 0.7 });
    burst(shot, t, { type: 'bandpass', hz: 3000, q: 2, amp: vel * 0.1, decay: 0.008 });
    return len;
  },

  cabasa(shot, def, vel, t) {
    return burst(shot, t, { type: 'bandpass', hz: 6200, q: 1.1, amp: vel * 0.32, decay: 0.12, attack: 0.012 }) + 0.03;
  },

  guiro(shot, def, vel, t) {
    // A stick dragged across ridges: a quick train of clicks.
    const n = 14;
    const span = def.decay ?? 0.2;
    for (let i = 0; i < n; i++) {
      burst(shot, t + (i / n) * span, { type: 'bandpass', hz: 2900, q: 5, amp: vel * 0.3, decay: 0.01 });
    }
    return span + 0.05;
  },
};
