/* The 4x4 pad grid. Pads fire one-shots, so a press is all that matters for
   sound; the release only ends the visual state. */

import { h, multitouch } from './dom.js';
import { padGridOrder } from '../audio/kits.js';

const FLASH_MS = 190;

export class PadGrid {
  constructor(container, { onHit, onRelease } = {}) {
    this.el = container;
    this.onHit = onHit;
    this.onRelease = onRelease;
    this.padEls = new Map();     // pad index -> element
    this._timers = new Map();
    this.kit = null;

    multitouch(container, {
      resolve: (el) => {
        const pad = el.closest('.pad');
        return pad ? Number(pad.dataset.pad) : null;
      },
      onPress: (index, velocity) => {
        this.flash(index, velocity);
        this.onHit?.(index, velocity);
      },
      onRelease: (index) => this.onRelease?.(index),
      // Sliding between pads retriggers, which is how finger-drumming rolls work.
      slide: true,
    });
  }

  setKit(kit, layout = 'mpc') {
    this.kit = kit;
    this.el.textContent = '';
    this.padEls.clear();

    for (const index of padGridOrder(layout)) {
      const def = kit.pads[index];
      const el = h('div.pad', {
        dataset: { pad: String(index) },
        style: { '--pad-color': def.color },
        role: 'button',
        'aria-label': `Pad ${index + 1}: ${def.name}`,
      },
        h('span.pad__flash'),
        h('span.pad__num', null, String(index + 1)),
        h('span.pad__name', null, def.name),
      );
      this.padEls.set(index, el);
      this.el.append(el);
    }
  }

  flash(index, velocity = 1) {
    const el = this.padEls.get(index);
    if (!el) return;
    el.style.setProperty('--flash', String(0.25 + velocity * 0.55));

    // Restart the CSS animation even if the pad is already lit.
    el.classList.remove('is-hit');
    void el.offsetWidth;
    el.classList.add('is-hit');

    clearTimeout(this._timers.get(index));
    this._timers.set(index, setTimeout(() => {
      el.classList.remove('is-hit');
      this._timers.delete(index);
    }, FLASH_MS + velocity * 120));
  }

  clearAll() {
    for (const t of this._timers.values()) clearTimeout(t);
    this._timers.clear();
    for (const el of this.padEls.values()) el.classList.remove('is-hit');
  }

  padName(index) {
    return this.kit?.pads[index]?.name || `Pad ${index + 1}`;
  }

  padColor(index) {
    return this.kit?.pads[index]?.color || 'var(--accent)';
  }
}
