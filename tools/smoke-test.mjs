/* Headless smoke test.

   Serves the repo, drives it with Playwright, and asserts the things that have
   actually broken during development: module errors on boot, the audio graph
   starting, MIDI routing, BLE packet decoding, Bash mode's lock, the polyphony
   cap, and layout overflow at phone sizes.

   Run with: node tools/smoke-test.mjs
   Needs playwright (a devDependency) and a Chromium build. */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const PORT = Number(process.env.SMOKE_PORT || 8231);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      let path = decodeURIComponent(url.pathname);
      if (path.endsWith('/')) path += 'index.html';
      // Keep the server inside the repo even if asked otherwise.
      const target = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
      if (!target.startsWith(ROOT)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const body = await readFile(target);
      res.writeHead(200, { 'Content-Type': MIME[extname(target)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(PORT, '127.0.0.1', () => ok(server)));
}

/* ---- harness ------------------------------------------------------------- */

const failures = [];
const consoleErrors = [];

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message.split('\n')[0]}`);
    console.log(`  FAIL  ${name}: ${err.message.split('\n')[0]}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const eq = (actual, expected, message) => assert(
  JSON.stringify(actual) === JSON.stringify(expected),
  `${message} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
);

/* ---- run ----------------------------------------------------------------- */

const server = await startServer();
const { chromium } = await import('playwright');

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`${e.message}`));

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });

await check('boots and starts audio', async () => {
  await page.click('#splash-start');
  await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(700);
  const state = await page.evaluate(() => ({
    ready: window.synthia.engine.ready,
    ctx: window.synthia.engine.ctx?.state,
    patch: window.synthia.patch?.id,
  }));
  assert(state.ready, 'audio engine did not start');
  assert(state.patch, 'no patch loaded');
});

await check('dismisses first-run sheet', async () => {
  const btn = page.locator('.sheet button', { hasText: 'Start playing' });
  if (await btn.count()) await btn.first().click();
  await page.waitForTimeout(400);
});

await check('renders keys and pads', async () => {
  const counts = await page.evaluate(() => ({
    whites: document.querySelectorAll('.key--w').length,
    blacks: document.querySelectorAll('.key--b').length,
    pads: document.querySelectorAll('.pad').length,
    knobs: document.querySelectorAll('.knob').length,
  }));
  assert(counts.whites >= 8, `too few white keys: ${counts.whites}`);
  assert(counts.blacks >= 5, `too few black keys: ${counts.blacks}`);
  eq(counts.pads, 16, 'pad count');
  eq(counts.knobs, 4, 'macro knob count');
});

await check('pads carry their own colours', async () => {
  // Regression guard: custom properties assigned via Object.assign silently
  // do nothing, which made every pad fall back to the accent colour.
  const unique = await page.evaluate(() => new Set(
    [...document.querySelectorAll('.pad')].map(
      (el) => el.style.getPropertyValue('--pad-color'),
    ),
  ).size);
  assert(unique >= 4, `expected several pad colours, found ${unique}`);
});

await check('playing keys allocates voices', async () => {
  const voices = await page.evaluate(async () => {
    for (const note of [60, 64, 67]) window.synthia.keyOn(note, 0.9, 'test');
    await new Promise((r) => setTimeout(r, 200));
    return window.synthia.synth.voiceCount;
  });
  eq(voices, 3, 'voice count after a triad');
  await page.click('#panic-btn');
  await page.waitForTimeout(200);
  eq(await page.evaluate(() => window.synthia.synth.voiceCount), 0, 'voices after panic');
});

await check('polyphony cap holds', async () => {
  const count = await page.evaluate(async () => {
    window.synthia.synth.polyphony = 8;
    for (let n = 40; n < 80; n++) window.synthia.keyOn(n, 0.9, 'test');
    await new Promise((r) => setTimeout(r, 200));
    return window.synthia.synth.voiceCount;
  });
  assert(count <= 8, `40 notes held exceeded the cap of 8: ${count}`);
  await page.click('#panic-btn');
});

await check('routes keys and pads by channel', async () => {
  const seen = await page.evaluate(async () => {
    const { midiHub } = await import('./js/midi/hub.js');
    const { bus } = await import('./js/state.js');
    const fake = { kind: 'webmidi', label: 'Test', status: 'connected', deviceName: 'Test', available: true, disconnect() {} };
    midiHub.active = fake;
    const out = { keys: [], pads: [] };
    bus.on('midi:key-on', ({ note }) => out.keys.push(note));
    bus.on('midi:pad-on', ({ padIndex }) => out.pads.push(padIndex));
    const send = (b) => midiHub._onMessage(b, performance.now(), fake);
    send([0x90, 60, 100]); send([0x90, 72, 100]);   // channel 1 -> keys
    send([0x99, 36, 120]); send([0x99, 40, 90]); send([0x99, 51, 90]);  // channel 10 -> pads
    await new Promise((r) => setTimeout(r, 250));
    send([0x80, 60, 0]); send([0x80, 72, 0]);
    return out;
  });
  eq(seen.keys, [60, 72], 'key routing');
  eq(seen.pads, [0, 4, 15], 'pad routing (notes 36/40/51 on ch10)');
  await page.click('#panic-btn');
});

await check('decodes BLE-MIDI packets', async () => {
  const res = await page.evaluate(async () => {
    const { decodeBleMidiPacket } = await import('./js/midi/blemidi.js');
    const state = { status: 0, inSysex: false };
    return {
      single: decodeBleMidiPacket(new Uint8Array([0x80, 0x80, 0x90, 60, 100]), state),
      running: decodeBleMidiPacket(new Uint8Array([0x80, 0x81, 62, 99]), state),
      multi: decodeBleMidiPacket(
        new Uint8Array([0x82, 0x90, 0x99, 36, 120, 0x95, 0x89, 36, 0]), state),
      noTimestamp: decodeBleMidiPacket(
        new Uint8Array([0x80, 0x80, 0xb0, 74, 64, 20, 30]), state),
    };
  });
  eq(res.single, [[144, 60, 100]], 'single note-on');
  eq(res.running, [[144, 62, 99]], 'running status across packets');
  eq(res.multi, [[153, 36, 120], [137, 36, 0]], 'two messages in one packet');
  eq(res.noTimestamp, [[176, 74, 64], [176, 20, 30]], 'running status without a timestamp');
});

await check('screen keyboard follows the hardware octave', async () => {
  const res = await page.evaluate(async () => {
    const kb = window.synthia.keyboard;
    const target = kb.lowNote - 24;
    window.synthia.keyOn(target, 0.9, 'midi');
    const lit = document.querySelector(`.key[data-note="${target}"]`)?.classList.contains('is-down');
    const covers = kb.covers(target);
    window.synthia.keyOff(target, 'midi');
    return { lit, covers };
  });
  assert(res.covers, 'window did not follow a note below the visible range');
  assert(res.lit, 'the followed note did not light up');
});

await check('bash mode quantises to its scale', async () => {
  await page.click('#bash-btn');
  await page.waitForSelector('#bash:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(400);
  const notes = await page.evaluate(() => {
    const out = [61, 63, 66, 68, 70].map((n) => window.synthia.bash.hardwareNoteOn(n, 0.8));
    [61, 63, 66, 68, 70].forEach((n) => window.synthia.bash.hardwareNoteOff(n));
    return out;
  });
  const pentatonic = [0, 2, 4, 7, 9];
  for (const note of notes) {
    assert(pentatonic.includes(((note % 12) + 12) % 12), `${note} is off-scale`);
  }
});

await check('bash mode needs a long hold to exit', async () => {
  const box = await page.locator('#bash-exit').boundingBox();
  const centre = [box.x + box.width / 2, box.y + box.height / 2];

  await page.mouse.move(...centre);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForTimeout(300);
  assert(
    await page.evaluate(() => window.synthia.mode === 'bash'),
    'a 0.9s hold escaped bash mode',
  );

  await page.mouse.move(...centre);
  await page.mouse.down();
  await page.waitForTimeout(3400);
  await page.mouse.up();
  await page.waitForTimeout(400);
  assert(
    await page.evaluate(() => window.synthia.mode === 'play'),
    'a 3.4s hold did not exit bash mode',
  );
});

for (const [name, size] of [
  ['phone portrait', { width: 390, height: 844 }],
  ['phone landscape', { width: 844, height: 390 }],
  ['tablet', { width: 1024, height: 768 }],
]) {
  await check(`layout fits: ${name}`, async () => {
    await page.setViewportSize(size);
    await page.waitForTimeout(700);
    const box = await page.evaluate(() => {
      const rect = (sel) => {
        const el = document.querySelector(sel);
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) };
      };
      return {
        pads: rect('.pads'),
        padwrap: rect('.padwrap'),
        keyrow: rect('.keyrow'),
        viewbar: rect('.viewbar'),
        topbarScroll: document.querySelector('.topbar').scrollWidth,
        innerW: window.innerWidth,
        innerH: window.innerHeight,
      };
    });
    assert(box.pads.w <= box.padwrap.w + 1 && box.pads.h <= box.padwrap.h + 1,
      `pad grid overflows its container: ${JSON.stringify(box)}`);
    assert(box.keyrow.bottom <= box.innerH + 1,
      `keyboard runs past the viewport bottom: ${box.keyrow.bottom} > ${box.innerH}`);
    assert(box.topbarScroll <= box.innerW + 1,
      `top bar overflows: ${box.topbarScroll} > ${box.innerW}`);
    assert(box.viewbar.bottom <= box.innerH + 1, 'view bar pushed off screen');
  });
}

await check('settings persist across a reload', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    window.synthia.setPatch('rubber-bass');
    window.synthia.setTempo(140);
  });
  await page.waitForTimeout(700);
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('#splash-start');
  await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    patch: document.querySelector('#patch-label').textContent,
    tempo: document.querySelector('#tempo-val').textContent,
  }));
  eq(after.patch, 'Rubber Bass', 'patch after reload');
  eq(after.tempo, '140', 'tempo after reload');
});

await browser.close();
server.close();

if (consoleErrors.length) {
  console.log(`\nConsole errors (${consoleErrors.length}):`);
  for (const err of [...new Set(consoleErrors)]) console.log(`  - ${err}`);
}

if (failures.length || consoleErrors.length) {
  console.log(`\n${failures.length} check(s) failed, ${consoleErrors.length} console error(s).`);
  process.exit(1);
}

console.log('\nAll checks passed with no console errors.');
