/**
 * Deterministic app-icon generator.
 *
 * Tauri needs a real `.ico` (embedded into the Windows executable by `tauri-build`)
 * and a handful of PNG sizes. Rather than depend on an image toolchain or download
 * anything, this draws the camellia mark per-pixel and encodes PNG/ICO directly with
 * `node:zlib`. Same input → same bytes, so the icon is reproducible in CI.
 *
 * Run: `node scripts/gen-icons.mjs`
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'src-tauri', 'icons');

/** Palette — the same warm-dark / camellia tokens the UI uses (whitepaper §6.5). */
const BG_TOP = [26, 21, 20]; // #1A1514
const BG_BOTTOM = [34, 27, 25]; // #221B19
const RING = [217, 108, 95]; // #D96C5F
const CORE = [247, 239, 233]; // #F7EFE9

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Signed distance to a rounded rectangle centred on the origin. */
function sdRoundRect(px, py, halfW, halfH, radius) {
  const qx = Math.abs(px) - (halfW - radius);
  const qy = Math.abs(py) - (halfH - radius);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Draw the mark at a given size into an RGBA buffer. */
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const inset = size * 0.02;
  const half = size / 2 - inset;
  const radius = size * 0.22;
  const ringRadius = size * 0.3;
  const ringWidth = size * 0.06;
  const coreRadius = size * 0.085;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - c;
      const py = y + 0.5 - c;
      const i = (y * size + x) * 4;

      // Shape coverage (antialiased by ~1px).
      const covShape = clamp(0.5 - sdRoundRect(px, py, half, half, radius), 0, 1);
      if (covShape <= 0) continue;

      const t = (y + 0.5) / size;
      let r = BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t;
      let g = BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t;
      let b = BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t;

      const dist = Math.hypot(px, py);

      // Camellia ring.
      const covRing = clamp(0.5 - (Math.abs(dist - ringRadius) - ringWidth / 2), 0, 1);
      r = r * (1 - covRing) + RING[0] * covRing;
      g = g * (1 - covRing) + RING[1] * covRing;
      b = b * (1 - covRing) + RING[2] * covRing;

      // Warm-white core.
      const covCore = clamp(0.5 - (dist - coreRadius), 0, 1);
      r = r * (1 - covCore) + CORE[0] * covCore;
      g = g * (1 - covCore) + CORE[1] * covCore;
      b = b * (1 - covCore) + CORE[2] * covCore;

      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = Math.round(covShape * 255);
    }
  }
  return rgba;
}

function crc32(buf) {
  return zlib.crc32(buf) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

/** Encode an ICO that embeds PNG frames (Vista+ supports PNG-in-ICO). */
function encodeIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(frames.length, 4);

  let offset = 6 + frames.length * 16;
  const dirs = [];
  for (const frame of frames) {
    const entry = Buffer.alloc(16);
    entry[0] = frame.size >= 256 ? 0 : frame.size;
    entry[1] = frame.size >= 256 ? 0 : frame.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(frame.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += frame.png.length;
    dirs.push(entry);
  }
  return Buffer.concat([header, ...dirs, ...frames.map((f) => f.png)]);
}

fs.mkdirSync(OUT, { recursive: true });

const sizes = [16, 32, 48, 64, 128, 256, 512];
const pngs = new Map();
for (const size of sizes) {
  const png = encodePng(size, size, drawIcon(size));
  pngs.set(size, png);
  if ([32, 128, 256, 512].includes(size)) {
    const name = size === 256 ? '128x128@2x.png' : `${size}x${size}.png`;
    fs.writeFileSync(path.join(OUT, name), png);
  }
}
fs.writeFileSync(path.join(OUT, 'icon.png'), pngs.get(512));
fs.writeFileSync(
  path.join(OUT, 'icon.ico'),
  encodeIco([16, 32, 48, 64, 128, 256].map((size) => ({ size, png: pngs.get(size) }))),
);

console.log(`icons written to ${path.relative(process.cwd(), OUT)}`);