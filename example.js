/**
 * Example — run with:  node example.js [url]
 */

import { CFBrowser } from './index.js';

const URL = process.argv[2] || 'https://nowsecure.nl';

const browser = await CFBrowser.launch({
  profile:     'chrome-win',
  cfTimeout:   35_000,
  disableXvfb: false,   // keep false on headless Linux servers
});

try {
  const page = await browser.open(URL);

  console.log('Title      :', await page.title());
  console.log('URL        :', page.url());
  console.log('cf_clearance:', await page.getClearance() ?? '(none)');

  await page.screenshot({ path: 'screenshot.png', fullPage: true });
  console.log('Screenshot → screenshot.png');

} finally {
  await browser.close();
}
