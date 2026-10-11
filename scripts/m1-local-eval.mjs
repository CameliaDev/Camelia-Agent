/**
 * M1 真���模型复测：用本地qwen2.5-coder:7b 跑一组简单任务，统计成功率。
 *
 * 与脚本化 Provider 的关键区别：模型会真的犯错。这份脚本不判定「架构是否正确」，
 * 只回答白皮书第九章的问题——**在真实弱模型上，M1 的成功率是多少**。
 *
 * 判据是客观的：任务声称完成后，逐条校验 acceptance（文件存在、内容匹配、
 * 命令退出码），而不是相信模型的自我报告。幻觉声明在本脚本里会被记为失败。
 *
 * 用法：node scripts/m1-local-eval.mjs [用例数]
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLI = 'C:/Users/37963/Desktop/Camelia-Agent/packages/cli/dist/bin.js';
const MODEL = process.env.CAMELIA_EVAL_MODEL ?? 'qwen2.5-coder:7b';
const LIMIT = Number(process.argv[2] ?? 8);

/**
 * 用例集：全部是「单文件修改」这一M1 定义的任务形状。
 *
 * 每条都带一个客观校验器。`check` 返回失败原因数组，空数组即通过。
 */
const CASES = [
  {
    id: 'plain-text',
    prompt: 'Create a file named note.txt containing exactly the text: hello world',
    check: (dir) => readFile(dir, 'note.txt') === 'hello world',
  },
  {
    id: 'trailing-newline',
    prompt: 'Create a file named greet.txt whose entire content is the single line: goodbye',
    check: (dir) => readFile(dir, 'greet.txt').trim() === 'goodbye',
  },
  {
    id: 'multi-line',
    prompt: 'Create a file named lines.txt containing exactly three lines: alpha, beta, gamma (one per line)',
    check: (dir) => {
      const t = readFile(dir, 'lines.txt');
      return t.includes('alpha') && t.includes('beta') && t.includes('gamma');
    },
  },
  {
    id: 'json-file',
    prompt: 'Create a file named config.json containing the JSON object {"name": "camelia", "version": 1}',
    check: (dir) => {
      try {
        const j = JSON.parse(readFile(dir, 'config.json'));
        return j.name === 'camelia' && j.version === 1;
      } catch {
        return false;
      }
    },
  },
  {
    id: 'nested-path',
    prompt: 'Create a file at docs/readme.md containing the text: # Title',
    check: (dir) => readFile(dir, 'docs/readme.md').includes('# Title'),
  },
  {
    id: 'numbers',
    prompt: 'Create a file named nums.txt containing the numbers one per line: 1, 2, 3',
    check: (dir) => {
      const t = readFile(dir, 'nums.txt');
      return /\b1\b/.test(t) && /\b2\b/.test(t) && /\b3\b/.test(t);
    },
  },
  {
    id: 'markdown-list',
    prompt: 'Create a file named list.md containing a markdown list with exactly two items: - first and - second',
    check: (dir) => {
      const t = readFile(dir, 'list.md');
      return /first/.test(t) && /second/.test(t);
    },
  },
  {
    id: 'css-file',
    prompt: 'Create a file named style.css containing the CSS rule: body { margin: 0; }',
    check: (dir) => /margin\s*:\s*0/.test(readFile(dir, 'style.css')),
  },
  {
    id: 'url-file',
    prompt: 'Create a file named site.txt containing the URL: https://example.com',
    check: (dir) => readFile(dir, 'site.txt').includes('https://example.com'),
  },
  {
    id: 'quoted-string',
    prompt: 'Create a file named q.txt containing exactly: "quoted"',
    check: (dir) => /quoted/.test(readFile(dir, 'q.txt')),
  },
  {
    id: 'long-line',
    prompt:
      'Create a file named sentence.txt containing exactly this sentence: The quick brown fox jumps over the lazy dog.',
    check: (dir) => readFile(dir, 'sentence.txt').includes('quick brown fox'),
  },
  {
    id: 'chinese',
    prompt: 'Create a file named cn.txt containing the text: 你好世界',
    check: (dir) => readFile(dir, 'cn.txt').includes('你好世界'),
  },
  {
    id: 'code-ts',
    prompt: 'Create a file named greet.ts containing: export function greet() { return "hi"; }',
    check: (dir) => /export function greet/.test(readFile(dir, 'greet.ts')),
  },
  {
    id: 'code-py',
    prompt: 'Create a file named main.py containing: def add(a, b):\n    return a + b',
    check: (dir) => /def add/.test(readFile(dir, 'main.py')),
  },
  {
    id: 'boolean-json',
    prompt: 'Create a file named flags.json containing: {"debug": true, "verbose": false}',
    check: (dir) => {
      try {
        const j = JSON.parse(readFile(dir, 'flags.json'));
        return j.debug === true && j.verbose === false;
      } catch {
        return false;
      }
    },
  },
  {
    id: 'deep-nested',
    prompt: 'Create a file at src/lib/util.ts containing the text: export const x = 1;',
    check: (dir) => readFile(dir, 'src/lib/util.ts').includes('export const x'),
  },
  {
    id: 'email',
    prompt: 'Create a file named contact.txt containing the email: dev@example.com',
    check: (dir) => readFile(dir, 'contact.txt').includes('dev@example.com'),
  },
  {
    id: 'commas',
    prompt: 'Create a file named csv.csv with a single header row: name,age',
    check: (dir) => {
      const t = readFile(dir, 'csv.csv');
      return /name/i.test(t) && /age/i.test(t);
    },
  },
  {
    id: 'semver',
    prompt: 'Create a file named version.txt containing exactly the version string: 1.2.3',
    check: (dir) => readFile(dir, 'version.txt').includes('1.2.3'),
  },
  {
    id: 'negation',
    prompt: 'Create a file named rule.txt containing exactly: do not commit secrets',
    check: (dir) => /do not commit secrets/i.test(readFile(dir, 'rule.txt')),
  },
  {
    id: 'html',
    prompt: 'Create a file named page.html containing: <h1>Hello</h1>',
    check: (dir) => /<h1>Hello<\/h1>/.test(readFile(dir, 'page.html')),
  },
];

function readFile(dir, rel) {
  try {
    return fs.readFileSync(path.join(dir, rel), 'utf8');
  } catch {
    return '';
  }
}

/** Run one case in a fresh workspace, return { passed, status, seconds }. */
function runCase(testCase) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camelia-m1-'));
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
    }, 300_000);

    child.on('exit', (code) => {
      clearTimeout(timer);
      const seconds = (Date.now() - started) / 1000;
      // Objective check: the artifact must exist and match. Never trust the
      // model's own claim of success.
      const passed = code === 0 && testCase.check(dir);
      const status = code === 0 ? (passed ? 'done' : 'unverified') : 'failed';
      resolve({ passed, status, seconds, tail: out.slice(-400) });
    });
  });
}

const selected = CASES.slice(0, LIMIT);
console.log(`M1 真实模型复测 — ${MODEL}`);
console.log(`用例数: ${selected.length}  （每例独立工作区，客观校验产物）\n`);

const results = [];
for (const [i, testCase] of selected.entries()) {
  process.stdout.write(`[${i + 1}/${selected.length}] ${testCase.id.padEnd(16)} `);
  const r = await runCase(testCase);
  results.push({ id: testCase.id, ...r });
  const mark = r.passed ? '✓' : '✗';
  console.log(`${mark} ${r.status.padEnd(10)} ${r.seconds.toFixed(1)}s`);
  if (!r.passed) {
    const line = (r.tail ?? '').split('\n').filter((l) => l.trim()).slice(-2).join(' / ');
    console.log(`      ${line.slice(0, 160)}`);
  }
}

const passed = results.filter((r) => r.passed).length;
const rate = Math.round((passed / results.length) * 100);
const avg = results.reduce((a, r) => a + r.seconds, 0) / results.length;

console.log('\n=== M1 真实模型结果 ===');
console.log(`成功: ${passed}/${results.length}  成功率 ${rate}%  （目标 ≥ 95%）`);
console.log(`平均耗时: ${avg.toFixed(1)}s/任务（${MODEL} @ 29.5 tokens/s）`);
console.log(`总耗时: ${(avg * results.length / 60).toFixed(1)} 分钟`);

const report = { model: MODEL, total: results.length, passed, rate, avgSeconds: avg, results };
const outFile = 'C:/Users/37963/Desktop/Camelia-Agent/docs/M1-LOCAL-EVAL.json';
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(`\n报告写入 ${outFile}`);