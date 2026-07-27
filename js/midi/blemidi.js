/* BLE-MIDI over Web Bluetooth.

   This talks to the keyboard's GATT MIDI service directly instead of going
   through the OS MIDI stack. That matters for two reasons:
     - On Android it sidesteps the flaky business of getting a BLE device bound
       into the Android MIDI service before Chrome will enumerate it.
     - On iOS it is the only route that works at all, inside a browser app that
       implements Web Bluetooth (Safari does not).

   Spec reference: the MIDI-over-Bluetooth-LE packet format. Each notification
   is a header byte (0b10xxxxxx, low 6 bits = timestamp high) followed by
   [timestamp byte][MIDI message] groups. Running status is permitted, and a
   message may omit its timestamp byte when it shares the previous one. */

export const MIDI_SERVICE_UUID = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
export const MIDI_CHARACTERISTIC_UUID = '7772e5db-3868-4112-a1a9-f2669d106bf3';

/** How many data bytes follow a given status byte. */
function dataByteCount(status) {
  if (status >= 0x80 && status <= 0xbf) return 2;   // note off/on, poly AT, CC
  if (status >= 0xc0 && status <= 0xdf) return 1;   // program change, channel pressure
  if (status >= 0xe0 && status <= 0xef) return 2;   // pitch bend
  switch (status) {
    case 0xf1: return 1;   // MTC quarter frame
    case 0xf2: return 2;   // song position
    case 0xf3: return 1;   // song select
    default: return 0;     // realtime and everything else
  }
}

/**
 * Decode one BLE-MIDI notification into a list of raw MIDI messages.
 * @param {Uint8Array} data
 * @param {{status:number, inSysex:boolean}} state carried between packets
 * @returns {number[][]} array of [status, d1?, d2?]
 */
export function decodeBleMidiPacket(data, state) {
  const out = [];
  if (!data || data.length < 1) return out;

  let i = 1;                       // byte 0 is the packet header
  const len = data.length;

  while (i < len) {
    const b = data[i];

    if (b & 0x80) {
      if (state.inSysex) {
        // Inside sysex, a high bit is either a timestamp or the 0xF7 terminator.
        if (b === 0xf7) {
          state.inSysex = false;
          i++;
          continue;
        }
        i++;                       // timestamp byte inside a split sysex
        continue;
      }
      i++;                         // consume the timestamp byte
      if (i >= len) break;
      if (data[i] & 0x80) {
        const status = data[i];
        i++;
        if (status === 0xf0) {
          state.inSysex = true;    // we don't use sysex; skip its payload
          continue;
        }
        if (status === 0xf7) {
          state.inSysex = false;
          continue;
        }
        if (status < 0xf0) state.status = status;   // channel messages latch
        const n = dataByteCount(status);
        if (n === 0) {
          out.push([status]);
          continue;
        }
        if (i + n > len) break;
        out.push([status, ...data.slice(i, i + n)]);
        i += n;
        continue;
      }
      // Timestamp followed by data bytes: running status.
    }

    if (state.inSysex) { i++; continue; }

    const status = state.status;
    if (!status) { i++; continue; }               // data with no status yet
    const n = dataByteCount(status);
    if (n === 0 || i + n > len) break;
    out.push([status, ...data.slice(i, i + n)]);
    i += n;
  }

  return out;
}

const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000];

export class BleMidiTransport {
  constructor() {
    this.kind = 'ble';
    this.label = 'Bluetooth (direct)';
    this.status = 'idle';
    this.device = null;
    this.characteristic = null;
    this.onMessage = null;
    this.onStatus = null;
    this._decodeState = { status: 0, inSysex: false };
    this._reconnectAttempt = 0;
    this._reconnectTimer = 0;
    this._wantConnected = false;
  }

  get available() {
    return !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
  }

  get deviceName() {
    return this.device?.name || '';
  }

  get deviceId() {
    return this.device?.id || '';
  }

  _setStatus(status, detail = '') {
    this.status = status;
    this.onStatus?.({ kind: this.kind, status, detail, name: this.deviceName });
  }

  /**
   * Opens the browser's device chooser. Must be called from a user gesture —
   * Web Bluetooth refuses otherwise.
   */
  async connect() {
    if (!this.available) throw new Error('Web Bluetooth is not available in this browser.');
    this._wantConnected = true;
    this._setStatus('connecting');

    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [MIDI_SERVICE_UUID] }],
        optionalServices: [MIDI_SERVICE_UUID],
      });
    } catch (err) {
      this._wantConnected = false;
      if (err?.name === 'NotFoundError') {
        // User dismissed the chooser, or nothing was advertising.
        this._setStatus('idle', 'No device chosen');
        return null;
      }
      this._setStatus('error', err?.message || String(err));
      throw err;
    }

    await this._attach(device);
    return { id: device.id, name: device.name || 'Bluetooth MIDI' };
  }

  /** Reconnect to a device already granted permission, without a chooser. */
  async reconnectKnown(deviceId) {
    if (!this.available || !navigator.bluetooth.getDevices) return false;
    try {
      const known = await navigator.bluetooth.getDevices();
      const match = known.find((d) => d.id === deviceId) || known[0];
      if (!match) return false;
      this._wantConnected = true;
      await this._attach(match);
      return true;
    } catch {
      return false;
    }
  }

  async _attach(device) {
    this.device = device;
    device.removeEventListener?.('gattserverdisconnected', this._onDropBound);
    this._onDropBound = () => this._onDrop();
    device.addEventListener('gattserverdisconnected', this._onDropBound);

    this._setStatus('connecting', device.name || '');
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(MIDI_SERVICE_UUID);
    const char = await service.getCharacteristic(MIDI_CHARACTERISTIC_UUID);
    this.characteristic = char;
    this._decodeState = { status: 0, inSysex: false };

    char.addEventListener('characteristicvaluechanged', (e) => {
      const value = e.target.value;
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const messages = decodeBleMidiPacket(bytes, this._decodeState);
      for (const msg of messages) this.onMessage?.(msg, performance.now());
    });

    await char.startNotifications();
    this._reconnectAttempt = 0;
    this._setStatus('connected', device.name || 'Bluetooth MIDI');
  }

  _onDrop() {
    this.characteristic = null;
    if (!this._wantConnected) {
      this._setStatus('idle');
      return;
    }
    this._setStatus('reconnecting', this.deviceName);
    const delay = RECONNECT_DELAYS[Math.min(this._reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this._reconnectAttempt++;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(async () => {
      if (!this._wantConnected || !this.device) return;
      try {
        await this._attach(this.device);
      } catch {
        this._onDrop();      // schedules the next, longer, attempt
      }
    }, delay);
  }

  disconnect() {
    this._wantConnected = false;
    clearTimeout(this._reconnectTimer);
    try {
      this.device?.gatt?.disconnect();
    } catch {
      /* ignore */
    }
    this.characteristic = null;
    this.device = null;
    this._setStatus('idle');
  }
}
