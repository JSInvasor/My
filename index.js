/**
 * cf-browser — Cloudflare UAM & Turnstile bypass via real browser emulation
 *
 * Public API:
 *
 *   import { CFBrowser } from 'cf-browser';
 *
 *   // Quick one-liner
 *   const browser = await CFBrowser.launch({ profile: 'chrome-win' });
 *   const page    = await browser.open('https://example.com');
 *   console.log(await page.content());
 *   await browser.close();
 *
 *   // More control
 *   const browser = new CFBrowser({ profile: 'chrome-mac', headless: false });
 *   const page    = await browser.newPage();
 *   await page.goto('https://example.com');
 *   const clearance = await page.getClearance();
 *   console.log('cf_clearance:', clearance);
 *   await browser.close();
 */

export { CFBrowser, CFPage } from './src/browser.js';
export { profiles, defaultProfile } from './src/fingerprints.js';
export { handleCloudflare, detectChallenge, hasClearance } from './src/cf-handler.js';
export { sleep, sleepRandom, moveMouse, simulateHumanActivity, humanClick } from './src/utils.js';
