/* Snythia — application controller.

   Boot order matters: audio can only start from a user gesture, so nothing is
   constructed until the splash screen is tapped. After that the app wires the
   MIDI hub, the audio graph and the UI together and stays event-driven. */

import { engine } from './audio/engine.js';
import { Clock } from './audio/clock.js';
import { PolySynth } from './audio/polysynth.js';
import { Groove, getPattern } from './audio/groove.js';
import { TakeRecorder } from './audio/recorder.js';
import { triggerPad, panicDrums } from './audio/drums.js';
import { getPreset, PRESETS } from './audio/presets.js';
import { getKit } from './audio/kits.js';
import { midiHub } from './midi/hub.js';
import { settings, bus, commit } from './state.js';
import {
  clamp, quantiseToScale, shapeVelocity, haptic, platform, formatTime, debounce, noteLabel,
} from './util.js';
import { qs } from './ui/dom.js';
import { ScreenKeyboard } from './ui/keyboard.js';
import { PadGrid } from './ui/pads.js';
import { Visualizer } from './ui/visualizer.js';
import { createKnob } from './ui/knob.js';
import { toast, toastOnce } from './ui/toast.js';
import { BashMode } from './ui/bash.js';
import {
  openConnectSheet, openSoundSheet, openSettingsSheet, openTakesSheet, openWelcomeSheet,
} from './ui/panels.js';

/* Computer keyboard mapping — handy on a laptop, and how the app is testable
   without any hardware attached. Offsets are semitones from the window's C. */
const COMPUTER_KEYS = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ';': 16, "'": 17,
};
const COMPUTER_PADS = ['z', 'x', 'c', 'v', 'b', 'n', 'm', ','];

const MACROS = [
  { key: 'cutoff', name: 'Tone', color: '#ffb454' },
  { key: 'resonance', name: 'Bite', color: '#ff7a6b' },
  { key: 'reverb', name: 'Space', color: '#4ecdc4' },
  { key: 'delay', name: 'Echo', color: '#a98cf0' },
];

class App {
  constructor() {
    this.mode = 'play';
    this.booted = false;
    this.hub = midiHub;
    this.engine = engine;
    this.knobs = new Map();
    /** null = derive the on-screen window from settings; set once it follows hardware. */
    this.screenBase = null;
    this._wakeLock = null;
  }

  /* ======================================================================
     Boot
     ====================================================================== */

  async boot() {
    if (this.booted) return;

    try {
      await engine.start();
    } catch (err) {
      qs('#splash-hint').textContent = `Audio could not start: ${err.message}`;
      return;
    }

    this.booted = true;

    /* ---- audio graph ---- */
    this.synthStrip = engine.channel('synth', {
      reverb: settings.macros.reverb,
      delay: settings.macros.delay,
    });
    this.drumStrip = engine.channel('drums', { reverb: 0.12, delay: 0.05 });

    this.clock = new Clock(engine.ctx);
    this.clock.setTempo(settings.groove.tempo);

    this.synth = new PolySynth(engine.ctx, this.synthStrip, this.clock);
    this.synth.polyphony = settings.master.polyphony;
    this.synth.setArp(settings.arp);

    this.groove = new Groove(engine.ctx, this.drumStrip, this.clock);
    this.groove.setPattern(settings.groove.patternId);
    this.groove.setLevel(settings.groove.level);

    this.recorder = new TakeRecorder(engine);

    engine.setMasterVolume(settings.master.volume);
    engine.setLimiter(settings.master.limiter);
    engine.fx.syncToTempo(settings.groove.tempo);

    /* ---- UI ---- */
    this.viz = new Visualizer(qs('#viz'), engine);
    this.viz.setEnabled(settings.ui.showVisualizer);

    this.keyboard = new ScreenKeyboard(qs('#keys'), {
      onNoteOn: (note, velocity) => this.keyOn(note, velocity, 'touch'),
      onNoteOff: (note) => this.keyOff(note, 'touch'),
    });
    this.keyboard.labelAll = settings.ui.labelKeys;

    this.pads = new PadGrid(qs('#pads'), {
      onHit: (index, velocity) => this.padHit(index, velocity, 'touch'),
    });

    this.bash = new BashMode(this);

    this.setView(settings.ui.view, { silent: true });
    this.rebuildPads();
    this.rebuildKeyboard();
    this.buildKnobs();
    this.setPatch(settings.synth.presetId, { silent: true });
    this.applyScale();
    this.refreshToggles();
    this.updateOctaveLabel();
    this.updateConnChip();

    this.wireMidi();
    this.wireChrome();
    this.startMeters();
    this.updateWakeLock();

    /* ---- reveal ---- */
    const splash = qs('#splash');
    splash.classList.add('is-going');
    setTimeout(() => { splash.hidden = true; }, 420);
    qs('#app').hidden = false;

    // The layout only has real dimensions once it's visible.
    requestAnimationFrame(() => {
      this.rebuildKeyboard();
      this.viz.resize();
    });

    this.afterBoot();
  }

  async afterBoot() {
    const lat = engine.latencyInfo();
    if (lat.total != null && lat.total > 0.08 && !settings.seenLatencyWarning) {
      settings.seenLatencyWarning = true;
      commit('latency');
      toast(
        `Audio delay is about ${Math.round(lat.total * 1000)} ms. If you're on a Bluetooth speaker, switch to the phone speaker or wired headphones.`,
        { kind: 'warn', ms: 7000 },
      );
    }

    if (!settings.onboarded) {
      openWelcomeSheet(this);
    } else if (!this.hub.connected) {
      this.showHint('No keyboard connected — tap the chip at the top left, or just play on screen.', 7000);
    }

    this.tryReconnect();
  }

  /**
   * Silently pick the keyboard back up, but only for someone who has connected
   * before. Asking for MIDI permission on a first run would be a prompt nobody
   * asked for — and an unanswered prompt never resolves, so this is deliberately
   * not awaited and is capped by a timeout.
   */
  async tryReconnect() {
    if (!settings.autoReconnect) return;
    if (settings.transport === 'auto' || settings.transport === 'none') return;

    const dev = await Promise.race([
      this.hub.connect({ interactive: false }).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    if (dev) toast(`Reconnected to ${dev.name || 'keyboard'}`, { kind: 'good' });
  }

  /* ======================================================================
     Note routing
     ====================================================================== */

  /** Raw incoming note -> the pitch that actually sounds. */
  soundingNote(raw) {
    let note = raw + settings.keyboard.transpose + settings.keyboard.octave * 12;
    if (settings.scale.lock) {
      note = quantiseToScale(note, settings.scale.root, settings.scale.name, settings.scale.mode);
    }
    return clamp(note, 0, 127);
  }

  keyOn(raw, velocity01, source = 'touch') {
    if (this.mode === 'bash') {
      this.bash.hardwareNoteOn(raw, velocity01);
      return;
    }
    const note = this.soundingNote(raw);
    this.synth.noteOn(note, velocity01, { key: `${source}:${raw}` });

    // With hardware attached the on-screen keyboard is mainly a display, so it
    // follows the controller: play outside the visible octave and the window
    // moves to keep up, instead of the note lighting nothing at all.
    if (source === 'midi' && !settings.keyboard.fitAll && !this.keyboard.covers(raw)) {
      this.followWindow(raw);
    }

    this.keyboard.setNote(raw, true, {
      external: source === 'midi',
      color: this.patch?.color,
    });
    this.viz.bloom({ note, velocity: velocity01, color: this.patch?.color || '#ffb454' });
    if (settings.ui.haptics && source === 'touch') haptic(7);
  }

  keyOff(raw, source = 'touch') {
    if (this.mode === 'bash') {
      this.bash.hardwareNoteOff(raw);
      return;
    }
    this.synth.noteOff(`${source}:${raw}`);
    this.keyboard.setNote(raw, false);
  }

  padHit(index, velocity01, source = 'touch') {
    const def = this.mode === 'bash'
      ? this.bash.padDef(index)
      : this.kit?.pads[clamp(index, 0, 15)];
    if (!def) return;

    triggerPad(engine.ctx, this.drumStrip.input, def, velocity01);

    if (this.mode === 'bash') {
      // Pads have no tile of their own; flash a tile in the same column so
      // there's still something to look at.
      const col = index % 4;
      this.bash.flashTile(clamp(col * 5 + 2, 0, this.bash.tiles.length - 1), velocity01);
    } else {
      if (source === 'midi') this.pads.flash(index, velocity01);
      this.viz.bloom({
        x: (index % 4 + 0.5) / 4,
        velocity: velocity01,
        color: def.color,
        big: true,
      });
    }
    if (settings.ui.haptics && source === 'touch') haptic(11);
  }

  /** Used by Bash mode, which owns its own note keys and quantising. */
  playBashNote(note, velocity, key) {
    this.synth.noteOn(note, velocity, { key });
  }

  stopBashNote(key) {
    this.synth.noteOff(key);
  }

  panic() {
    this.synth?.panic();
    if (engine.ctx) panicDrums(engine.ctx);
    this.keyboard?.clearAll();
    this.pads?.clearAll();
  }

  /* ======================================================================
     MIDI
     ====================================================================== */

  wireMidi() {
    const vel = (v) => shapeVelocity(
      v, settings.velocity.curve, settings.velocity.fixed, settings.velocity.scale,
    );

    bus.on('midi:key-on', ({ note, velocity }) => this.keyOn(note, vel(velocity), 'midi'));
    bus.on('midi:key-off', ({ note }) => this.keyOff(note, 'midi'));
    bus.on('midi:pad-on', ({ padIndex, velocity }) => this.padHit(padIndex, vel(velocity), 'midi'));

    bus.on('midi:sustain', ({ on }) => this.synth.setSustain(on));
    bus.on('midi:modwheel', ({ value }) => this.synth.setModWheel(value));
    bus.on('midi:bend', ({ value }) => this.synth.setBend(value));
    bus.on('midi:panic', () => this.panic());

    bus.on('midi:macro', ({ macro, value }) => this.setMacro(macro, value, { fromMidi: true }));

    // Program change steps through the preset list — nice from a controller.
    bus.on('midi:program', ({ program }) => {
      const preset = PRESETS[program % PRESETS.length];
      if (preset) {
        this.setPatch(preset.id);
        toast(preset.name);
      }
    });

    bus.on('midi:status', (info) => this.updateConnChip(info));
    bus.on('midi:learn', (info) => {
      if (info.done && !info.cancelled && info.count) {
        toast(`Mapped ${info.count} pads`, { kind: 'good' });
      }
    });
  }

  updateConnChip(info = {}) {
    const dot = qs('#conn-dot');
    const label = qs('#conn-label');
    const status = info.status || this.hub.status;
    const name = info.name || this.hub.deviceName;

    dot.className = 'dot';
    if (status === 'connected') dot.classList.add('is-on');
    else if (status === 'error' || status === 'unavailable') dot.classList.add('is-err');
    else if (status !== 'idle') dot.classList.add('is-wait');

    const text = {
      connected: name || 'Connected',
      connecting: 'Connecting…',
      reconnecting: 'Reconnecting…',
      waiting: 'No device',
      error: 'Failed',
      unavailable: 'No MIDI here',
      idle: 'No keyboard',
    }[status] || status;
    label.textContent = text;

    if (status === 'connected') {
      this.showHint(null);
      toastOnce('mirror',
        'Keyboard live. The on-screen keys mirror what you play and follow your octave.',
        { kind: 'good', ms: 5000 });
    }
  }

  /* ======================================================================
     Settings appliers
     ====================================================================== */

  setPatch(id, { silent = false } = {}) {
    const preset = getPreset(id);
    this.patch = preset;
    settings.synth.presetId = preset.id;
    this.synth.setPatch(preset);

    // A patch recalls its own effect levels, like a hardware preset would.
    settings.macros.cutoff = preset.macroCutoff ?? 0.75;
    settings.macros.reverb = preset.send.reverb;
    settings.macros.delay = preset.send.delay;
    this.applyMacros();

    if (!silent) commit('synth');
    qs('#patch-label').textContent = preset.name;
    qs('#patch-swatch').style.background = preset.color;
    qs('#patch-swatch').style.color = preset.color;
  }

  setKit(id) {
    settings.pads.kitId = id;
    commit('pads');
    this.rebuildPads();
  }

  rebuildPads() {
    this.kit = getKit(settings.pads.kitId);
    this.pads.setKit(this.kit, settings.pads.layout || 'mpc');
  }

  /** Slide the on-screen window so `note` is visible, keeping whole octaves. */
  followWindow(note) {
    const base = this.keyboard.windowAround(note);
    if (base === this.keyboard.baseNote) return;
    this.screenBase = base;
    this.keyboard.configure({ baseNote: base });
    this.applyScale();
  }

  rebuildKeyboard() {
    const base = settings.keyboard.fitAll
      ? settings.keyboard.baseNote
      : this.screenBase ?? Math.min(settings.keyboard.baseNote + 12, 84);
    this.keyboard.labelAll = settings.ui.labelKeys;
    this.keyboard.configure({
      baseNote: base,
      fitAll: settings.keyboard.fitAll,
      totalKeys: settings.keyboard.keyCount,
    });
    this.applyScale();
  }

  applyScale() {
    this.keyboard.setScale({
      lock: settings.scale.lock,
      root: settings.scale.root,
      name: settings.scale.name,
    });
  }

  applyMacros() {
    const m = settings.macros;
    this.synth.setMacro('cutoff', m.cutoff);
    this.synth.setMacro('resonance', m.resonance);
    this.synthStrip.setReverb(m.reverb);
    this.synthStrip.setDelay(m.delay);
    // Drums want much less of both, or the kit turns to mush.
    this.drumStrip.setReverb(m.reverb * 0.35);
    this.drumStrip.setDelay(m.delay * 0.25);
    for (const [key, knob] of this.knobs) knob.set(m[key]);
  }

  setMacro(name, value, { fromMidi = false } = {}) {
    settings.macros[name] = value;
    commit('macros');
    this.applyMacros();
    if (fromMidi) this.knobs.get(name)?.set(value);
  }

  setTempo(bpm) {
    settings.groove.tempo = Math.round(bpm);
    commit('groove');
    this.clock.setTempo(settings.groove.tempo);
    engine.fx.syncToTempo(settings.groove.tempo);
    qs('#tempo-val').textContent = String(settings.groove.tempo);
  }

  setPattern(id) {
    settings.groove.patternId = id;
    commit('groove');
    this.groove.setPattern(id);
    const pattern = getPattern(id);
    qs('#groove-name').textContent = pattern.name;
    this.setTempo(pattern.tempo);
    if (!settings.groove.on) this.setGroove(true);
  }

  setGroove(on) {
    settings.groove.on = on;
    commit('groove');
    if (on) {
      this.groove.start();
      this.clock.start();
    } else {
      this.groove.stop();
      if (!settings.arp.on) this.clock.stop();
    }
    this.refreshToggles();
  }

  setArp(patch) {
    Object.assign(settings.arp, patch);
    commit('arp');
    this.synth.setArp(settings.arp);
    if (settings.arp.on) this.clock.start();
    else if (!settings.groove.on) this.clock.stop();
    this.refreshToggles();
  }

  setView(view, { silent = false } = {}) {
    settings.ui.view = view;
    if (!silent) commit('ui');
    document.body.dataset.view = view;
    for (const btn of document.querySelectorAll('.viewbtn')) {
      btn.classList.toggle('is-on', btn.dataset.view === view);
    }
    if (this.keyboard) requestAnimationFrame(() => this.rebuildKeyboard());
  }

  setOctave(delta) {
    settings.keyboard.octave = clamp(settings.keyboard.octave + delta, -3, 3);
    commit('keyboard');
    this.updateOctaveLabel();
    this.panic();   // held notes would otherwise be stuck at the old pitch
  }

  updateOctaveLabel() {
    const o = settings.keyboard.octave;
    qs('#oct-val').textContent = o > 0 ? `+${o}` : String(o);
  }

  refreshToggles() {
    qs('#tog-arp').setAttribute('aria-pressed', String(settings.arp.on));
    qs('#arp-rate').textContent = settings.arp.rate;
    qs('#tog-hold').setAttribute('aria-pressed', String(settings.arp.hold));
    qs('#tog-groove').setAttribute('aria-pressed', String(settings.groove.on));
    qs('#groove-name').textContent = getPattern(settings.groove.patternId).name;
    qs('#tempo-val').textContent = String(settings.groove.tempo);
  }

  buildKnobs() {
    const row = qs('#knobrow');
    row.textContent = '';
    for (const macro of MACROS) {
      const knob = createKnob({
        name: macro.name,
        color: macro.color,
        value: settings.macros[macro.key],
        defaultValue: this.patch ? undefined : 0.5,
        format: (v) => `${Math.round(v * 100)}`,
        onChange: (v, live) => {
          settings.macros[macro.key] = v;
          this.applyMacros();
          if (!live) commit('macros');
        },
      });
      this.knobs.set(macro.key, knob);
      row.append(knob.el);
    }
  }

  /* ======================================================================
     Chrome wiring
     ====================================================================== */

  wireChrome() {
    qs('#conn-chip').addEventListener('click', () => openConnectSheet(this));
    qs('#patch-chip').addEventListener('click', () => openSoundSheet(this));
    qs('#menu-btn').addEventListener('click', () => openSettingsSheet(this));
    qs('#oct-down').addEventListener('click', () => this.setOctave(-1));
    qs('#oct-up').addEventListener('click', () => this.setOctave(1));

    qs('#panic-btn').addEventListener('click', () => {
      this.panic();
      toast('All sound stopped');
    });

    qs('#bash-btn').addEventListener('click', () => this.enterBash());

    for (const btn of document.querySelectorAll('.viewbtn')) {
      btn.addEventListener('click', () => this.setView(btn.dataset.view));
    }

    qs('#tog-arp').addEventListener('click', () => this.setArp({ on: !settings.arp.on }));
    qs('#tog-hold').addEventListener('click', () => this.setArp({ hold: !settings.arp.hold }));
    qs('#tog-groove').addEventListener('click', () => this.setGroove(!settings.groove.on));
    qs('#tog-tempo').addEventListener('click', () => openSoundSheet(this, 'beat'));

    qs('#rec-btn').addEventListener('click', () => this.toggleRecording());

    /* ---- resize ---- */
    const onResize = debounce(() => {
      this.rebuildKeyboard();
      this.viz.resize();
    }, 180);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    /* ---- lifecycle ---- */
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) {
        this.panic();
        await engine.suspend();
      } else {
        await engine.resume();
        this.updateWakeLock();
      }
    });

    // Any tap re-arms audio if the browser suspended it behind our back.
    document.addEventListener('pointerdown', () => engine.resume(), { passive: true });

    /* ---- computer keyboard ---- */
    const held = new Set();
    window.addEventListener('keydown', (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target.matches?.('input, textarea, select')) return;
      const key = event.key.toLowerCase();

      if (key === ' ') {
        event.preventDefault();
        this.setGroove(!settings.groove.on);
        return;
      }
      if (key === 'escape' && this.mode === 'bash') return;   // Bash needs the hold

      const padIndex = COMPUTER_PADS.indexOf(key);
      if (padIndex >= 0) {
        if (held.has(key)) return;
        held.add(key);
        this.padHit(padIndex, 0.9, 'touch');
        return;
      }

      const offset = COMPUTER_KEYS[key];
      if (offset == null || held.has(key)) return;
      held.add(key);
      this.keyOn(this._computerBase() + offset, 0.85, 'computer');
    });

    window.addEventListener('keyup', (event) => {
      const key = event.key.toLowerCase();
      if (!held.delete(key)) return;
      const offset = COMPUTER_KEYS[key];
      if (offset != null) this.keyOff(this._computerBase() + offset, 'computer');
    });

    window.addEventListener('blur', () => {
      held.clear();
      this.panic();
    });
  }

  _computerBase() {
    return this.keyboard?.lowNote ?? 48;
  }

  showHint(text, ms = 6000) {
    const el = qs('#hint');
    clearTimeout(this._hintTimer);
    if (!text) {
      el.hidden = true;
      return;
    }
    el.textContent = text;
    el.hidden = false;
    this._hintTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  /* ======================================================================
     Recording
     ====================================================================== */

  toggleRecording() {
    const btn = qs('#rec-btn');
    const time = qs('#rec-time');

    if (!this.recorder.supported) {
      toast('This browser can’t record audio', { kind: 'bad' });
      return;
    }

    if (this.recorder.recording) {
      this.recorder.stop();
      btn.classList.remove('is-rec');
      time.textContent = '';
      clearInterval(this._recTimer);
      toast('Take saved — open it from Settings › Audio', { kind: 'good' });
      return;
    }

    if (!this.recorder.start()) {
      toast('Recording could not start', { kind: 'bad' });
      return;
    }
    btn.classList.add('is-rec');
    this._recTimer = setInterval(() => {
      time.textContent = formatTime(this.recorder.elapsed);
    }, 400);
    this.recorder.onChange = () => {};
    toast('Recording');
  }

  /* ======================================================================
     Bash mode
     ====================================================================== */

  async enterBash() {
    if (this.mode === 'bash') return;
    this.panic();
    this.mode = 'bash';
    this.bash.enter();
    this.updateWakeLock();
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      /* iOS Safari has no fullscreen API for elements — the PWA is already full screen */
    }
  }

  exitBash() {
    if (this.mode !== 'bash') return;
    this.panic();
    this.mode = 'play';
    this.bash.exit();
    this.bash.restore();

    // Put Play mode back exactly as it was.
    engine.setMasterVolume(settings.master.volume);
    this.setPatch(settings.synth.presetId, { silent: true });
    this.applyMacros();
    if (settings.groove.on) {
      this.groove.setPattern(settings.groove.patternId);
      this.groove.setLevel(settings.groove.level);
      this.groove.start();
      this.clock.setTempo(settings.groove.tempo);
      this.clock.start();
    } else if (!settings.arp.on) {
      this.clock.stop();
    }

    try {
      if (document.fullscreenElement) document.exitFullscreen?.();
    } catch { /* ignore */ }
    toast('Back to Play mode');
  }

  /* ======================================================================
     Housekeeping
     ====================================================================== */

  async updateWakeLock() {
    const want = settings.ui.keepAwake && !document.hidden;
    if (want && 'wakeLock' in navigator) {
      if (this._wakeLock) return;
      try {
        this._wakeLock = await navigator.wakeLock.request('screen');
        this._wakeLock.addEventListener('release', () => { this._wakeLock = null; });
      } catch {
        /* denied, or not allowed in this context */
      }
    } else if (!want && this._wakeLock) {
      try { await this._wakeLock.release(); } catch { /* ignore */ }
      this._wakeLock = null;
    }
  }

  startMeters() {
    const meter = qs('#meter').firstElementChild;
    const voices = qs('#stat-voices');
    setInterval(() => {
      if (document.hidden || !engine.ready) return;
      meter.style.width = `${Math.round(engine.level() * 100)}%`;
      voices.textContent = String(this.synth.voiceCount);
    }, 120);
  }
}

/* ==========================================================================
   Start-up
   ========================================================================== */

const app = new App();
window.snythia = app;   // handy in the console, and used by the test harness

function describeSplash() {
  const hint = qs('#splash-hint');
  if (platform.isIOS && !platform.hasWebMidi && !platform.hasWebBluetooth) {
    hint.innerHTML = 'Heads up: Safari on iPhone can’t see MIDI hardware. '
      + 'Everything on screen works, and the Keyboard screen explains how to get your '
      + 'controller talking.';
  } else if (platform.hasWebMidi || platform.hasWebBluetooth) {
    hint.textContent = 'Your keyboard can connect once the app is running.';
  } else {
    hint.textContent = 'No MIDI support in this browser — the on-screen keys still work.';
  }
}

describeSplash();

const startHandlers = ['click', 'touchend'];
for (const evt of startHandlers) {
  qs('#splash-start').addEventListener(evt, (e) => {
    e.preventDefault();
    app.boot();
  }, { once: true });
}
qs('#splash').addEventListener('click', () => app.boot());

/* Service worker: offline support and installability. */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('[sw] registration failed', err);
    });
  });
}

export { app };
