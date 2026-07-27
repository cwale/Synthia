/* Rotary macro control.

   Drag anywhere on the knob (vertically, or horizontally for fine work). The
   travel is deliberately long — about 180 px for the full range — because a
   short throw is unusable with a thumb on a phone. */

import { h } from './dom.js';
import { clamp } from '../util.js';

const TRAVEL_PX = 180;

export function createKnob({
  name,
  value = 0.5,
  color = 'var(--accent)',
  defaultValue = null,
  format = (v) => `${Math.round(v * 100)}`,
  onChange,
}) {
  let current = clamp(value, 0, 1);

  const dial = h('div.knob__dial', null, h('div.knob__pointer'));
  const valEl = h('div.knob__val', null, format(current));
  const el = h('div.knob', {
    style: { '--knob-color': color },
    role: 'slider',
    'aria-label': name,
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    tabindex: '0',
  },
    dial,
    h('div.knob__text', null, h('div.knob__name', null, name), valEl),
  );

  const render = () => {
    el.style.setProperty('--pct', String(current));
    valEl.textContent = format(current);
    el.setAttribute('aria-valuenow', String(Math.round(current * 100)));
  };

  const commit = (next, live = true) => {
    const clamped = clamp(next, 0, 1);
    if (clamped === current) return;
    current = clamped;
    render();
    onChange?.(current, live);
  };

  /* ---- drag ---- */
  let dragging = false;
  let startY = 0;
  let startX = 0;
  let startValue = 0;

  el.addEventListener('pointerdown', (event) => {
    dragging = true;
    startY = event.clientY;
    startX = event.clientX;
    startValue = current;
    el.classList.add('is-live');
    el.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  el.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dy = startY - event.clientY;
    const dx = event.clientX - startX;
    // Vertical is the primary axis; horizontal adds a quarter-weight nudge for
    // fine adjustment without needing a modifier.
    const delta = (dy + dx * 0.25) / TRAVEL_PX;
    commit(startValue + delta);
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('is-live');
    onChange?.(current, false);
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('lostpointercapture', endDrag);

  /* ---- double tap resets ---- */
  let lastTap = 0;
  el.addEventListener('pointerup', () => {
    const now = performance.now();
    if (now - lastTap < 320 && defaultValue != null) commit(defaultValue, false);
    lastTap = now;
  });

  /* ---- keyboard ---- */
  el.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 0.01 : 0.05;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') commit(current + step, false);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') commit(current - step, false);
    else return;
    event.preventDefault();
  });

  render();

  return {
    el,
    get value() { return current; },
    /** Update from elsewhere (MIDI CC, preset recall) without re-emitting. */
    set(v) {
      current = clamp(v, 0, 1);
      render();
    },
  };
}
