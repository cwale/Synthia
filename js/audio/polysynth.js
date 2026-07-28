/* Voice allocation, sustain pedal, pitch bend, macros and the arpeggiator.

   Voices are keyed by an arbitrary "key" rather than by pitch, so the caller
   can hold a key down while the sounding pitch is something else (scale lock
   rewrites pitches, and the on-screen keyboard needs to release exactly what
   it pressed). */

import { clamp } from '../util.js';
import { SynthVoice } from './voice.js';
import { defaultMacros } from './macros.js';

const RATE_STEPS = { '1/4': 4, '1/8': 2, '1/8t': 1.5, '1/16': 1 };

export class PolySynth {
  constructor(ctx, strip, clock) {
    this.ctx = ctx;
    this.dest = strip.input;
    this.clock = clock;
    this.patch = null;
    this.polyphony = 12;
    this.macros = defaultMacros();
    this.bendRange = 2;

    this._voices = new Map();     // key -> SynthVoice
    this._order = [];             // keys, oldest first
    this._held = new Map();       // key -> pitch, for arp + sustain bookkeeping
    this._sustained = new Set();
    this._sustainOn = false;
    this._bendCents = 0;
    this._lastPitch = null;

    this.arp = { on: false, mode: 'up', rate: '1/8', gate: 0.55, octaves: 1, hold: false };
    this._arpIndex = 0;
    this._latched = new Map();

    clock?.subscribe((step, time) => this._arpTick(step, time));
  }

  setPatch(patch) {
    this.patch = patch;
  }

  setMacro(name, value) {
    this.macros[name] = value;
    if (name === 'cutoff') {
      for (const v of this._voices.values()) v.setCutoffMacro(value);
    } else if (name === 'resonance') {
      for (const v of this._voices.values()) v.setResonanceMacro(value);
    }
  }

  setBend(normalised) {
    // normalised is -1..1 from the pitch wheel
    this._bendCents = normalised * this.bendRange * 100;
    for (const v of this._voices.values()) v.setBendCents(this._bendCents);
  }

  /** Mod wheel opens the filter a little — the most useful default mapping. */
  setModWheel(v) {
    this._modWheel = v;
    const effective = clamp(this.macros.cutoff + v * 0.25, 0, 1);
    for (const voice of this._voices.values()) voice.setCutoffMacro(effective);
  }

  noteOn(pitch, velocity, { key = pitch, time = null } = {}) {
    if (!this.patch) return;
    const t = time ?? this.ctx.currentTime;

    this._held.set(key, pitch);

    if (this.arp.on) {
      // Arp mode swallows the note; the clock plays it instead.
      if (this.arp.hold) {
        if (this._latchCleared) {
          this._latched.clear();
          this._latchCleared = false;
        }
        this._latched.set(key, pitch);
      }
      return;
    }

    this._spawn(pitch, velocity, key, t);
  }

  _spawn(pitch, velocity, key, t, releaseAfter = 0) {
    // Retrigger: fade the previous voice for this key rather than layering.
    const existing = this._voices.get(key);
    if (existing) {
      existing.kill(t);
      this._forget(key);
    }

    while (this._order.length >= this.polyphony) {
      const oldest = this._order.shift();
      const victim = this._voices.get(oldest);
      if (victim) {
        victim.kill(t);
        this._voices.delete(oldest);
      }
    }

    const voice = new SynthVoice(this.ctx, this.dest, this.patch, (v) => {
      if (this._voices.get(key) === v) this._forget(key);
    });

    voice.start(pitch, velocity, t, {
      bendCents: this._bendCents,
      cutoffMacro: this.macros.cutoff,
      resonanceMacro: this.macros.resonance,
      macros: this.macros,
      glideFrom: this.patch.mono ? this._lastPitch : null,
    });

    this._lastPitch = pitch;
    this._voices.set(key, voice);
    this._order.push(key);

    if (releaseAfter > 0) voice.release(t + releaseAfter);
    return voice;
  }

  _forget(key) {
    this._voices.delete(key);
    const i = this._order.indexOf(key);
    if (i >= 0) this._order.splice(i, 1);
  }

  noteOff(key, { time = null } = {}) {
    const t = time ?? this.ctx.currentTime;
    this._held.delete(key);

    if (this.arp.on) {
      if (this.arp.hold) {
        // Keep the latch until the player starts a fresh chord.
        if (this._held.size === 0) this._latchCleared = true;
      }
      return;
    }

    if (this._sustainOn) {
      this._sustained.add(key);
      return;
    }

    const voice = this._voices.get(key);
    if (voice) voice.release(t);
  }

  setSustain(on) {
    this._sustainOn = on;
    if (!on) {
      const t = this.ctx.currentTime;
      for (const key of this._sustained) {
        if (!this._held.has(key)) this._voices.get(key)?.release(t);
      }
      this._sustained.clear();
    }
  }

  /** Release everything that is sounding, gracefully. */
  allNotesOff() {
    const t = this.ctx.currentTime;
    for (const voice of this._voices.values()) voice.release(t);
    this._held.clear();
    this._sustained.clear();
    this._latched.clear();
  }

  /** Hard stop — used by the panic button and when a device disconnects. */
  panic() {
    const t = this.ctx.currentTime;
    for (const voice of this._voices.values()) voice.kill(t, 0.008);
    this._voices.clear();
    this._order.length = 0;
    this._held.clear();
    this._sustained.clear();
    this._latched.clear();
    this._sustainOn = false;
  }

  get voiceCount() {
    return this._voices.size;
  }

  /* ---- arpeggiator ---- */

  setArp(patch) {
    const wasOn = this.arp.on;
    Object.assign(this.arp, patch);
    if (wasOn && !this.arp.on) {
      this.allNotesOff();
      this._latched.clear();
    }
    if (!this.arp.hold) this._latched.clear();
  }

  _arpSource() {
    const map = this.arp.hold && this._latched.size ? this._latched : this._held;
    return [...map.values()];
  }

  _arpTick(step, time) {
    if (!this.arp.on || !this.patch) return;
    const div = RATE_STEPS[this.arp.rate] ?? 2;
    // Triplet rates land on fractional steps; nearest-step is close enough at
    // these tempos and keeps the shared sixteenth grid.
    if (step % Math.max(1, Math.round(div)) !== 0) return;

    const pitches = this._arpSource();
    if (!pitches.length) {
      this._arpIndex = 0;
      return;
    }

    const octaves = clamp(this.arp.octaves, 1, 3);
    const pool = [];
    const sorted = [...pitches].sort((a, b) => a - b);
    for (let o = 0; o < octaves; o++) {
      for (const p of sorted) pool.push(p + o * 12);
    }

    let seq = pool;
    if (this.arp.mode === 'down') seq = [...pool].reverse();
    else if (this.arp.mode === 'updown') seq = [...pool, ...[...pool].reverse().slice(1, -1)];

    let pitch;
    if (this.arp.mode === 'random') {
      pitch = pool[Math.floor(Math.random() * pool.length)];
    } else if (this.arp.mode === 'chord') {
      const gate = this.clock.stepDuration * div * this.arp.gate;
      pool.forEach((p, i) => this._spawn(p, 0.8, `arp:${i}`, time + i * 0.012, gate));
      return;
    } else {
      pitch = seq[this._arpIndex % seq.length];
      this._arpIndex = (this._arpIndex + 1) % seq.length;
    }

    const gate = this.clock.stepDuration * div * clamp(this.arp.gate, 0.05, 0.98);
    this._spawn(pitch, 0.85, `arp:${this._arpIndex}`, time, gate);
  }
}
