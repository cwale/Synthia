/* Pad kits: 16 pads each, matching the hardware's 4x4 grid.

   Pad index 0 is pad 1 on the controller. How that maps onto screen rows is a
   display choice (see settings.pads.layout) because controllers disagree:
   MPC-style numbering starts bottom-left, others read top-left. */

const C = {
  kick: '#ff6b5c',
  snare: '#ffa14a',
  hat: '#ffd93d',
  perc: '#f2854f',
  metal: '#c9d64a',
  tuned: '#4ecdc4',
  deep: '#5b8def',
  fun: '#c77dff',
  pop: '#ff7ac6',
};

export const KITS = [
  {
    id: 'studio',
    name: 'Studio Kit',
    blurb: 'Straight acoustic-ish kit plus a few tuned pads.',
    pads: [
      { name: 'Kick', type: 'kick', tune: 52, decay: 0.4, color: C.kick },
      { name: 'Snare', type: 'snare', decay: 0.19, color: C.snare },
      { name: 'Clap', type: 'clap', color: C.snare },
      { name: 'Rim', type: 'rim', color: C.perc },

      { name: 'Hat', type: 'hat', decay: 0.05, color: C.hat },
      { name: 'Hat open', type: 'hat', decay: 0.32, color: C.hat },
      { name: 'Shaker', type: 'shaker', color: C.hat },
      { name: 'Crash', type: 'cymbal', decay: 1.4, color: C.metal },

      { name: 'Tom lo', type: 'tom', tune: 120, color: C.perc },
      { name: 'Tom mid', type: 'tom', tune: 175, color: C.perc },
      { name: 'Tom hi', type: 'tom', tune: 240, color: C.perc },
      { name: 'Cowbell', type: 'cowbell', color: C.metal },

      { name: 'Block', type: 'woodblock', color: C.perc },
      { name: 'Bass C', type: 'bass', note: 36, decay: 0.45, color: C.deep },
      { name: 'Marimba', type: 'marimba', note: 72, color: C.tuned },
      { name: 'Bell', type: 'bell', note: 84, decay: 1.6, color: C.tuned },
    ],
  },

  {
    id: 'eight-oh-eight',
    name: 'Eight-Oh-Eight',
    blurb: 'Long booming kick, snappy claps, metallic everything.',
    pads: [
      { name: 'Boom', type: 'kick', tune: 41, decay: 0.95, gain: 1.1, color: C.kick },
      { name: 'Kick', type: 'kick', tune: 58, decay: 0.28, color: C.kick },
      { name: 'Snare', type: 'snare', tune: 2200, decay: 0.14, color: C.snare },
      { name: 'Clap', type: 'clap', decay: 0.2, color: C.snare },

      { name: 'Hat', type: 'hat', decay: 0.035, color: C.hat },
      { name: 'Hat open', type: 'hat', decay: 0.42, color: C.hat },
      { name: 'Rim', type: 'rim', tune: 2100, color: C.perc },
      { name: 'Cymbal', type: 'cymbal', decay: 1.8, tune: 420, color: C.metal },

      { name: 'Cowbell', type: 'cowbell', tune: 587, color: C.metal },
      { name: 'Tom lo', type: 'tom', tune: 98, decay: 0.42, color: C.perc },
      { name: 'Tom hi', type: 'tom', tune: 210, decay: 0.3, color: C.perc },
      { name: 'Zap', type: 'zap', color: C.fun },

      { name: 'Sub C', type: 'bass', note: 24, wave: 'sine', decay: 0.8, color: C.deep },
      { name: 'Sub F', type: 'bass', note: 29, wave: 'sine', decay: 0.8, color: C.deep },
      { name: 'Sub G', type: 'bass', note: 31, wave: 'sine', decay: 0.8, color: C.deep },
      { name: 'Sub A#', type: 'bass', note: 34, wave: 'sine', decay: 0.8, color: C.deep },
    ],
  },

  {
    id: 'playroom',
    name: 'Playroom',
    blurb: 'Boings, pops and bubbles. Built for small people.',
    pads: [
      { name: 'Boing', type: 'boing', color: C.fun },
      { name: 'Pop', type: 'pop', color: C.pop },
      { name: 'Bubble', type: 'bubble', color: C.tuned },
      { name: 'Whoosh', type: 'whoosh', color: C.deep },

      { name: 'Zap', type: 'zap', color: C.fun },
      { name: 'Laser', type: 'laser', color: C.pop },
      { name: 'Boing hi', type: 'boing', tune: 900, decay: 0.3, color: C.fun },
      { name: 'Pop hi', type: 'pop', tune: 340, color: C.pop },

      { name: 'Bell', type: 'bell', note: 79, decay: 1.5, color: C.tuned },
      { name: 'Chime', type: 'chime', note: 88, color: C.tuned },
      { name: 'Marimba', type: 'marimba', note: 67, color: C.tuned },
      { name: 'Block', type: 'woodblock', color: C.perc },

      { name: 'Big drum', type: 'kick', tune: 48, decay: 0.6, color: C.kick },
      { name: 'Snare', type: 'snare', color: C.snare },
      { name: 'Clap', type: 'clap', color: C.snare },
      { name: 'Cymbal', type: 'cymbal', decay: 1.6, color: C.metal },
    ],
  },

  {
    id: 'melodic',
    name: 'Melodic Pads',
    blurb: 'Sixteen tuned pads in a pentatonic scale. Nothing can clash.',
    pads: [
      // C major pentatonic climbing across four rows of four.
      { name: 'C4', type: 'marimba', note: 60, color: C.tuned },
      { name: 'D4', type: 'marimba', note: 62, color: C.tuned },
      { name: 'E4', type: 'marimba', note: 64, color: C.tuned },
      { name: 'G4', type: 'marimba', note: 67, color: C.tuned },

      { name: 'A4', type: 'marimba', note: 69, color: '#43b8b0' },
      { name: 'C5', type: 'marimba', note: 72, color: '#43b8b0' },
      { name: 'D5', type: 'bell', note: 74, decay: 1.2, color: '#43b8b0' },
      { name: 'E5', type: 'bell', note: 76, decay: 1.2, color: '#43b8b0' },

      { name: 'G5', type: 'bell', note: 79, decay: 1.3, color: C.deep },
      { name: 'A5', type: 'bell', note: 81, decay: 1.3, color: C.deep },
      { name: 'C6', type: 'chime', note: 84, color: C.deep },
      { name: 'D6', type: 'chime', note: 86, color: C.deep },

      { name: 'Bass C', type: 'bass', note: 36, decay: 0.5, color: '#3f6fd8' },
      { name: 'Bass G', type: 'bass', note: 43, decay: 0.5, color: '#3f6fd8' },
      { name: 'Pluck C', type: 'pluck', note: 48, color: '#6f8ce8' },
      { name: 'Pluck G', type: 'pluck', note: 55, color: '#6f8ce8' },
    ],
  },
];

const BY_ID = new Map(KITS.map((k) => [k.id, k]));

export function getKit(id) {
  return BY_ID.get(id) || KITS[0];
}

/**
 * Screen position for a pad index.
 * 'mpc' puts pad 1 bottom-left (the DAW convention for note 36);
 * 'reading' puts pad 1 top-left.
 */
export function padGridOrder(layout = 'mpc') {
  const order = [];
  if (layout === 'reading') {
    for (let i = 0; i < 16; i++) order.push(i);
  } else {
    for (let row = 3; row >= 0; row--) {
      for (let col = 0; col < 4; col++) order.push(row * 4 + col);
    }
  }
  return order;
}
