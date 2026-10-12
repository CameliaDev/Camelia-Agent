/**
 * Write ~/.camelia/desktop.json as UTF-8 **without BOM**.
 *
 * Windows PowerShell 5.x `Set-Content -Encoding utf8` prepends a BOM; serde_json
 * then rejects the file and the desktop shell reports "CLI bin.js not found"
 * even when the paths are correct. Prefer this script (or Python
 * `Path.write_bytes(...encode('utf-8'))`).
 *
 * Usage:
 *   node scripts/write-desktop-json.mjs
 *   node scripts/write-desktop-json.mjs --cli <bin.js> --node <node.exe>
 *
 * Env overrides: CAMELIA_CLI, CAMELIA_NODE (written into the file when flags omitted).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const defaultCli = path.join(ROOT, 'packages', 'cli', 'dist', 'bin.js');
const cli = argValue('--cli') || process.env.CAMELIA_CLI || defaultCli;
const node =
  argValue('--node') ||
  process.env.CAMELIA_NODE ||
  process.execPath;

if (!fs.existsSync(cli)) {
  console.error(`cli not found: ${cli}`);
  process.exit(1);
}
if (!fs.existsSync(node)) {
  console.error(`node not found: ${node}`);
  process.exit(1);
}

const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
const outDir = path.join(home, '.camelia');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'desktop.json');
const body = JSON.stringify({ cli, node }, null, 2) + '\n';
fs.writeFileSync(out, body, { encoding: 'utf8' }); // Node never writes a UTF-8 BOM

console.log(`wrote ${out}`);
console.log(`  cli:  ${cli}`);
console.log(`  node: ${node}`);
console.log('  encoding: UTF-8 no BOM');
