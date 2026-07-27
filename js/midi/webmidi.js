/* Web MIDI transport.

   Available in Chrome/Edge/Opera and Samsung Internet, on desktop and Android.
   Not available in any iOS browser except third-party shells that ship a shim.

   By default we listen to every input port. Bluetooth keyboards show up under
   unpredictable names, and listening to all of them means the app just works
   when the keyboard reconnects under a different port id. */

export class WebMidiTransport {
  constructor() {
    this.kind = 'webmidi';
    this.label = 'Web MIDI';
    this.status = 'idle';
    this.access = null;
    this.onMessage = null;
    this.onStatus = null;
    this.onPortsChanged = null;
    this.selectedId = 'all';
    this._bound = new Map();
  }

  get available() {
    return typeof navigator.requestMIDIAccess === 'function';
  }

  get inputs() {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((p) => ({
      id: p.id,
      name: p.name || 'MIDI input',
      manufacturer: p.manufacturer || '',
      state: p.state,
      connection: p.connection,
    }));
  }

  get deviceName() {
    const list = this.inputs;
    if (this.selectedId !== 'all') {
      return list.find((p) => p.id === this.selectedId)?.name || '';
    }
    if (!list.length) return '';
    return list.length === 1 ? list[0].name : `${list.length} MIDI inputs`;
  }

  get deviceId() {
    return this.selectedId;
  }

  _setStatus(status, detail = '') {
    this.status = status;
    this.onStatus?.({ kind: this.kind, status, detail, name: this.deviceName });
  }

  async connect({ deviceId = 'all' } = {}) {
    if (!this.available) throw new Error('Web MIDI is not supported in this browser.');
    this.selectedId = deviceId || 'all';
    this._setStatus('connecting');

    try {
      // sysex: false keeps the permission prompt to the gentler wording.
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      this._setStatus('error', err?.message || 'Permission denied');
      throw err;
    }

    this.access.onstatechange = (e) => {
      this._rebind();
      this.onPortsChanged?.(this.inputs, e.port);
      if (e.port?.type === 'input') {
        const connected = this.inputs.some((p) => p.state === 'connected');
        this._setStatus(connected ? 'connected' : 'waiting', e.port.name || '');
      }
    };

    this._rebind();
    const any = this.inputs.some((p) => p.state === 'connected');
    this._setStatus(any ? 'connected' : 'waiting');
    return { id: this.selectedId, name: this.deviceName };
  }

  selectInput(deviceId) {
    this.selectedId = deviceId || 'all';
    this._rebind();
    this._setStatus(this.status === 'idle' ? 'waiting' : this.status);
  }

  _rebind() {
    if (!this.access) return;
    for (const [port, handler] of this._bound) {
      port.removeEventListener('midimessage', handler);
    }
    this._bound.clear();

    for (const port of this.access.inputs.values()) {
      if (this.selectedId !== 'all' && port.id !== this.selectedId) continue;
      const handler = (e) => this.onMessage?.(Array.from(e.data), e.timeStamp);
      port.addEventListener('midimessage', handler);
      // Some implementations need an explicit open before messages flow.
      port.open?.().catch(() => {});
      this._bound.set(port, handler);
    }
  }

  disconnect() {
    for (const [port, handler] of this._bound) {
      port.removeEventListener('midimessage', handler);
      port.close?.().catch(() => {});
    }
    this._bound.clear();
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    this._setStatus('idle');
  }
}
