/**
 * cf-browser — Cloudflare UAM & Turnstile bypass
 *
 * Built on puppeteer-real-browser (rebrowser-patches + xvfb + real Chrome).
 *
 * Quick start:
 *   import { CFBrowser } from 'cf-browser';
 *
 *   const browser = await CFBrowser.launch({ profile: 'chrome-win' });
 *   const page    = await browser.open('https://example.com');
 *   console.log(await page.content());
 *   await browser.close();
 */

export { CFBrowser, CFPage }          from './src/browser.js';
export { CFPool }                     from './src/pool.js';
export { profiles, defaultProfile }   from './src/fingerprints.js';
export { handleCloudflare, detectChallenge, hasClearance } from './src/cf-handler.js';
export { sleep, sleepRandom, moveMouse, simulateHumanActivity, humanClick } from './src/utils.js';
