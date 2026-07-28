/* Generates the PWA icons as PNGs with no image-library dependency.

   Everything is drawn by evaluating a colour function per pixel, then encoded
   as a PNG by hand (IHDR + IDAT + IEND, zlib-deflated scanlines with filter 0).
   Run with: node tools/make-icons.mjs */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

/* ---- PNG encoding -------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // truecolour with alpha
  ihdr[10] = 0;   // deflate
  ihdr[11] = 0;   // adaptive filtering
  ihdr[12] = 0;   // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;   // filter type 0 for every scanline
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---- drawing ------------------------------------------------------------- */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp01(t));
const smooth = (edge, width, x) => clamp01((edge - x) / width + 0.5);

/** Signed distance to a rounded rectangle, negative inside. */
function roundedRectSdf(px, py, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(px - cx) - (halfW - radius);
  const dy = Math.abs(py - cy) - (halfH - radius);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(dx, dy), 0) - radius;
}

/**
 * @param {number} size
 * @param {object} opts
 * @param {number} opts.inset  fraction of the canvas kept clear at the edges;
 *   maskable icons need a generous safe zone because launchers crop to a circle.
 * @param {boolean} opts.bleed fill the whole canvas rather than a rounded tile
 */
function drawIcon(size, { inset = 0.06, bleed = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const S = size;
  const tileR = S * 0.22;
  const tileHalf = S * (0.5 - inset);

  /* A solid ivory keybed with black keys cut into it. At icon sizes this reads
     as a keyboard immediately, where separate floating keys read as an EQ. */
  const artHalf = tileHalf * (bleed ? 0.62 : 0.68);
  const bedHalfW = artHalf;
  const bedHalfH = artHalf * 0.56;
  const bedCy = S * 0.47;
  const bedTop = bedCy - bedHalfH;
  const bedBottom = bedCy + bedHalfH;
  const whiteW = (bedHalfW * 2) / 5;
  const bedLeft = S * 0.5 - bedHalfW;

  const separators = [1, 2, 3, 4].map((i) => bedLeft + i * whiteW);
  const blackKeys = [1, 2, 4].map((i) => bedLeft + i * whiteW);
  const blackHalfW = whiteW * 0.29;
  const blackBottom = bedTop + bedHalfH * 2 * 0.62;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const u = x / S;
      const v = y / S;

      /* --- background --- */
      let colour = mix([18, 21, 30], [8, 9, 13], v * 1.15);

      // Warm glow behind the keys.
      const gd = Math.hypot(u - 0.5, v - 0.26) * 2.2;
      colour = mix(colour, [92, 56, 20], Math.pow(clamp01(1 - gd), 2.4) * 0.85);

      // Cool counter-light from the bottom right.
      const cd = Math.hypot(u - 0.9, v - 1.0) * 1.6;
      colour = mix(colour, [22, 62, 66], Math.pow(clamp01(1 - cd), 2.6) * 0.55);

      let alpha = 255;
      if (!bleed) {
        const d = roundedRectSdf(x, y, S / 2, S / 2, tileHalf, tileHalf, tileR);
        alpha = Math.round(smooth(0, 1.6, d) * 255);
        // Top rim highlight, so the tile reads as a physical object.
        const rim = clamp01(1 - Math.abs(d + 1.6) / 1.8) * clamp01(1 - v * 2.4);
        colour = mix(colour, [255, 255, 255], rim * 0.32);
      }

      /* --- the ivory keybed --- */
      const bedD = roundedRectSdf(x, y, S / 2, bedCy, bedHalfW, bedHalfH, whiteW * 0.16);
      const bedCover = smooth(0, 1.4, bedD);
      if (bedCover > 0.002) {
        const t = clamp01((y - bedTop) / (bedBottom - bedTop));
        const ivory = mix([255, 253, 249], [188, 193, 208], Math.pow(t, 1.25));
        colour = mix(colour, ivory, bedCover);
        if (!bleed) alpha = Math.max(alpha, Math.round(bedCover * 255));

        // Grooves between the white keys.
        for (const sx of separators) {
          const line = clamp01(1 - Math.abs(x - sx) / (S * 0.006));
          if (line > 0) colour = mix(colour, [150, 155, 170], line * bedCover * 0.9);
        }
      }

      /* --- black keys sit on top of the bed --- */
      for (const bx of blackKeys) {
        const halfH = (blackBottom - bedTop) / 2;
        const d = roundedRectSdf(x, y, bx, bedTop + halfH, blackHalfW, halfH, blackHalfW * 0.3);
        const cover = smooth(0, 1.3, d);
        if (cover <= 0.002) continue;
        const t = clamp01((y - bedTop) / (blackBottom - bedTop));
        // Kept well above pure black so it still separates from the background.
        const keyColour = mix([64, 70, 88], [20, 23, 32], Math.pow(t, 0.9));
        colour = mix(colour, keyColour, cover);
        if (!bleed) alpha = Math.max(alpha, Math.round(cover * 255));
      }

      /* --- amber accent bar under the keys --- */
      const barHalfH = S * 0.017;
      const barCy = bedBottom + S * 0.062;
      const barD = roundedRectSdf(x, y, S / 2, barCy, artHalf * 0.98, barHalfH, barHalfH);
      const barCover = smooth(0, 1.4, barD);
      if (barCover > 0.002) {
        colour = mix(colour, [255, 180, 84], barCover);
      }

      buf[i] = Math.round(clamp01(colour[0] / 255) * 255);
      buf[i + 1] = Math.round(clamp01(colour[1] / 255) * 255);
      buf[i + 2] = Math.round(clamp01(colour[2] / 255) * 255);
      buf[i + 3] = alpha;
    }
  }

  return encodePng(S, S, buf);
}

/* ---- output -------------------------------------------------------------- */

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ['icon-192.png', 192, { inset: 0.05 }],
  ['icon-512.png', 512, { inset: 0.05 }],
  // Maskable icons get cropped hard, so the art sits well inside the frame.
  ['icon-maskable-512.png', 512, { inset: 0.02, bleed: true }],
  // iOS applies its own rounding and does not support transparency well.
  ['apple-touch-icon.png', 180, { inset: 0.0, bleed: true }],
  ['favicon-32.png', 32, { inset: 0.0, bleed: true }],
];

for (const [name, size, opts] of targets) {
  writeFileSync(join(OUT_DIR, name), drawIcon(size, opts));
  console.log(`wrote icons/${name} (${size}x${size})`);
}
