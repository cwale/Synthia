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
    id: 'acoustic',
    name: 'Acoustic Kit',
    blurb: 'A modelled drum kit. Hit harder for more crack, click and sizzle.',
    pads: [
      { name: 'Kick', type: 'akick', tune: 56, color: C.kick },
      { name: 'Snare', type: 'asnare', tune: 190, color: C.snare },
      { name: 'Rimshot', type: 'asnare', tune: 200, rim: true, color: C.snare },
      { name: 'Side stick', type: 'sidestick', color: C.perc },

      { name: 'Hat', type: 'ahat', decay: 0.05, choke: 'hat', color: C.hat },
      { name: 'Hat pedal', type: 'ahat', decay: 0.03, pedal: true, choke: 'hat', color: C.hat },
      { name: 'Hat open', type: 'ahat', decay: 0.75, choke: 'hat', color: C.hat },
      { name: 'Crash', type: 'crash', decay: 2.2, color: C.metal },

      { name: 'Tom hi', type: 'atom', tune: 205, color: C.perc },
      { name: 'Tom mid', type: 'atom', tune: 160, color: C.perc },
      { name: 'Tom lo', type: 'atom', tune: 122, decay: 1.15, color: C.perc },
      { name: 'Floor tom', type: 'atom', tune: 92, decay: 1.3, color: C.perc },

      { name: 'Ride', type: 'ride', decay: 2.6, color: C.metal },
      { name: 'Ride bell', type: 'ride', bell: true, color: C.metal },
      { name: 'Tambourine', type: 'tambourine', color: C.hat },
      { name: 'Cowbell', type: 'cowbell', color: C.metal },
    ],
  },

  {
    id: 'orchestra',
    name: 'Orchestral Percussion',
    blurb: 'Timpani, gran cassa, cymbals and the tuned percussion section.',
    pads: [
      { name: 'Timpani D', type: 'timpani', note: 38, color: C.deep },
      { name: 'Timpani A', type: 'timpani', note: 45, color: C.deep },
      { name: 'Bass drum', type: 'bassdrum', color: C.kick },
      { name: 'Snare', type: 'asnare', tune: 230, wires: 0.42, decay: 1.2, color: C.snare },

      { name: 'Clash cymbals', type: 'crash', decay: 3.2, pair: true, size: 0.9, color: C.metal },
      { name: 'Susp. cymbal', type: 'crash', decay: 3.4, swell: 0.35, size: 1.1, color: C.metal },
      { name: 'Triangle', type: 'triangle', color: C.hat },
      { name: 'Tambourine', type: 'tambourine', skin: true, color: C.hat },

      { name: 'Glockenspiel', type: 'mallet', modes: 'glockenspiel', note: 96, click: 6000, color: C.tuned },
      { name: 'Xylophone', type: 'mallet', modes: 'xylophone', note: 84, hardness: 0.75, color: C.tuned },
      { name: 'Tubular bell', type: 'mallet', modes: 'tubular', note: 72, click: 3000, gain: 0.6, color: C.tuned },
      { name: 'Tam-tam', type: 'gong', color: C.deep },

      { name: 'Woodblock', type: 'woodblock', color: C.perc },
      { name: 'Claves', type: 'claves', color: C.perc },
      { name: 'Sleigh bells', type: 'sleighbells', color: C.hat },
      { name: 'Castanets', type: 'castanets', color: C.perc },
    ],
  },

  {
    id: 'hand',
    name: 'Hand Percussion',
    blurb: 'Congas, bongos, djembe and cajon, plus the shakers and scrapers.',
    pads: [
      { name: 'Conga open', type: 'hand', tune: 196, stroke: 'open', color: C.perc },
      { name: 'Conga slap', type: 'hand', tune: 196, stroke: 'slap', crack: 2300, color: C.snare },
      { name: 'Conga mute', type: 'hand', tune: 196, stroke: 'mute', color: C.perc },
      { name: 'Tumba', type: 'hand', tune: 148, stroke: 'open', decay: 1.2, color: C.kick },

      { name: 'Bongo hi', type: 'hand', tune: 410, stroke: 'open', decay: 0.6, color: C.perc },
      { name: 'Bongo lo', type: 'hand', tune: 300, stroke: 'open', decay: 0.7, color: C.perc },
      { name: 'Djembe bass', type: 'hand', tune: 78, stroke: 'bass', color: C.kick },
      { name: 'Djembe slap', type: 'hand', tune: 330, stroke: 'slap', crack: 2900, color: C.snare },

      { name: 'Cajon bass', type: 'hand', tune: 82, stroke: 'bass', wires: 0.08, color: C.kick },
      { name: 'Cajon slap', type: 'hand', tune: 260, stroke: 'slap', crack: 1600, wires: 0.3, color: C.snare },
      { name: 'Agogo hi', type: 'agogo', tune: 920, color: C.metal },
      { name: 'Agogo lo', type: 'agogo', tune: 650, color: C.metal },

      { name: 'Shaker', type: 'shaker', color: C.hat },
      { name: 'Cabasa', type: 'cabasa', color: C.hat },
      { name: 'Guiro', type: 'guiro', color: C.perc },
      { name: 'Claves', type: 'claves', tune: 2300, color: C.perc },
    ],
  },

  {
    id: 'studio',
    name: 'Electro Kit',
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
      { name: 'Boom', type: 'kick', tune: 41, decay: 0.95, gain: 0.9, color: C.kick },
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
