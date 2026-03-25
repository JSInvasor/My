/**
 * Turnstile solver — copied from puppeteer-real-browser, extended.
 *
 * Original: https://github.com/zfcsoftware/puppeteer-real-browser
 *
 * Changes:
 *  - Added UAM detection + cf_clearance polling
 *  - Increased detection timeout to 8s
 *  - Added extra selector fallback for newer CF widget markup
 */

export const checkTurnstile = ({ page }) => {
  return new Promise(async (resolve) => {
    // Timeout — don't hang forever on a page without Turnstile
    const waitTimeout = setTimeout(() => resolve(false), 8000);

    try {
      // ── Method 1: find by hidden input (most reliable) ────────────────────
      const elements = await page.$$('[name="cf-turnstile-response"]');

      if (elements.length <= 0) {
        // ── Method 2: find Turnstile widget by geometry ─────────────────────
        // The widget container is a ~300px wide empty div.
        const coordinates = await page.evaluate(() => {
          const found = [];

          document.querySelectorAll('div').forEach(item => {
            try {
              const rect = item.getBoundingClientRect();
              const css  = window.getComputedStyle(item);
              // Strict match: 300px wide, no children, zero margin/padding
              if (
                css.margin === '0px' &&
                css.padding === '0px' &&
                rect.width > 290 && rect.width <= 310 &&
                !item.querySelector('*')
              ) {
                found.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
              }
            } catch (_) {}
          });

          // Looser fallback — drop the CSS requirement
          if (found.length === 0) {
            document.querySelectorAll('div').forEach(item => {
              try {
                const rect = item.getBoundingClientRect();
                if (rect.width > 290 && rect.width <= 310 && !item.querySelector('*')) {
                  found.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                }
              } catch (_) {}
            });
          }

          return found;
        });

        for (const item of coordinates) {
          try {
            await page.mouse.click(item.x + 30, item.y + item.h / 2);
          } catch (_) {}
        }

        clearTimeout(waitTimeout);
        return resolve(true);
      }

      // ── Method 1 path: click via parent bounding box ──────────────────────
      for (const element of elements) {
        try {
          const parent = await element.evaluateHandle(el => el.parentElement);
          const box    = await parent.boundingBox();
          await page.mouse.click(box.x + 30, box.y + box.height / 2);
        } catch (_) {}
      }

      clearTimeout(waitTimeout);
      resolve(true);

    } catch (err) {
      clearTimeout(waitTimeout);
      resolve(false);
    }
  });
};

// ── UAM (Under Attack Mode) helper ────────────────────────────────────────

/**
 * Poll until cf_clearance cookie appears or the challenge DOM disappears.
 * Returns true when cleared, false on timeout.
 */
export const waitForUAM = ({ page, timeout = 30000 }) => {
  return new Promise(async (resolve) => {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      try {
        // Check cookie
        const cookies = await page.cookies();
        if (cookies.some(c => c.name === 'cf_clearance')) {
          return resolve(true);
        }
        // Check if challenge DOM is gone
        const title = await page.title();
        if (!/just a moment/i.test(title)) {
          const spinner = await page.$('#cf-spinner, #challenge-running, #challenge-form');
          if (!spinner) return resolve(true);
        }
      } catch (_) {}

      await new Promise(r => setTimeout(r, 500));
    }

    resolve(false);
  });
};
