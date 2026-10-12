/**
 * Memory panel — recall timeline screenshot (Iteration 26, Stage 2 gate).
 *
 * Captures the panel's new recall-timeline section at 1280×820: one long hit
 * (layer tag, content snippet, via, noise — not downgraded) and one short hit
 * (downgraded badge), both answered by the fixture transport over the same
 * command channel a live engine speaks. Fails loudly on console errors.
 *
 * Usage: node scripts/screenshot-memory-timeline.mjs [baseUrl]
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'tests', 'screenshots');

const VIEWPORT = { width: 1280, height: 820 };

async function main() {
  const base = (process.argv[2] ?? 'http://localhost:4173').replace(/\/$/, '');
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(`${base}/?scene=running&replay=instant`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#root > *', { state: 'attached' });

  // The right rail scrolls independently; bring the recall timeline into frame.
  await page.waitForSelector('[data-testid="recall-timeline"]', { timeout: 15_000 });
  await page.evaluate(() => {
    const rail = document.querySelector('aside[data-rail="right"]');
    const label = rail?.querySelector('p');
    const targets = Array.from(rail?.querySelectorAll('p') ?? []);
    const heading = targets.find((n) => n.textContent?.trim().startsWith('recall timeline'));
    if (rail && heading) {
      const top = heading.getBoundingClientRect().top - rail.getBoundingClientRect().top + rail.scrollTop;
      rail.scrollTop = Math.max(0, top - 48);
    }
  });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(300);

  const file = join(OUT_DIR, 'memory-panel-recall-timeline.png');
  await page.screenshot({ path: file });
  await browser.close();

  if (consoleErrors.length) {
    process.stderr.write('Console errors detected:\n');
    for (const e of consoleErrors) process.stderr.write(`  - ${e}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`  memory-panel-recall-timeline -> ${file}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
