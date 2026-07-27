/* Shared effect rack: plate-ish reverb, ping-pong delay, chorus insert. */

import { clamp } from '../util.js';

/**
 * Build a decaying-noise impulse response. Cheap, and warmer than raw white
 * noise because each sample is smoothed against the last (a one-pole lowpass).
 */
function makeImpulse(ctx, seconds = 2.8, decay = 2.4) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decay);
      // 5 ms fade-in stops the convolver from clicking on transients
      const attack = Math.min(1, i / (rate * 0.005));
      last = last * 0.55 + (Math.random() * 2 - 1) * 0.45;
      data[i] = last * env * attack;
    }
  }
  return buf;
}

/** Soft-clip curve for the drive stage. */
function makeDriveCurve(amount = 0.5) {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = 1 + amount * 40;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return curve;
}

export function makeChorus(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  wet.gain.value = 0;

  input.connect(dry).connect(output);
  wet.connect(output);

  const voices = [
    { time: 0.0135, depth: 0.0035, rate: 0.33, pan: -0.7 },
    { time: 0.0205, depth: 0.0028, rate: 0.47, pan: 0.7 },
  ];

  for (const v of voices) {
    const delay = ctx.createDelay(0.2);
    delay.delayTime.value = v.time;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = v.rate;
    const depth = ctx.createGain();
    depth.gain.value = v.depth;
    lfo.connect(depth).connect(delay.delayTime);
    lfo.start();
    const panner = ctx.createStereoPanner();
    panner.pan.value = v.pan;
    input.connect(delay).connect(panner).connect(wet);
  }

  return {
    input,
    output,
    setMix(mix) {
      const m = clamp(mix, 0, 1);
      wet.gain.value = m * 0.9;
      dry.gain.value = 1 - m * 0.35;
    },
  };
}

export class FxRack {
  constructor(ctx) {
    this.ctx = ctx;
    this.output = ctx.createGain();

    /* ---- reverb send ---- */
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    const revHP = ctx.createBiquadFilter();
    revHP.type = 'highpass';
    revHP.frequency.value = 180;      // keeps the low end out of the tail
    const revLP = ctx.createBiquadFilter();
    revLP.type = 'lowpass';
    revLP.frequency.value = 7200;
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeImpulse(ctx, 2.8, 2.4);
    this.reverbWet = ctx.createGain();
    this.reverbWet.gain.value = 1;

    this.reverbIn.connect(revHP);
    revHP.connect(revLP);
    revLP.connect(this.convolver);
    this.convolver.connect(this.reverbWet);
    this.reverbWet.connect(this.output);

    /* ---- ping-pong delay send ---- */
    this.delayIn = ctx.createGain();
    this.delayIn.gain.value = 1;
    const dL = ctx.createDelay(2);
    const dR = ctx.createDelay(2);
    dL.delayTime.value = 0.28;
    dR.delayTime.value = 0.28;
    this._delayL = dL;
    this._delayR = dR;

    const fbL = ctx.createGain();
    const fbR = ctx.createGain();
    fbL.gain.value = 0.42;
    fbR.gain.value = 0.42;

    const loopLP = ctx.createBiquadFilter();
    loopLP.type = 'lowpass';
    loopLP.frequency.value = 3200;    // repeats get darker, like tape

    const panL = ctx.createStereoPanner();
    const panR = ctx.createStereoPanner();
    panL.pan.value = -0.75;
    panR.pan.value = 0.75;

    this.delayWet = ctx.createGain();
    this.delayWet.gain.value = 1;

    // input -> L -> R -> (filtered) -> back into L, taps panned hard apart
    this.delayIn.connect(dL);
    dL.connect(panL).connect(this.delayWet);
    dL.connect(fbR).connect(dR);
    dR.connect(panR).connect(this.delayWet);
    dR.connect(loopLP).connect(fbL).connect(dL);
    this.delayWet.connect(this.output);

    this._feedback = [fbL, fbR];
  }

  setReverbLevel(v) {
    this.reverbWet.gain.value = clamp(v, 0, 1.4);
  }

  setDelayLevel(v) {
    this.delayWet.gain.value = clamp(v, 0, 1.2);
  }

  setDelayTime(sec) {
    const t = clamp(sec, 0.02, 1.5);
    const now = this.ctx.currentTime;
    this._delayL.delayTime.setTargetAtTime(t, now, 0.05);
    this._delayR.delayTime.setTargetAtTime(t, now, 0.05);
  }

  setFeedback(v) {
    const g = clamp(v, 0, 0.85);
    for (const n of this._feedback) n.gain.value = g;
  }

  /** Sync delay time to a dotted-eighth of the given tempo. */
  syncToTempo(bpm) {
    this.setDelayTime((60 / clamp(bpm, 40, 220)) * 0.75);
  }
}

export function makeDrive(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeDriveCurve(0.5);
  shaper.oversample = '2x';
  const trim = ctx.createGain();
  trim.gain.value = 0.7;

  wet.gain.value = 0;
  input.connect(dry).connect(output);
  input.connect(shaper).connect(trim).connect(wet).connect(output);

  return {
    input,
    output,
    setAmount(a) {
      const amt = clamp(a, 0, 1);
      shaper.curve = makeDriveCurve(0.1 + amt * 0.9);
      wet.gain.value = amt;
      dry.gain.value = 1 - amt * 0.8;
    },
  };
}
