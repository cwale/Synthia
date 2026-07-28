/* Backing drum patterns. Deliberately independent of the selected pad kit so
   the beat sounds the same whichever kit is loaded on the pads. */

import { clamp } from '../util.js';
import { triggerPad } from './drums.js';

const VOICES = {
  kick: { type: 'kick', tune: 50, decay: 0.38 },
  snare: { type: 'snare', decay: 0.17 },
  clap: { type: 'clap', decay: 0.16 },
  hat: { type: 'hat', decay: 0.045, gain: 0.9 },
  hatOpen: { type: 'hat', decay: 0.3, gain: 0.8 },
  shaker: { type: 'shaker', decay: 0.09, gain: 0.8 },
  rim: { type: 'rim', gain: 0.9 },
  tom: { type: 'tom', tune: 150, decay: 0.26 },
  cowbell: { type: 'cowbell', gain: 0.6 },
};

const _ = 0;

export const PATTERNS = [
  {
    id: 'boombap',
    name: 'Boom Bap',
    tempo: 88,
    swing: 0.18,
    tracks: {
      kick: [1, _, _, _, _, _, 0.8, _, _, _, 0.9, _, _, _, _, _],
      snare: [_, _, _, _, 1, _, _, _, _, _, _, _, 0.95, _, _, 0.4],
      hat: [0.6, _, 0.4, _, 0.6, _, 0.4, _, 0.6, _, 0.4, _, 0.6, _, 0.5, 0.3],
    },
  },
  {
    id: 'fourfloor',
    name: 'Four on the Floor',
    tempo: 124,
    swing: 0,
    tracks: {
      kick: [1, _, _, _, 1, _, _, _, 1, _, _, _, 1, _, _, _],
      clap: [_, _, _, _, 0.9, _, _, _, _, _, _, _, 0.9, _, _, _],
      hatOpen: [_, _, 0.5, _, _, _, 0.5, _, _, _, 0.5, _, _, _, 0.5, _],
      shaker: [0.3, 0.2, 0.3, 0.2, 0.3, 0.2, 0.3, 0.2, 0.3, 0.2, 0.3, 0.2, 0.3, 0.2, 0.3, 0.2],
    },
  },
  {
    id: 'rock',
    name: 'Straight Rock',
    tempo: 108,
    swing: 0,
    tracks: {
      kick: [1, _, _, _, _, _, 0.85, _, 1, _, _, _, _, _, _, _],
      snare: [_, _, _, _, 1, _, _, _, _, _, _, _, 1, _, _, _],
      hat: [0.7, _, 0.5, _, 0.7, _, 0.5, _, 0.7, _, 0.5, _, 0.7, _, 0.5, _],
    },
  },
  {
    id: 'shuffle',
    name: 'Lazy Shuffle',
    tempo: 96,
    swing: 0.34,
    tracks: {
      kick: [1, _, _, _, _, _, _, _, 0.9, _, _, _, _, _, 0.6, _],
      snare: [_, _, _, _, 0.9, _, _, _, _, _, _, _, 0.9, _, _, _],
      hat: [0.6, _, 0.35, _, 0.6, _, 0.35, _, 0.6, _, 0.35, _, 0.6, _, 0.35, _],
      rim: [_, _, _, 0.3, _, _, _, _, _, _, _, 0.3, _, _, _, _],
    },
  },
  {
    id: 'bossa',
    name: 'Soft Bossa',
    tempo: 120,
    swing: 0,
    tracks: {
      kick: [0.9, _, _, _, _, _, 0.7, _, 0.8, _, _, _, _, _, 0.7, _],
      rim: [0.6, _, _, 0.5, _, _, 0.6, _, _, 0.5, _, _, 0.6, _, _, _],
      shaker: [0.35, 0.2, 0.35, 0.2, 0.35, 0.2, 0.35, 0.2, 0.35, 0.2, 0.35, 0.2, 0.35, 0.2, 0.35, 0.2],
    },
  },
  {
    id: 'clappy',
    name: 'Clap Along',
    tempo: 92,
    swing: 0,
    blurb: 'Simple and happy — the Bash mode default.',
    tracks: {
      kick: [1, _, _, _, _, _, _, _, 1, _, _, _, _, _, _, _],
      clap: [_, _, _, _, 0.85, _, _, _, _, _, _, _, 0.85, _, _, _],
      shaker: [_, _, 0.3, _, _, _, 0.3, _, _, _, 0.3, _, _, _, 0.3, _],
    },
  },
  {
    id: 'halftime',
    name: 'Half Time',
    tempo: 76,
    swing: 0.12,
    tracks: {
      kick: [1, _, _, _, _, _, _, _, _, _, 0.85, _, _, _, _, _],
      snare: [_, _, _, _, _, _, _, _, 1, _, _, _, _, _, _, 0.35],
      hat: [0.5, _, _, 0.3, 0.5, _, _, 0.3, 0.5, _, _, 0.3, 0.5, _, 0.35, _],
    },
  },
];

const BY_ID = new Map(PATTERNS.map((p) => [p.id, p]));

export function getPattern(id) {
  return BY_ID.get(id) || PATTERNS[0];
}

export class Groove {
  constructor(ctx, strip, clock) {
    this.ctx = ctx;
    this.strip = strip;
    this.clock = clock;
    this.pattern = PATTERNS[0];
    this.level = 0.7;
    this.playing = false;
    this.onStep = null;
    clock.subscribe((step, time) => this._tick(step, time));
  }

  setPattern(id) {
    this.pattern = getPattern(id);
  }

  setLevel(v) {
    this.level = clamp(v, 0, 1);
  }

  start() {
    this.playing = true;
  }

  stop() {
    this.playing = false;
  }

  _tick(step, time) {
    if (!this.playing) return;
    const pat = this.pattern;
    // Swing pushes the odd sixteenths late, which is what gives a groove its lilt.
    const swingOffset = step % 2 === 1 ? this.clock.stepDuration * (pat.swing || 0) : 0;
    const at = time + swingOffset;

    for (const [voiceName, steps] of Object.entries(pat.tracks)) {
      const vel = steps[step];
      if (!vel) continue;
      const def = VOICES[voiceName];
      if (!def) continue;
      triggerPad(this.ctx, this.strip.input, def, vel * this.level, at);
    }

    this.onStep?.(step, at);
  }
}
