/* One look-ahead scheduler shared by the groove player and the arpeggiator, so
   they can never drift apart. Subscribers receive (stepIndex, audioTime) for
   each sixteenth note, scheduled slightly ahead of the audio clock. */

import { clamp } from '../util.js';

const LOOKAHEAD_SEC = 0.12;
const TIMER_MS = 25;

export class Clock {
  constructor(ctx) {
    this.ctx = ctx;
    this.bpm = 96;
    this.step = 0;
    this.running = false;
    this._nextTime = 0;
    this._timer = 0;
    this._subs = new Set();
  }

  get stepDuration() {
    return 60 / clamp(this.bpm, 40, 240) / 4;
  }

  subscribe(fn) {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  setTempo(bpm) {
    this.bpm = clamp(bpm, 40, 240);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.step = 0;
    this._nextTime = this.ctx.currentTime + 0.08;
    this._timer = setInterval(() => this._pump(), TIMER_MS);
    this._pump();
  }

  stop() {
    this.running = false;
    clearInterval(this._timer);
    this._timer = 0;
  }

  /** Restart the bar without stopping, e.g. after a tempo jump. */
  resetBar() {
    this.step = 0;
  }

  _pump() {
    if (!this.running) return;
    const horizon = this.ctx.currentTime + LOOKAHEAD_SEC;
    // If the tab was throttled we can be far behind; skip forward rather than
    // firing a burst of stale events.
    if (this._nextTime < this.ctx.currentTime - 0.25) {
      this._nextTime = this.ctx.currentTime + 0.02;
    }
    while (this._nextTime < horizon) {
      const step = this.step;
      const time = this._nextTime;
      for (const fn of this._subs) {
        try {
          fn(step, time, this);
        } catch (err) {
          console.error('[clock] subscriber threw', err);
        }
      }
      this.step = (step + 1) % 16;
      this._nextTime += this.stepDuration;
    }
  }
}
