/**
 * Utility helpers: human-like delays, mouse simulation, random helpers.
 */

/**
 * Sleep for `ms` milliseconds.
 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sleep for a random duration between min and max ms.
 */
export const sleepRandom = (min = 300, max = 1200) =>
  sleep(min + Math.random() * (max - min));

/**
 * Ease-in-out interpolation for smooth mouse movement.
 */
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/**
 * Move the mouse from its current position to (x, y) in a curved, human-like
 * path with randomized speed and micro-jitter.
 *
 * @param {import('playwright').Page} page
 * @param {number} toX
 * @param {number} toY
 * @param {object} [opts]
 * @param {number} [opts.steps=25]   Number of intermediate points
 * @param {number} [opts.jitter=2]   Max pixel jitter per step
 */
export async function moveMouse(page, toX, toY, { steps = 25, jitter = 2 } = {}) {
  // Get current mouse position (Playwright tracks this internally)
  // We'll just move from a plausible starting point
  const fromX = toX - 100 + Math.random() * 200;
  const fromY = toY - 100 + Math.random() * 200;

  for (let i = 1; i <= steps; i++) {
    const t = easeInOut(i / steps);
    const x = fromX + (toX - fromX) * t + (Math.random() - 0.5) * jitter;
    const y = fromY + (toY - fromY) * t + (Math.random() - 0.5) * jitter;
    await page.mouse.move(Math.round(x), Math.round(y));
    await sleep(10 + Math.random() * 20);
  }
}

/**
 * Simulate a natural scroll — random direction, random distance.
 */
export async function randomScroll(page) {
  const distance = 100 + Math.floor(Math.random() * 300);
  const direction = Math.random() > 0.5 ? distance : -distance;
  await page.mouse.wheel(0, direction);
  await sleepRandom(200, 600);
}

/**
 * Simulate idle human behaviour on the page while waiting for a CF challenge.
 * Moves mouse around and occasionally scrolls.
 *
 * @param {import('playwright').Page} page
 * @param {number} durationMs  How long to simulate activity
 */
export async function simulateHumanActivity(page, durationMs = 8000) {
  const start = Date.now();
  const viewport = page.viewportSize() || { width: 1280, height: 720 };

  while (Date.now() - start < durationMs) {
    const x = 200 + Math.random() * (viewport.width - 400);
    const y = 200 + Math.random() * (viewport.height - 400);
    await moveMouse(page, x, y, { steps: 15 + Math.floor(Math.random() * 20) });
    await sleepRandom(400, 1200);

    if (Math.random() < 0.3) {
      await randomScroll(page);
    }
  }
}

/**
 * Click an element with a natural mouse movement first.
 */
export async function humanClick(page, selector, { timeout = 5000 } = {}) {
  const el = await page.waitForSelector(selector, { timeout });
  const box = await el.boundingBox();
  if (!box) throw new Error(`Element ${selector} has no bounding box`);

  // Click slightly off-center (humans don't click dead center)
  const x = box.x + box.width * (0.3 + Math.random() * 0.4);
  const y = box.y + box.height * (0.3 + Math.random() * 0.4);

  await moveMouse(page, x, y);
  await sleepRandom(80, 250);
  await page.mouse.click(x, y);
}

/**
 * Retry an async fn up to `maxAttempts` times with exponential back-off.
 */
export async function retry(fn, maxAttempts = 3, baseDelayMs = 1000) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }
  throw lastErr;
}
