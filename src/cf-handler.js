/**
 * Cloudflare challenge detection and bypass logic.
 *
 * Handles two CF challenge types:
 *   1. UAM  – "Under Attack Mode" (the 5-second JS spinner)
 *   2. Turnstile – interactive or invisible captcha widget
 *
 * Strategy:
 *   - Detect CF challenge via page title / DOM / cookie absence
 *   - Simulate human activity while CF's JS runs
 *   - Poll for `cf_clearance` cookie (set when the challenge passes)
 *   - For interactive Turnstile, attempt to click the checkbox naturally
 *   - Raise a clear error if the challenge isn't solved within the timeout
 */

import { sleep, sleepRandom, simulateHumanActivity, humanClick } from './utils.js';

// ── Detection helpers ──────────────────────────────────────────────────────

const CF_TITLE_PATTERN = /just a moment/i;

/** Selector list that indicates an active CF challenge. */
const CF_CHALLENGE_SELECTORS = [
  '#cf-spinner',
  '#challenge-running',
  '#challenge-form',
  '.cf-browser-verification',
  '#cf-please-wait',
  '#trk_jschal_js',
];

/** Turnstile widget selectors (both interactive and invisible). */
const TURNSTILE_SELECTORS = [
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="turnstile"]',
  '#cf-turnstile',
  '.cf-turnstile',
];

/** Selector for the Turnstile checkbox inside its iframe. */
const TURNSTILE_CHECKBOX_SELECTOR = 'input[type="checkbox"]';

// ── Core functions ─────────────────────────────────────────────────────────

/**
 * Check if the current page is showing a Cloudflare challenge.
 * @param {import('playwright').Page} page
 * @returns {Promise<'uam'|'turnstile'|'none'>}
 */
export async function detectChallenge(page) {
  try {
    const title = await page.title();
    if (CF_TITLE_PATTERN.test(title)) {
      // Distinguish UAM vs Turnstile
      for (const sel of TURNSTILE_SELECTORS) {
        const el = await page.$(sel);
        if (el) return 'turnstile';
      }
      return 'uam';
    }

    // Title might not have loaded yet — check DOM directly
    for (const sel of CF_CHALLENGE_SELECTORS) {
      const el = await page.$(sel);
      if (el) return 'uam';
    }
    for (const sel of TURNSTILE_SELECTORS) {
      const el = await page.$(sel);
      if (el) return 'turnstile';
    }
  } catch (_) {
    // Page navigated mid-check — not a challenge
  }
  return 'none';
}

/**
 * Check whether the `cf_clearance` cookie is present (challenge solved).
 * @param {import('playwright').BrowserContext} context
 * @returns {Promise<boolean>}
 */
export async function hasClearance(context) {
  const cookies = await context.cookies();
  return cookies.some((c) => c.name === 'cf_clearance');
}

// ── UAM bypass ────────────────────────────────────────────────────────────

/**
 * Wait for Cloudflare's Under Attack Mode to complete.
 * CF's UAM JS challenge normally takes 4-6 seconds, then redirects.
 *
 * @param {import('playwright').Page} page
 * @param {import('playwright').BrowserContext} context
 * @param {object} opts
 * @param {number} opts.timeout   Max ms to wait (default 30 000)
 */
export async function bypassUAM(page, context, { timeout = 30_000 } = {}) {
  console.log('[CF] UAM detected — simulating human activity…');

  const deadline = Date.now() + timeout;

  // Run human-like mouse movement in parallel with polling
  const activityPromise = simulateHumanActivity(page, Math.min(timeout, 12_000));

  while (Date.now() < deadline) {
    if (await hasClearance(context)) {
      console.log('[CF] UAM cleared ✓ (cf_clearance cookie set)');
      await sleepRandom(800, 1500); // small grace period before proceeding
      return;
    }

    // Also check if CF challenge DOM has disappeared
    const challenge = await detectChallenge(page);
    if (challenge === 'none') {
      // Double-check: give the redirect a moment to complete
      await sleep(1500);
      if (await detectChallenge(page) === 'none') {
        console.log('[CF] UAM cleared ✓ (challenge page gone)');
        return;
      }
    }

    await sleep(500);
  }

  await activityPromise.catch(() => {});
  throw new Error('[CF] UAM bypass timed out — challenge not solved within ' + timeout + 'ms');
}

// ── Turnstile bypass ──────────────────────────────────────────────────────

/**
 * Handle a Cloudflare Turnstile challenge.
 *
 * Invisible Turnstile: resolves automatically once CF's JS is satisfied
 *   with the browser fingerprint.
 * Interactive (checkbox) Turnstile: attempts a natural click on the checkbox.
 *
 * @param {import('playwright').Page} page
 * @param {import('playwright').BrowserContext} context
 * @param {object} opts
 * @param {number} opts.timeout
 */
export async function bypassTurnstile(page, context, { timeout = 45_000 } = {}) {
  console.log('[CF] Turnstile detected — waiting for widget to load…');

  const deadline = Date.now() + timeout;

  // Wait a bit for the Turnstile iframe to fully load
  await sleepRandom(2000, 3500);

  // Simulate human activity while Turnstile evaluates the browser
  simulateHumanActivity(page, Math.min(timeout * 0.6, 15_000)).catch(() => {});

  // Try to find and click an interactive checkbox inside the Turnstile iframe
  let checkboxClicked = false;
  try {
    const frame = await findTurnstileFrame(page);
    if (frame) {
      const checkbox = await frame.$(TURNSTILE_CHECKBOX_SELECTOR);
      if (checkbox) {
        console.log('[CF] Interactive Turnstile found — clicking checkbox…');
        const box = await checkbox.boundingBox();
        if (box) {
          await sleepRandom(500, 1200);
          // Use the parent page's mouse so the click position is correct
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await sleepRandom(100, 300);
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          checkboxClicked = true;
          console.log('[CF] Checkbox clicked');
        }
      }
    }
  } catch (err) {
    console.log('[CF] Checkbox click skipped:', err.message);
  }

  // Poll for clearance
  while (Date.now() < deadline) {
    if (await hasClearance(context)) {
      console.log('[CF] Turnstile cleared ✓');
      await sleepRandom(600, 1000);
      return;
    }

    const challenge = await detectChallenge(page);
    if (challenge === 'none') {
      await sleep(1000);
      if (await detectChallenge(page) === 'none') {
        console.log('[CF] Turnstile cleared ✓ (widget gone)');
        return;
      }
    }

    await sleep(700);
  }

  throw new Error(
    '[CF] Turnstile bypass timed out — ' +
    (checkboxClicked ? 'checkbox was clicked but challenge not solved' : 'no interactive checkbox found') +
    `. Timeout: ${timeout}ms`
  );
}

/**
 * Locate the Turnstile iframe and return its Frame object.
 * @param {import('playwright').Page} page
 * @returns {Promise<import('playwright').Frame|null>}
 */
async function findTurnstileFrame(page) {
  for (const sel of TURNSTILE_SELECTORS) {
    const el = await page.$(sel);
    if (el) {
      const frame = await el.contentFrame();
      if (frame) return frame;
    }
  }

  // Fallback: search all frames by URL
  for (const frame of page.frames()) {
    const url = frame.url();
    if (url.includes('challenges.cloudflare.com') || url.includes('turnstile')) {
      return frame;
    }
  }
  return null;
}

// ── Main bypass entry point ───────────────────────────────────────────────

/**
 * Detect and handle any active Cloudflare challenge on the current page.
 * Resolves immediately if no challenge is present.
 *
 * @param {import('playwright').Page} page
 * @param {import('playwright').BrowserContext} context
 * @param {object} [opts]
 * @param {number} [opts.timeout=30000]   Per-challenge timeout in ms
 * @param {number} [opts.maxRetries=2]    How many times to retry if a new
 *                                        challenge appears after solving one
 */
export async function handleCloudflare(page, context, { timeout = 30_000, maxRetries = 2 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const type = await detectChallenge(page);

    if (type === 'none') {
      if (attempt > 0) console.log('[CF] No further challenges detected.');
      return; // All clear
    }

    console.log(`[CF] Challenge type: ${type} (attempt ${attempt + 1}/${maxRetries + 1})`);

    if (type === 'uam') {
      await bypassUAM(page, context, { timeout });
    } else if (type === 'turnstile') {
      await bypassTurnstile(page, context, { timeout });
    }

    // After bypass, wait for navigation to settle
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch (_) {}
  }

  // Final check
  const remaining = await detectChallenge(page);
  if (remaining !== 'none') {
    throw new Error(`[CF] Challenge persists after ${maxRetries + 1} attempts (type: ${remaining})`);
  }
}
