/**
 * Cloudflare challenge detection & bypass (Puppeteer API)
 *
 * Handles:
 *   UAM       — "Under Attack Mode" 5-second JS spinner
 *   Turnstile — puppeteer-real-browser handles this natively via turnstile:true,
 *               but we add a fallback poller here as safety net.
 */

import { sleep, sleepRandom, simulateHumanActivity } from './utils.js';

const CF_TITLE_RE = /just a moment/i;

const CF_SELECTORS = [
  '#cf-spinner',
  '#challenge-running',
  '#challenge-form',
  '.cf-browser-verification',
  '#cf-please-wait',
];

const TURNSTILE_SELECTORS = [
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="turnstile"]',
  '#cf-turnstile',
  '.cf-turnstile',
];

// ── helpers ────────────────────────────────────────────────────────────────

export async function detectChallenge(page) {
  try {
    const title = await page.title();
    if (CF_TITLE_RE.test(title)) {
      for (const sel of TURNSTILE_SELECTORS) {
        if (await page.$(sel)) return 'turnstile';
      }
      return 'uam';
    }
    for (const sel of CF_SELECTORS) {
      if (await page.$(sel)) return 'uam';
    }
    for (const sel of TURNSTILE_SELECTORS) {
      if (await page.$(sel)) return 'turnstile';
    }
  } catch (_) {}
  return 'none';
}

export async function hasClearance(page) {
  try {
    const cookies = await page.cookies();
    return cookies.some((c) => c.name === 'cf_clearance');
  } catch (_) {
    return false;
  }
}

// ── UAM ────────────────────────────────────────────────────────────────────

export async function bypassUAM(page, { timeout = 30_000 } = {}) {
  console.log('[CF] UAM detected — waiting for JS challenge…');
  const deadline = Date.now() + timeout;

  // Human activity runs in background while we poll
  simulateHumanActivity(page, Math.min(timeout, 12_000)).catch(() => {});

  while (Date.now() < deadline) {
    if (await hasClearance(page)) {
      console.log('[CF] UAM cleared ✓');
      await sleepRandom(700, 1200);
      return;
    }
    if (await detectChallenge(page) === 'none') {
      await sleep(1200);
      if (await detectChallenge(page) === 'none') {
        console.log('[CF] UAM cleared ✓ (challenge gone)');
        return;
      }
    }
    await sleep(500);
  }
  throw new Error(`[CF] UAM timed out after ${timeout}ms`);
}

// ── Turnstile ──────────────────────────────────────────────────────────────
// puppeteer-real-browser with turnstile:true handles this automatically.
// This is a fallback safety-net poller.

export async function bypassTurnstile(page, { timeout = 45_000 } = {}) {
  console.log('[CF] Turnstile detected — polling for clearance…');
  const deadline = Date.now() + timeout;

  simulateHumanActivity(page, Math.min(timeout * 0.5, 15_000)).catch(() => {});

  while (Date.now() < deadline) {
    if (await hasClearance(page)) {
      console.log('[CF] Turnstile cleared ✓');
      await sleepRandom(500, 900);
      return;
    }
    if (await detectChallenge(page) === 'none') {
      await sleep(1000);
      if (await detectChallenge(page) === 'none') {
        console.log('[CF] Turnstile cleared ✓ (widget gone)');
        return;
      }
    }
    await sleep(600);
  }
  throw new Error(`[CF] Turnstile timed out after ${timeout}ms`);
}

// ── main entry ─────────────────────────────────────────────────────────────

export async function handleCloudflare(page, { timeout = 30_000, maxRetries = 2 } = {}) {
  for (let i = 0; i <= maxRetries; i++) {
    const type = await detectChallenge(page);
    if (type === 'none') return;

    console.log(`[CF] Challenge: ${type} (try ${i + 1}/${maxRetries + 1})`);

    if (type === 'uam')       await bypassUAM(page, { timeout });
    if (type === 'turnstile') await bypassTurnstile(page, { timeout });

    // Wait for redirect/settle
    try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }); } catch (_) {}
  }

  const rem = await detectChallenge(page);
  if (rem !== 'none') throw new Error(`[CF] Challenge persists after ${maxRetries + 1} tries (${rem})`);
}
