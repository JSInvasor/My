/**
 * Example usage of cf-browser
 *
 * Run:  node example.js [url]
 */

import { CFBrowser } from './index.js';

const TARGET_URL = process.argv[2] || 'https://nowsecure.nl'; // great CF fingerprint test site

async function main() {
  console.log(`\n[Example] Opening: ${TARGET_URL}\n`);

  const browser = await CFBrowser.launch({
    profile:  'chrome-win',  // 'chrome-win' | 'chrome-mac' | 'chrome-linux'
    headless: false,          // set true for CI / server environments
    cfTimeout: 35_000,        // ms to wait for CF challenge to resolve
  });

  try {
    const page = await browser.open(TARGET_URL);

    console.log('\n[Example] Page title  :', await page.title());
    console.log('[Example] Final URL   :', page.url());

    const clearance = await page.getClearance();
    console.log('[Example] cf_clearance:', clearance ?? '(none — site may not use CF)');

    // Save screenshot for inspection
    await page.screenshot({ path: 'screenshot.png', fullPage: true });
    console.log('[Example] Screenshot saved → screenshot.png');

    // Dump first 500 chars of body text
    const text = await page.evaluate(() => document.body?.innerText?.slice(0, 500) ?? '');
    console.log('\n[Example] Page content preview:\n', text);

  } finally {
    await browser.close();
    console.log('\n[Example] Done.');
  }
}

main().catch((err) => {
  console.error('[Example] Fatal error:', err.message);
  process.exit(1);
});
