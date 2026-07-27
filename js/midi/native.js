/* Bridge to a native shell (see docs/IOS.md).

   The contract, deliberately tiny so the Swift/Kotlin side stays short:

     window.SnythiaNative = {
       listDevices(): Promise<Array<{id, name}>>,
       connect(id): Promise<void>,
       disconnect(): Promise<void>,
       showPairingUI?(): Promise<void>,   // iOS CoreMIDI BLE pairing sheet
     }

   The shell pushes incoming MIDI by calling, on every message:

     window.__snythiaMidi([status, data1, data2])

   ...and reports connection changes with:

     window.__snythiaMidiStatus({ status: 'connected'|'idle'|'error', name })

   Both globals are installed by this module, so the shell only has to call
   them. Everything else in the app is identical across platforms. */

export class NativeMidiTransport {
  constructor() {
    this.kind = 'native';
    this.label = 'Native bridge';
    this.status = 'idle';
    this.onMessage = null;
    this.onStatus = null;
    this._name = '';

    window.__snythiaMidi = (bytes) => {
      if (!bytes || !bytes.length) return;
      this.onMessage?.(Array.from(bytes), performance.now());
    };

    window.__snythiaMidiStatus = (info = {}) => {
      this._name = info.name || this._name;
      this.status = info.status || 'connected';
      this.onStatus?.({ kind: this.kind, status: this.status, detail: '', name: this._name });
    };
  }

  get available() {
    return !!window.SnythiaNative;
  }

  get deviceName() {
    return this._name;
  }

  get deviceId() {
    return this._id || '';
  }

  async listDevices() {
    if (!this.available) return [];
    try {
      return (await window.SnythiaNative.listDevices()) || [];
    } catch {
      return [];
    }
  }

  /** Opens the OS Bluetooth-MIDI pairing sheet, if the shell provides one. */
  async showPairingUI() {
    try {
      await window.SnythiaNative.showPairingUI?.();
      return true;
    } catch {
      return false;
    }
  }

  async connect({ deviceId } = {}) {
    if (!this.available) throw new Error('No native MIDI bridge in this build.');
    this.status = 'connecting';
    this.onStatus?.({ kind: this.kind, status: 'connecting', detail: '', name: this._name });
    const devices = await this.listDevices();
    const target = devices.find((d) => d.id === deviceId) || devices[0];
    if (!target) {
      this.status = 'waiting';
      this.onStatus?.({ kind: this.kind, status: 'waiting', detail: 'No MIDI devices', name: '' });
      return null;
    }
    await window.SnythiaNative.connect(target.id);
    this._id = target.id;
    this._name = target.name;
    this.status = 'connected';
    this.onStatus?.({ kind: this.kind, status: 'connected', detail: '', name: this._name });
    return target;
  }

  disconnect() {
    try {
      window.SnythiaNative?.disconnect?.();
    } catch {
      /* ignore */
    }
    this.status = 'idle';
    this.onStatus?.({ kind: this.kind, status: 'idle', detail: '', name: '' });
  }
}
