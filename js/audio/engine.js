/* AudioContext lifecycle, master bus, channel strips, latency reporting. */

import { clamp } from '../util.js';
import { bus } from '../state.js';
import { FxRack, makeDrive } from './fx.js';

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
    this.masterGain.connect(ctx.destination);
    this.masterGain.connect(this.analyser);

    // Separate tap for the recorder so takes capture the master mix.
    if (typeof ctx.createMediaStreamDestination === 'function') {
      this.recordDest = ctx.createMediaStreamDestination();
      this.masterGain.connect(this.recordDest);
    }
  }

  /**
   * A named strip with its own reverb/delay sends, so the synth can sit in a
   * big space while the drums stay dry and punchy.
   */
  channel(name, { reverb = 0.25, delay = 0.1, gain = 1 } = {}) {
    if (this.channels.has(name)) return this.channels.get(name);

    const ctx = this.ctx;
    const input = ctx.createGain();
    input.gain.value = gain;
    const revSend = ctx.createGain();
    revSend.gain.value = reverb;
    const delSend = ctx.createGain();
    delSend.gain.value = delay;

    input.connect(this.mix);
    input.connect(revSend).connect(this.fx.reverbIn);
    input.connect(delSend).connect(this.fx.delayIn);

    const strip = {
      input,
      revSend,
      delSend,
      setReverb: (v) => { revSend.gain.value = clamp(v, 0, 1.5); },
      setDelay: (v) => { delSend.gain.value = clamp(v, 0, 1.5); },
      setGain: (v) => { input.gain.value = clamp(v, 0, 2); },
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
