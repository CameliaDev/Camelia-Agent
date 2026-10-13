/**
 * Verify that the built executable actually carries the current app icon.
 *
 * ## The failure this exists to catch
 *
 * `tauri-build` embeds `icons/icon.ico` into the executable through a Windows resource
 * compiled by the build script. It does **not** emit `cargo:rerun-if-changed` for the
 * icon, so replacing the icon does not re-run the build script, and the previously
 * compiled resource is linked instead. Every step reports success: `cargo tauri build`
 * exits 0, the NSIS installer is produced, the app runs — with the previous icon.
 *
 * There is no way to notice that from exit codes, so this checks two independent
 * signals:
 *
 * 1. **Freshness** — `resource.lib` must be newer than `icons/icon.ico`. If the icon
 *    was regenerated after the resource was compiled, the resource is stale by
 *    definition. `gen-icons.mjs` deletes and re-touches on purpose, so this is cheap.
 * 2. **Content** — an ICO may embed PNG frames, and a PNG frame is stored *verbatim*
 *    in the PE resource section. So each frame of `icons/icon.ico` must appear as a
 *    contiguous byte run inside the executable. A missing frame is proof the embedded
 *    resource is not the one on disk, regardless of timestamps.
 *
 * Run after `desktop:build` / `desktop:bundle`:
 *
 *     node scripts/verify-icons.mjs
 *     node scripts/verify-icons.mjs --exe path/to/camelia-desktop.exe
 *
 * Exits 0 when every frame is embedded, 1 otherwise.
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const ICO = path.join(ROOT, 'src-tauri', 'icons', 'icon.ico');

/** Read an ICO into `{ size: pngOrBmpBytes }`, keyed by the frame's pixel size. */
function readIcoFrames(file) {
  const data = fs.readFileSync(file);
  if (data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) {
    throw new Error(`${file} is not an ICO`);
  }
  const count = data.readUInt16LE(4);
  const frames = new Map();
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    const size = data[entry] || 256;
    const bytes = data.readUInt32LE(entry + 8);
    const offset = data.readUInt32LE(entry + 12);
    frames.set(size, data.subarray(offset, offset + bytes));
  }
  return frames;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Every `resource.lib` / `resource.rc` a build script may have produced. */
function resourceFiles() {
  const found = [];
  for (const profile of ['release', 'debug']) {
    const buildDir = path.join(ROOT, 'src-tauri', 'target', profile, 'build');
    let entries;
    try {
      entries = fs.readdirSync(buildDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('camelia-desktop-')) continue;
      for (const file of ['resource.lib', 'resource.rc']) {
        const candidate = path.join(buildDir, entry.name, 'out', file);
        if (fs.existsSync(candidate)) found.push(candidate);
      }
    }
  }
  return found;
}

function resolveExe() {
  const flag = process.argv.indexOf('--exe');
  if (flag !== -1) {
    const given = process.argv[flag + 1];
    if (!given) throw new Error('--exe needs a path');
    return path.resolve(given);
  }
  for (const profile of ['release', 'debug']) {
    const candidate = path.join(ROOT, 'src-tauri', 'target', profile, 'camelia-desktop.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('no built camelia-desktop.exe found; run desktop:build or desktop:bundle first');
}

const problems = [];
const frames = readIcoFrames(ICO);
const icoMtime = fs.statSync(ICO).mtimeMs;

console.log(`icon    ${path.relative(process.cwd(), ICO)}  frames=[${[...frames.keys()].sort((a, b) => a - b).join(',')}]`);
console.log(`        modified ${new Date(icoMtime).toISOString()}`);
console.log();

// --- signal 1: is the compiled resource newer than the icon? ------------------
console.log('resource freshness');
const resources = resourceFiles();
if (resources.length === 0) {
  console.log('  no resource.rc / resource.lib on disk (nothing compiled yet)');
} else {
  for (const file of resources) {
    const mtime = fs.statSync(file).mtimeMs;
    const stale = mtime < icoMtime;
    console.log(`  ${stale ? 'STALE' : 'fresh'}  ${path.relative(ROOT, file)}  (${new Date(mtime).toISOString()})`);
    if (stale) problems.push(`${path.relative(ROOT, file)} is older than the icon it should embed`);
  }
}

// --- signal 2: are the frames actually inside the executable? -----------------
const exe = resolveExe();
const bytes = fs.readFileSync(exe);
console.log();
console.log(`embedded frames in ${path.relative(process.cwd(), exe)}  (${bytes.length}B)`);

for (const size of [...frames.keys()].sort((a, b) => a - b)) {
  const frame = frames.get(size);
  if (!frame.subarray(0, 8).equals(PNG_MAGIC)) {
    // BMP-framed icons are not stored verbatim; timestamp freshness is the only
    // signal available for those, so skip rather than report a false negative.
    console.log(`  ${String(size).padStart(4)}px  skipped (not a PNG frame)`);
    continue;
  }
  const at = bytes.indexOf(frame);
  const ok = at >= 0;
  console.log(`  ${String(size).padStart(4)}px  ${ok ? `found at 0x${at.toString(16)}` : 'NOT FOUND'}`);
  if (!ok) problems.push(`the ${size}px frame of the current icon is not embedded in ${path.basename(exe)}`);
}

console.log();
if (problems.length > 0) {
  console.error('Icon verification FAILED:');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nThe executable carries a stale icon. Fix with:');
  console.error('  node scripts/gen-icons.mjs        # 作废构建指纹');
  console.error('  pnpm --filter @camelia/desktop desktop:bundle');
  process.exitCode = 1;
} else {
  console.log('OK — the executable embeds the icon currently on disk.');
}
