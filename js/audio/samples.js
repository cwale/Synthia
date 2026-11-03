/* Recorded instruments: fetching, decoding and choosing which recording plays.

   Only the grand piano uses recordings. Everything else in Synthia is
   modelled in code (see acoustic.js), because a piano is the one instrument a
   practical model cannot convince you of. So this file is small and specific:
   a bank is a set of notes, each recorded at a few dynamics, and a key is
   played from the nearest recording, re-pitched.

   Banks load on demand, the first time a patch that needs one is chosen, so
   nobody downloads a piano they never play. The service worker keeps the files
   once fetched, so a bank loaded once works offline from then on. */

const PIANO_NAMES = ['C', 'E', 'Gs'];
const PIANO_OFFSETS = [0, 4, 8];

function pianoNotes() {
  const out = [];
  for (let oct = 1; oct <= 7; oct++) {
    PIANO_NAMES.forEach((name, i) => {
      out.push({ midi: (oct + 1) * 12 + PIANO_OFFSETS[i], name: `${name}${oct}` });
    });
  }
  return out;
}

export const BANKS = {
  grand: {
    name: 'Grand piano',
    credit: 'Steinway B, from the Versilian Community Sample Library (CC0)',
    base: 'samples/piano/',
    notes: pianoNotes(),
    // The three dynamics the piano was recorded at. A piano struck hard is
    // brighter, not merely louder, so the layer matters more than the gain.
    layers: [
      { id: 'v2', upTo: 0.4 },
      { id: 'v3', upTo: 0.74 },
      { id: 'v4', upTo: 1.01 },
    ],
  },
};

/** id -> { status, promise, buffers: Map, loaded, total, error } */
const state = new Map();

function bankState(id) {
  if (!state.has(id)) {
    state.set(id, { status: 'idle', promise: null, buffers: new Map(), loaded: 0, total: 0, error: null });
  }
  return state.get(id);
}

export function bankStatus(id) {
  return bankState(id).status;
}

export function bankReady(id) {
  return bankState(id).status === 'ready';
}

export function bankProgress(id) {
  const s = bankState(id);
  return s.total ? s.loaded / s.total : 0;
}

/**
 * Where the sound actually starts in a decoded recording.
 *
 * Both the recording and the MP3 encoder leave silence in front of the note —
 * an encoder pads every file by a few dozen milliseconds. Left in, a key would
 * sound late, and later on some notes than others. Starting a millisecond
 * before the first audible sample keeps the attack intact.
 */
export function findOnset(buffer, threshold = 0.002) {
  const data = buffer.getChannelData(0);
  const limit = Math.min(data.length, Math.floor(buffer.sampleRate * 0.25));
  for (let i = 0; i < limit; i++) {
    if (Math.abs(data[i]) > threshold) {
      return Math.max(0, i - Math.floor(buffer.sampleRate * 0.001)) / buffer.sampleRate;
    }
  }
  return 0;
}

async function fetchOne(ctx, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  // The callback form is the one older Safari supports.
  const buffer = await new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(bytes, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
  return { buffer, offset: findOnset(buffer) };
}

/**
 * Fetch and decode a bank. Safe to call repeatedly: later calls get the same
 * promise. A failed load can be retried by calling again.
 */
export function loadBank(ctx, id, onProgress = null) {
  const bank = BANKS[id];
  if (!bank) return Promise.reject(new Error(`unknown sample bank "${id}"`));
  const s = bankState(id);
  if (s.status === 'ready') return Promise.resolve();
  if (s.status === 'loading') return s.promise;

  const jobs = [];
  for (const note of bank.notes) {
    for (const layer of bank.layers) {
      jobs.push({ key: `${note.midi}:${layer.id}`, url: `${bank.base}${note.name}-${layer.id}.mp3` });
    }
  }

  s.status = 'loading';
  s.total = jobs.length;
  s.loaded = 0;
  s.error = null;

  // A few at a time: a phone on mobile data copes badly with 63 at once.
  const queue = [...jobs];
  const worker = async () => {
    while (queue.length) {
      const job = queue.shift();
      if (s.buffers.has(job.key)) { s.loaded++; continue; }
      s.buffers.set(job.key, await fetchOne(ctx, job.url));
      s.loaded++;
      onProgress?.(s.loaded / s.total);
    }
  };

  s.promise = Promise.all(Array.from({ length: 6 }, worker))
    .then(() => { s.status = 'ready'; })
    .catch((err) => {
      s.status = 'error';
      s.error = err;
      throw err;
    });
  return s.promise;
}

/**
 * The recording to play for a note at a velocity: the nearest sampled pitch,
 * in the dynamic layer that velocity falls in.
 * @returns {{ buffer: AudioBuffer, offset: number, root: number } | null}
 */
export function pickSample(id, note, velocity) {
  const bank = BANKS[id];
  const s = bankState(id);
  if (!bank || s.status !== 'ready') return null;

  let root = bank.notes[0].midi;
  let best = Infinity;
  for (const n of bank.notes) {
    const d = Math.abs(n.midi - note);
    // On a tie, re-pitch downwards from the recording above: lowering a piano
    // sample darkens it slightly, which reads more naturally than brightening.
    if (d < best || (d === best && n.midi > root)) {
      best = d;
      root = n.midi;
    }
  }
  const layer = bank.layers.find((l) => velocity < l.upTo) || bank.layers[bank.layers.length - 1];
  const hit = s.buffers.get(`${root}:${layer.id}`);
  return hit ? { ...hit, root } : null;
}

/** Forget everything — for tests. */
export function resetBanks() {
  state.clear();
}
