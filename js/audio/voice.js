/* A single subtractive/FM synth voice. Nodes are built per note and torn down
   when the release finishes — simple to reason about, and the voice count is
   capped upstream so churn stays bounded. */

import { clamp, noteToFreq } from '../util.js';
import { noiseBuffer } from './engine.js';
import {
  shapeAmpEnvelope, filterEnvScale, lfoRateScale, lfoDepthBoost, widthScale,
} from './macros.js';

function cancelAndHold(param, t) {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(t);
  } else {
    const v = param.value;
    param.cancelScheduledValues(t);
    param.setValueAtTime(v, t);
  }
}

export class SynthVoice {
  constructor(ctx, dest, patch, onDone) {
    this.ctx = ctx;
    this.patch = patch;
    this.onDone = onDone;
    this.note = 60;
    this.dead = false;
    this._nodes = [];
    this._sources = [];

    const p = patch;

    this.amp = ctx.createGain();
    this.amp.gain.value = 0;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = p.filter.type || 'lowpass';
    this.filter.Q.value = p.filter.q ?? 1;

    this.panner = ctx.createStereoPanner();

    // Ring modulation sits between the filter and the amp: the carrier passes
    // through a gain whose value is driven by an oscillator, which multiplies
    // the two signals. Cheap, and the fastest route to genuinely strange.
    if (p.ring && p.ring.amount > 0) {
      this.ringGain = ctx.createGain();
      this.ringGain.gain.value = 1 - clamp(p.ring.amount, 0, 1);
      this.filter.connect(this.ringGain);
      this.ringGain.connect(this.amp);
      this._nodes.push(this.ringGain);
    } else {
      this.filter.connect(this.amp);
    }

    this.amp.connect(this.panner);
    this.panner.connect(dest);
    this._nodes.push(this.amp, this.filter, this.panner);
  }

  /**
   * @param {number} note      MIDI note number (already transposed/quantised)
   * @param {number} velocity  0..1
   * @param {number} time      AudioContext time to start at
   * @param {object} mod       { bendCents, cutoffMacro, resonanceMacro, glideFrom }
   */
  start(note, velocity, time, mod = {}) {
    const ctx = this.ctx;
    const p = this.patch;
    this.note = note;
    this.velocity = velocity;
    const freq = noteToFreq(note);
    this.baseFreq = freq;
    const bend = mod.bendCents || 0;

    /* ---- oscillators ---- */
    const unisonCount = clamp(p.unison?.voices ?? 1, 1, 3);
    const spread = p.unison?.spread ?? 0;

    for (const oscDef of p.oscs || []) {
      for (let u = 0; u < unisonCount; u++) {
        const osc = ctx.createOscillator();
        osc.type = oscDef.type;
        const uniDetune = unisonCount > 1 ? (u - (unisonCount - 1) / 2) * spread : 0;
        const cents = (oscDef.semi || 0) * 100 + (oscDef.cents || 0) + uniDetune;
        osc.detune.value = cents + bend;
        osc._cents = cents;

        const g = ctx.createGain();
        g.gain.value = (oscDef.level ?? 1) / unisonCount;

        osc.connect(g).connect(this.filter);
        this._nodes.push(g);
        this._sources.push(osc);
        this.oscs = this.oscs || [];
        this.oscs.push(osc);
      }
    }

    /* ---- sub oscillator ---- */
    if (p.sub && p.sub.level > 0) {
      const sub = ctx.createOscillator();
      sub.type = p.sub.type || 'sine';
      const cents = (p.sub.octave ?? -1) * 1200;
      sub.detune.value = cents + bend;
      sub._cents = cents;
      const g = ctx.createGain();
      g.gain.value = p.sub.level;
      sub.connect(g).connect(this.filter);
      this._nodes.push(g);
      this._sources.push(sub);
      this.oscs.push(sub);
    }

    /* ---- noise layer ---- */
    if (p.noise > 0) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = p.noise;
      src.connect(g).connect(this.filter);
      this._nodes.push(g);
      this._sources.push(src);
      this._noise = src;
    }

    /* ---- FM: one modulator into every carrier's frequency ---- */
    if (p.fm && p.fm.index > 0) {
      const modOsc = ctx.createOscillator();
      modOsc.type = p.fm.type || 'sine';
      modOsc.frequency.value = freq * (p.fm.ratio ?? 2);
      const modGain = ctx.createGain();
      const idx = p.fm.index * (0.4 + velocity * 0.6);
      modGain.gain.setValueAtTime(idx, time);
      if (p.fm.decay > 0) {
        // Bell-like: the modulation index falls away faster than the amplitude.
        modGain.gain.linearRampToValueAtTime(idx * 0.02, time + p.fm.decay);
      }
      modOsc.connect(modGain);
      for (const osc of this.oscs) {
        if (osc.frequency) modGain.connect(osc.frequency);
      }
      this._nodes.push(modGain);
      this._sources.push(modOsc);
    }

    /* ---- ring modulator ---- */
    if (this.ringGain && p.ring) {
      const ringOsc = ctx.createOscillator();
      ringOsc.type = p.ring.type || 'sine';
      ringOsc.frequency.value = p.ring.fixed || freq * (p.ring.ratio ?? 1.5);
      const depth = ctx.createGain();
      depth.gain.value = clamp(p.ring.amount, 0, 1);
      ringOsc.connect(depth).connect(this.ringGain.gain);
      this._nodes.push(depth);
      this._sources.push(ringOsc);
    }

    /* ---- set pitch, with optional glide ---- */
    const glide = mod.glideFrom && p.glide > 0 ? p.glide : 0;
    for (const osc of this.oscs) {
      if (!osc.frequency) continue;
      if (glide > 0) {
        osc.frequency.setValueAtTime(noteToFreq(mod.glideFrom), time);
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq), time + glide);
      } else {
        osc.frequency.setValueAtTime(freq, time);
      }
    }

    /* ---- pitch envelope: swoops, boings, slide whistles ---- */
    if (p.pitchEnv && p.pitchEnv.semis) {
      const offset = p.pitchEnv.semis * 100;
      const span = Math.max(0.005, p.pitchEnv.time ?? 0.25);
      for (const osc of this.oscs) {
        if (!osc.detune) continue;
        const base = (osc._cents || 0) + bend;
        osc.detune.setValueAtTime(base + offset, time);
        osc.detune.linearRampToValueAtTime(base, time + span);
      }
    }

    /* ---- LFO ----
       The Wobble macro can add movement to a patch that has none of its own,
       so an LFO is built whenever either the patch or the macro asks for one. */
    const macros = mod.macros || {};
    const lfoBoost = lfoDepthBoost(macros);
    const patchLfo = p.lfo && p.lfo.amount > 0 ? p.lfo : null;

    if (patchLfo || lfoBoost > 0) {
      const spec = patchLfo || { type: 'sine', rate: 5, target: 'pitch', amount: 0, delay: 0 };
      const amount = clamp((spec.amount || 0) + lfoBoost, 0, 1.5);
      const lfo = ctx.createOscillator();
      lfo.type = spec.type || 'sine';
      lfo.frequency.value = (spec.rate ?? 5) * lfoRateScale(macros);
      const depth = ctx.createGain();
      lfo.connect(depth);

      let target;
      if (spec.target === 'filter') {
        depth.gain.value = amount * 2000;
        target = this.filter.frequency;
      } else if (spec.target === 'amp') {
        depth.gain.value = amount * 0.3;
        target = this.amp.gain;
      } else if (spec.target === 'pan') {
        depth.gain.value = clamp(amount, 0, 1);
        target = this.panner.pan;
      } else {
        depth.gain.value = amount * 50; // cents of vibrato
        for (const osc of this.oscs) if (osc.detune) depth.connect(osc.detune);
      }
      if (target) depth.connect(target);

      // Fade the LFO in so sustained notes shimmer but attacks stay clean.
      if (spec.delay > 0) {
        const peak = depth.gain.value;
        depth.gain.setValueAtTime(0, time);
        depth.gain.linearRampToValueAtTime(peak, time + spec.delay);
      }
      this._nodes.push(depth);
      this._sources.push(lfo);
    }

    /* ---- filter cutoff + envelope ---- */
    const f = p.filter;
    const macro = mod.cutoffMacro ?? 0.75;
    // Exponential feel: the macro spans roughly a five-octave sweep.
    const macroMul = Math.pow(2, (macro - 0.75) * 5);
    const keytrack = (f.keytrack ?? 0) * (note - 60) * 28;
    const base = clamp(f.hz * macroMul + keytrack, 40, 17000);
    const envAmt = (f.env ?? 0) * filterEnvScale(macros)
      * (1 - (p.vel?.filter ?? 0) + (p.vel?.filter ?? 0) * velocity);
    const peak = clamp(base + envAmt * macroMul, 40, 18000);

    if (mod.resonanceMacro != null) {
      this.filter.Q.value = clamp((f.q ?? 1) + mod.resonanceMacro * 14, 0.0001, 22);
    }

    const fEnv = { a: f.envA ?? 0.005, d: f.envD ?? 0.25, s: f.envS ?? 0.4, r: f.envR ?? 0.3 };
    this._filterBase = base;
    this._filterEnv = fEnv;

    const fp = this.filter.frequency;
    fp.setValueAtTime(base, time);
    if (peak !== base) {
      fp.linearRampToValueAtTime(peak, time + fEnv.a);
      fp.linearRampToValueAtTime(base + (peak - base) * fEnv.s, time + fEnv.a + fEnv.d);
    }

    /* ---- amplitude envelope ---- */
    const a = shapeAmpEnvelope(p.amp, macros);
    this._ampEnv = a;
    const peakGain = (p.gain ?? 0.2) *
      (1 - (p.vel?.amp ?? 0.8) + (p.vel?.amp ?? 0.8) * velocity);
    const g = this.amp.gain;
    g.setValueAtTime(0, time);
    g.linearRampToValueAtTime(peakGain, time + Math.max(0.001, a.a));
    g.linearRampToValueAtTime(peakGain * a.s, time + Math.max(0.001, a.a) + a.d);
    this._peakGain = peakGain;

    /* ---- stereo placement ---- */
    const panSpread = (p.panSpread ?? 0) * widthScale(macros);
    if (p.lfo?.target !== 'pan') {
      this.panner.pan.value = panSpread ? clamp((Math.random() * 2 - 1) * panSpread, -1, 1) : 0;
    }

    for (const s of this._sources) {
      try { s.start(time); } catch { /* already started */ }
    }

    // Percussive patches (zero sustain) free themselves so held keys don't
    // pin a voice slot forever.
    if (a.s <= 0.001) {
      this._autoStop(time + Math.max(0.001, a.a) + a.d + 0.05);
    }
  }

  release(time) {
    if (this.dead) return;
    const p = this.patch;
    const r = Math.max(0.01, this._ampEnv?.r ?? p.amp.r);
    const g = this.amp.gain;
    cancelAndHold(g, time);
    g.linearRampToValueAtTime(0, time + r);

    const fp = this.filter.frequency;
    cancelAndHold(fp, time);
    fp.linearRampToValueAtTime(this._filterBase, time + Math.max(0.02, this._filterEnv?.r ?? 0.2));

    this._autoStop(time + r + 0.03);
  }

  /** Fast fade used for voice stealing and panic — avoids a click. */
  kill(time, fade = 0.012) {
    if (this.dead) return;
    const g = this.amp.gain;
    cancelAndHold(g, time);
    g.linearRampToValueAtTime(0, time + fade);
    this._autoStop(time + fade + 0.01);
  }

  _autoStop(when) {
    if (this._stopScheduled) return;
    this._stopScheduled = true;
    for (const s of this._sources) {
      try { s.stop(when); } catch { /* ignore */ }
    }
    const first = this._sources[0];
    if (first) {
      first.onended = () => this._teardown();
    } else {
      setTimeout(() => this._teardown(), (when - this.ctx.currentTime + 0.05) * 1000);
    }
  }

  _teardown() {
    if (this.dead) return;
    this.dead = true;
    for (const n of this._nodes) {
      try { n.disconnect(); } catch { /* ignore */ }
    }
    for (const s of this._sources) {
      try { s.disconnect(); } catch { /* ignore */ }
    }
    this._nodes.length = 0;
    this._sources.length = 0;
    this.oscs = null;
    this.onDone?.(this);
  }

  setBendCents(cents) {
    if (this.dead || !this.oscs) return;
    for (const osc of this.oscs) {
      if (osc.detune) osc.detune.value = (osc._cents || 0) + cents;
    }
  }

  setCutoffMacro(macro) {
    if (this.dead) return;
    const f = this.patch.filter;
    const macroMul = Math.pow(2, (macro - 0.75) * 5);
    const keytrack = (f.keytrack ?? 0) * (this.note - 60) * 28;
    const base = clamp(f.hz * macroMul + keytrack, 40, 17000);
    this._filterBase = base;
    this.filter.frequency.setTargetAtTime(base, this.ctx.currentTime, 0.03);
  }

  setResonanceMacro(v) {
    if (this.dead) return;
    const q = clamp((this.patch.filter.q ?? 1) + v * 14, 0.0001, 22);
    this.filter.Q.setTargetAtTime(q, this.ctx.currentTime, 0.03);
  }
}
