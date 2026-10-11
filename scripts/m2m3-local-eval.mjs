/**
 * M2/M3 真实模型复测：多文件与跨模块任务。
 *
 * M1 已经 100%，所以这里的用例**刻意选择弱模型的真实弱项**：
 *
 * - **M2（多文件）**：多个文件之间有依赖顺序，后一个要用到前一个的产物。
 * - **M3（跨模块）**：一个符号要在多处创建、引用、保持一致。
 *
 * 这两类任务失败的原因不是「不会写」，而是**记不住自己刚才写了什么**。
 * 一个7B 模型在 8k 上下文里做完第 3 步，很可能已经忘了第 1 步的命名。
 * 脚本化 Provider 永远不会暴露这一点，因为它不需要记忆。
 *
 * 判据仍然是客观产物：文件存在、内容匹配、**跨文件引用一致**。
 *
 * 用法：node scripts/m2m3-local-eval.mjs [m2|m3|all]
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Absolute by necessity: `cwd` is the per-case temp workspace, so a relative
// path here resolves against that directory and the spawn fails with
// MODULE_NOT_FOUND. Getting this wrong made every case report `failed` while
// the CLI itself was never even reached.
const CLI = 'C:/Users/37963/Desktop/Camelia-Agent/packages/cli/dist/bin.js';
const WHICH = (process.argv[2] ?? 'all').toLowerCase();

if (!fs.existsSync(CLI)) {
  console.error(`✗ 找不到 CLI：${CLI}\n  先运行 pnpm build`);
  process.exit(1);
}

function read(dir, rel) {
  try {
    return fs.readFileSync(path.join(dir, rel), 'utf8');
  } catch {
    return '';
  }
}
function exists(dir, rel) {
  return fs.existsSync(path.join(dir, rel));
}

/**
 * M2 用例：多文件、有依赖顺序。
 *
 * 每条 check 都验证**全部**产物，且关键点在于跨文件一致性——
 * 例如 add.ts 必须导出 calc，而 app.ts 必须真的引用它。
 */
const M2_CASES = [
  {
    id: 'two-modules-import',
    prompt:
      'Create two files. src/add.ts must export a function add(a, b) that returns a + b. ' +
      'src/app.ts must import add from ./add and call it with add(2, 3).',
    check: (dir) => {
      const add = read(dir, 'src/add.ts');
      const app = read(dir, 'src/app.ts');
      return (
        /export\s+(function|const)\s+add/.test(add) &&
        /import\s+.*\badd\b.*from\s+['"]\.\/add['"]/.test(app) &&
        /add\s*\(\s*2\s*,\s*3\s*\)/.test(app)
      );
    },
  },
  {
    id: 'utils-consumed',
    prompt:
      'Create src/util.ts exporting a constant VERSION = "1.0.0". ' +
      'Then create src/index.ts that imports VERSION from ./util and prints it with console.log.',
    check: (dir) => {
      const util = read(dir, 'src/util.ts');
      const index = read(dir, 'src/index.ts');
      return (
        /VERSION\s*=\s*['"]1\.0\.0['"]/.test(util) &&
        /import\s+.*VERSION.*from\s+['"]\.\/util['"]/.test(index) &&
        /console\.log\s*\(\s*VERSION\s*\)/.test(index)
      );
    },
  },
  {
    id: 'three-files-chain',
    prompt:
      'Create three files: a.js containing "const A = 1; module.exports = A;", ' +
      'b.js containing "const B = 2; module.exports = B;", ' +
      'and c.js that requires both ./a and ./b and exports their sum.',
    check: (dir) => {
      const c = read(dir, 'c.js');
      return (
        /const\s+A\s*=\s*1/.test(read(dir, 'a.js')) &&
        /const\s+B\s*=\s*2/.test(read(dir, 'b.js')) &&
        /require\s*\(\s*['"]\.\/a['"]\s*\)/.test(c) &&
        /require\s*\(\s*['"]\.\/b['"]\s*\)/.test(c)
      );
    },
  },
  {
    id: 'types-and-impl',
    prompt:
      'Create src/types.ts with "export interface User { id: number; name: string }". ' +
      'Create src/user.ts that imports the User type from ./types and exports a function makeUser(id, name) returning a User.',
    check: (dir) => {
      const types = read(dir, 'src/types.ts');
      const user = read(dir, 'src/user.ts');
      return (
        /export\s+interface\s+User/.test(types) &&
        /id\s*:\s*number/.test(types) &&
        /name\s*:\s*string/.test(types) &&
        /import\s+.*User.*from\s+['"]\.\/types['"]/.test(user) &&
        /export\s+(function|const)\s+makeUser/.test(user)
      );
    },
  },
  {
    id: 'json-and-reader',
    prompt:
      'Create data.json containing {"name": "test", "count": 3}. ' +
      'Create read.js that requires ./data.json and logs data.name.',
    check: (dir) => {
      const reader = read(dir, 'read.js');
      let json = null;
      try {
        json = JSON.parse(read(dir, 'data.json'));
      } catch {
        return false;
      }
      return (
        json?.name === 'test' &&
        json?.count === 3 &&
        /require\s*\(\s*['"]\.\/data\.json['"]\s*\)/.test(reader) &&
        /\.name/.test(reader)
      );
    },
  },
];

/**
 * M3 用例：跨模块新功能，符号必须在多处保持一致。
 *
 * 这是 7B 最容易崩的地方——改了创建处忘了改引用处。
 */
const M3_CASES = [
  {
    id: 'rename-symbol-consistency',
    prompt:
      'Create src/calc.ts exporting a function called computeArea(w, h) returning w * h. ' +
      'Create src/main.ts that imports computeArea and calls it with computeArea(3, 4). ' +
      'Every reference must use the name computeArea.',
    check: (dir) => {
      const calc = read(dir, 'src/calc.ts');
      const main = read(dir, 'src/main.ts');
      return (
        /export\s+(function|const)\s+computeArea/.test(calc) &&
        /import\s+.*computeArea.*from\s+['"]\.\/calc['"]/.test(main) &&
        /computeArea\s*\(\s*3\s*,\s*4\s*\)/.test(main) &&
        // 旧名字必须已被替换干净：跨模块改名最容易漏
        !/\b(calcArea|area)\b/.test(calc) &&
        !/\b(calcArea|area)\b/.test(main)
      );
    },
  },
  {
    id: 'constant-single-source',
    prompt:
      'Create src/config.ts exporting const API_URL = "https://api.example.com". ' +
      'Create src/client.ts and src/worker.ts, both importing API_URL from ./config. Neither may hardcode the URL.',
    check: (dir) => {
      const config = read(dir, 'src/config.ts');
      const client = read(dir, 'src/client.ts');
      const worker = read(dir, 'src/worker.ts');
      const importsBoth =
        /import\s+.*API_URL.*from\s+['"]\.\/config['"]/.test(client) &&
        /import\s+.*API_URL.*from\s+['"]\.\/config['"]/.test(worker);
      // 单一真相源：两个消费者都不得内联 URL 字面量
      const noHardcode = !/https:\/\/api\.example\.com/.test(client) && !/https:\/\/api\.example\.com/.test(worker);
      return /export\s+const\s+API_URL/.test(config) && importsBoth && noHardcode;
    },
  },
  {
    id: 'error-path-propagation',
    prompt:
      'Create src/errors.ts exporting a class AppError extends Error. ' +
      'Create src/service.ts importing AppError from ./errors and exporting a function load(id) that throws new AppError when id is falsy.',
    check: (dir) => {
      const errors = read(dir, 'src/errors.ts');
      const service = read(dir, 'src/service.ts');
      return (
        /export\s+class\s+AppError\s+extends\s+Error/.test(errors) &&
        /import\s+.*AppError.*from\s+['"]\.\/errors['"]/.test(service) &&
        /throw\s+new\s+AppError/.test(service)
      );
    },
  },
  {
    id: 'three-consumers',
    prompt:
      'Create src/theme.ts exporting const COLORS = { primary: "#f00", secondary: "#00f" }. ' +
      'Create src/a.ts, src/b.ts and src/c.ts, each importing COLORS from ./theme and using COLORS.primary.',
    check: (dir) => {
      const theme = read(dir, 'src/theme.ts');
      if (!/export\s+const\s+COLORS/.test(theme)) return false;
      return ['a', 'b', 'c'].every((n) => {
        const file = read(dir, `src/${n}.ts`);
        return (
          /import\s+.*COLORS.*from\s+['"]\.\/theme['"]/.test(file) && /COLORS\.primary/.test(file)
        );
      });
    },
  },
  {
    id: 'reexport-consistency',
    prompt:
      'Create src/inner.ts exporting const value = 42 and a function double(x) returning x * 2. ' +
      'Create src/index.ts that re-exports both from ./inner.',
    check: (dir) => {
      const inner = read(dir, 'src/inner.ts');
      const index = read(dir, 'src/index.ts');
      return (
        /export\s+const\s+value\s*=\s*42/.test(inner) &&
        /export\s+(function|const)\s+double/.test(inner) &&
        /export\s*\{[^}]*\bvalue\b[^}]*\}\s*from\s*['"]\.\/inner['"]/.test(index) &&
        /export\s*\{[^}]*\bdouble\b[^}]*\}\s*from\s*['"]\.\/inner['"]/.test(index)
      );
    },
  },
];

function runCase(testCase) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camelia-m23-'));
  const started = Date.now();
  const child = spawn(
    process.execPath,
    [CLI, 'run', '--provider', 'ollama', '--yes', '--no-color', '--quiet', testCase.prompt],
    { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let out = '';
  child.stdout.on('data', (d) => (out += d.toString()));
  child.stderr.on('data', (d) => (out += d.toString()));

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve({ passed: false, status: 'timeout', seconds: (Date.now() - started) / 1000 });
    }, 600_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const seconds = (Date.now() - started) / 1000;
      const passed = code === 0 && testCase.check(dir);
      // Distinguish "the model failed" from "the harness failed". A spawn error
      // is indistinguishable from a task failure unless the output is inspected,
      // and misreading it costs a whole debugging cycle.
      const infraFailure = /MODULE_NOT_FOUND|Cannot find module|ENOENT/.test(out);
      resolve({
        passed,
        status: infraFailure ? 'harness-error' : code === 0 ? (passed ? 'done' : 'unverified') : 'failed',
        seconds,
        files: fs.readdirSync(dir, { recursive: true }).filter((f) => typeof f === 'string').length,
        tail: out.slice(-300),
      });
    });
  });
}

async function suite(label, cases, target) {
  console.log(`\n${'='.repeat(64)}`);
  console.log(`${label}  — ${cases.length} 例（目标 ≥ ${target}%）`);
  console.log('='.repeat(64));
  const results = [];
  for (const [i, c] of cases.entries()) {
    process.stdout.write(`[${i + 1}/${cases.length}] ${c.id.padEnd(26)} `);
    const r = await runCase(c);
    results.push({ id: c.id, ...r });
    console.log(`${r.passed ? '✓' : '✗'} ${r.status.padEnd(10)} ${r.seconds.toFixed(1)}s`);
  }
  const passed = results.filter((r) => r.passed).length;
  const rate = Math.round((passed / results.length) * 100);
  const avg = results.reduce((a, r) => a + r.seconds, 0) / results.length;
  console.log(`\n${label}: ${passed}/${results.length} = ${rate}%  (目标 ≥${target}%)  平均 ${avg.toFixed(1)}s`);
  return { label, target, total: results.length, passed, rate, avgSeconds: avg, results };
}

const out = { model: 'qwen2.5-coder:7b', suites: [] };
if (WHICH === 'all' || WHICH === 'm2') out.suites.push(await suite('M2 中等任务（多文件/ 有依赖顺序）', M2_CASES, 80));
if (WHICH === 'all' || WHICH === 'm3') out.suites.push(await suite('M3 复杂任务（跨模块符号一致）', M3_CASES, 60));

console.log('\n=== 汇总 ===');
for (const s of out.suites) {
  const verdict = s.rate >= s.target ? '✅ 达标' : '⚠️ 未达标';
  console.log(`${s.label}: ${s.rate}%  ${verdict}`);
}
const file = 'C:/Users/37963/Desktop/Camelia-Agent/docs/M2M3-LOCAL-EVAL.json';
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`\n报告写入 ${file}`);