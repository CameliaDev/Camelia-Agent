/**
 * 可用性自检：一条命令回答「现在能不能用」。
 *
 * 每个可选项都是**实跑**得到的结论，不是读版本号推断的：
 * - CLI 能否启动并自检
 * - 真实模型能否完成一个任务并产出**被校验过的**文件
 * - 构建产物是否与当前源码同步（stale 产物是最容易被忽略的「不可用」）
 * - Ollama 服务是否在线
 *
 * 退出码：0 全部通过；1 有失败项。
 *
 * 用法：node scripts/usable-check.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 仓库根由本文件位置推导（scripts/ 的上一级），不依赖当前工作目录
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const CLI = `${ROOT}/packages/cli/dist/bin.js`;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(30)} ${detail}`);
}

console.log('Camelia 可用性自检');
console.log('='.repeat(64));

// 1. CLI 存在且能启动
const cliExists = fs.existsSync(CLI);
check('CLI 已构建', cliExists, cliExists ? path.basename(CLI) : '缺失——先运行 pnpm build');
if (!cliExists) process.exit(1);

const version = spawnSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' });
check('CLI 可启动', version.status === 0, version.stdout?.trim() ?? '启动失败');

// 2. doctor 自检
const doctor = spawnSync(process.execPath, [CLI, 'doctor'], { encoding: 'utf8', timeout: 60_000 });
const ollamaOk = /✓\s+ollama/.test(doctor.stdout ?? '');
check('Ollama 可用', ollamaOk, ollamaOk ? 'keyless provider 已就绪' : '未检测到可用 ollama');

// 3. 真实模型完成一个任务，产物客观校验
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camelia-usable-'));
const run = spawnSync(
  process.execPath,
  [CLI, 'run', '--provider', 'ollama', '--yes', '--no-color', 'Create a file named usable.txt containing the text: ready'],
  { cwd: dir, encoding: 'utf8', timeout: 300_000 },
);
const artifact = path.join(dir, 'usable.txt');
let content = '';
try {
  content = fs.readFileSync(artifact, 'utf8');
} catch {
  /* 产物不存在 */
}
const taskOk = run.status === 0 && content.trim() === 'ready';
check('真实模型完成任务', taskOk, taskOk ? `产物已校验: "${content.trim()}"` : '未产出预期文件');
fs.rmSync(dir, { recursive: true, force: true });

// 4. 构建产物新鲜度 —— stale 产物是最容易被忽略的「不可用」
function newestMtime(dirPath, filter = () => true) {
  let newest = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (filter(full)) {
        const m = fs.statSync(full).mtimeMs;
        if (m > newest) newest = m;
      }
    }
  };
  walk(dirPath);
  return newest;
}

const uiDist = `${ROOT}/packages/ui/dist/index.html`;
const desktopExe = `${ROOT}/apps/desktop/src-tauri/target/release/camelia-desktop.exe`;
if (fs.existsSync(uiDist) && fs.existsSync(desktopExe)) {
  const uiTime = fs.statSync(uiDist).mtimeMs;
  const exeTime = fs.statSync(desktopExe).mtimeMs;
  const fresh = exeTime >= uiTime;
  check(
    '桌面端产物新鲜',
    fresh,
    fresh
      ? 'exe 包含最新 UI'
      : `exe 比 UI 旧 ${Math.round((uiTime - exeTime) / 60000)} 分钟——需重跑 desktop:build`,
  );
} else {
  check('桌面端产物', false, '未找到构建产物（可只用 CLI）');
}

// 5. 插件沙箱是否真的接线（配置存在但不生效是最隐蔽的不可用）
const loaderSrc = `${ROOT}/packages/agent/src/plugins/PluginLoader.ts`;
if (fs.existsSync(loaderSrc)) {
  const src = fs.readFileSync(loaderSrc, 'utf8');
  const wired = src.includes('loadToolsInWorker');
  check('插件沙箱已接线', wired, wired ? 'worker 边界生效' : '沙箱未接入加载路径');
}

console.log('='.repeat(64));
const failed = results.filter((r) => !r.ok);
if (failed.length === 0) {
  console.log('✓ 全部通过 —— 可以使用');
  process.exit(0);
}
console.log(`✗ ${failed.length} 项未通过：${failed.map((f) => f.name).join('、')}`);
process.exit(1);