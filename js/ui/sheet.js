/* Bottom sheet plus the form atoms used inside them. */

import { h, qs } from './dom.js';
import { clamp } from '../util.js';

let current = null;

/**
 * Builders receive `(body, api)`. They run synchronously while the sheet is
 * being constructed, so they must never close over the sheet handle itself —
 * that is why the api is passed in rather than returned first.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {Array<{id:string,label:string,build:(body:HTMLElement,api:object)=>void}>} [opts.tabs]
 * @param {(body:HTMLElement,api:object)=>void} [opts.build] used when there are no tabs
 * @param {string} [opts.activeTab]
 */
export function openSheet({ title, tabs = null, build = null, activeTab = null, onClose = null }) {
  closeSheet();

  const root = qs('#sheet-root');
  const body = h('div.sheet__body');
  const scrim = h('div.scrim');
  const closeBtn = h('button.sheet__close', { 'aria-label': 'Close' }, '✕');
  const grab = h('div.sheet__grab');

  const sheet = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    grab,
    h('div.sheet__head', null, h('h2.sheet__title', null, title), closeBtn),
  );

  const api = {
    sheet,
    body,
    activeTab,
    close: () => closeSheet(),
    refresh: () => {},
  };

  /* A builder that throws must not leave a scrim swallowing every tap, so the
     failure is contained and the sheet still closes normally. */
  const runBuild = (fn) => {
    try {
      fn?.(body, api);
    } catch (err) {
      console.error('[sheet] builder failed', err);
      body.textContent = '';
      body.append(h('div.row', null, h('div.row__text', null,
        h('div.row__label', null, 'Something went wrong'),
        h('div.row__sub', null, String(err && err.message ? err.message : err)),
      )));
    }
  };

  if (tabs?.length) {
    const buttons = new Map();
    const select = (id) => {
      for (const [key, btn] of buttons) btn.classList.toggle('is-on', key === id);
      body.textContent = '';
      body.scrollTop = 0;
      api.activeTab = id;
      runBuild(tabs.find((t) => t.id === id)?.build);
    };
    const tabBar = h('div.tabs', { role: 'tablist' });
    for (const tab of tabs) {
      const btn = h('button.tab', { role: 'tab', onclick: () => select(tab.id) }, tab.label);
      buttons.set(tab.id, btn);
      tabBar.append(btn);
    }
    sheet.append(tabBar, body);
    root.append(scrim, sheet);

    api.refresh = () => {
      const scroll = body.scrollTop;
      body.textContent = '';
      runBuild(tabs.find((t) => t.id === api.activeTab)?.build);
      body.scrollTop = scroll;
    };

    select(activeTab && tabs.some((t) => t.id === activeTab) ? activeTab : tabs[0].id);
  } else {
    sheet.append(body);
    root.append(scrim, sheet);
    api.refresh = () => {
      body.textContent = '';
      runBuild(build);
    };
    runBuild(build);
  }

  requestAnimationFrame(() => {
    scrim.classList.add('is-open');
    sheet.classList.add('is-open');
  });

  const doClose = () => {
    if (current !== api) return;
    scrim.classList.remove('is-open');
    sheet.classList.remove('is-open');
    current = null;
    onClose?.();
    setTimeout(() => {
      scrim.remove();
      sheet.remove();
    }, 340);
  };

  api._doClose = doClose;
  scrim.addEventListener('pointerdown', doClose);
  closeBtn.addEventListener('click', doClose);

  /* Drag the grab handle down to dismiss. */
  let startY = null;
  const onDown = (e) => { startY = e.clientY; sheet.style.transition = 'none'; };
  const onMove = (e) => {
    if (startY == null) return;
    const dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const onUp = (e) => {
    if (startY == null) return;
    const dy = Math.max(0, e.clientY - startY);
    sheet.style.transition = '';
    sheet.style.transform = '';
    startY = null;
    if (dy > 90) doClose();
  };
  for (const target of [grab, sheet.querySelector('.sheet__head')]) {
    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }

  current = api;
  return api;
}

export function closeSheet() {
  current?._doClose?.();
}

export function activeSheet() {
  return current;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

/* ==========================================================================
   Form atoms
   ========================================================================== */

export function group(title, ...children) {
  return h('div.group', null,
    title ? h('div.group__title', null, title) : null,
    ...children,
  );
}

export function note(text) {
  return h('p.group__note', null, text);
}

export function row(label, sub, control, opts = {}) {
  return h(`div.row${opts.stack ? '.row--stack' : ''}${opts.tap ? '.row--tap' : ''}`,
    opts.onclick ? { onclick: opts.onclick } : null,
    h('div.row__text', null,
      h('div.row__label', null, label),
      sub ? h('div.row__sub', null, sub) : null,
    ),
    control || null,
  );
}

export function switchRow(label, sub, value, onChange) {
  const btn = h('button.switch', {
    'aria-pressed': String(!!value),
    'aria-label': label,
    onclick: () => {
      const next = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(next));
      onChange(next);
    },
  });
  return row(label, sub, btn);
}

export function segRow(label, sub, options, value, onChange) {
  const buttons = new Map();
  const seg = h('div.seg', { role: 'group', 'aria-label': label });
  for (const opt of options) {
    const btn = h('button', {
      class: opt.value === value ? 'is-on' : '',
      onclick: () => {
        for (const [v, b] of buttons) b.classList.toggle('is-on', v === opt.value);
        onChange(opt.value);
      },
    }, opt.label);
    buttons.set(opt.value, btn);
    seg.append(btn);
  }
  return row(label, sub, seg, { stack: true });
}

export function sliderRow(label, sub, {
  min = 0, max = 1, step = 0.01, value = 0.5, format = (v) => v.toFixed(2), onInput,
}) {
  const val = h('span.val', null, format(value));
  const input = h('input.slider', {
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    'aria-label': label,
    oninput: () => {
      const v = Number(input.value);
      val.textContent = format(v);
      input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
      onInput(v);
    },
  });
  input.style.setProperty('--fill', `${((value - min) / (max - min)) * 100}%`);

  return h('div.row.row--stack', null,
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
      h('div.row__text', null,
        h('div.row__label', null, label),
        sub ? h('div.row__sub', null, sub) : null,
      ),
      val,
    ),
    input,
  );
}

export function buttonRow(label, sub, buttonLabel, onClick, kind = '') {
  return row(label, sub, h(`button.btn.btn--ghost${kind ? `.${kind}` : ''}`, {
    onclick: onClick,
    style: { padding: '9px 16px', fontSize: '13px', flex: '0 0 auto' },
  }, buttonLabel));
}

export function stepList(...items) {
  return h('div.steps', null, ...items.map((item) => h('div.step', { html: item })));
}

export { clamp };
