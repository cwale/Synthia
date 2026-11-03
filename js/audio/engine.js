/* AudioContext lifecycle, master bus, channel strips, latency reporting. */

import { clamp } from '../util.js';
import { bus } from '../state.js';
import { FxRack, makeDrive, makeChorus } from './fx.js';

let sharedNoiseBuffer = null;

/** One second of white noise, reused by every voice that needs it. */
export function noiseBuffer(ctx) {
  if (sharedNoiseBuffer && sharedNoiseBuffer.sampleRate === ctx.sampleRate) {
    return sharedNoiseBuffer;
  }
  const len = ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  sharedNoiseBuffer = buf;
  return buf;
}

/**
 * Unity below KNEE, then a smooth bend towards 1. The curve covers inputs of
 * ±2 (a WaveShaper maps -1..1 onto its curve, so the input is halved first and
 * the curve stores the doubled-domain result): even a signal twice full scale
 * comes out under 1 rather than flat-topped.
 */
const KNEE = 0.8;
export function safetyShape(x) {
  const a = Math.abs(x);
  if (a <= KNEE) return x;
  const room = 1 - KNEE;
  return Math.sign(x) * (KNEE + room * Math.tanh((a - KNEE) / room));
}

function makeSafetyCurve(n = 4096) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 4 - 2;   // the input this sample stands for
    curve[i] = safetyShape(x) / 2;     // halved: the shaper's input is halved too
  }
  return curve;
}

export class Engine {
  constructor() {
    this.ctx = null;
    this.channels = new Map();
    this.ready = false;
    this._masterVolume = 0.85;
  }

  /**
   * Must be called from a user gesture. Safari and Chrome both refuse to start
   * an AudioContext otherwise, and on iOS the context starts 'suspended' even
   * after construction, so we resume explicitly.
   */
  async start() {
    if (this.ready) {
      await this.resume();
      return this.ctx;
    }

    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio is not available in this browser.');

    this.ctx = new Ctor({ latencyHint: 'interactive' });
    this._buildGraph();
    this.ready = true;
    await this.resume();

    bus.emit('audio:ready', this.latencyInfo());
    return this.ctx;
  }

  async resume() {
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* will retry on the next gesture */
      }
    }
  }

  async suspend() {
    if (this.ctx && this.ctx.state === 'running') {
      try { await this.ctx.suspend(); } catch { /* ignore */ }
    }
  }

  _buildGraph() {
    const ctx = this.ctx;

    this.mix = ctx.createGain();            // everything sums here, pre-master
    this.mix.gain.value = 1;

    this.drive = makeDrive(ctx);

    // Gentle tilt EQ: trims boom, adds a little air.
    this.lowShelf = ctx.createBiquadFilter();
    this.lowShelf.type = 'lowshelf';
    this.lowShelf.frequency.value = 110;
    this.lowShelf.gain.value = -1.5;

    this.highShelf = ctx.createBiquadFilter();
    this.highShelf.type = 'highshelf';
    this.highShelf.frequency.value = 6500;
    this.highShelf.gain.value = 1.5;

    // Safety net. A toddler holding down twenty keys should not clip or
    // distort, and phone speakers are unforgiving.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.18;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this._masterVolume;

    /* The last word before the speaker. The compressor above can't stop a
       hard attack: it needs a few milliseconds to react, and Chrome adds its
       own make-up gain on top, so the first instant of a loud chord could leave
       it above full scale and be clipped flat by the device. This curve is
       exact unity up to 0.8 and then bends smoothly towards 1, so nothing
       ordinary is touched and nothing extraordinary can square off. */
    this.safetyIn = ctx.createGain();
    this.safetyIn.gain.value = 0.5;
    this.safetyShaper = ctx.createWaveShaper();
    this.safetyShaper.curve = makeSafetyCurve();
    this.safetyShaper.oversample = '4x';
    this.safety = ctx.createGain();
    this.safety.gain.value = 2;
    this.safetyIn.connect(this.safetyShaper).connect(this.safety);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.7;

    this.fx = new FxRack(ctx);
    this.fx.output.connect(this.mix);

    this.mix.connect(this.drive.input);
    this.drive.output.connect(this.lowShelf);
    this.lowShelf.connect(this.highShelf);
    this.highShelf.connect(this.limiter);
    this.limiter.connect(this.masterGain);
    this.masterGain.connect(this.safetyIn);
    this.safety.connect(ctx.destination);
    this.safety.connect(this.analyser);

    // Separate tap for the recorder so takes capture the master mix.
    if (typeof ctx.createMediaStreamDestination === 'function') {
      this.recordDest = ctx.createMediaStreamDestination();
      this.safety.connect(this.recordDest);
    }
  }

  /**
   * A named strip with its own reverb/delay sends, so the synth can sit in a
   * big space while the drums stay dry and punchy.
   */
  channel(name, { reverb = 0.25, delay = 0.1, gain = 1, chorus = false } = {}) {
    if (this.channels.has(name)) return this.channels.get(name);

    const ctx = this.ctx;
    const input = ctx.createGain();
    input.gain.value = gain;
    const revSend = ctx.createGain();
    revSend.gain.value = reverb;
    const delSend = ctx.createGain();
    delSend.gain.value = delay;

    // An optional chorus sits inline, before the sends, so the widened signal
    // is what feeds the reverb — that's what makes pads bloom.
    let tail = input;
    let chorusInsert = null;
    if (chorus) {
      chorusInsert = makeChorus(ctx);
      input.connect(chorusInsert.input);
      tail = chorusInsert.output;
    }

    tail.connect(this.mix);
    tail.connect(revSend).connect(this.fx.reverbIn);
    tail.connect(delSend).connect(this.fx.delayIn);

    const strip = {
      input,
      revSend,
      delSend,
      setReverb: (v) => { revSend.gain.value = clamp(v, 0, 1.5); },
      setDelay: (v) => { delSend.gain.value = clamp(v, 0, 1.5); },
      setGain: (v) => { input.gain.value = clamp(v, 0, 2); },
      setChorus: (v) => chorusInsert?.setMix(v),
    };
    this.channels.set(name, strip);
    return strip;
  }

  setMasterVolume(v) {
    this._masterVolume = clamp(v, 0, 1);
    if (!this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(this._masterVolume, this.ctx.currentTime, 0.02);
  }

  setLimiter(on) {
    if (!this.limiter) return;
    // Raising the threshold effectively bypasses it without rewiring.
    this.limiter.threshold.value = on ? -8 : 0;
    this.limiter.ratio.value = on ? 12 : 1;
  }

  /** Ceiling for Bash mode so a toddler can't reach an unpleasant volume. */
  setCeiling(maxGain) {
    if (!this.masterGain) return;
    const target = Math.min(this._masterVolume, clamp(maxGain, 0, 1));
    this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  setDrive(v) {
    this.drive?.setAmount(v);
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /**
   * Round-trip latency as the browser reports it. `outputLatency` is the one
   * that matters and is often missing outside Chrome, so it's optional.
   */
  latencyInfo() {
    if (!this.ctx) return { total: null, base: null, output: null, sampleRate: null };
    const base = this.ctx.baseLatency ?? null;
    const output = this.ctx.outputLatency ?? null;
    const total = (base ?? 0) + (output ?? 0);
    return {
      base,
      output,
      total: total > 0 ? total : null,
      sampleRate: this.ctx.sampleRate,
      state: this.ctx.state,
    };
  }

  /** Read the analyser for the visualiser. Returns 0..1. */
  level() {
    if (!this.analyser) return 0;
    const buf = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i];
    return clamp(sum / buf.length / 160, 0, 1);
  }

  spectrum(target) {
    if (!this.analyser) return null;
    const arr = target || new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(arr);
    return arr;
  }
}

export const engine = new Engine();
