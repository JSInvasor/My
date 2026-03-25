/**
 * cf-browser examples
 *
 * Single browser:  node example.js single https://example.com
 * Pool (parallel): node example.js pool   https://example.com
 */

import { CFBrowser, CFPool } from './index.js';

const [,, mode = 'single', TARGET = 'https://nowsecure.nl'] = process.argv;

// ── Single browser ────────────────────────────────────────────────────────

async function runSingle() {
  console.log(`\n[Single] → ${TARGET}\n`);

  const browser = await CFBrowser.launch({
    profile:    'chrome-win',
    cfTimeout:  35_000,
    disableXvfb: false,
  });

  try {
    const page = await browser.open(TARGET);
    console.log('Title      :', await page.title());
    console.log('URL        :', page.url());
    console.log('cf_clearance:', await page.getClearance() ?? '(none)');
    await page.screenshot({ path: 'screenshot.png', fullPage: true });
    console.log('Screenshot → screenshot.png');
  } finally {
    await browser.close();
  }
}

// ── Pool (concurrent) ─────────────────────────────────────────────────────

async function runPool() {
  // Simulate multiple URLs to scrape
  const urls = Array.from({ length: 10 }, (_, i) => `${TARGET}?t=${i}`);

  console.log(`\n[Pool] ${urls.length} URLs, threads=5, rps=3\n`);

  const pool = await CFPool.launch({
    threads:    5,      // 5 concurrent browser tabs
    rps:        3,      // max 3 requests per second total
    mode:       'page', // 'page' = tabs in one browser | 'browser' = separate browsers
    profile:    'chrome-win',
    cfTimeout:  35_000,
    disableXvfb: false,
  });

  try {
    const results = await pool.openAll(urls, async (page) => {
      return {
        title: await page.title(),
        url:   page.url(),
        clearance: await page.getClearance(),
      };
    });

    for (const { url, result, error } of results) {
      if (error) {
        console.log(`✗ ${url} → ${error}`);
      } else {
        console.log(`✓ ${result.url} | clearance: ${result.clearance ?? 'none'}`);
      }
    }

    console.log(`\nDone. ${results.filter(r => !r.error).length}/${results.length} succeeded.`);
  } finally {
    await pool.close();
  }
}

// ── Run ───────────────────────────────────────────────────────────────────

if (mode === 'pool') {
  await runPool();
} else {
  await runSingle();
}
