import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const CLI = 'C:/Users/37963/Desktop/Camelia-Agent/packages/cli/dist/bin.js';
const dir = process.argv[2];
console.log('cwd:', dir);
const r = spawnSync(
  process.execPath,
  [CLI, 'run', '--provider', 'ollama', '--yes', '--no-color',
   'Create a file named usable.txt containing the text: ready'],
  { cwd: dir, encoding: 'utf8', timeout: 300_000 }
);
console.log('status:', r.status);
console.log('error:', r.error?.message);
console.log('--- stdout ---');
console.log(r.stdout);
console.log('--- stderr ---');
console.log(r.stderr);
