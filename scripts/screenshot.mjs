/**
 * Screenshot harness for the Camelia webview.
 *
 * The UI is a pure projection of a deterministic event script, so a screenshot taken
 * after `?scene=<id>&replay=instant` is byte-reproducible: same script in, same pixels
 * out. This script also fails loudly on any console error, which is DoD item 4 ("the app
 * starts with no console error") enforced by a machine instead of by eye.
 *
 * Usage: node scripts/screenshot.mjs [baseUrl]
 */

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'tests', 'screenshots');

const SCENES = ['empty', 'connecting', 'planning', 'diff', 'running', 'approval', 'failure', 'error', 'done'];

const VIEWPORT = { width: 1600, height: 1000 };

async function main() {
  const base = (process.argv[2] ?? 'http://localhost:4173').replace(/\/$/, '');
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });

  const problems = [];
  const shots = [];

  /**
   * The conversation column scrolls inside a fixed-height shell, so `fullPage` alone would
   * only ever show the first screen of a long run. Each shot scrolls to the part that
   * matters for that state — the active step, or the delivery card at the very bottom.
   */
  async function scrollTo(page, target) {
    await page.evaluate((where) => {
      const scroller = document.querySelector('main .overflow-y-auto');
      if (!scroller) return;
      if (where === 'bottom') {
        scroller.scrollTop = scroller.scrollHeight;
        return;
      }
      const label = Array.from(scroller.querySelectorAll('span')).find((n) => n.textContent?.trim() === where);
      if (!label) return;
      const top = label.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      scroller.scrollTop = top - 8;
    }, target);
  }

  async function capture(name, prepare, scrollTarget) {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await prepare(page);
    await page.evaluate(() => document.fonts?.ready);
    if (scrollTarget) await scrollTo(page, scrollTarget);
    await page.waitForTimeout(250);

    const file = join(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    shots.push(name);
    if (consoleErrors.length) problems.push({ name, consoleErrors });
    process.stdout.write(`  ${name.padEnd(11)} -> ${file}${consoleErrors.length ? `  [${consoleErrors.length} console error(s)]` : ''}\n`);
    await page.close();
  }

  const openScene = (scene) => async (page) => {
    await page.goto(`${base}/?scene=${scene}&replay=instant`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#root > *', { state: 'attached' });
  };

  // Which slice of the scrollable run each state should be framed on.
  const SCROLL = { diff: 'STEP 3', running: 'STEP 4', done: 'bottom' };

  // 1..N — one shot per reproducible scene.
  for (const scene of SCENES) await capture(scene, openScene(scene), SCROLL[scene]);

  // The steering affordance only exists after a click, so it gets its own shot.
  await capture('steering', async (page) => {
    await openScene('running')(page);
    await page.getByRole('button', { name: 'Steer', exact: true }).first().click();
    await page.getByText(/Steer the run/).first().waitFor({ state: 'visible' });
  });

  await browser.close();

  if (problems.length) {
    process.stderr.write('\nConsole errors detected:\n');
    for (const p of problems) {
      process.stderr.write(`  ${p.name}:\n`);
      for (const e of p.consoleErrors) process.stderr.write(`    - ${e}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`\nCaptured ${shots.length} shots with zero console errors.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});