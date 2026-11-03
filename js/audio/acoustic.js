/* Acoustic instruments: one recorded, the rest modelled in code.

   Three kinds of voice share one shell, so the synth's voice allocation,
   sustain pedal, pitch bend and macros treat them exactly like SynthVoice:

   - SampledVoice plays a recording. Only the grand piano: it is the one
     instrument a practical model cannot make convincing.
   - ModalVoice models struck bars, tubes, plates and bells as a set of
     resonant modes, each its own sine with its own decay. Real mallet
     instruments are well described this way — the ratios below are the
     measured mode frequencies of each instrument family — so the model is not
     an approximation of a recording, it is the same physics a recording
     captures, and it gives every velocity its own brightness for free.
   - StringVoice models plucked strings with extended Karplus–Strong synthesis:
     a burst of noise circulating in a tuned delay line, losing energy and
     high frequencies on each pass the way a vibrating string does. Each note
     is rendered into a buffer the first time it is played and kept, because
     a delay line short enough for a high note is shorter than Web Audio's
     own feedback-loop minimum. */

import { clamp, noteToFreq } from '../util.js';
import { noiseBuffer } from './engine.js';
import { SynthVoice } from './voice.js';
import { pickSample, bankReady } from './samples.js';

function cancelAndHold(param, t) {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(t);
  } else {
    const v = param.value;
    param.cancelScheduledValues(t);
    param.setValueAtTime(v, t);
  }
}

/** A velocity of 0..1 as a gain, over a dynamic range in dB. */
export function velocityGain(v, rangeDb = 30, curve = 1.5) {
  return Math.pow(10, (-rangeDb * Math.pow(1 - clamp(v, 0, 1), curve)) / 20);
}

/* ==========================================================================
   Shared shell: sources -> tone filter -> amp -> pan -> out
   ========================================================================== */

class AcousticVoice {
  constructor(ctx, dest, patch, onDone) {
    this.ctx = ctx;
    this.patch = patch;
    this.onDone = onDone;
    this.dead = false;
    this.note = 60;
    this._nodes = [];
    this._sources = [];
    this._bend = 0;

    // The tone filter sits wide open at the Tone knob's default, so a real
    // instrument sounds like itself until someone reaches for the knob.
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = patch.tone?.q ?? 0.5;

    this.amp = ctx.createGain();
    this.amp.gain.value = 1;
    this.panner = ctx.createStereoPanner();

    this.filter.connect(this.amp).connect(this.panner).connect(dest);
    this._nodes.push(this.filter, this.amp, this.panner);
    this.input = this.filter;
  }

  start(note, velocity, time, mod = {}) {
    const p = this.patch;
    this.note = note + (p.transpose || 0);
    this.velocity = velocity;
    this._bend = mod.bendCents || 0;
    this._macros = mod.macros || {};

    this.setCutoffMacro(mod.cutoffMacro ?? 0.75, time);
    if (mod.resonanceMacro != null) this.setResonanceMacro(mod.resonanceMacro, time);

    // Players sit at the keyboard: low notes to the left, high to the right.
    const spread = (p.panSpread ?? 0) * (Math.random() * 2 - 1);
    const byPitch = (p.pitchPan ?? 0) * clamp((this.note - 64) / 40, -1, 1);
    this.panner.pan.value = clamp(byPitch + spread, -1, 1);

    // The Attack macro still means something on an acoustic instrument: it
    // swells the note in, which is how you get a bowed or reversed feel.
    const swell = Math.max(p.swell ?? 0, (this._macros.attack ?? 0) * 1.6);
    if (swell > 0.005) {
      this.amp.gain.setValueAtTime(0, time);
      this.amp.gain.linearRampToValueAtTime(1, time + swell);
    }

    const length = this.build(this.note, velocity, time);
    this._naturalEnd = time + length;
    this._scheduleEnd(time + length);
  }

  /** Subclasses connect sources into this.input and return the note's length. */
  build() {
    return 1;
  }

  /**
   * How long the note takes to stop once the key is let go, or null if it
   * keeps ringing — a marimba bar does not stop because the key came up.
   */
  releaseTime() {
    const r = this.patch.damp;
    if (r == null) return null;
    return r * (0.3 + (this._macros?.release ?? 0.5) * 1.4);
  }

  release(time) {
    if (this.dead || this._released) return;
    const r = this.releaseTime();
    if (r == null) return;
    this._released = true;
    const g = this.amp.gain;
    cancelAndHold(g, time);
    // Dampers don't stop a string dead, they bleed the energy out quickly.
    g.setTargetAtTime(0, time, Math.max(0.005, r / 4));
    this._scheduleEnd(Math.min(this._naturalEnd ?? Infinity, time + r + 0.05));
  }

  kill(time, fade = 0.012) {
    if (this.dead) return;
    const g = this.amp.gain;
    cancelAndHold(g, time);
    g.linearRampToValueAtTime(0, time + fade);
    this._scheduleEnd(time + fade + 0.01);
  }

  _scheduleEnd(when) {
    if (this.dead) return;
    if (this._end != null && when >= this._end) return;
    this._end = when;
    for (const s of this._sources) {
      try { s.stop(when); } catch { /* already stopped */ }
    }
    clearTimeout(this._timer);
    // A timer, not a source's onended: the sources here end at different
    // times, and the first to finish is often only the strike noise.
    const ms = Math.max(0, (when - this.ctx.currentTime) * 1000) + 80;
    this._timer = setTimeout(() => this._teardown(), ms);
  }

  _teardown() {
    if (this.dead) return;
    this.dead = true;
    clearTimeout(this._timer);
    for (const n of [...this._nodes, ...this._sources]) {
      try { n.disconnect(); } catch { /* ignore */ }
    }
    this._nodes.length = 0;
    this._sources.length = 0;
    this.onDone?.(this);
  }

  _track(node) {
    this._nodes.push(node);
    return node;
  }

  _source(node) {
    this._sources.push(node);
    return node;
  }

  setBendCents(cents) {
    if (this.dead) return;
    this._bend = cents;
    for (const s of this._sources) {
      if (s.detune && s._cents != null) s.detune.value = s._cents + cents;
    }
  }

  setCutoffMacro(macro, time = this.ctx.currentTime) {
    if (this.dead) return;
    const hz = this.patch.tone?.hz ?? 16000;
    // The same five-octave sweep as the synth's filter, centred on the default.
    const f = clamp(hz * Math.pow(2, (macro - 0.75) * 5), 60, 20000);
    this.filter.frequency.setTargetAtTime(f, time, 0.02);
  }

  setResonanceMacro(v, time = this.ctx.currentTime) {
    if (this.dead) return;
    const q = clamp((this.patch.tone?.q ?? 0.5) + v * 10, 0.0001, 18);
    this.filter.Q.setTargetAtTime(q, time, 0.03);
  }
}

/* ==========================================================================
   Recorded: grand piano
   ========================================================================== */

/** Above about F6 a piano has no dampers — the strings ring however you play. */
const UNDAMPED_FROM = 89;

export class SampledVoice extends AcousticVoice {
  build(note, velocity, time) {
    const p = this.patch;
    const hit = pickSample(p.sampler.bank, note, velocity);
    if (!hit) return 0.05;

    const rate = Math.pow(2, (note - hit.root) / 12);
    const level = (p.gain ?? 0.3) * velocityGain(velocity, p.sampler.rangeDb ?? 30, 1.5);
    // Two slightly detuned copies is all a honky-tonk upright really is.
    const copies = p.sampler.double ? [-p.sampler.double, p.sampler.double] : [0];
    let length = 0;

    for (const cents of copies) {
      const src = this._source(this.ctx.createBufferSource());
      src.buffer = hit.buffer;
      src.playbackRate.value = rate;
      src._cents = cents;
      src.detune.value = cents + this._bend;
      const g = this._track(this.ctx.createGain());
      g.gain.value = level / copies.length ** 0.5;
      src.connect(g).connect(this.input);
      src.start(time, hit.offset);
      length = Math.max(length, (hit.buffer.duration - hit.offset) / rate);
    }
    return length;
  }

  releaseTime() {
    if (this.note >= UNDAMPED_FROM) return null;
    const base = this.patch.damp ?? 0.3;
    // Bass dampers sit on heavier strings and take longer to stop them.
    const heavier = clamp((60 - this.note) / 36, 0, 1) * 0.25;
    return (base + heavier) * (0.3 + (this._macros?.release ?? 0.5) * 1.4);
  }
}

/* ==========================================================================
   Modal: struck bars, tubes, plates and bells
   ========================================================================== */

/**
 * Mode tables, as [ratio to the sounding pitch, level, T60 seconds at A4].
 *
 * Bars on a marimba, xylophone and vibraphone are cut so their overtones fall
 * on harmonics (4x, 10x; 3x for a xylophone), which is why they sound pitched
 * rather than clangy. A glockenspiel's bars are not, and keep the free-bar
 * ratios 2.76, 5.40, 8.93. Tubular bells are heard at half their fourth
 * mode, so the fundamental sits well below the note you hear. Church bell
 * ratios are the traditional hum, prime, tierce (a minor third), quint and
 * nominal that bell founders tune to.
 */
export const MODES = {
  marimba: [[1, 1, 1.6], [3.99, 0.22, 0.45], [9.85, 0.06, 0.16]],
  xylophone: [[1, 1, 0.9], [3.0, 0.42, 0.42], [6.2, 0.16, 0.18], [9.9, 0.07, 0.09]],
  vibraphone: [[1, 1, 5.5], [4.0, 0.16, 1.6], [10.1, 0.035, 0.5]],
  glockenspiel: [[1, 1, 3.2], [2.76, 0.42, 1.4], [5.4, 0.22, 0.7], [8.93, 0.12, 0.35]],
  celesta: [[1, 1, 1.9], [2.0, 0.1, 0.9], [4.08, 0.09, 0.45], [7.1, 0.03, 0.2]],
  tubular: [
    [0.224, 0.12, 4.5], [0.618, 0.28, 5.5], [1.209, 0.55, 6.5],
    [2.0, 1, 7.5], [2.987, 0.6, 5.5], [4.174, 0.32, 3.5],
  ],
  churchBell: [
    [0.5, 0.55, 14], [1.0, 0.7, 10], [1.183, 0.6, 8], [1.506, 0.3, 6],
    [2.0, 0.9, 6], [2.514, 0.3, 4], [2.662, 0.22, 3.5], [3.011, 0.2, 3], [4.166, 0.14, 2],
  ],
  musicBox: [[1, 1, 2.4], [5.93, 0.12, 0.5], [17.5, 0.04, 0.1]],
  kalimba: [[1, 1, 1.9], [5.75, 0.2, 0.25], [2.01, 0.05, 0.6]],
  toyPiano: [[1, 1, 1.3], [2.42, 0.32, 0.6], [4.11, 0.24, 0.35], [6.9, 0.1, 0.15]],
  steelPan: [[1, 1, 2.2], [2.0, 0.5, 1.3], [3.0, 0.24, 0.8], [4.02, 0.1, 0.4]],
  // Two modes close together beat against each other — the slow wah of a bowl.
  singingBowl: [[1, 1, 14], [1.004, 0.7, 14], [2.71, 0.38, 8], [2.716, 0.25, 8], [5.15, 0.14, 4], [8.43, 0.06, 2.5]],
  // An electric-piano tine: a near-sine fundamental and a bright, short "bark".
  tine: [[1, 1, 3.2], [2.0, 0.08, 1.2], [7.02, 0.16, 0.12], [13.6, 0.04, 0.05]],
};

/** Strike sound for each mallet: [bandpass Hz, Q, level, decay seconds]. */
const MALLETS = {
  rubber: [900, 0.8, 0.18, 0.012],
  yarn: [600, 0.7, 0.08, 0.02],
  hard: [3200, 1.2, 0.35, 0.008],
  brass: [5200, 2, 0.3, 0.006],
  hammer: [2600, 0.9, 0.22, 0.01],
  felt: [400, 0.7, 0.05, 0.03],
  pluck: [1800, 1, 0.16, 0.006],
};

export class ModalVoice extends AcousticVoice {
  build(note, velocity, time) {
    const ctx = this.ctx;
    const p = this.patch;
    const m = p.modal;
    const f0 = noteToFreq(note);
    const modes = MODES[m.modes] || MODES.marimba;

    // Hit harder, and the upper modes come up relative to the fundamental —
    // which is what a harder hit sounds like, more than it sounds louder.
    const hardness = clamp((m.hardness ?? 0.5) + (velocity - 0.6) * (m.velBright ?? 0.6), 0.05, 1);
    const level = (p.gain ?? 0.2) * velocityGain(velocity, m.rangeDb ?? 26, 1.4);
    // Short bars ring briefly; long ones go on. This scales every mode at once.
    const pitchDecay = Math.pow(440 / f0, m.decayTilt ?? 0.45) * (m.decay ?? 1);

    const sum = this._track(ctx.createGain());
    sum.gain.value = 1;
    sum.connect(this.input);

    // A vibraphone's motor spins discs in the resonators: a steady tremolo.
    if (m.tremolo) {
      const lfo = this._source(ctx.createOscillator());
      lfo.frequency.value = m.tremolo.rate;
      const depth = this._track(ctx.createGain());
      depth.gain.value = m.tremolo.depth / 2;
      sum.gain.value = 1 - m.tremolo.depth / 2;
      lfo.connect(depth).connect(sum.gain);
      lfo.start(time);
    }

    let longest = 0.1;
    const nyquist = ctx.sampleRate * 0.45;
    for (const [ratio, gain, t60] of modes) {
      const hz = f0 * ratio;
      if (hz > Math.min(nyquist, 18000)) continue;
      // Each octave above the fundamental loses level unless the mallet is hard.
      const tilt = Math.pow(0.35 + hardness * 0.65, Math.max(0, Math.log2(ratio)));
      const amp = level * gain * tilt;
      const decay = clamp(t60 * pitchDecay, 0.04, 20);

      const osc = this._source(ctx.createOscillator());
      osc.type = 'sine';
      osc.frequency.value = hz;
      osc._cents = 0;
      osc.detune.value = this._bend;
      const g = this._track(ctx.createGain());
      const attack = m.attack ?? 0.0015;
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(amp, time + attack);
      g.gain.exponentialRampToValueAtTime(Math.max(1e-5, amp * 0.001), time + attack + decay);
      osc.connect(g).connect(sum);
      osc.start(time);
      longest = Math.max(longest, attack + decay);
    }

    // The mallet itself: a short filtered tick, brighter for harder mallets.
    const mallet = MALLETS[m.mallet || 'rubber'];
    if (mallet && mallet[2] > 0) {
      const [bandHz, q, strikeLevel, strikeDecay] = mallet;
      const n = this._source(ctx.createBufferSource());
      n.buffer = noiseBuffer(ctx);
      const bp = this._track(ctx.createBiquadFilter());
      bp.type = 'bandpass';
      bp.frequency.value = clamp(bandHz * (0.6 + hardness * 0.8) * Math.pow(f0 / 440, 0.25), 200, 12000);
      bp.Q.value = q;
      const g = this._track(ctx.createGain());
      const amp = level * strikeLevel * (0.4 + hardness);
      g.gain.setValueAtTime(amp, time);
      g.gain.exponentialRampToValueAtTime(Math.max(1e-5, amp * 0.001), time + strikeDecay * 6);
      n.connect(bp).connect(g).connect(sum);
      n.start(time, Math.random() * 0.5);
    }

    return Math.min(longest, m.maxLength ?? 12);
  }
}

/* ==========================================================================
   Strings: extended Karplus–Strong, rendered per note
   ========================================================================== */

const renderCache = new Map();
const RENDER_CACHE_LIMIT = 48;

/**
 * Render one plucked note.
 *
 * The loop is the classic extended Karplus–Strong string: a delay line one
 * period long, a two-tap lowpass that makes high harmonics die first (as they
 * do on a real string), a loss factor chosen so the note falls 60 dB in the
 * decay time asked for, and an allpass that supplies the fraction of a sample
 * an integer delay line can't — without it, high notes go audibly out of tune.
 * The excitation's shape is the pluck: filtered for a soft fingertip, comb-
 * filtered for where along the string it was plucked.
 */
export function renderString(sampleRate, freq, spec, velocity) {
  const s = spec;
  const t60 = clamp((s.decay ?? 3) * Math.pow(220 / freq, s.decayTilt ?? 0.5), 0.15, s.maxLength ?? 6);
  const length = Math.ceil(Math.min(t60 * 1.1, s.maxLength ?? 6) * sampleRate);
  const out = new Float32Array(length);
  const strings = s.strings || [{ cents: 0, gain: 1 }];

  for (const str of strings) {
    const f = freq * Math.pow(2, (str.cents || 0) / 1200);
    const stretch = clamp(s.damping ?? 0.5, 0.05, 0.5);   // loop lowpass weight
    const period = sampleRate / f;
    const L = Math.max(2, Math.floor(period - stretch - 0.5));
    const frac = period - stretch - L;                    // 0.5 .. 1.5
    const C = (1 - frac) / (1 + frac);
    const loss = Math.pow(10, -3 / (t60 * f));             // per period

    // Excitation: noise, softened by a one-pole lowpass whose cutoff follows
    // how hard the string was plucked, then a pluck-position comb.
    const line = new Float32Array(L);
    const bright = clamp((s.brightness ?? 0.6) + (velocity - 0.6) * (s.velBright ?? 0.5), 0.05, 1);
    let lp = 0;
    for (let i = 0; i < L; i++) {
      lp += bright * ((Math.random() * 2 - 1) - lp);
      line[i] = lp;
    }
    const pick = Math.max(1, Math.round(L * (s.pickPosition ?? 0.2)));
    for (let i = L - 1; i >= pick; i--) line[i] -= line[i - pick];
    let peak = 0;
    for (let i = 0; i < L; i++) peak = Math.max(peak, Math.abs(line[i]));
    const norm = peak > 0 ? (str.gain ?? 1) / peak : 0;
    for (let i = 0; i < L; i++) line[i] *= norm;

    let idx = 0;
    let prev = 0;
    let apIn = 0;
    let apOut = 0;
    for (let n = 0; n < length; n++) {
      const x = line[idx];
      out[n] += x;
      const y = loss * ((1 - stretch) * x + stretch * prev);
      prev = x;
      const ap = C * y + apIn - C * apOut;
      apIn = y;
      apOut = ap;
      line[idx] = ap;
      idx++;
      if (idx === L) idx = 0;
    }
  }

  // A short fade at the end, so a note cut off by its length doesn't click.
  const fade = Math.min(length, Math.floor(sampleRate * 0.05));
  for (let i = 0; i < fade; i++) out[length - 1 - i] *= i / fade;
  return out;
}

function cachedString(ctx, patch, note, velocity) {
  // Three velocity buckets is plenty: the pluck is random noise anyway, so no
  // two renders are identical, and rendering takes a couple of milliseconds.
  const bucket = Math.min(2, Math.floor(velocity * 3));
  const key = `${patch.id}|${note}|${bucket}|${ctx.sampleRate}`;
  let buf = renderCache.get(key);
  if (buf) {
    renderCache.delete(key);
    renderCache.set(key, buf);   // most recently used goes to the back
    return buf;
  }
  const data = renderString(ctx.sampleRate, noteToFreq(note), patch.string, (bucket + 0.5) / 3);
  buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buf.copyToChannel(data, 0);
  renderCache.set(key, buf);
  while (renderCache.size > RENDER_CACHE_LIMIT) {
    renderCache.delete(renderCache.keys().next().value);
  }
  return buf;
}

export class StringVoice extends AcousticVoice {
  build(note, velocity, time) {
    const ctx = this.ctx;
    const p = this.patch;
    const s = p.string;
    // Harpsichord quills pluck the same way however hard the key goes down.
    const vel = s.fixedVelocity ?? velocity;
    const buf = cachedString(ctx, p, note, vel);

    const src = this._source(ctx.createBufferSource());
    src.buffer = buf;
    src._cents = 0;
    src.detune.value = this._bend;

    // The body: a guitar's air and top resonances, a harp's soundboard.
    let tail = src;
    for (const b of s.body || []) {
      const eq = this._track(ctx.createBiquadFilter());
      eq.type = 'peaking';
      eq.frequency.value = b.hz;
      eq.Q.value = b.q ?? 1;
      eq.gain.value = b.gain;
      tail.connect(eq);
      tail = eq;
    }

    const g = this._track(ctx.createGain());
    g.gain.value = (p.gain ?? 0.25) * (s.fixedVelocity != null ? 1 : velocityGain(velocity, s.rangeDb ?? 24, 1.4));
    tail.connect(g).connect(this.input);
    src.start(time);
    return buf.duration;
  }
}

/* ==========================================================================
   Factory
   ========================================================================== */

/**
 * The right voice for a patch. A sampled patch whose recordings haven't
 * arrived yet plays its synthesised stand-in, so a key is never silent while
 * the piano downloads.
 */
export function createVoice(ctx, dest, patch, onDone) {
  switch (patch.engine) {
    case 'sampler':
      if (bankReady(patch.sampler.bank)) return new SampledVoice(ctx, dest, patch, onDone);
      return new SynthVoice(ctx, dest, patch.fallback, onDone);
    case 'modal':
      return new ModalVoice(ctx, dest, patch, onDone);
    case 'string':
      return new StringVoice(ctx, dest, patch, onDone);
    default:
      return new SynthVoice(ctx, dest, patch, onDone);
  }
}
