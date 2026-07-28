/* Contents of every bottom sheet: connection, mapping, monitor, sounds,
   settings, takes and the Bash-mode setup. */

import { h } from './dom.js';
import {
  openSheet, closeSheet, group, note, row, switchRow, segRow, sliderRow, buttonRow, stepList,
} from './sheet.js';
import { toast } from './toast.js';
import { bus, settings, commit, exportSettings, importSettings, resetSettings } from '../state.js';
import { platform, noteLabel, SCALES, pitchClassName, formatTime } from '../util.js';
import { PRESETS, PRESET_CATEGORIES, BASH_SOUNDS } from '../audio/presets.js';
import { KITS, getKit } from '../audio/kits.js';
import { PATTERNS } from '../audio/groove.js';

const STATUS_TEXT = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  waiting: 'Waiting for a device',
  connected: 'Connected',
  error: 'Connection failed',
  unavailable: 'Not supported here',
};

const STATUS_KIND = {
  connected: 'good',
  waiting: 'warn',
  connecting: 'warn',
  reconnecting: 'warn',
  error: 'bad',
  unavailable: 'bad',
};

/* Terse pill wording — the row beside it already spells the state out. */
const STATUS_PILL = {
  connected: 'Live',
  connecting: 'Wait',
  reconnecting: 'Wait',
  waiting: 'Waiting',
  error: 'Failed',
  unavailable: 'N/A',
  idle: 'Off',
};

/* ==========================================================================
   Connection
   ========================================================================== */

export function openConnectSheet(app, activeTab = 'connect') {
  const sheet = openSheet({
    title: 'Keyboard',
    activeTab,
    tabs: [
      { id: 'connect', label: 'Connect', build: (body, api) => buildConnect(app, body, api) },
      { id: 'mapping', label: 'Mapping', build: (body, api) => buildMapping(app, body, api) },
      { id: 'monitor', label: 'Monitor', build: (body) => buildMonitor(app, body) },
    ],
  });

  const off = bus.on('midi:status', () => {
    if (sheet.activeTab === 'connect') sheet.refresh();
  });
  const offLearn = bus.on('midi:learn', () => {
    if (sheet.activeTab === 'mapping') sheet.refresh();
  });
  const origClose = sheet._doClose;
  sheet._doClose = () => {
    off();
    offLearn();
    origClose();
  };
  return sheet;
}

function buildConnect(app, body, sheet) {
  const caps = app.hub.capabilities();
  const status = app.hub.status;
  const name = app.hub.deviceName;

  const subline = status === 'connected'
    ? (app.hub.active?.label || 'Connected')
    : status === 'idle'
      ? 'Nothing connected yet'
      : `${STATUS_TEXT[status] || status}${app.hub.active ? ` · ${app.hub.active.label}` : ''}`;

  body.append(group('Status',
    h('div.row', null,
      h('div.row__text', null,
        h('div.row__label', null, name || 'No keyboard'),
        h('div.row__sub', null, subline),
      ),
      h('span.pill', { class: `pill--${STATUS_KIND[status] || 'warn'}` },
        STATUS_PILL[status] || status),
    ),
  ));

  /* ---- the buttons that actually connect ---- */
  const actions = [];

  if (caps.bluetooth) {
    actions.push(buttonRow(
      'Connect over Bluetooth',
      'Talks to the keyboard directly. Put it in pairing mode first, then pick it from the list.',
      'Scan',
      async () => {
        const dev = await app.hub.connect({ kind: 'ble', interactive: true });
        if (dev) {
          settings.transport = 'ble';
          commit('transport');
          toast(`Connected to ${dev.name}`, { kind: 'good' });
        }
        sheet.refresh();
      },
    ));
  }

  if (caps.webmidi) {
    actions.push(buttonRow(
      'Use Web MIDI',
      'For a keyboard already paired in your phone’s Bluetooth settings, or plugged in by USB.',
      'Enable',
      async () => {
        const dev = await app.hub.connect({ kind: 'webmidi', interactive: true });
        if (dev) {
          settings.transport = 'webmidi';
          commit('transport');
          toast(dev.name ? `Listening to ${dev.name}` : 'Web MIDI enabled', { kind: 'good' });
        }
        sheet.refresh();
      },
    ));
  }

  if (caps.native) {
    actions.push(buttonRow(
      'Pair with the app',
      'Uses the built-in Bluetooth MIDI pairing sheet.',
      'Pair',
      async () => {
        await app.hub.native.showPairingUI();
        await app.hub.connect({ kind: 'native', interactive: true });
        sheet.refresh();
      },
    ));
  }

  if (actions.length) {
    body.append(group('Connect', ...actions));
  }

  /* ---- Web MIDI input picker ---- */
  if (caps.webmidi && app.hub.webmidi.access) {
    const inputs = app.hub.webmidi.inputs;
    if (inputs.length) {
      const options = [{ label: 'All inputs', value: 'all' },
        ...inputs.map((p) => ({ label: p.name, value: p.id }))];
      body.append(group('MIDI inputs', segRow(
        'Listen to',
        'Leave on “All inputs” unless something else is sending MIDI.',
        options,
        app.hub.webmidi.selectedId,
        (v) => {
          app.hub.webmidi.selectInput(v);
          settings.lastDevice = { id: v === 'all' ? '' : v, name: '' };
          commit('device');
        },
      )));
    } else {
      body.append(group('MIDI inputs', row(
        'No inputs found',
        'Pair the keyboard in your phone’s Bluetooth settings, then come back. Some phones also need a Bluetooth-MIDI helper app to hand the device to the system MIDI service — the direct Bluetooth option above skips that step.',
        null,
      )));
    }
  }

  /* ---- platform-specific guidance ---- */
  body.append(buildPlatformHelp(caps));

  body.append(group('No keyboard?', buttonRow(
    'Play on the screen',
    'The keys and pads on screen work on their own — handy for trying sounds out.',
    'Close',
    () => closeSheet(),
  )));
}

function buildPlatformHelp(caps) {
  if (caps.native) {
    return group('This build', note('Running in the native shell, so Bluetooth MIDI is handled by the operating system.'));
  }

  if (caps.isIOS && !caps.anyMidi) {
    return group('Getting your keyboard working on iPhone',
      note('Safari does not implement Web MIDI or Web Bluetooth, and every iOS browser is required to use Safari’s engine — so no website can see your keyboard in Safari. Two free apps work around it, and both load this page normally:'),
      stepList(
        'Install <b>Web MIDI Browser</b> from the App Store, open this page inside it, then use its Bluetooth button to pair the keyboard. It adds the Web MIDI support Safari is missing.',
        'Or install <b>Bluefy</b>, open this page inside it, and use <b>Connect over Bluetooth</b> above. Bluefy adds Web Bluetooth, which this app can talk BLE-MIDI over directly.',
        'For a real home-screen app with no third-party browser, build the native wrapper described in <code>docs/IOS.md</code>.',
      ),
      note('Until then, everything else works: the on-screen keys, the pads, all the sounds, recording and Bash mode.'),
    );
  }

  if (caps.isAndroid) {
    return group('Getting your keyboard working on Android',
      stepList(
        'Hold the keyboard’s Bluetooth button until it advertises, then tap <b>Scan</b> above and pick it. This is the most reliable route — it bypasses Android’s MIDI service entirely.',
        'If you would rather use the system pairing: pair it in <b>Settings → Bluetooth</b> first, then tap <b>Enable</b> under Web MIDI. Note that some Android versions need a Bluetooth-MIDI helper app before the keyboard shows up as a MIDI port.',
        'Use the phone’s speaker or wired headphones. A Bluetooth speaker adds enough delay that playing in time becomes difficult.',
      ),
    );
  }

  return group('Getting connected',
    note('On a desktop browser, pair the keyboard with the computer first, then enable Web MIDI. Chrome, Edge and Opera support it; Safari and Firefox do not.'),
  );
}

/* ==========================================================================
   Mapping
   ========================================================================== */

function buildMapping(app, body, sheet) {
  const learn = app.hub.learn;

  if (learn?.mode === 'pads') {
    const done = learn.collected.length;
    body.append(group('Learning pads',
      h('div.learnbox', null,
        h('div.micro', null, 'Hit each pad once, in order'),
        h('div.learnbox__count', null, `${done} / 16`),
        h('div.learnbox__dots', null,
          ...Array.from({ length: 16 }, (_, i) => h('span', { class: i < done ? 'is-on' : '' })),
        ),
        h('div.row__sub', null, learn.collected.length
          ? `Last: ${learn.last || ''}`
          : 'Start with pad 1 (top-left or bottom-left, whichever your controller calls first).'),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '14px', justifyContent: 'center' } },
          h('button.btn.btn--ghost', {
            onclick: () => {
              const count = app.hub.finishLearn();
              toast(count ? `Mapped ${count} pads` : 'Nothing captured', { kind: count ? 'good' : 'warn' });
              sheet.refresh();
            },
          }, 'Save what I hit'),
          h('button.btn.btn--ghost', {
            onclick: () => { app.hub.cancelLearn(); sheet.refresh(); },
          }, 'Cancel'),
        ),
      ),
    ));
    return;
  }

  const mapped = Object.keys(settings.padMap).length;

  body.append(group('Which notes are pads?',
    buttonRow(
      'Learn my pads',
      mapped
        ? `${mapped} pads mapped. Run it again to remap.`
        : 'The surest way. Hit each pad once and the app records exactly what it sends.',
      mapped ? 'Redo' : 'Start',
      () => {
        app.hub.startPadLearn();
        toast('Hit pad 1, then the rest in order', { kind: 'warn', ms: 4000 });
        sheet.refresh();
      },
    ),
    segRow('Otherwise, split by', null, [
      { label: 'MIDI channel', value: 'channel' },
      { label: 'Note range', value: 'range' },
      { label: 'Learned only', value: 'padmap' },
    ], settings.split.mode, (v) => {
      settings.split.mode = v;
      commit('split');
      sheet.refresh();
    }),
  ));

  if (settings.split.mode === 'channel') {
    body.append(group('Channel split',
      sliderRow('Pad channel', 'Most controllers put pads on channel 10.', {
        min: 1, max: 16, step: 1, value: settings.split.padChannel,
        format: (v) => `ch ${v}`,
        onInput: (v) => { settings.split.padChannel = v; commit('split'); },
      }),
      sliderRow('Pad 1 note', 'The note the first pad sends.', {
        min: 24, max: 96, step: 1, value: settings.split.padBaseNote,
        format: (v) => `${noteLabel(v)} (${v})`,
        onInput: (v) => { settings.split.padBaseNote = v; commit('split'); },
      }),
      note('Not sure? Open the Monitor tab and hit a pad — it shows the channel and note.'),
    ));
  }

  if (settings.split.mode === 'range') {
    body.append(group('Note range',
      sliderRow('Lowest pad note', null, {
        min: 0, max: 120, step: 1, value: settings.split.padRangeLo,
        format: (v) => `${noteLabel(v)} (${v})`,
        onInput: (v) => { settings.split.padRangeLo = v; commit('split'); },
      }),
      sliderRow('Highest pad note', null, {
        min: 0, max: 127, step: 1, value: settings.split.padRangeHi,
        format: (v) => `${noteLabel(v)} (${v})`,
        onInput: (v) => { settings.split.padRangeHi = v; commit('split'); },
      }),
      note('Everything inside the range plays a pad; everything outside plays the synth.'),
    ));
  }

  if (mapped) {
    body.append(group('Learned map',
      buttonRow('Clear learned pads', `${mapped} entries`, 'Clear', () => {
        app.hub.clearPadMap();
        toast('Pad map cleared');
        sheet.refresh();
      }),
    ));
  }

  body.append(group('Pad layout on screen',
    segRow('Pad 1 sits', 'Match whatever your controller prints on the pads.', [
      { label: 'Bottom left', value: 'mpc' },
      { label: 'Top left', value: 'reading' },
    ], settings.pads.layout || 'mpc', (v) => {
      settings.pads.layout = v;
      commit('pads');
      app.rebuildPads();
    }),
  ));

  body.append(group('Touch and velocity',
    segRow('Velocity response', 'How hard you have to hit for a loud note.', [
      { label: 'Soft', value: 'soft' },
      { label: 'Normal', value: 'linear' },
      { label: 'Hard', value: 'hard' },
      { label: 'Fixed', value: 'fixed' },
    ], settings.velocity.curve, (v) => {
      settings.velocity.curve = v;
      commit('velocity');
      sheet.refresh();
    }),
    settings.velocity.curve === 'fixed'
      ? sliderRow('Fixed velocity', 'Every note plays at this level.', {
        min: 1, max: 127, step: 1, value: settings.velocity.fixed,
        format: (v) => String(v),
        onInput: (v) => { settings.velocity.fixed = v; commit('velocity'); },
      })
      : null,
  ));

  body.append(group('Tuning',
    sliderRow('Transpose', 'Shifts everything, keys and hardware alike.', {
      min: -24, max: 24, step: 1, value: settings.keyboard.transpose,
      format: (v) => (v > 0 ? `+${v}` : String(v)),
      onInput: (v) => { settings.keyboard.transpose = v; commit('keyboard'); },
    }),
    switchRow('Scale lock', 'Bends every note onto a scale, so nothing can sound wrong.',
      settings.scale.lock, (on) => {
        settings.scale.lock = on;
        commit('scale');
        app.applyScale();
        sheet.refresh();
      }),
    settings.scale.lock ? segRow('Root', null,
      Array.from({ length: 12 }, (_, i) => ({ label: pitchClassName(i), value: i })),
      settings.scale.root, (v) => {
        settings.scale.root = v;
        commit('scale');
        app.applyScale();
      }) : null,
    settings.scale.lock ? segRow('Scale', null,
      Object.entries(SCALES).map(([key, s]) => ({ label: s.name, value: key })),
      settings.scale.name, (v) => {
        settings.scale.name = v;
        commit('scale');
        app.applyScale();
      }) : null,
    settings.scale.lock ? segRow('How', null, [
      { label: 'Nearest note', value: 'snap' },
      { label: 'Every key a step', value: 'fold' },
    ], settings.scale.mode, (v) => {
      settings.scale.mode = v;
      commit('scale');
    }) : null,
  ));
}

/* ==========================================================================
   MIDI monitor
   ========================================================================== */

function buildMonitor(app, body) {
  const list = h('div.monitor');
  const render = () => {
    list.textContent = '';
    if (!app.hub.monitor.length) {
      list.append(h('div.monitor__empty', null, 'Nothing yet. Press a key or a pad on the keyboard.'));
      return;
    }
    for (const msg of app.hub.monitor.slice(0, 40)) {
      list.append(h('div.monitor__row', null,
        h('span', null, msg.label),
        h('span.monitor__detail', null, msg.detail),
      ));
    }
  };
  render();

  const off = bus.on('midi:raw', () => {
    if (!list.isConnected) { off(); return; }
    render();
  });

  body.append(group('Incoming MIDI', list,
    note('This is every message the keyboard sends. Hit a pad to see which channel and note it uses, then set that up under Mapping.'),
  ));

  body.append(group('Reference', row(
    'Reading it',
    'Pads on most controllers send note-on messages on channel 10 with notes starting at C1 (36). Knobs and faders send CC messages — the number after “CC” is what to map.',
    null,
  )));
}

/* ==========================================================================
   Sounds
   ========================================================================== */

export function openSoundSheet(app, activeTab = 'synth') {
  const sheet = openSheet({
    title: 'Sounds',
    activeTab,
    tabs: [
      { id: 'synth', label: 'Keys', build: (body, api) => buildSynthPicker(app, body, api) },
      { id: 'pads', label: 'Pads', build: (body, api) => buildKitPicker(app, body, api) },
      { id: 'beat', label: 'Beat', build: (body, api) => buildBeatPicker(app, body, api) },
    ],
  });
  return sheet;
}

function buildSynthPicker(app, body, sheet) {
  for (const category of PRESET_CATEGORIES) {
    const grid = h('div.patchgrid');
    for (const preset of PRESETS.filter((p) => p.category === category)) {
      grid.append(h('button.patchcard', {
        class: preset.id === settings.synth.presetId ? 'is-on' : '',
        style: { '--pc': preset.color },
        onclick: () => {
          app.setPatch(preset.id);
          sheet.refresh();
        },
      },
        h('div.patchcard__cat', null, preset.category),
        h('div.patchcard__name', null, preset.name),
        h('div.patchcard__blurb', null, preset.blurb),
      ));
    }
    body.append(group(category, grid));
  }
  body.append(note('Picking a sound also recalls its reverb and delay levels. Nudge the knobs afterwards to taste.'));
}

function buildKitPicker(app, body, sheet) {
  const grid = h('div.patchgrid');
  for (const kit of KITS) {
    grid.append(h('button.patchcard', {
      class: kit.id === settings.pads.kitId ? 'is-on' : '',
      style: { '--pc': kit.pads[0].color },
      onclick: () => {
        app.setKit(kit.id);
        sheet.refresh();
      },
    },
      h('div.patchcard__cat', null, `${kit.pads.length} pads`),
      h('div.patchcard__name', null, kit.name),
      h('div.patchcard__blurb', null, kit.blurb),
    ));
  }
  body.append(group('Pad kits', grid));

  const kit = getKit(settings.pads.kitId);
  body.append(group('What each pad does',
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(88px,1fr))', gap: '6px' } },
      ...kit.pads.map((p, i) => h('div', {
        style: {
          padding: '7px 8px', borderRadius: '9px', background: 'var(--panel)',
          boxShadow: 'var(--bevel)', borderLeft: `3px solid ${p.color}`,
        },
      },
        h('div', { style: { fontSize: '9px', color: 'var(--ink-3)', fontWeight: '700' } }, `PAD ${i + 1}`),
        h('div', { style: { fontSize: '12px', fontWeight: '650' } }, p.name),
      )),
    ),
  ));
}

function buildBeatPicker(app, body, sheet) {
  const grid = h('div.patchgrid');
  for (const pattern of PATTERNS) {
    grid.append(h('button.patchcard', {
      class: pattern.id === settings.groove.patternId ? 'is-on' : '',
      style: { '--pc': 'var(--accent-2)' },
      onclick: () => {
        app.setPattern(pattern.id);
        sheet.refresh();
      },
    },
      h('div.patchcard__cat', null, `${pattern.tempo} bpm`),
      h('div.patchcard__name', null, pattern.name),
      pattern.blurb ? h('div.patchcard__blurb', null, pattern.blurb) : null,
    ));
  }
  body.append(group('Backing beat', grid));

  body.append(group('Transport',
    switchRow('Beat playing', 'Also toggled by the Beat button on the main screen.',
      settings.groove.on, (on) => app.setGroove(on)),
    sliderRow('Tempo', 'Drives the beat, the arpeggiator and the delay.', {
      min: 50, max: 190, step: 1, value: settings.groove.tempo,
      format: (v) => `${v} bpm`,
      onInput: (v) => app.setTempo(v),
    }),
    sliderRow('Beat level', null, {
      min: 0, max: 1, step: 0.01, value: settings.groove.level,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => { settings.groove.level = v; commit('groove'); app.groove?.setLevel(v); },
    }),
  ));

  body.append(group('Arpeggiator',
    switchRow('Arpeggiator', 'Hold a chord and it plays it in time.', settings.arp.on,
      (on) => { app.setArp({ on }); sheet.refresh(); }),
    segRow('Pattern', null, [
      { label: 'Up', value: 'up' },
      { label: 'Down', value: 'down' },
      { label: 'Up-down', value: 'updown' },
      { label: 'Random', value: 'random' },
      { label: 'Strum', value: 'chord' },
    ], settings.arp.mode, (v) => app.setArp({ mode: v })),
    segRow('Speed', null, [
      { label: '1/4', value: '1/4' },
      { label: '1/8', value: '1/8' },
      { label: '1/16', value: '1/16' },
    ], settings.arp.rate, (v) => app.setArp({ rate: v })),
    sliderRow('Note length', null, {
      min: 0.1, max: 0.95, step: 0.05, value: settings.arp.gate,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => app.setArp({ gate: v }),
    }),
    segRow('Octaves', null, [
      { label: '1', value: 1 }, { label: '2', value: 2 }, { label: '3', value: 3 },
    ], settings.arp.octaves, (v) => app.setArp({ octaves: v })),
    switchRow('Hold', 'Keeps the chord going after you let go.', settings.arp.hold,
      (on) => app.setArp({ hold: on })),
  ));
}

/* ==========================================================================
   Settings
   ========================================================================== */

export function openSettingsSheet(app, activeTab = 'play') {
  const sheet = openSheet({
    title: 'Settings',
    activeTab,
    tabs: [
      { id: 'play', label: 'Play', build: (body, api) => buildPlaySettings(app, body, api) },
      { id: 'audio', label: 'Audio', build: (body, api) => buildAudioSettings(app, body, api) },
      { id: 'bash', label: 'Bash', build: (body, api) => buildBashSettings(app, body, api) },
      { id: 'about', label: 'About', build: (body) => buildAbout(app, body) },
    ],
  });
  return sheet;
}

function buildPlaySettings(app, body, sheet) {
  body.append(group('Screen',
    segRow('Layout', null, [
      { label: 'Keys', value: 'keys' },
      { label: 'Pads', value: 'pads' },
      { label: 'Both', value: 'both' },
    ], settings.ui.view, (v) => app.setView(v)),
    switchRow('Show all 37 keys', 'Fits the whole hardware range on screen. Keys get small.',
      settings.keyboard.fitAll, (on) => {
        settings.keyboard.fitAll = on;
        commit('keyboard');
        app.rebuildKeyboard();
      }),
    switchRow('Label every white key', 'Otherwise only the Cs are labelled.',
      settings.ui.labelKeys, (on) => {
        settings.ui.labelKeys = on;
        commit('ui');
        app.rebuildKeyboard();
      }),
    switchRow('Background animation', 'Blooms behind the keys. Turn off to save battery.',
      settings.ui.showVisualizer, (on) => {
        settings.ui.showVisualizer = on;
        commit('ui');
        app.viz.setEnabled(on);
      }),
    switchRow('Vibrate on touch', null, settings.ui.haptics, (on) => {
      settings.ui.haptics = on;
      commit('ui');
    }),
    switchRow('Keep the screen awake', 'While you are playing.', settings.ui.keepAwake, (on) => {
      settings.ui.keepAwake = on;
      commit('ui');
      app.updateWakeLock();
    }),
  ));

  body.append(group('Hardware keyboard range',
    sliderRow('Lowest key sends', 'What your controller’s leftmost key plays. Only affects the on-screen display.', {
      min: 12, max: 72, step: 12, value: settings.keyboard.baseNote,
      format: (v) => noteLabel(v),
      onInput: (v) => {
        settings.keyboard.baseNote = v;
        commit('keyboard');
        app.rebuildKeyboard();
      },
    }),
    sliderRow('Number of keys', null, {
      min: 25, max: 88, step: 1, value: settings.keyboard.keyCount,
      format: (v) => `${v} keys`,
      onInput: (v) => {
        settings.keyboard.keyCount = v;
        commit('keyboard');
        app.rebuildKeyboard();
      },
    }),
  ));
}

function buildAudioSettings(app, body, sheet) {
  const lat = app.engine.latencyInfo();
  const ms = lat.total != null ? Math.round(lat.total * 1000) : null;
  const latKind = ms == null ? 'warn' : ms < 30 ? 'good' : ms < 70 ? 'warn' : 'bad';

  body.append(group('Output',
    h('div.row', null,
      h('div.row__text', null,
        h('div.row__label', null, 'Latency'),
        h('div.row__sub', null, ms == null
          ? 'This browser does not report its latency.'
          : `${ms} ms from touch to sound${lat.sampleRate ? `, ${(lat.sampleRate / 1000).toFixed(1)} kHz` : ''}.`),
      ),
      h('span.pill', { class: `pill--${latKind}` }, ms == null ? 'unknown' : `${ms} ms`),
    ),
    note('Under about 30 ms feels immediate. A Bluetooth speaker or Bluetooth headphones typically add 100–200 ms on top of this, which is enough to make playing in time hard — use the phone’s speaker or wired headphones if you can.'),
    sliderRow('Master volume', null, {
      min: 0, max: 1, step: 0.01, value: settings.master.volume,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => {
        settings.master.volume = v;
        commit('master');
        app.engine.setMasterVolume(v);
      },
    }),
    switchRow('Safety limiter', 'Stops loud chords clipping the speaker. Leave this on.',
      settings.master.limiter, (on) => {
        settings.master.limiter = on;
        commit('master');
        app.engine.setLimiter(on);
      }),
    sliderRow('Maximum voices', 'Lower it if the sound stutters on a busy patch.', {
      min: 4, max: 24, step: 1, value: settings.master.polyphony,
      format: (v) => String(v),
      onInput: (v) => {
        settings.master.polyphony = v;
        commit('master');
        app.synth.polyphony = v;
      },
    }),
  ));

  body.append(group('Effects',
    sliderRow('Reverb', null, {
      min: 0, max: 1, step: 0.01, value: settings.macros.reverb,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => app.setMacro('reverb', v),
    }),
    sliderRow('Delay', null, {
      min: 0, max: 1, step: 0.01, value: settings.macros.delay,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => app.setMacro('delay', v),
    }),
    note('Delay time follows the tempo — a dotted eighth, which is why it locks in with the beat.'),
  ));

  body.append(group('Recording',
    app.recorder.supported
      ? buttonRow('Recorded takes', `${app.recorder.takes.length} saved this session`, 'Open',
        () => openTakesSheet(app))
      : row('Not supported', 'This browser can’t record audio.', null),
    note('Takes live in memory only — download the ones you want to keep before closing the tab.'),
  ));
}

function buildBashSettings(app, body, sheet) {
  body.append(group('What Bash mode does',
    note('One tap gives a toddler the whole screen: giant tiles, every note bent onto a scale so nothing sounds wrong, a volume ceiling, softened highs, and notes that release themselves so nothing can drone. Getting out needs a three-second hold, which small hands do not manage by accident.'),
  ));

  const pick = h('div.bigpick');
  for (const sound of BASH_SOUNDS) {
    pick.append(h('button', {
      class: sound.id === settings.bash.soundSet ? 'is-on' : '',
      onclick: () => {
        settings.bash.soundSet = sound.id;
        commit('bash');
        [...pick.children].forEach((c) => c.classList.remove('is-on'));
        pick.children[BASH_SOUNDS.indexOf(sound)].classList.add('is-on');
        if (app.mode === 'bash') app.bash.applySound();
      },
    }, h('span', null, sound.emoji), sound.label));
  }
  body.append(group('Sound', pick));

  body.append(group('Safety and feel',
    sliderRow('Volume ceiling', 'The loudest it can get in Bash mode.', {
      min: 0.15, max: 1, step: 0.01, value: settings.bash.maxVolume,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => {
        settings.bash.maxVolume = v;
        commit('bash');
        if (app.mode === 'bash') app.engine.setCeiling(v);
      },
    }),
    switchRow('Soften the highs', 'Rolls off the top end so nothing is piercing.',
      settings.bash.softenHighs, (on) => {
        settings.bash.softenHighs = on;
        commit('bash');
        if (app.mode === 'bash') app.bash.applySound();
      }),
    sliderRow('Notes fade after', 'A held key releases itself, so nothing drones on.', {
      min: 1, max: 8, step: 0.5, value: settings.bash.autoReleaseSec,
      format: (v) => `${v}s`,
      onInput: (v) => { settings.bash.autoReleaseSec = v; commit('bash'); },
    }),
    switchRow('Backing beat', 'Makes bashing sound like music.', settings.bash.groove, (on) => {
      settings.bash.groove = on;
      commit('bash');
      if (app.mode === 'bash') app.bash.applyGroove();
    }),
    switchRow('Pads play drums', 'Off means the pads play tuned notes instead.',
      settings.bash.padsAreDrums, (on) => {
        settings.bash.padsAreDrums = on;
        commit('bash');
      }),
  ));

  body.append(group('Scale',
    segRow('Root', null,
      Array.from({ length: 12 }, (_, i) => ({ label: pitchClassName(i), value: i })),
      settings.bash.root, (v) => { settings.bash.root = v; commit('bash'); }),
    segRow('Scale', null,
      ['majorPentatonic', 'minorPentatonic', 'major', 'hirajoshi', 'blues'].map((k) => ({
        label: SCALES[k].name, value: k,
      })),
      settings.bash.scaleName, (v) => { settings.bash.scaleName = v; commit('bash'); }),
  ));

  body.append(group(null, buttonRow('Start Bash mode', 'Locks the screen down right away.', 'Go',
    () => { closeSheet(); app.enterBash(); })));
}

function buildAbout(app, body) {
  const caps = app.hub.capabilities();

  body.append(group('Install it',
    platform.standalone
      ? note('Already installed — you are running it from the home screen.')
      : stepList(
        platform.isIOS
          ? 'In Safari, tap <b>Share</b> then <b>Add to Home Screen</b>.'
          : 'In Chrome, open the <b>⋮</b> menu and tap <b>Install app</b> or <b>Add to Home screen</b>.',
        'It then opens full screen with no browser bars, and works offline.',
      ),
  ));

  body.append(group('This browser',
    row('Web MIDI', caps.webmidi ? 'Supported' : 'Not supported',
      h('span.pill', { class: caps.webmidi ? 'pill--good' : 'pill--bad' }, caps.webmidi ? 'yes' : 'no')),
    row('Web Bluetooth', caps.bluetooth ? 'Supported' : 'Not supported',
      h('span.pill', { class: caps.bluetooth ? 'pill--good' : 'pill--bad' }, caps.bluetooth ? 'yes' : 'no')),
    row('Audio recording', app.recorder.supported ? 'Supported' : 'Not supported',
      h('span.pill', { class: app.recorder.supported ? 'pill--good' : 'pill--bad' },
        app.recorder.supported ? 'yes' : 'no')),
  ));

  body.append(group('Your setup',
    buttonRow('Copy settings', 'Every mapping and preference, as JSON.', 'Copy', async () => {
      try {
        await navigator.clipboard.writeText(exportSettings());
        toast('Settings copied', { kind: 'good' });
      } catch {
        toast('Could not reach the clipboard', { kind: 'bad' });
      }
    }),
    buttonRow('Paste settings', 'Replaces everything with what is on your clipboard.', 'Paste', async () => {
      try {
        importSettings(await navigator.clipboard.readText());
        toast('Settings restored — reloading', { kind: 'good' });
        setTimeout(() => location.reload(), 700);
      } catch {
        toast('That clipboard text was not valid settings', { kind: 'bad' });
      }
    }),
    buttonRow('Reset everything', 'Back to factory defaults.', 'Reset', () => {
      resetSettings();
      toast('Reset — reloading');
      setTimeout(() => location.reload(), 600);
    }),
  ));

  body.append(group('About',
    note('Synthia turns a Bluetooth MIDI controller into a synth and drum machine that plays through the phone. Every sound is generated live in the browser — there are no samples to download, and it works with no network once installed.'),
  ));
}

/* ==========================================================================
   Takes
   ========================================================================== */

export function openTakesSheet(app) {
  const sheet = openSheet({
    title: 'Recordings',
    build: (body, api) => {
      if (!app.recorder.takes.length) {
        body.append(group('Nothing recorded yet',
          note('Tap the record button in the top bar, play, then tap it again. Recordings appear here.'),
        ));
        return;
      }
      const list = h('div.takelist');
      for (const take of app.recorder.takes) {
        list.append(h('div.take', null,
          h('div', { style: { flex: '1', minWidth: '0' } },
            h('div', { style: { fontSize: '13px', fontWeight: '650' } }, take.name),
            h('div.take__meta', null, formatTime(take.duration)),
            h('audio', { controls: true, src: take.url, preload: 'none', style: { width: '100%', marginTop: '6px', height: '32px' } }),
          ),
          h('button.btn.btn--ghost', {
            style: { padding: '8px 12px', fontSize: '12px' },
            onclick: () => (app.recorder.canShare ? app.recorder.share(take) : app.recorder.download(take)),
          }, app.recorder.canShare ? 'Share' : 'Save'),
          h('button.btn.btn--ghost', {
            style: { padding: '8px 11px', fontSize: '12px' },
            onclick: () => { app.recorder.remove(take); api.refresh(); },
          }, '✕'),
        ));
      }
      body.append(group(`${app.recorder.takes.length} take${app.recorder.takes.length === 1 ? '' : 's'}`, list));
      body.append(note('These are held in memory for this session only. Save anything worth keeping.'));
    },
  });
  return sheet;
}

/* ==========================================================================
   First-run onboarding
   ========================================================================== */

export function openWelcomeSheet(app) {
  const caps = app.hub.capabilities();
  return openSheet({
    title: 'Welcome',
    build: (body) => {
      body.append(group('Synthia in one minute',
        stepList(
          'Everything on screen plays right now — tap the keys and the pads.',
          'To use your keyboard, open <b>Keyboard</b> from the top-left chip and connect it.',
          'Tap the sound name to browse synths, pad kits and beats.',
          'The <b>Bash</b> button hands the whole screen to a toddler and locks it there.',
        ),
      ));

      if (!caps.anyMidi) {
        body.append(group('About your phone',
          note(caps.isIOS
            ? 'This is an iPhone or iPad, so Safari cannot see MIDI hardware at all — an Apple limitation, not a bug here. The Keyboard screen lists two free apps that fix it. Everything else works as-is.'
            : 'This browser has no MIDI support. The on-screen keys and pads still work; Chrome would let you connect the keyboard.'),
        ));
      }

      body.append(group(null, buttonRow('Ready', 'You can reopen this from Settings.', 'Start playing', () => {
        settings.onboarded = true;
        commit('onboarded');
        closeSheet();
      })));
    },
    onClose: () => {
      settings.onboarded = true;
      commit('onboarded');
    },
  });
}
