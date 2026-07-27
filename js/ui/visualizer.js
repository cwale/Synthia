/* Background visualiser: a spectrum ribbon plus a bloom for every note.

   Runs on requestAnimationFrame, capped to roughly 40 fps, and stops entirely
   when the tab is hidden or the user prefers reduced motion — this is the one
   part of the app that would otherwise cost battery while nothing is playing. */

import { clamp } from '../util.js';

const MAX_BLOOMS = 44;
const FRAME_MS = 24;

export class Visualizer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.engine = engine;
    this.blooms = [];
    this.running = false;
    this._last = 0;
    this._spectrum = null;
    this.enabled = true;

    this._reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else if (this.enabled) this.start();
    });
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || 1;
    const hgt = this.canvas.clientHeight || 1;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(hgt * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = hgt;
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this.start();
    else {
      this.stop();
      this.ctx.clearRect(0, 0, this.w, this.h);
    }
  }

  start() {
    if (this.running || this._reduced || !this.enabled) return;
    this.running = true;
    this._last = 0;
    requestAnimationFrame((t) => this._frame(t));
  }

  stop() {
    this.running = false;
  }

  /**
   * @param {object} opts
   * @param {number} [opts.note]     MIDI note, used to place the bloom horizontally
   * @param {number} [opts.x]        0..1 override for pads
   * @param {number} [opts.velocity]
   * @param {string} [opts.color]
   */
  bloom({ note = null, x = null, velocity = 0.8, color = '#ffb454', big = false } = {}) {
    if (this._reduced || !this.enabled) return;
    // Notes map across the canvas by pitch, so melodies sweep left to right.
    const px = x != null ? x : clamp((note - 24) / 72, 0, 1);
    const maxR = (big ? 0.5 : 0.28) * Math.min(this.w, this.h) * (0.45 + velocity * 0.85);

    this.blooms.push({
      x: px * this.w,
      y: this.h * (big ? 0.5 : 0.42) + (Math.random() - 0.5) * this.h * 0.22,
      r: maxR * 0.08,
      maxR,
      color,
      life: 1,
      decay: 0.016 + Math.random() * 0.01,
    });

    if (this.blooms.length > MAX_BLOOMS) this.blooms.splice(0, this.blooms.length - MAX_BLOOMS);
    this.start();
  }

  _frame(now) {
    if (!this.running) return;
    if (now - this._last < FRAME_MS) {
      requestAnimationFrame((t) => this._frame(t));
      return;
    }
    this._last = now;

    const { ctx, w, h } = this;

    // Fade rather than clear, so blooms leave a soft trail.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(8, 9, 13, 0.26)';
    ctx.fillRect(0, 0, w, h);

    this._drawSpectrum();

    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.blooms.length - 1; i >= 0; i--) {
      const b = this.blooms[i];
      b.life -= b.decay;
      if (b.life <= 0) {
        this.blooms.splice(i, 1);
        continue;
      }
      const t = 1 - b.life;
      const r = b.r + (b.maxR - b.r) * (1 - Math.pow(1 - t, 2.2));
      const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, Math.max(1, r));
      grad.addColorStop(0, this._alpha(b.color, 0.5 * b.life));
      grad.addColorStop(0.45, this._alpha(b.color, 0.16 * b.life));
      grad.addColorStop(1, this._alpha(b.color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, Math.max(1, r), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // Idle out once there is nothing left to animate.
    const level = this.engine.ready ? this.engine.level() : 0;
    if (!this.blooms.length && level < 0.01) {
      this.running = false;
      ctx.clearRect(0, 0, w, h);
      return;
    }

    requestAnimationFrame((t) => this._frame(t));
  }

  _drawSpectrum() {
    if (!this.engine.ready || !this.engine.analyser) return;
    this._spectrum = this.engine.spectrum(this._spectrum);
    const data = this._spectrum;
    if (!data) return;

    const { ctx, w, h } = this;
    const bins = 40;
    const step = Math.floor(data.length / bins / 2) || 1;
    const baseY = h;

    ctx.beginPath();
    ctx.moveTo(0, baseY);
    for (let i = 0; i < bins; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += data[i * step + j] || 0;
      const v = (sum / step) / 255;
      const x = (i / (bins - 1)) * w;
      const y = baseY - v * h * 0.34;
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(w, baseY);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, baseY - h * 0.34, 0, baseY);
    grad.addColorStop(0, 'rgba(78, 205, 196, 0.16)');
    grad.addColorStop(1, 'rgba(255, 180, 84, 0.05)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  /** Accepts #rgb/#rrggbb and returns an rgba() string. */
  _alpha(color, a) {
    if (color.startsWith('#')) {
      let hex = color.slice(1);
      if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
      const n = parseInt(hex, 16);
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }
    return color;
  }

  clear() {
    this.blooms.length = 0;
    this.ctx.clearRect(0, 0, this.w, this.h);
  }
}
