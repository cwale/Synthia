/* Synthesised percussion and one-shot pad voices.

   Everything here is generated from oscillators and filtered noise — no sample
   files. That keeps the whole app a couple of hundred kilobytes, works offline
   from the first load, and means no licensing questions about drum samples. */

import { clamp, noteToFreq } from '../util.js';
import { noiseBuffer } from './engine.js';

const activeShots = new Set();

class OneShot {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(dest);
    this.nodes = [this.out];
    this.sources = [];
  }

  add(node) {
    this.nodes.push(node);
    return node;
  }

  src(node) {
    this.sources.push(node);
    this.nodes.push(node);
    return node;
  }

  noise() {
    const s = this.ctx.createBufferSource();
    s.buffer = noiseBuffer(this.ctx);
    s.loop = true;
    // Random read offset stops repeated hits sounding identical.
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    return this.src(s);
  }

  /** Percussive gain envelope: instant-ish attack then exponential-ish decay. */
  env(target, time, peak, decay, attack = 0.001) {
    const g = target.gain;
    g.setValueAtTime(0, time);
    g.linearRampToValueAtTime(peak, time + attack);
    g.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.001), time + attack + decay);
    g.linearRampToValueAtTime(0, time + attack + decay + 0.01);
    return g;
  }

  commit(time, endTime) {
    for (const s of this.sources) {
      try { s.start(time); } catch { /* ignore */ }
      try { s.stop(endTime); } catch { /* ignore */ }
    }
    activeShots.add(this);
    const first = this.sources[0];
    if (first) {
      first.onended = () => this.dispose();
    } else {
      setTimeout(() => this.dispose(), (endTime - this.ctx.currentTime + 0.1) * 1000);
    }
  }

  kill(time) {
    const g = this.out.gain;
    try {
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(time);
      else g.cancelScheduledValues(time);
      g.setValueAtTime(g.value, time);
      g.linearRampToValueAtTime(0, time + 0.01);
    } catch { /* ignore */ }
  }

  dispose() {
    activeShots.delete(this);
    for (const n of this.nodes) {
      try { n.disconnect(); } catch { /* ignore */ }
    }
    this.nodes.length = 0;
    this.sources.length = 0;
  }
}

export function panicDrums(ctx) {
  const t = ctx.currentTime;
  for (const shot of [...activeShots]) shot.kill(t);
}

export function activeDrumCount() {
  return activeShots.size;
}

/* ---- individual voices --------------------------------------------------- */

function biquad(shot, type, hz, q = 1) {
  const f = shot.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  return shot.add(f);
}

const VOICES = {
  kick(shot, def, vel, t) {
    const decay = def.decay ?? 0.42;
    const tune = def.tune ?? 52;
    const osc = shot.src(shot.ctx.createOscillator());
    osc.type = 'sine';
    osc.frequency.setValueAtTime(tune * 3.2, t);
    osc.frequency.exponentialRampToValueAtTime(tune, t + 0.055);
    const g = shot.add(shot.ctx.createGain());
    shot.env(g, t, vel, decay, 0.002);
    osc.connect(g).connect(shot.out);

    // Beater click, so it still reads on a phone speaker with no low end.
    const n = shot.noise();
    const hp = biquad(shot, 'highpass', 1400);
    const ng = shot.add(shot.ctx.createGain());
    shot.env(ng, t, vel * 0.25, 0.012);
    n.connect(hp).connect(ng).connect(shot.out);
    return decay + 0.1;
  },

  snare(shot, def, vel, t) {
    const decay = def.decay ?? 0.19;
    const n = shot.noise();
    const bp = biquad(shot, 'bandpass', def.tune ?? 1900, 0.9);
    const ng = shot.add(shot.ctx.createGain());
    shot.env(ng, t, vel * 0.7, decay);
    n.connect(bp).connect(ng).connect(shot.out);

    for (const f of [185, 331]) {
      const osc = shot.src(shot.ctx.createOscillator());
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = shot.add(shot.ctx.createGain());
      shot.env(g, t, vel * 0.4, 0.085);
      osc.connect(g).connect(shot.out);
    }
    return decay + 0.1;
  },

  clap(shot, def, vel, t) {
    const bp = biquad(shot, 'bandpass', def.tune ?? 1150, 1.6);
    bp.connect(shot.out);
    // Three fast slaps plus a tail is what makes a clap sound like hands.
    for (let i = 0; i < 3; i++) {
      const n = shot.noise();
      const g = shot.add(shot.ctx.createGain());
      shot.env(g, t + i * 0.012, vel * 0.55, 0.022);
      n.connect(g).connect(bp);
    }
    const tailNoise = shot.noise();
    const tail = shot.add(shot.ctx.createGain());
    shot.env(tail, t + 0.028, vel * 0.35, def.decay ?? 0.14);
    tailNoise.connect(tail).connect(bp);
    return 0.3;
  },

  hat(shot, def, vel, t) {
    const decay = def.decay ?? 0.055;
    const n = shot.noise();
    const hp = biquad(shot, 'highpass', 7200);
    const bp = biquad(shot, 'bandpass', def.tune ?? 10500, 1.2);
    const g = shot.add(shot.ctx.createGain());
    shot.env(g, t, vel * 0.42, decay);
    n.connect(hp).connect(bp).connect(g).connect(shot.out);
    return decay + 0.1;
  },

  cymbal(shot, def, vel, t) {
    const decay = def.decay ?? 1.1;
    const n = shot.noise();
    const hp = biquad(shot, 'highpass', 4200);
    const g = shot.add(shot.ctx.createGain());
    shot.env(g, t, vel * 0.3, decay, 0.004);
    n.connect(hp).connect(g).connect(shot.out);
    // A few inharmonic partials give it some metal.
    for (const ratio of [1, 1.41, 1.93]) {
      const osc = shot.src(shot.ctx.createOscillator());
      osc.type = 'square';
      osc.frequency.value = (def.tune ?? 320) * ratio;
      const og = shot.add(shot.ctx.createGain());
      shot.env(og, t, vel * 0.05, decay * 0.6);
      osc.connect(og).connect(hp);
    }
    return decay + 0.2;
  },

  tom(shot, def, vel, t) {
    const decay = def.decay ?? 0.3;
    const tune = def.tune ?? 180;
    const osc = shot.src(shot.ctx.createOscillator());
    osc.type = 'sine';
    osc.frequency.setValueAtTime(tune * 1.7, t);
    osc.frequency.exponentialRampToValueAtTime(tune, t + decay * 0.5);
    const g = shot.add(shot.ctx.createGain());
    shot.env(g, t, vel * 0.8, decay, 0.002);
    osc.connect(g).connect(shot.out);
    const n = shot.noise();
    const ng = shot.add(shot.ctx.createGain());
    shot.env(ng, t, vel * 0.1, 0.02);
    n.connect(ng).connect(shot.out);
    return decay + 0.1;
  },

  rim(shot, def, vel, t) {
    const n = shot.noise();
    const bp = biquad(shot, 'bandpass', def.tune ?? 1750, 5);
    const g = shot.add(shot.ctx.createGain());
    shot.env(g, t, vel * 0.6, def.decay ?? 0.035);
    n.connect(bp).connect(g).connect(shot.out);
    const osc = shot.src(shot.ctx.createOscillator());
    osc.type = 'square';
    osc.frequency.value = (def.tune ?? 1750) * 0.5;
    const og = shot.add(shot.ctx.createGain());
    shot.env(og, t, vel * 0.2, 0.02);
    osc.connect(og).connect(shot.out);
    return 0.15;
  },

  cowbell(shot, def, vel, t) {
    const decay = def.decay ?? 0.28;
    const bp = biquad(shot, 'bandpass', 2400, 1.4);
    const g = shot.add(shot.ctx.createGain());
    shot.env(g, t, vel * 0.35, decay, 0.002);
    bp.connect(g).connect(shot.out);
    for (const f of [(def.tune ?? 540), (def.tune ?? 540) * 1.48]) {
      const osc = shot.src(shot.ctx.createOscillator());
      osc.type = 'square';
      osc.frequency.value = f;
      osc.connect(bp);
    }
    return decay + 0.1;
  },

  shaker(shot, def, vel, t) {
    const decay = def.decay ?? 0.1;
    const n = shot.noise();
    const hp = biquad(shot, 'highpass', 5200);
    const g = shot.add(shot.ctx.createGain());
    // Soft attack is what separates a shaker from a hat.
    shot.env(g, t, vel * 0.3, decay, 0.012);
    n.connect(hp).connect(g).connect(shot.out);
    return decay + 0.1;
  },

  marimba(shot, def, vel, t) {
    const decay = def.decay ?? 0.5;
    const freq = def.note != null ? noteToFreq(def.note) : (def.tune ?? 440);
    for (const [ratio, level, dec] of [[1, 1, 1], [4.02, 0.22, 0.45], [9.1, 0.06, 0.25]]) {
      const osc = shot.src(shot.ctx.createOscillator());
      osc.type = 'sine';
      osc.frequency.value = freq * ratio;
      const g = shot.add(shot.ctx.createGain());
      shot.env(g, t, vel * 0.55 * level, decay * dec, 0.002);
      osc.connect(g).connect(shot.out);
    }
    return decay + 0.15;
  },

  bell(shot, def, vel, t) {
    const decay = def.decay ?? 1.6;
    const freq = def.note != null ? noteToFreq(def.note) : (def.tune ?? 660);
    const carrier = shot.src(shot.ctx.createOscillator());
    carrier.type = 'sine';
    carrier.frequency.value = freq;
    const mod = shot.src(shot.ctx.createOscillator());
    mod.type = 'sine';
    mod.frequency.value = freq * (def.ratio ?? 3.47);
    const modGain = shot.add(shot.ctx.createGain());
    modGain.gain.setValueAtTime(freq * 4 * vel, t);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.05, t + decay * 0.4);
    mod.connect(modGain).connect(carrier.frequency);
    const g = shot.add(shot.ctx.createGain());
    shot.env(g, t, vel * 0.4, decay, 0.002);
    carrier.connect(g).connect(shot.out);
    return decay + 0.2;
  },

  chime(shot, def, vel, t) {
    const decay = def.decay ?? 2.4;
    const freq = def.note != null ? noteToFreq(def.note) : (def.tune ?? 880);
    for (const [ratio, level] of [[1, 1], [2.76, 0.4], [5.4, 0.15]]) {
      const osc = shot.src(shot.ctx.createOscillator());
      osc.type = 'sine';
      osc.frequency.value = freq * ratio;
      const g = shot.add(shot.ctx.createGain());
      shot.env(g, t, vel * 0.28 * level, decay * (1 / (1 + ratio * 0.2)), 0.004);
      osc.connect(g).connect(shot.out);
    }
    return decay + 0.2;
  },

  woodblock(shot, def, vel, t) {
    const osc = shot.src(shot.ctx.createOscillator());
    osc.type = 'triangle';
    osc.frequency.value = def.tune ?? 1180;
    const g = shot.add(shot.ctx.createGain());
    shot.env(g, t, vel * 0.5, def.decay ?? 0.06);
    osc.connect(g).connect(shot.out);
    const n = shot.noise();
    const bp = biquad(shot, 'bandpass', 2600, 3);
    const ng = shot.add(shot.ctx.createGain());
    shot.env(ng, t, vel * 0.2, 0.012);
    n.connect(bp).connect(ng).connect(shot.out);
    return 0.2;
  },

  pluck(shot, def, vel, t) {
    const decay = def.decay ?? 0.35;
    const freq = def.note != null ? noteToFreq(def.note) : (def.tune ?? 220);
    const osc = shot.src(shot.ctx.createOscillator());
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const lp = biquad(shot, 'lowpass', freq * 12, 3);
    lp.frequency.setValueAtTime(Math.min(16000, freq * 14), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 1.5), t + decay * 0.7);
    const g = shot.add(shot.ctx.createGain());
    shot.env(g, t, vel * 0.4, decay, 0.002);
    osc.connect(lp).connect(g).connect(shot.out);
    return decay + 0.15;
  },

  bass(shot, def, vel, t) {
    const decay = def.decay ?? 0.4;
    const freq = def.note != null ? noteToFreq(def.note) : (def.tune ?? 65);
    const osc = shot.src(shot.ctx.createOscillator());
    osc.type = def.wave || 'sine';
    osc.frequency.value = freq;
    const lp = biquad(shot, 'lowpass', 900, 2);
    const g = shot.add(shot.ctx.createGain());
    shot.env(g, t, vel * 0.7, decay, 0.004);
    osc.connect(lp).connect(g).connect(shot.out);
    return decay + 0.15;
  },

  /* ---- playful voices, mostly for Bash mode ---- */

  boing(shot, def, vel, t) {
    const decay = def.decay ?? 0.45;
    const osc = shot.src(shot.ctx.createOscillator());
    osc.type = 'sine';
    const hi = def.tune ?? 620;
    osc.frequency.setValueAtTime(hi, t);
    osc.frequency.exponentialRampToValueAtTime(hi * 0.22, t + decay);
    const lfo = shot.src(shot.ctx.createOscillator());
    lfo.frequency.value = 17;
    const lfoGain = shot.add(shot.ctx.createGain());
    lfoGain.gain.setValueAtTime(hi * 0.25, t);
    lfoGain.gain.exponentialRampToValueAtTime(1, t + decay);
    lfo.connect(lfoGain).connect(osc.frequency);
    const g = shot.add(shot.ctx.createGain());
    shot.env(g, t, vel * 0.45, decay, 0.004);
    osc.connect(g).connect(shot.out);
    return decay + 0.15;
  },

  zap(shot, def, vel, t) {
    const decay = def.decay ?? 0.28;
    const osc = shot.src(shot.ctx.createOscillator());
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(def.tune ?? 1800, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + decay);
    const lp = biquad(shot, 'lowpass', 4000, 6);
    const g = shot.add(shot.ctx.createGain());
    shot.env(g, t, vel * 0.32, decay, 0.002);
    osc.connect(lp).connect(g).connect(shot.out);
    return decay + 0.15;
  },

  pop(shot, def, vel, t) {
    const decay = def.decay ?? 0.09;
    const osc = shot.src(shot.ctx.createOscillator());
    osc.type = 'sine';
    osc.frequency.setValueAtTime(def.tune ?? 210, t);
    osc.frequency.exponentialRampToValueAtTime((def.tune ?? 210) * 4.5, t + decay * 0.8);
    const g = shot.add(shot.ctx.createGain());
    shot.env(g, t, vel * 0.5, decay, 0.002);
    osc.connect(g).connect(shot.out);
    return decay + 0.1;
  },

  whoosh(shot, def, vel, t) {
    const decay = def.decay ?? 0.55;
    const n = shot.noise();
    const bp = biquad(shot, 'bandpass', 400, 2.2);
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(4200, t + decay);
    const g = shot.add(shot.ctx.createGain());
    shot.env(g, t, vel * 0.4, decay, 0.06);
    n.connect(bp).connect(g).connect(shot.out);
    return decay + 0.15;
  },

  laser(shot, def, vel, t) {
    const decay = def.decay ?? 0.3;
    const osc = shot.src(shot.ctx.createOscillator());
    osc.type = 'square';
    osc.frequency.setValueAtTime(def.tune ?? 1500, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + decay);
    const g = shot.add(shot.ctx.createGain());
    shot.env(g, t, vel * 0.22, decay, 0.002);
    osc.connect(g).connect(shot.out);
    return decay + 0.15;
  },

  bubble(shot, def, vel, t) {
    // Three rising blips — reads as "bloop bloop bloop".
    for (let i = 0; i < 3; i++) {
      const start = t + i * 0.075;
      const osc = shot.src(shot.ctx.createOscillator());
      osc.type = 'sine';
      const f = (def.tune ?? 380) * (1 + i * 0.35);
      osc.frequency.setValueAtTime(f, start);
      osc.frequency.exponentialRampToValueAtTime(f * 2.6, start + 0.05);
      const g = shot.add(shot.ctx.createGain());
      shot.env(g, start, vel * 0.3, 0.06, 0.002);
      osc.connect(g).connect(shot.out);
    }
    return 0.4;
  },
};

export const DRUM_VOICE_TYPES = Object.keys(VOICES);

/**
 * Fire a pad. `def` is a pad definition from a kit.
 * @returns {number} approximate voice length in seconds, for UI animation.
 */
export function triggerPad(ctx, dest, def, velocity = 1, time = null) {
  const voice = VOICES[def.type];
  if (!voice) {
    console.warn(`[drums] unknown voice type "${def.type}"`);
    return 0;
  }
  const t = time ?? ctx.currentTime;
  const shot = new OneShot(ctx, dest);
  shot.out.gain.value = clamp(def.gain ?? 1, 0, 2);
  const length = voice(shot, def, clamp(velocity, 0.02, 1), t) || 0.5;
  shot.commit(t, t + length + 0.05);
  return length;
}
