/* DOM helpers and shared multi-touch handling. */

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * Apply a style object. Custom properties have to go through setProperty —
 * assigning them onto element.style does nothing at all, silently.
 */
function setStyle(el, styles) {
  for (const [prop, value] of Object.entries(styles)) {
    if (prop.startsWith('--')) el.style.setProperty(prop, value);
    else el.style[prop] = value;
  }
}

/** Terse element builder. `h('div.foo', {onclick}, 'text', childEl)` */
export function h(spec, props = null, ...children) {
  const [tagPart, ...classes] = String(spec).split('.');
  const el = document.createElement(tagPart || 'div');
  if (classes.length) el.className = classes.join(' ');

  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className += ` ${v}`;
    else if (k === 'style' && typeof v === 'object') setStyle(el, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }

  for (const child of children.flat(3)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/**
 * Multi-touch for playable surfaces.
 *
 * Rather than binding per-key listeners, we hit-test on every move. That gives
 * glissando for free: sliding a finger across the keyboard releases the old
 * note and starts the new one, which is how a real instrument behaves.
 *
 * @param {HTMLElement} container
 * @param {object} handlers
 * @param {(el: Element) => any} handlers.resolve   element -> key id, or null
 * @param {(key, velocity, pointerId) => void} handlers.onPress
 * @param {(key, pointerId) => void} handlers.onRelease
 * @param {boolean} [handlers.slide=true]
 */
export function multitouch(container, { resolve, onPress, onRelease, slide = true }) {
  const active = new Map();

  const hit = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? resolve(el) : null;
  };

  /** Vertical position within the target reads as velocity: lower = harder. */
  const velocityAt = (event) => {
    if (event.pointerType === 'touch' && event.pressure > 0 && event.pressure < 1) {
      return 0.35 + event.pressure * 0.65;
    }
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el) return 0.85;
    const box = el.getBoundingClientRect();
    if (!box.height) return 0.85;
    const t = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    return 0.5 + t * 0.5;
  };

  container.addEventListener('pointerdown', (event) => {
    const key = hit(event.clientX, event.clientY);
    if (key == null) return;
    event.preventDefault();
    try { container.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    active.set(event.pointerId, key);
    onPress(key, velocityAt(event), event.pointerId);
  });

  container.addEventListener('pointermove', (event) => {
    if (!active.has(event.pointerId) || !slide) return;
    const prev = active.get(event.pointerId);
    const key = hit(event.clientX, event.clientY);
    if (key === prev) return;
    onRelease(prev, event.pointerId);
    if (key == null) {
      active.delete(event.pointerId);
    } else {
      active.set(event.pointerId, key);
      onPress(key, velocityAt(event), event.pointerId);
    }
  });

  const end = (event) => {
    if (!active.has(event.pointerId)) return;
    onRelease(active.get(event.pointerId), event.pointerId);
    active.delete(event.pointerId);
  };

  container.addEventListener('pointerup', end);
  container.addEventListener('pointercancel', end);
  container.addEventListener('lostpointercapture', end);

  // A pointer lost while the tab is hidden would otherwise leave a note stuck.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      for (const [id, key] of active) onRelease(key, id);
      active.clear();
    }
  });

  return {
    releaseAll() {
      for (const [id, key] of active) onRelease(key, id);
      active.clear();
    },
  };
}

/** Press-and-hold with a progress callback. Used by the Bash mode exit. */
export function holdToConfirm(el, { durationMs = 3000, onProgress, onComplete }) {
  let raf = 0;
  let startedAt = 0;

  const tick = () => {
    const p = Math.min(1, (performance.now() - startedAt) / durationMs);
    onProgress?.(p);
    if (p >= 1) {
      cancel();
      onComplete?.();
    } else {
      raf = requestAnimationFrame(tick);
    }
  };

  const begin = (event) => {
    event.preventDefault();
    event.stopPropagation();
    startedAt = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  };

  const cancel = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    onProgress?.(0);
  };

  el.addEventListener('pointerdown', begin);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  return { cancel };
}
