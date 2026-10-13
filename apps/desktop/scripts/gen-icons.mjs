/**
 * Deterministic app-icon generator — mastered from a source PNG.
 *
 * Tauri needs a real `.ico` (embedded into the Windows executable by `tauri-build`)
 * plus a handful of PNG sizes. Rather than depend on an image toolchain or download
 * anything, this decodes the committed master artwork
 * (`apps/desktop/assets/mascot-source.png`), resamples it, and re-encodes PNG/ICO by
 * hand with `node:zlib`. Same input → same bytes, so the icon set is reproducible on
 * any machine that has Node, without a native image dependency.
 *
 * ## Resampling decisions
 *
 * - **Premultiplied alpha.** RGB is multiplied by alpha before averaging, so the
 *   transparent surround cannot bleed dark fringes into the artwork's edge.
 * - **Box average in sRGB space**, not linear light. The artwork is thin dark ink
 *   lines; averaging in linear light lightens them and the mark turns to grey mush at
 *   32px. sRGB-space area averaging keeps the lines.
 * - **Mild unsharp pass at ≤128px.** A 32× reduction from the 512px master loses
 *   perceived contrast; the sharpen pass runs on the premultiplied planes so it cannot
 *   pull colour out of transparent pixels.
 * - **PNG frames inside the ICO**, which is what `tauri icon` emits and what
 *   `tauri-build` expects; Windows Vista and later accept it for every size.
 *
 * ## Reverting to the previous mark
 *
 * The earlier procedural camellia-ring generator is preserved verbatim as
 * `scripts/gen-icons-camellia.mjs`. To put that mark back:
 *
 *     pnpm --filter @camelia/desktop icons:camellia
 *
 * Run: `node scripts/gen-icons.mjs`
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, '..', 'assets', 'mascot-source.png');
const OUT = path.join(HERE, '..', 'src-tauri', 'icons');

/** Every size drawn. `tauri.conf.json` only names four, but the full ramp is cheap. */
const SIZES = [16, 32, 48, 64, 128, 256, 512];

/** Sizes written to disk as standalone PNGs, keyed by size. */
const PNG_FILES = { 32: '32x32.png', 128: '128x128.png', 256: '128x128@2x.png', 512: '512x512.png' };

/** Frames embedded in `icon.ico`, smallest first. */
const ICO_FRAMES = [16, 32, 48, 64, 128, 256];

const clamp8 = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

// ---------------------------------------------------------------------------
// PNG decode — 8-bit RGB/RGBA, non-interlaced, all five filter types
// ---------------------------------------------------------------------------

/** Undo one PNG scanline filter in place. `bpp` is bytes per pixel (3 or 4). */
function unfilter(type, line, prev, bpp) {
  const n = line.length;
  switch (type) {
    case 0:
      return;
    case 1:
      for (let x = bpp; x < n; x++) line[x] = (line[x] + line[x - bpp]) & 0xff;
      return;
    case 2:
      for (let x = 0; x < n; x++) line[x] = (line[x] + prev[x]) & 0xff;
      return;
    case 3:
      for (let x = 0; x < n; x++) {
        const left = x >= bpp ? line[x - bpp] : 0;
        line[x] = (line[x] + ((left + prev[x]) >> 1)) & 0xff;
      }
      return;
    case 4:
      for (let x = 0; x < n; x++) {
        const a = x >= bpp ? line[x - bpp] : 0;
        const b = prev[x];
        const c = x >= bpp ? prev[x - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[x] = (line[x] + pred) & 0xff;
      }
      return;
    default:
      throw new Error(`unsupported PNG filter type ${type}`);
  }
}

/** Decode a PNG buffer into `{ width, height, pixels }` with RGBA8 pixels. */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error('source is not a PNG');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG is not supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`source must be 8-bit RGB or RGBA; got depth ${bitDepth}, colour type ${colorType}`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let pos = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = Buffer.from(raw.subarray(pos, pos + stride));
    pos += stride;
    unfilter(filter, line, prev, channels);
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      pixels[d] = line[s];
      pixels[d + 1] = line[s + 1];
      pixels[d + 2] = line[s + 2];
      pixels[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }

  return { width, height, pixels };
}

// ---------------------------------------------------------------------------
// resampling
// ---------------------------------------------------------------------------

/** Split RGBA8 pixels into premultiplied float planes. */
function toPremultipliedPlanes({ width, height, pixels }) {
  const n = width * height;
  const r = new Float64Array(n);
  const g = new Float64Array(n);
  const b = new Float64Array(n);
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const alpha = pixels[i * 4 + 3];
    const k = alpha / 255;
    r[i] = pixels[i * 4] * k;
    g[i] = pixels[i * 4 + 1] * k;
    b[i] = pixels[i * 4 + 2] * k;
    a[i] = alpha;
  }
  return { r, g, b, a, width, height };
}

/**
 * Area-average resample to `size × size`.
 *
 * Weights are the exact overlap between each source pixel and the destination
 * pixel's footprint, so non-integer ratios (512 → 48) stay correct and identical
 * input produces identical output.
 */
function resample(planes, size) {
  const { r, g, b, a, width: sw, height: sh } = planes;
  const scaleX = sw / size;
  const scaleY = sh / size;
  const n = size * size;
  const out = {
    r: new Float64Array(n),
    g: new Float64Array(n),
    b: new Float64Array(n),
    a: new Float64Array(n),
    width: size,
    height: size,
  };

  for (let y = 0; y < size; y++) {
    const y0 = y * scaleY;
    const y1 = y0 + scaleY;
    const sy0 = Math.floor(y0);
    const sy1 = Math.min(sh, Math.ceil(y1));
    for (let x = 0; x < size; x++) {
      const x0 = x * scaleX;
      const x1 = x0 + scaleX;
      const sx0 = Math.floor(x0);
      const sx1 = Math.min(sw, Math.ceil(x1));
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let wsum = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (wy <= 0) continue;
        for (let sx = sx0; sx < sx1; sx++) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (wx <= 0) continue;
          const w = wx * wy;
          const si = sy * sw + sx;
          sr += r[si] * w;
          sg += g[si] * w;
          sb += b[si] * w;
          sa += a[si] * w;
          wsum += w;
        }
      }
      const di = y * size + x;
      out.r[di] = sr / wsum;
      out.g[di] = sg / wsum;
      out.b[di] = sb / wsum;
      out.a[di] = sa / wsum;
    }
  }
  return out;
}

/** 3×3 unsharp mask on the premultiplied colour planes. Alpha is left alone. */
function unsharp(planes, amount) {
  const { r, g, b, width: w, height: h } = planes;
  const blur = (src) => {
    const dst = new Float64Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            sum += src[yy * w + xx];
          }
        }
        dst[y * w + x] = sum / 9;
      }
    }
    return dst;
  };
  for (const plane of [r, g, b]) {
    const soft = blur(plane);
    for (let i = 0; i < plane.length; i++) plane[i] += amount * (plane[i] - soft[i]);
  }
  return planes;
}

/** Un-premultiply back to straight RGBA8. */
function toRgba(planes) {
  const { r, g, b, a, width, height } = planes;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const alpha = a[i];
    if (alpha <= 0.5) continue; // fully transparent: leave RGB at zero
    const inv = 255 / alpha;
    out[i * 4] = clamp8(r[i] * inv);
    out[i * 4 + 1] = clamp8(g[i] * inv);
    out[i * 4 + 2] = clamp8(b[i] * inv);
    out[i * 4 + 3] = clamp8(alpha);
  }
  return out;
}

/** Full pipeline: decode → premultiply → resample → (sharpen) → RGBA8. */
function drawIcon(master, size) {
  const target = resample(master, size);
  if (size <= 32) unsharp(target, 0.5);
  else if (size <= 64) unsharp(target, 0.3);
  else if (size <= 128) unsharp(target, 0.15);
  return toRgba(target);
}

// ---------------------------------------------------------------------------
// PNG / ICO encode
// ---------------------------------------------------------------------------

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
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(frame.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += frame.png.length;
    dirs.push(entry);
  }
  return Buffer.concat([header, ...dirs, ...frames.map((f) => f.png)]);
}

// ---------------------------------------------------------------------------
// invalidate the cargo build-script fingerprint
// ---------------------------------------------------------------------------

/**
 * Force cargo to re-run the build script so the Windows resource — the `.ico` that
 * `tauri-build` embeds into the executable — is regenerated from the icons just
 * written.
 *
 * ## Why this is not optional
 *
 * `tauri-build` 2.x emits `cargo:rerun-if-changed` for `tauri.conf.json`, the
 * capabilities directory and the frontend `dist`, but **never for `bundle.icon`**
 * (its own doc comment claims icons are covered; the code does not do it). Replacing
 * `icons/icon.ico` therefore leaves cargo's build-script fingerprint untouched, the
 * build script never re-runs, and the previously compiled `resource.lib` — carrying
 * the *old* icon — is linked again. The failure mode is silent: exit code 0, a valid
 * installer, the wrong icon. Observed exactly once while swapping the camellia mark
 * for the mascot; `verify-icons.mjs` exists so it cannot happen silently again.
 *
 * Touching `build.rs` is the smallest input cargo actually tracks for that unit. The
 * stale compiled resources are deleted as well, so a skipped build script can never
 * leave a stale artefact behind to be linked.
 */
function invalidateWindowsResource() {
  const removed = [];
  for (const profile of ['debug', 'release']) {
    const buildDir = path.join(HERE, '..', 'src-tauri', 'target', profile, 'build');
    let entries;
    try {
      entries = fs.readdirSync(buildDir, { withFileTypes: true });
    } catch {
      continue; // profile never built — nothing to invalidate
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('camelia-desktop-')) continue;
      for (const file of ['resource.rc', 'resource.lib']) {
        const target = path.join(buildDir, entry.name, 'out', file);
        try {
          fs.unlinkSync(target);
          removed.push(path.relative(process.cwd(), target));
        } catch {
          // absent is the normal case on a first build
        }
      }
    }
  }

  const buildScript = path.join(HERE, '..', 'src-tauri', 'build.rs');
  const now = new Date();
  fs.utimesSync(buildScript, now, now);

  return removed;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

if (!fs.existsSync(SOURCE)) {
  throw new Error(`master artwork missing: ${SOURCE}`);
}

const master = toPremultipliedPlanes(decodePng(fs.readFileSync(SOURCE)));
if (master.width !== master.height) {
  throw new Error(`master artwork must be square; got ${master.width}×${master.height}`);
}

const pngs = new Map();
for (const size of SIZES) {
  pngs.set(size, encodePng(size, size, drawIcon(master, size)));
}

fs.mkdirSync(OUT, { recursive: true });
for (const [size, name] of Object.entries(PNG_FILES)) {
  fs.writeFileSync(path.join(OUT, name), pngs.get(Number(size)));
}
fs.writeFileSync(path.join(OUT, 'icon.png'), pngs.get(512));
fs.writeFileSync(
  path.join(OUT, 'icon.ico'),
  encodeIco(ICO_FRAMES.map((size) => ({ size, png: pngs.get(size) }))),
);

const staleResources = invalidateWindowsResource();

console.log(`source  ${path.relative(process.cwd(), SOURCE)}  (${master.width}×${master.height})`);
for (const [size, name] of Object.entries(PNG_FILES)) {
  console.log(`wrote   icons/${name}  ${size}×${size}  ${pngs.get(Number(size)).length}B`);
}
console.log(`wrote   icons/icon.png  512×512  ${pngs.get(512).length}B`);
console.log(`wrote   icons/icon.ico  frames=[${ICO_FRAMES.join(',')}]`);
for (const file of staleResources) {
  console.log(`stale   ${file}  (deleted; build script will regenerate it)`);
}
console.log('touched src-tauri/build.rs so cargo re-runs the build script and re-embeds the icon');
