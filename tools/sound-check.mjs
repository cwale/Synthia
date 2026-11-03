/* Measures every sound instead of trusting it.

   Renders each patch and each pad offline, in a real browser, and checks the
   things that can be wrong without anyone noticing on a phone speaker:

   - tuning: a pitched instrument must sound the note it was asked for. String
     models are the risk here — an integer-length delay line plays flat.
   - clipping and silence: no single voice may exceed full scale or vanish.
   - balance: switching patch shouldn't change the volume much.
   - velocity: a harder hit must be brighter, not merely louder, for the
     instruments where that is the point.

   Run with: node tools/sound-check.mjs   (CHROMIUM_PATH to use a local build)
   Prints a table and exits 1 if any check fails. */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const PORT = Number(process.env.SOUND_PORT || 8232);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      let path = decodeURIComponent(url.pathname);
      if (path.endsWith('/')) path += 'index.html';
      const target = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
      if (!target.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      const body = await readFile(target);
      res.writeHead(200, { 'Content-Type': MIME[extname(target)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(PORT, '127.0.0.1', () => ok(server)));
}

/* Instruments whose heard pitch isn't their lowest mode, so autocorrelation
   can't judge them: tubular bells are heard at half their fourth mode, and a
   bell's hum sits an octave under its strike note. */
const INHARMONIC = new Set(['tubular-bells', 'cathedral-bell', 'glass-bells']);
// Two strings a deliberate 13 cents apart: there is no single right pitch.
const DETUNED = new Set(['honky-tonk']);

// Synth patches deliberately sweep, wobble or detune; only acoustic engines,
// whose whole claim is to be in tune, are held to a tuning tolerance.
const TUNING_TOLERANCE_CENTS = 12;
/* A recording carries the tuning the piano was given. Concert pianos are
   stretch-tuned — bass flatter, treble sharper than equal temperament, after
   the Railsback curve — and the Steinway's C2 measures about 17 cents flat. That
   is authentic, so recordings get a tolerance that admits stretch tuning. */
const RECORDED_TOLERANCE_CENTS = 22;

async function main() {
  const server = await startServer();
  const { chromium } = await import('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`);

  const report = await page.evaluate(async ({ INHARMONIC, DETUNED, TOL, RTOL }) => {
    const { PRESETS } = await import('/js/audio/presets.js');
    const { KITS } = await import('/js/audio/kits.js');
    const { createVoice } = await import('/js/audio/acoustic.js');
    const { triggerPad } = await import('/js/audio/drums.js');
    const { loadBank } = await import('/js/audio/samples.js');
    const { defaultMacros } = await import('/js/audio/macros.js');

    const SR = 44100;
    const noteToFreq = (n) => 440 * Math.pow(2, (n - 69) / 12);

    async function render(seconds, play) {
      const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
      await play(ctx);
      const buf = await ctx.startRendering();
      const l = buf.getChannelData(0);
      const r = buf.getChannelData(1);
      const mono = new Float32Array(l.length);
      for (let i = 0; i < l.length; i++) mono[i] = (l[i] + r[i]) / 2;
      return { mono, l, r };
    }

    const peakOf = (a) => { let p = 0; for (const x of a) { if (!Number.isFinite(x)) return NaN; p = Math.max(p, Math.abs(x)); } return p; };
    const rmsDb = (a, from, to) => {
      let s = 0; const n = Math.max(1, to - from);
      for (let i = from; i < to; i++) s += a[i] * a[i];
      return 10 * Math.log10(s / n + 1e-12);
    };

    /** Complex FFT in place (radix 2). */
    function fft(re, im) {
      const N = re.length;
      for (let i = 1, j = 0; i < N; i++) {
        let bit = N >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
      }
      for (let size = 2; size <= N; size <<= 1) {
        const ang = (-2 * Math.PI) / size;
        for (let i = 0; i < N; i += size) {
          for (let k = 0; k < size / 2; k++) {
            const wr = Math.cos(ang * k); const wi = Math.sin(ang * k);
            const a = i + k; const b = a + size / 2;
            const xr = re[b] * wr - im[b] * wi; const xi = re[b] * wi + im[b] * wr;
            re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          }
        }
      }
    }

    function spectrum(a, start, N) {
      const re = new Float64Array(N); const im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = (a[start + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
      fft(re, im);
      const mag = new Float64Array(N / 2);
      for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
      return mag;
    }

    /**
     * The fundamental's frequency, read straight off the spectrum: the
     * strongest peak within a semitone and a half of the expected pitch,
     * refined by interpolating across neighbouring bins. Unlike
     * autocorrelation, inharmonic overtones can't drag this estimate.
     */
    function pitchOf(a, expectHz) {
      // A 16k window resolves about 70 cents per bin at 65 Hz; low notes need more.
      const N = expectHz < 130 ? 32768 : 16384;
      const mag = spectrum(a, Math.floor(SR * 0.05), N);
      const binHz = SR / N;
      const lo = Math.max(2, Math.floor((expectHz * 2 ** (-1.5 / 12)) / binHz));
      const hi = Math.min(mag.length - 2, Math.ceil((expectHz * 2 ** (1.5 / 12)) / binHz));
      let k = -1; let best = 0;
      for (let i = lo; i <= hi; i++) if (mag[i] > best) { best = mag[i]; k = i; }
      if (k < 0 || best <= 0) return null;
      const y0 = Math.log(mag[k - 1] + 1e-12); const y1 = Math.log(mag[k] + 1e-12); const y2 = Math.log(mag[k + 1] + 1e-12);
      const shift = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
      return (k + shift) * binHz;
    }

    /** Loudness as heard: the loudest 100 ms in the first 1.5 s. */
    function loudness(a) {
      const win = Math.floor(SR * 0.1);
      let best = -120;
      for (let at = 0; at + win <= Math.min(a.length, SR * 1.5); at += Math.floor(win / 2)) {
        best = Math.max(best, rmsDb(a, at, at + win));
      }
      return best;
    }

    /** Spectral centroid just after the attack — a number for "brightness". */
    function centroid(a) {
      const N = 4096;
      const mag = spectrum(a, Math.floor(SR * 0.01), N);
      let num = 0; let den = 0;
      for (let k = 1; k < N / 2; k++) { num += mag[k] * (k * SR) / N; den += mag[k]; }
      return den ? num / den : 0;
    }

    // Load the piano for real, so the sampled patches are measured, not their stand-in.
    const loader = new OfflineAudioContext(2, SR, SR);
    await loadBank(loader, 'grand');

    function playNote(patch, note, vel) {
      return (ctx) => {
        const v = createVoice(ctx, ctx.destination, patch, () => {});
        v.start(note, vel, 0, { macros: defaultMacros(), cutoffMacro: patch.macroCutoff ?? 0.75, resonanceMacro: patch.engine ? null : 0.18 });
        v.release(1.2);
      };
    }

    const patches = [];
    for (const patch of PRESETS) {
      const acoustic = !!patch.engine;
      const row = { id: patch.id, name: patch.name, category: patch.category, engine: patch.engine || 'synth', problems: [], cents: [] };
      const main = await render(2, playNote(patch, 60, 0.8));
      row.peak = peakOf(main.mono);
      row.rms = loudness(main.mono);
      if (!Number.isFinite(row.peak)) row.problems.push('NaN in output');
      else if (row.peak < 0.003) row.problems.push(`silent (peak ${row.peak.toFixed(4)})`);
      else if (row.peak > 1) row.problems.push(`clips (peak ${row.peak.toFixed(2)})`);

      if (acoustic && !INHARMONIC.includes(patch.id) && !DETUNED.includes(patch.id)) {
        /* An ensemble patch (several strings deliberately detuned against each
           other, each excited by random noise) has no single pitch: which string
           dominates changes from pluck to pluck. Its tolerance includes the
           spread it was given on purpose. */
        const spread = Math.max(0, ...(patch.string?.strings || []).map((s) => Math.abs(s.cents || 0)));
        const tol = (patch.engine === 'sampler' ? RTOL : TOL) + spread;
        for (const note of [36, 48, 60, 72, 84]) {
          const sounding = note + (patch.transpose || 0);
          const hz = noteToFreq(sounding);
          if (hz > 3000 || hz < 40) continue;
          const { mono } = await render(hz < 130 ? 0.9 : 0.5, playNote(patch, note, 0.7));
          const got = pitchOf(mono, hz);
          if (!got) { row.problems.push(`no pitch found at note ${note}`); continue; }
          const cents = 1200 * Math.log2(got / hz);
          row.cents.push(Math.round(cents));
          if (Math.abs(cents) > tol) row.problems.push(`note ${note} ${cents > 0 ? '+' : ''}${cents.toFixed(0)} cents out`);
        }
      }

      if (acoustic && !patch.string?.fixedVelocity) {
        const soft = await render(0.3, playNote(patch, 60, 0.25));
        const hard = await render(0.3, playNote(patch, 60, 1));
        row.brightSoft = Math.round(centroid(soft.mono));
        row.brightHard = Math.round(centroid(hard.mono));
        row.velDb = +(rmsDb(hard.mono, 0, 8000) - rmsDb(soft.mono, 0, 8000)).toFixed(1);
        if (row.brightHard <= row.brightSoft) row.problems.push(`not brighter when hit harder (${row.brightSoft} -> ${row.brightHard} Hz)`);
        if (row.velDb < 4) row.problems.push(`velocity barely changes level (${row.velDb} dB)`);
      }
      patches.push(row);
    }

    const pads = [];
    for (const kit of KITS) {
      for (const def of kit.pads) {
        const row = { kit: kit.id, name: def.name, type: def.type, problems: [] };
        // Full velocity: the hardest hit is the one that needs the headroom.
        const { mono } = await render(2.5, (ctx) => { triggerPad(ctx, ctx.destination, def, 1, 0); });
        row.peak = peakOf(mono);
        row.rms = loudness(mono);
        if (!Number.isFinite(row.peak)) row.problems.push('NaN in output');
        else if (row.peak < 0.003) row.problems.push('silent');
        else if (row.peak > 1) row.problems.push(`clips (peak ${row.peak.toFixed(2)})`);
        pads.push(row);
      }
    }
    return { patches, pads };
  }, { INHARMONIC: [...INHARMONIC], DETUNED: [...DETUNED], TOL: TUNING_TOLERANCE_CENTS, RTOL: RECORDED_TOLERANCE_CENTS });

  await browser.close();
  server.close();

  // Balance: compare each patch's loudness with the median of all of them.
  const levels = report.patches.map((p) => p.rms).sort((a, b) => a - b);
  const median = levels[Math.floor(levels.length / 2)];
  for (const p of report.patches) {
    const off = p.rms - median;
    if (Math.abs(off) > 9) p.problems.push(`${off > 0 ? 'louder' : 'quieter'} than the rest by ${Math.abs(off).toFixed(1)} dB`);
  }

  console.log(`\nPatches (median level ${median.toFixed(1)} dBFS)\n`);
  for (const p of report.patches) {
    const tuning = p.cents.length ? `tune ${p.cents.map((c) => (c > 0 ? `+${c}` : c)).join('/')}c` : '';
    const vel = p.brightSoft != null ? `bright ${p.brightSoft}->${p.brightHard}Hz +${p.velDb}dB` : '';
    const mark = p.problems.length ? 'FAIL' : 'ok  ';
    console.log(`  ${mark} ${p.name.padEnd(18)} ${p.engine.padEnd(7)} ${p.rms.toFixed(1).padStart(6)}dB peak ${p.peak.toFixed(2)}  ${tuning.padEnd(26)} ${vel}`);
    for (const why of p.problems) console.log(`         - ${why}`);
  }
  console.log('\nPads\n');
  for (const p of report.pads) {
    const mark = p.problems.length ? 'FAIL' : 'ok  ';
    console.log(`  ${mark} ${p.kit.padEnd(14)} ${p.name.padEnd(14)} ${p.rms.toFixed(1).padStart(6)}dB peak ${p.peak.toFixed(2)}`);
    for (const why of p.problems) console.log(`         - ${why}`);
  }

  const failed = [...report.patches, ...report.pads].filter((p) => p.problems.length).length + errors.length;
  for (const e of errors) console.log(`  page error: ${e}`);
  console.log(`\n${failed ? `${failed} problem(s)` : 'All sounds measured clean.'}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
