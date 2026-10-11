/**
 * 拉取模型并报告真实进度。
 *
 * 两个要点：
 * 1. 输出写入文件而非管道 —— `Select-Object -First N` 会提前关闭管道，
 *    Ollama 的 CLI 收到断管后退出，这正是「12 分钟零字节且无报错」的原因。
 * 2. 进度以 blobs 目录的实际字节数计量，不信任 CLI 自己的进度条。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MODEL = process.argv[2] ?? 'qwen2.5-coder:7b';
const EXPECTED_MB = Number(process.argv[3] ?? 4680);
const OBSERVE_MS = Number(process.argv[4] ?? 300_000);

const home = os.homedir();
const exe = path.join(home, 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe');
const blobs = path.join(home, '.ollama', 'models', 'blobs');

function blobBytes() {
  if (!fs.existsSync(blobs)) return 0;
  return fs
    .readdirSync(blobs)
    .map((f) => {
      try {
        return fs.statSync(path.join(blobs, f)).size;
      } catch {
        return 0;
      }
    })
    .reduce((a, b) => a + b, 0);
}

console.log(`拉取 ${MODEL}`);
console.log(`观察 ${Math.round(OBSERVE_MS / 1000)}s，期望约 ${EXPECTED_MB} MB\n`);

const child = spawn(exe, ['pull', MODEL], {
  env: {
    ...process.env,
    HF_ENDPOINT: 'https://hf-mirror.com',
    OLLAMA_HOST: '127.0.0.1:11434',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

const tail = [];
function record(chunk) {
  const text = chunk.toString();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    tail.push(t);
    if (tail.length > 8) tail.shift();
  }
}
child.stdout.on('data', record);
child.stderr.on('data', record);

let exited = null;
child.on('exit', (code) => {
  exited = code;
});

const started = Date.now();
let lastMb = -1;
let stagnant = 0;

while (Date.now() - started < OBSERVE_MS && exited === null) {
  await new Promise((r) => setTimeout(r, 5000));
  const mb = blobBytes() / 1024 / 1024;
  const pct = Math.min(100, (mb / EXPECTED_MB) * 100);
  const bar = '█'.repeat(Math.floor(pct / 2.5)).padEnd(40, '░');
  console.log(`[${String(Math.round((Date.now() - started) / 1000)).padStart(3)}s] ${bar} ${mb.toFixed(1)} MB (${pct.toFixed(1)}%)`);

  if (Math.abs(mb - lastMb) < 0.5) {
    stagnant += 5;
    if (stagnant >= 30) {
      console.log(`\n⚠ 已30 秒无字节增长。日志尾部：`);
      tail.forEach((l) => console.log(`    ${l}`));
    }
  } else {
    stagnant = 0;
  }
  lastMb = mb;
}

console.log('\n=== 结果 ===');
if (exited !== null) {
  console.log(`进程退出 code=${exited}`);
} else {
  console.log('观察期结束，进程仍在运行（可继续后台下载）');
}
console.log(`实际下载: ${(blobBytes() / 1024 / 1024).toFixed(1)} MB`);
console.log('日志尾部:');
tail.forEach((l) => console.log(`  ${l}`));