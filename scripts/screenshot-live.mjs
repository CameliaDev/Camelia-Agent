/**
 * Live-engine screenshot harness (Iteration 13).
 *
 * The other screenshot script projects deterministic *fixtures*. This one proves the
 * opposite half of the architecture: it boots a real `camelia serve` engine, points the
 * webview at it with `?engineUrl=...`, and captures what the UI shows while the SSE
 * transport carries a real task. The approval frame is the load-bearing one — it only
 * exists if `tool.approval_required` reaches the UI *before* the run suspends, and the
 * "done" frame only exists if the webview's `approve_tool` command resumes the engine.
 * Same script, so a green run is end-to-end evidence of the live path.
 *
 * Usage: node scripts/screenshot-live.mjs [uiBaseUrl]
 */

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CLI = join(ROOT, 'packages', 'cli', 'dist', 'bin.js');
const SPEC = join(HERE, 'fixtures', 'live-demo.spec.json');
const OUT_DIR = join(ROOT, 'tests', 'screenshots');

const UI_BASE = (process.argv[2] ?? 'http://localhost:4173').replace(/\/$/, '');
const INTENT = 'add a live demo note and confirm node is available';
const VIEWPORT = { width: 1600, height: 1000 };

/** Boot the engine and resolve with the JSON banner it prints once it is listening. */
function startEngine(workspace) {
  const child = spawn(
    process.execPath,
    [
      CLI,
      'serve',
      '--mock',
      '--spec',
      SPEC,
      '--auto-run',
      INTENT,
      '--port',
      '0',
      '--json',
      '--approval-timeout',
      '180',
      '--workspace',
      workspace,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`engine did not report an address; stderr:\n${stderr}`)), 20_000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      try {
        const banner = JSON.parse(stdout.trim());
        clearTimeout(timer);
        resolve({ child, banner });
      } catch {
        // Banner is pretty-printed across several chunks; keep accumulating.
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`engine exited early (code ${code}); stderr:\n${stderr}`));
    });
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const workspace = await mkdtemp(join(tmpdir(), 'camelia-live-ws-'));
  const { child, banner } = await startEngine(workspace);
  process.stdout.write(`  engine    ${banner.url}  (session ${banner.sessionId})\n`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });

  const consoleErrors = [];
  const shots = [];
  let exitCode = 0;

  try {
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    // Point the webview at the live engine; the transport picks SSE over the fixture.
    await page.goto(`${UI_BASE}/?engineUrl=${encodeURIComponent(banner.url)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#root > *', { state: 'attached' });

    // 1. The gate. Only renders if approval_required reached the UI before the suspend.
    await page.getByText('Approval required').first().waitFor({ state: 'visible', timeout: 40_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT_DIR, 'live-approval.png'), fullPage: true });
    shots.push('live-approval');

    // 2. Answer from the webview — this POSTs approve_tool and must resume the engine.
    await page.getByRole('button', { name: 'Allow for session' }).first().click();

    // 3. The engine runs to completion; the server flips the link to "Finished".
    await page.getByText('Finished', { exact: true }).first().waitFor({ state: 'visible', timeout: 40_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT_DIR, 'live-done.png'), fullPage: true });
    shots.push('live-done');
  } catch (error) {
    process.stderr.write(`\nlive capture failed: ${error?.message ?? error}\n`);
    exitCode = 1;
  } finally {
    await browser.close();
    child.kill();
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }

  if (consoleErrors.length) {
    process.stderr.write('\nConsole errors detected:\n');
    for (const error of consoleErrors) process.stderr.write(`  - ${error}\n`);
    exitCode = 1;
  }

  if (exitCode === 0) process.stdout.write(`\nCaptured ${shots.length} live shot(s): ${shots.join(', ')} — zero console errors.\n`);
  process.exitCode = exitCode;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});