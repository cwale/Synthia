/* The on-screen keyboard.

   It shows a whole number of octaves sized to fit the screen, and the octave
   buttons move the window. There is deliberately no horizontal scrolling: a
   scroll gesture and a glissando are the same gesture, and playing has to win.

   It doubles as the display for the hardware keyboard — notes arriving over
   MIDI light up here, so you can see what the controller is sending. */

import { h, multitouch } from './dom.js';
import { clamp, isBlackKey, noteLabel, pitchClassName, SCALES } from '../util.js';

const WHITE_PER_OCTAVE = 7;
const MIN_WHITE_PX = 30;
const BLACK_RATIO = 0.62;

export class ScreenKeyboard {
  constructor(container, { onNoteOn, onNoteOff }) {
    this.el = container;
    this.onNoteOn = onNoteOn;
    this.onNoteOff = onNoteOff;
    this.baseNote = 48;
    this.octaves = 1;
    this.fitAll = false;
    this.totalKeys = 37;
    this.keyEls = new Map();     // note -> element
    this._extCount = new Map();  // note -> how many sources are holding it

    this.touch = multitouch(container, {
      resolve: (el) => {
        const key = el.closest('.key');
        return key ? Number(key.dataset.note) : null;
      },
      onPress: (note, velocity) => this.onNoteOn?.(note, velocity),
      onRelease: (note) => this.onNoteOff?.(note),
    });
  }

  /** @param {{baseNote:number, fitAll:boolean, totalKeys:number}} opts */
  configure({ baseNote = this.baseNote, fitAll = this.fitAll, totalKeys = this.totalKeys } = {}) {
    this.baseNote = baseNote;
    this.fitAll = fitAll;
    this.totalKeys = totalKeys;
    this.render();
  }

  /**
   * Width available to the keyboard. Measuring the container is safe because
   * keys are positioned in percentages and carry no intrinsic width — there is
   * no path by which the keys can widen the box we just measured. Falls back to
   * a window estimate for the first render, before the app is visible.
   */
  _availableWidth() {
    const measured = this.el.parentElement?.clientWidth || 0;
    if (measured > 80) return measured;
    const landscape = window.matchMedia('(orientation: landscape) and (max-height: 560px)').matches;
    return Math.max(200, window.innerWidth - (landscape ? 104 : 0) - 16);
  }

  /** How many white keys fit at a comfortable size. */
  _whiteKeyTarget(width) {
    if (this.fitAll) {
      // Count the white keys in the hardware's full range.
      let whites = 0;
      for (let n = this.baseNote; n < this.baseNote + this.totalKeys; n++) {
        if (!isBlackKey(n)) whites++;
      }
      return Math.max(whites, 8);
    }
    const maxOctaves = 3;
    let octaves = 1;
    for (let o = maxOctaves; o >= 1; o--) {
      if (width / (WHITE_PER_OCTAVE * o + 1) >= MIN_WHITE_PX) {
        octaves = o;
        break;
      }
    }
    this.octaves = octaves;
    return WHITE_PER_OCTAVE * octaves + 1;   // + the closing C
  }

  render() {
    /* How many octaves fit is decided from the viewport, never from our own
       element: keys are laid out in percentages so they can't widen the
       container, which would otherwise feed back into the next measurement. */
    const width = this._availableWidth();
    const whiteTarget = this._whiteKeyTarget(width);
    const whitePct = 100 / whiteTarget;
    const blackPct = whitePct * BLACK_RATIO;

    this.el.textContent = '';
    this.keyEls.clear();

    const whites = [];
    const blacks = [];
    let whiteIndex = 0;
    let note = this.baseNote;

    while (whiteIndex < whiteTarget) {
      if (isBlackKey(note)) {
        blacks.push({ note, left: whiteIndex * whitePct - blackPct / 2 });
      } else {
        whites.push({ note, left: whiteIndex * whitePct });
        whiteIndex++;
      }
      note++;
      if (note > this.baseNote + 128) break;   // guard
    }

    this.lowNote = this.baseNote;
    this.highNote = note - 1;
    this.whiteCount = whiteTarget;

    const makeKey = (spec, black) => {
      const label = black
        ? null
        : (this.labelAll || pitchClassName(spec.note) === 'C' ? noteLabel(spec.note) : null);
      const el = h(
        `div.key.${black ? 'key--b' : 'key--w'}`,
        {
          dataset: { note: String(spec.note) },
          style: { left: `${spec.left}%`, width: `${black ? blackPct : whitePct}%` },
        },
        label ? h('span.key__label', null, label) : null,
      );
      this.keyEls.set(spec.note, el);
      return el;
    };

    for (const w of whites) this.el.append(makeKey(w, false));
    for (const b of blacks) this.el.append(makeKey(b, true));

    this._applyScale();
  }

  setLabelAll(on) {
    this.labelAll = on;
    this.render();
  }

  setScale({ lock, root, name }) {
    this._scale = { lock, root, name };
    this._applyScale();
  }

  _applyScale() {
    const s = this._scale;
    if (!s || !s.lock || s.name === 'chromatic') {
      this.el.classList.remove('is-offscale');
      for (const el of this.keyEls.values()) el.classList.remove('in-scale', 'is-root');
      return;
    }
    const steps = (SCALES[s.name] || SCALES.chromatic).steps;
    this.el.classList.add('is-offscale');
    for (const [note, el] of this.keyEls) {
      const pc = (((note - s.root) % 12) + 12) % 12;
      el.classList.toggle('in-scale', steps.includes(pc));
      el.classList.toggle('is-root', pc === 0 && !isBlackKey(note));
    }
  }

  /**
   * Light a key.
   * @param {boolean} external true for notes from the hardware, which get a
   *   glow rather than the pressed-down look.
   */
  setNote(note, on, { external = false, color = null } = {}) {
    const el = this.keyEls.get(note);
    if (!el) return false;

    const count = this._extCount.get(note) || 0;
    if (on) {
      this._extCount.set(note, count + 1);
      if (color) el.style.setProperty('--key-lit', color);
      el.classList.add('is-down');
      if (external) el.classList.add('is-ext');
    } else {
      const next = Math.max(0, count - 1);
      this._extCount.set(note, next);
      if (next === 0) el.classList.remove('is-down', 'is-ext');
    }
    return true;
  }

  clearAll() {
    this._extCount.clear();
    for (const el of this.keyEls.values()) el.classList.remove('is-down', 'is-ext');
    this.touch.releaseAll();
  }

  /** True when the note falls inside the visible window. */
  covers(note) {
    return note >= this.lowNote && note <= this.highNote;
  }

  /** Shift the window so `note` becomes visible; returns the new base. */
  windowAround(note) {
    const span = this.highNote - this.lowNote;
    let base = this.baseNote;
    while (note < base) base -= 12;
    while (note > base + span) base += 12;
    return clamp(base, 12, 108);
  }
}
