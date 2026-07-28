/* The MIDI router.

   Picks a transport, decodes channel messages, and decides whether each note
   belongs to the synth (keys) or a pad. Also owns the Learn wizards and the
   raw message monitor, which between them let the app adapt to a controller
   whose factory mapping we can't know in advance. */

import { bus, settings, commit } from '../state.js';
import { noteLabel, platform } from '../util.js';
import { WebMidiTransport } from './webmidi.js';
import { BleMidiTransport } from './blemidi.js';
import { NativeMidiTransport } from './native.js';

const MONITOR_LIMIT = 80;

function describeMessage(status, d1, d2) {
  const type = status & 0xf0;
  const ch = (status & 0x0f) + 1;
  switch (type) {
    case 0x80: return { label: `Note off  ${noteLabel(d1)}`, detail: `ch${ch} vel ${d2}` };
    case 0x90: return {
      label: d2 === 0 ? `Note off  ${noteLabel(d1)}` : `Note on   ${noteLabel(d1)}`,
      detail: `ch${ch} vel ${d2}`,
    };
    case 0xa0: return { label: `Poly AT   ${noteLabel(d1)}`, detail: `ch${ch} ${d2}` };
    case 0xb0: return { label: `CC ${String(d1).padStart(3)}`, detail: `ch${ch} ${d2}` };
    case 0xc0: return { label: `Program ${d1}`, detail: `ch${ch}` };
    case 0xd0: return { label: 'Channel AT', detail: `ch${ch} ${d1}` };
    case 0xe0: return { label: 'Pitch bend', detail: `ch${ch} ${((d2 << 7) | d1) - 8192}` };
    default: return { label: `0x${status.toString(16)}`, detail: '' };
  }
}

export class MidiHub {
  constructor() {
    this.webmidi = new WebMidiTransport();
    this.ble = new BleMidiTransport();
    this.native = new NativeMidiTransport();
    this.active = null;
    this.monitor = [];
    this.learn = null;
    this._activeNotes = new Set();

    for (const t of [this.webmidi, this.ble, this.native]) {
      t.onMessage = (bytes, ts) => this._onMessage(bytes, ts, t);
      t.onStatus = (info) => this._onStatus(info, t);
    }

    this.webmidi.onPortsChanged = (ports) => bus.emit('midi:ports', ports);
  }

  /* ---- connection ------------------------------------------------------- */

  get status() {
    return this.active?.status || 'idle';
  }

  get deviceName() {
    return this.active?.deviceName || '';
  }

  get connected() {
    return this.status === 'connected';
  }

  availableTransports() {
    const list = [];
    if (this.native.available) list.push({ kind: 'native', label: 'Built-in MIDI', transport: this.native });
    if (this.webmidi.available) list.push({ kind: 'webmidi', label: 'Web MIDI', transport: this.webmidi });
    if (this.ble.available) list.push({ kind: 'ble', label: 'Bluetooth (direct)', transport: this.ble });
    return list;
  }

  /**
   * @param {object} opts
   * @param {boolean} opts.interactive true when called from a user gesture, which
   *   is required for the Bluetooth chooser and for MIDI permission prompts.
   */
  async connect({ kind = settings.transport, interactive = false } = {}) {
    const wanted = kind === 'auto' ? this._preferredKind() : kind;
    if (wanted === 'none') return null;

    const transport = this[wanted];
    if (!transport || !transport.available) {
      bus.emit('midi:status', {
        kind: wanted, status: 'unavailable', name: '',
        detail: 'Not supported in this browser',
      });
      return null;
    }

    if (this.active && this.active !== transport) this.active.disconnect();
    this.active = transport;

    try {
      if (wanted === 'ble') {
        if (!interactive) {
          // Silent path: only works for a device we already have permission for.
          const ok = await this.ble.reconnectKnown(settings.lastDevice.id);
          return ok ? { id: this.ble.deviceId, name: this.ble.deviceName } : null;
        }
        const dev = await this.ble.connect();
        if (dev) this._remember(dev);
        return dev;
      }

      const dev = await transport.connect({ deviceId: settings.lastDevice.id || 'all' });
      if (dev) this._remember(dev);
      return dev;
    } catch (err) {
      console.warn('[midi] connect failed', err);
      bus.emit('midi:status', {
        kind: wanted, status: 'error', name: '',
        detail: err?.message || 'Connection failed',
      });
      return null;
    }
  }

  _preferredKind() {
    if (this.native.available) return 'native';
    if (this.webmidi.available) return 'webmidi';
    if (this.ble.available) return 'ble';
    return 'none';
  }

  _remember(dev) {
    settings.lastDevice = { id: dev.id || '', name: dev.name || '' };
    commit('device');
  }

  disconnect() {
    this.active?.disconnect();
    this.active = null;
    bus.emit('midi:panic');
  }

  _onStatus(info, transport) {
    if (transport !== this.active) return;
    // Any drop should silence held notes rather than leave them ringing.
    if (info.status !== 'connected') {
      this._activeNotes.clear();
      bus.emit('midi:panic');
    }
    bus.emit('midi:status', info);
  }

  /* ---- message handling ------------------------------------------------- */

  _onMessage(bytes, timestamp, transport) {
    if (transport !== this.active) return;
    const [status, d1 = 0, d2 = 0] = bytes;

    // Clock, active sensing and friends arrive constantly; keep them out of
    // the monitor so it stays readable.
    if (status >= 0xf8) return;

    const desc = describeMessage(status, d1, d2);
    this.monitor.unshift({ ...desc, bytes, at: timestamp || performance.now() });
    if (this.monitor.length > MONITOR_LIMIT) this.monitor.length = MONITOR_LIMIT;
    bus.emit('midi:raw', this.monitor[0]);

    const type = status & 0xf0;
    const channel = (status & 0x0f) + 1;

    switch (type) {
      case 0x90:
        if (d2 === 0) this._noteOff(channel, d1);
        else this._noteOn(channel, d1, d2);
        break;
      case 0x80:
        this._noteOff(channel, d1);
        break;
      case 0xb0:
        this._controlChange(channel, d1, d2);
        break;
      case 0xe0:
        bus.emit('midi:bend', { value: (((d2 << 7) | d1) - 8192) / 8192, channel });
        break;
      case 0xd0:
        bus.emit('midi:aftertouch', { value: d1 / 127, channel });
        break;
      case 0xa0:
        bus.emit('midi:aftertouch', { value: d2 / 127, note: d1, channel });
        break;
      case 0xc0:
        bus.emit('midi:program', { program: d1, channel });
        break;
      default:
        break;
    }
  }

  /**
   * Which half of the instrument does this note belong to?
   * A learned pad map always wins, because it was measured from the hardware.
   */
  classify(channel, note) {
    const learned = settings.padMap[`${channel}:${note}`];
    if (learned != null) return { target: 'pad', padIndex: learned };

    const s = settings.split;
    if (s.mode === 'padmap') return { target: 'key' };   // only learned pads count

    if (s.mode === 'channel') {
      if (channel === s.padChannel) {
        const idx = note - s.padBaseNote;
        if (idx >= 0 && idx < 16) return { target: 'pad', padIndex: idx };
        // On the pad channel but outside the pad range — wrap so nothing is lost.
        return { target: 'pad', padIndex: ((idx % 16) + 16) % 16 };
      }
      return { target: 'key' };
    }

    if (s.mode === 'range') {
      if (note >= s.padRangeLo && note <= s.padRangeHi) {
        return { target: 'pad', padIndex: Math.min(15, note - s.padRangeLo) };
      }
      return { target: 'key' };
    }

    return { target: 'key' };
  }

  _noteOn(channel, note, velocity) {
    if (this.learn?.mode === 'pads') {
      this._learnPad(channel, note);
      return;
    }

    const { target, padIndex } = this.classify(channel, note);
    this._activeNotes.add(`${channel}:${note}`);

    if (target === 'pad') {
      bus.emit('midi:pad-on', { padIndex, velocity, note, channel });
    } else {
      bus.emit('midi:key-on', { note, velocity, channel });
    }
  }

  _noteOff(channel, note) {
    if (this.learn?.mode === 'pads') return;
    this._activeNotes.delete(`${channel}:${note}`);
    const { target, padIndex } = this.classify(channel, note);
    if (target === 'pad') bus.emit('midi:pad-off', { padIndex, note, channel });
    else bus.emit('midi:key-off', { note, channel });
  }

  _controlChange(channel, cc, value) {
    if (this.learn?.mode === 'cc') {
      settings.ccMap[cc] = this.learn.target;
      commit('ccMap');
      const target = this.learn.target;
      this.learn = null;
      bus.emit('midi:learn', { mode: 'cc', done: true, cc, target });
      return;
    }

    if (cc === 64) {
      bus.emit('midi:sustain', { on: value >= 64 });
      return;
    }
    if (cc === 1) {
      bus.emit('midi:modwheel', { value: value / 127 });
      return;
    }
    if (cc === 123 || cc === 120) {
      bus.emit('midi:panic');
      return;
    }

    const macro = settings.ccMap[cc];
    if (macro) bus.emit('midi:macro', { macro, value: value / 127, cc });
    bus.emit('midi:cc', { cc, value, channel });
  }

  /* ---- learn ------------------------------------------------------------ */

  /**
   * Ask the player to hit pads 1..16 in order. This is the only reliable way
   * to map a controller whose factory note assignments we don't know.
   */
  startPadLearn() {
    this.learn = { mode: 'pads', collected: [], seen: new Set() };
    bus.emit('midi:learn', { mode: 'pads', progress: 0, total: 16 });
  }

  _learnPad(channel, note) {
    const key = `${channel}:${note}`;
    if (this.learn.seen.has(key)) return;   // ignore a double-tap on one pad
    this.learn.seen.add(key);
    this.learn.collected.push(key);
    const progress = this.learn.collected.length;
    bus.emit('midi:learn', { mode: 'pads', progress, total: 16, last: noteLabel(note), channel });
    if (progress >= 16) this.finishLearn();
  }

  /** Commit however many pads were captured — 8 is still useful. */
  finishLearn() {
    if (this.learn?.mode === 'pads') {
      const map = {};
      this.learn.collected.forEach((key, i) => { map[key] = i; });
      settings.padMap = map;
      settings.split.mode = 'padmap';
      commit('padMap');
      const count = this.learn.collected.length;
      this.learn = null;
      bus.emit('midi:learn', { mode: 'pads', done: true, count });
      return count;
    }
    this.learn = null;
    bus.emit('midi:learn', { done: true, cancelled: true });
    return 0;
  }

  cancelLearn() {
    this.learn = null;
    bus.emit('midi:learn', { done: true, cancelled: true });
  }

  startCCLearn(target) {
    this.learn = { mode: 'cc', target };
    bus.emit('midi:learn', { mode: 'cc', target });
  }

  clearPadMap() {
    settings.padMap = {};
    if (settings.split.mode === 'padmap') settings.split.mode = 'channel';
    commit('padMap');
  }

  /* ---- help text -------------------------------------------------------- */

  /** What this browser can and can't do, for the connection screen. */
  capabilities() {
    return {
      webmidi: this.webmidi.available,
      bluetooth: this.ble.available,
      native: this.native.available,
      isIOS: platform.isIOS,
      isAndroid: platform.isAndroid,
      anyMidi: this.webmidi.available || this.ble.available || this.native.available,
    };
  }
}

export const midiHub = new MidiHub();
