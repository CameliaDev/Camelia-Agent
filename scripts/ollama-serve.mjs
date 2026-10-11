/**
 * 以 hf-mirror 镜像启动 `ollama serve`。
 *
 * 为什么绕开 shell：Windows PowerShell 5.1 的 `Start-Process` 缺少
 * `-Environment` 参数，且这台机器的环境里同时存在 `Path` 与 `PATH` 两个键，
 * 直接调用会抛「已添加项。字典中的关键字:Path」。cmd.exe 又被安全策略拦截。
 * Node 的 `spawn` 能显式传入完整 env，没有这两类问题。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const exe = path.join(home, 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe');

if (!fs.existsSync(exe)) {
  console.error(`✗ 未找到 ${exe}`);
  process.exit(1);
}

const env = {
  ...process.env,
  HF_ENDPOINT: 'https://hf-mirror.com',
  OLLAMA_HOST: '127.0.0.1:11434',
  OLLAMA_MODELS: path.join(home, '.ollama', 'models'),
  // 空闲 30 分钟自动卸载，避免模型长期占着6GB 显存。
  OLLAMA_KEEP_ALIVE: '30m',
  // 显式启用 GPU 层卸载；显存不足时由 Ollama 自动回退到部分 CPU。
  OLLAMA_NUM_GPU: '999',
};

console.log('启动 ollama serve：');
console.log(`  HF_ENDPOINT   = ${env.HF_ENDPOINT}`);
console.log(`  OLLAMA_HOST   = ${env.OLLAMA_HOST}`);
console.log(`  OLLAMA_MODELS = ${env.OLLAMA_MODELS}`);
console.log(`  KEEP_ALIVE    = ${env.OLLAMA_KEEP_ALIVE}`);

const child = spawn(exe, ['serve'], { env, detached: true, stdio: 'ignore', windowsHide: true });
child.unref();

console.log(`\n✓ 已启动 (PID ${child.pid})`);

// 轮询等待服务就绪
const deadline = Date.now() + 25_000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1200));
  try {
    const res = await fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const { version } = await res.json();
      console.log(`✓ 服务就绪 version=${version}`);
      process.exit(0);
    }
  } catch {
    /* 还没起来，继续等 */
  }
}
console.error('✗ 25 秒内服务未就绪');
process.exit(1);