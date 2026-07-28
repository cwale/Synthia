/* Transient messages. Deliberately non-blocking — you might be mid-phrase. */

import { h, qs } from './dom.js';

const MAX_VISIBLE = 3;

export function toast(message, { kind = '', ms = 2800 } = {}) {
  const root = qs('#toasts');
  if (!root) return null;

  const el = h('div.toast', { class: kind ? `toast--${kind}` : '', role: 'status' }, message);
  root.append(el);

  while (root.children.length > MAX_VISIBLE) root.firstElementChild.remove();

  const remove = () => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 260);
  };
  const timer = setTimeout(remove, ms);
  el.addEventListener('pointerdown', () => {
    clearTimeout(timer);
    remove();
  });
  return el;
}

/** Only show a given message once per session (latency warnings, tips). */
const shown = new Set();
export function toastOnce(id, message, opts) {
  if (shown.has(id)) return null;
  shown.add(id);
  return toast(message, opts);
}
