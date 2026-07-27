/* Capture the master mix to a file so a jam (or a toddler's masterpiece) can be
   kept and shared. Uses MediaRecorder on a MediaStreamDestination tap. */

import { uid } from '../util.js';

const CANDIDATE_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',            // iOS/Safari
  'audio/ogg;codecs=opus',
];

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of CANDIDATE_TYPES) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return '';   // let the browser choose
}

export class TakeRecorder {
  constructor(engine) {
    this.engine = engine;
    this.takes = [];
    this.recording = false;
    this._recorder = null;
    this._chunks = [];
    this._startedAt = 0;
    this.onChange = null;
  }

  get supported() {
    return typeof MediaRecorder !== 'undefined' && !!this.engine.recordDest;
  }

  get elapsed() {
    return this.recording ? (Date.now() - this._startedAt) / 1000 : 0;
  }

  start() {
    if (!this.supported || this.recording) return false;
    const mimeType = pickMimeType();
    try {
      this._recorder = new MediaRecorder(
        this.engine.recordDest.stream,
        mimeType ? { mimeType } : undefined,
      );
    } catch (err) {
      console.error('[recorder] could not start', err);
      return false;
    }

    this._chunks = [];
    this._recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) this._chunks.push(e.data);
    };
    this._recorder.onstop = () => this._finalise(mimeType);
    this._recorder.start(250);
    this.recording = true;
    this._startedAt = Date.now();
    this.onChange?.();
    return true;
  }

  stop() {
    if (!this.recording) return;
    this.recording = false;
    try {
      this._recorder.stop();
    } catch {
      /* already stopped */
    }
  }

  _finalise(mimeType) {
    const type = mimeType || this._chunks[0]?.type || 'audio/webm';
    const blob = new Blob(this._chunks, { type });
    this._chunks = [];
    if (blob.size < 512) {
      this.onChange?.();
      return;
    }
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    const now = new Date();
    const take = {
      id: uid(),
      name: `Snythia ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      blob,
      url: URL.createObjectURL(blob),
      duration: (Date.now() - this._startedAt) / 1000,
      createdAt: now.toISOString(),
      ext,
    };
    this.takes.unshift(take);
    this.onChange?.(take);
  }

  download(take) {
    const a = document.createElement('a');
    a.href = take.url;
    a.download = `${take.name.replace(/[^\w\s-]/g, '')}.${take.ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  get canShare() {
    return !!(navigator.canShare && navigator.share);
  }

  async share(take) {
    const file = new File([take.blob], `${take.name}.${take.ext}`, { type: take.blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: take.name });
      return true;
    }
    this.download(take);
    return false;
  }

  remove(take) {
    const i = this.takes.indexOf(take);
    if (i >= 0) {
      URL.revokeObjectURL(take.url);
      this.takes.splice(i, 1);
      this.onChange?.();
    }
  }
}
