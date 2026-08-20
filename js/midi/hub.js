/* The MIDI router.

   Picks a transport, decodes channel messages, and decides whether each note
   belongs to the synth (keys) or a pad. Also owns the Learn wizards and the
   raw message monitor, which between them let the app adapt to a controller
   whose factory mapping we can't know in advance. */

import { bus, settings, commit } from '../state.js';
import { MACRO_BY_KEY } from '../audio/macros.js';
import { noteLabel, platform } from '../util.js';
import { WebMidiTransport } from './webmidi.js';
import { BleMidiTransport } from './blemidi.js';
import { NativeMidiTransport } from './native.js';

const MONITOR_LIMIT = 80;

function describeMessage(status, d1, d2) {
  const type = status & 0xf0;
  const ch = (status & 0x0f) + 1;
  switch (type) {
    case 0x80: return { label: `Note off  ${noteLabel(d1)} (${d1})`, detail: `ch${ch} vel ${d2}` };
    case 0x90: return {
      // A note-on at velocity 0 means note-off by convention, but it is a
      // different message on the wire and worth telling apart when a pad
      // appears to send nothing playable.
      label: `${d2 === 0 ? 'On@0 vel ' : 'Note on  '} ${noteLabel(d1)} (${d1})`,
      detail: `ch${ch} vel ${d2}`,
    };
    case 0xa0: return { label: `Poly AT   ${noteLabel(d1)} (${d1})`, detail: `ch${ch} ${d2}` };
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
    /** "n:ch:note" / "cc:ch:num" -> what it is and how often it has arrived. */
    this.seen = new Map();
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

    this._remember(status, d1, d2);
    const desc = describeMessage(status, d1, d2);
    // Raw hex removes any doubt about which message actually arrived.
    desc.detail += `  ·  ${[status, d1, d2].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`;
    this.monitor.unshift({ ...desc, bytes, at: timestamp || performance.now() });
    if (this.monitor.length > MONITOR_LIMIT) this.monitor.length = MONITOR_LIMIT;
    bus.emit('midi:raw', this.monitor[0]);

    const type = status & 0xf0;
    const channel = (status & 0x0f) + 1;

    switch (type) {
      case 0x90:
        if (d2 === 0) {
          /* Some controllers report a pad strike as note-on velocity 0, which
             the spec reads as note-off — so the hit is silently discarded. On
             the pad channel only, treat it as a real hit at a fixed velocity;
             pads are one-shots, so the missing note-off costs nothing. Never
             do this for keys, where the convention must be honoured. */
          if (settings.pads.rescueZeroVelocity !== false
            && this._isPadChannel(channel)
            && this.classify(channel, d1).target === 'pad') {
            this._noteOn(channel, d1, settings.pads.zeroVelocityLevel ?? 100);
            this._noteOff(channel, d1);
          } else {
            this._noteOff(channel, d1);
          }
        } else {
          this._noteOn(channel, d1, d2);
        }
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

  /** Track distinct controls so the monitor can summarise the hardware. */
  _remember(status, d1, d2) {
    const type = status & 0xf0;
    const ch = (status & 0x0f) + 1;
    let key = null;
    if (type === 0x90) key = `note|${ch}|${d1}`;
    else if (type === 0xb0) key = `cc|${ch}|${d1}`;
    if (!key) return;
    const entry = this.seen.get(key)
      || { kind: key.split('|')[0], channel: ch, number: d1, count: 0, zeroVel: 0, realVel: 0 };
    entry.count++;
    entry.lastValue = d2;
    if (type === 0x90) {
      if (d2 === 0) entry.zeroVel++;
      else entry.realVel++;
    }
    this.seen.set(key, entry);
  }

  /** Distinct controls seen this session, most-used first. */
  seenSummary() {
    return [...this.seen.values()].sort((a, b) => b.count - a.count);
  }

  forgetSeen() {
    this.seen.clear();
  }

  /**
   * Best guess at the pad channel: whichever channel has carried notes that
   * the 37-key keyboard could not have produced, or failing that the busiest
   * note channel that isn't the one the keys arrive on.
   */
  guessPadChannel() {
    const byChannel = new Map();
    for (const entry of this.seen.values()) {
      if (entry.kind !== 'note') continue;
      const stats = byChannel.get(entry.channel) || { count: 0, outOfRange: 0, notes: new Set() };
      stats.count += entry.count;
      stats.notes.add(entry.number);
      // A 37-key controller starting at C2 spans 36..72; anything outside that
      // is almost certainly a pad rather than a key.
      if (entry.number < 36 || entry.number > 72) stats.outOfRange += entry.count;
      byChannel.set(entry.channel, stats);
    }
    if (!byChannel.size) return null;

    const ranked = [...byChannel.entries()].sort((a, b) => {
      if (b[1].outOfRange !== a[1].outOfRange) return b[1].outOfRange - a[1].outOfRange;
      return b[1].count - a[1].count;
    });
    const [channel, stats] = ranked[0];
    return { channel, confident: stats.outOfRange > 0, distinctNotes: stats.notes.size };
  }

  /** Wipe the pad map and start assigning slots from pad 1 again. */
  resetPadSlots(padChannel = null) {
    settings.padMap = {};
    if (padChannel) settings.split.padChannel = padChannel;
    settings.split.mode = 'padmap';
    settings.pads.autoAdopt = true;
    this._invalidatePadCache();
    commit('padMap');
  }

  /**
   * Which half of the instrument does this note belong to?
   * A learned pad map always wins, because it was measured from the hardware.
   */
  classify(channel, note) {
    const learned = settings.padMap[`${channel}:${note}`];
    if (learned != null) return { target: 'pad', padIndex: learned };

    const s = settings.split;
    if (s.mode === 'padmap') {
      /* Controllers don't always number their pads contiguously — the SMK-37
         runs 36..47 and then drops to 16..19 for the last four. Rather than
         letting those fall through to the synth, anything arriving on a channel
         that Learn already established as a pad channel is folded into the pad
         range relative to the lowest note learned. */
      if (this._isPadChannel(channel)) {
        const base = this._lowestPadNote();
        const idx = base == null ? note : note - base;
        return { target: 'pad', padIndex: ((idx % 16) + 16) % 16 };
      }
      return { target: 'key' };

    }

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

  /**
   * Is this channel carrying pads?
   *
   * Either the learned map already has an entry on it, or it is the channel
   * configured under Mapping. The second half is what stops an empty map
   * deadlocking: without it nothing can ever adopt, because adopting is the
   * only thing that would make a channel known.
   */
  _isPadChannel(channel) {
    return channel === settings.split.padChannel || this._padChannels().includes(channel);
  }

  /** Channels that the learned pad map covers. */
  _padChannels() {
    if (this._padChannelCache) return this._padChannelCache;
    const set = new Set();
    for (const key of Object.keys(settings.padMap)) {
      set.add(Number(key.split(':')[0]));
    }
    this._padChannelCache = [...set];
    return this._padChannelCache;
  }

  _lowestPadNote() {
    const notes = Object.keys(settings.padMap).map((k) => Number(k.split(':')[1]));
    return notes.length ? Math.min(...notes) : null;
  }

  _invalidatePadCache() {
    this._padChannelCache = null;
  }

  /**
   * Give an unrecognised pad the first free slot and remember it. Controllers
   * that scatter their pad notes across the range (this one sends some near
   * note 16 and some near 111) defeat any contiguous assumption, so the app
   * learns them as they are played rather than guessing a formula.
   *
   * @returns {number|null} the slot claimed, or null when all 16 are taken
   */
  adoptPad(channel, note) {
    const used = new Set(Object.values(settings.padMap));
    for (let i = 0; i < 16; i++) {
      if (used.has(i)) continue;
      settings.padMap[`${channel}:${note}`] = i;
      this._invalidatePadCache();
      commit('padMap');
      bus.emit('midi:pad-adopted', { padIndex: i, note, channel });
      return i;
    }
    return null;
  }

  _noteOn(channel, note, velocity) {
    if (this.learn?.mode === 'pads') {
      this._learnPad(channel, note);
      return;
    }
    if (this.learn?.mode === 'pad-one') {
      this._learnOnePad(channel, note);
      return;
    }

    // A pad the map hasn't seen before claims a free slot, so playing all
    // sixteen once is enough to map a controller however it numbers them.
    if (settings.pads.autoAdopt !== false
      && settings.split.mode === 'padmap'
      && settings.padMap[`${channel}:${note}`] == null
      && this._isPadChannel(channel)) {
      this.adoptPad(channel, note);
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
    if (this.learn?.mode === 'pads' || this.learn?.mode === 'pad-one') return;
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

    /* A mapped control wins over the built-in meaning of its CC number. This
       matters on real hardware: the M-VAVE's four faders sit on CC64-67, which
       the MIDI spec reserves for the sustain, portamento, sostenuto and soft
       pedals. Checking the map first is what stops fader 1 latching sustain. */
    const macro = settings.ccMap[cc];
    if (macro && MACRO_BY_KEY.has(macro)) {
      bus.emit('midi:macro', { macro, value: value / 127, cc });
      bus.emit('midi:cc', { cc, value, channel });
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
      this._invalidatePadCache();
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

  /**
   * Learn one pad in isolation. Useful when a bulk Learn caught most of them
   * and a few outliers need filling in by hand.
   */
  startPadLearnOne(padIndex) {
    this.learn = { mode: 'pad-one', padIndex };
    bus.emit('midi:learn', { mode: 'pad-one', padIndex });
  }

  _learnOnePad(channel, note) {
    const { padIndex } = this.learn;
    // Drop any previous owner of this slot so two notes can't claim one pad.
    for (const [key, idx] of Object.entries(settings.padMap)) {
      if (idx === padIndex) delete settings.padMap[key];
    }
    settings.padMap[`${channel}:${note}`] = padIndex;
    if (settings.split.mode !== 'padmap') settings.split.mode = 'padmap';
    this._invalidatePadCache();
    commit('padMap');
    this.learn = null;
    bus.emit('midi:learn', { mode: 'pad-one', done: true, padIndex, note, channel });
  }

  startCCLearn(target) {
    this.learn = { mode: 'cc', target };
    bus.emit('midi:learn', { mode: 'cc', target });
  }

  clearPadMap() {
    settings.padMap = {};
    this._invalidatePadCache();
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
