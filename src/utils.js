/**
 * Human-like helpers: delays, mouse movement, scrolling.
 * Adapted for Puppeteer API (puppeteer-real-browser).
 */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const sleepRandom = (min = 300, max = 1200) =>
  sleep(min + Math.random() * (max - min));

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/**
 * Move mouse to (toX, toY) along a smooth eased path with jitter.
 */
export async function moveMouse(page, toX, toY, { steps = 25, jitter = 2 } = {}) {
  const fromX = toX - 80 + Math.random() * 160;
  const fromY = toY - 80 + Math.random() * 160;

  for (let i = 1; i <= steps; i++) {
    const t = easeInOut(i / steps);
    const x = fromX + (toX - fromX) * t + (Math.random() - 0.5) * jitter;
    const y = fromY + (toY - fromY) * t + (Math.random() - 0.5) * jitter;
    await page.mouse.move(Math.round(x), Math.round(y));
    await sleep(8 + Math.random() * 18);
  }
}

/**
 * Random scroll up or down.
 */
export async function randomScroll(page) {
  const dist = 80 + Math.floor(Math.random() * 280);
  const dir  = Math.random() > 0.5 ? dist : -dist;
  await page.mouse.wheel({ deltaY: dir });
  await sleepRandom(200, 500);
}

/**
 * Simulate ~durationMs of natural human activity (mouse moves + occasional scrolls).
 */
export async function simulateHumanActivity(page, durationMs = 8000) {
  const start    = Date.now();
  const viewport = page.viewport() || { width: 1280, height: 720 };

  while (Date.now() - start < durationMs) {
    const x = 150 + Math.random() * (viewport.width  - 300);
    const y = 150 + Math.random() * (viewport.height - 300);
    await moveMouse(page, x, y, { steps: 12 + Math.floor(Math.random() * 18) });
    await sleepRandom(350, 1000);
    if (Math.random() < 0.3) await randomScroll(page);
  }
}

/**
 * Click an element with natural mouse movement first.
 */
export async function humanClick(page, selector, { timeout = 5000 } = {}) {
  await page.waitForSelector(selector, { timeout });
  const el  = await page.$(selector);
  const box = await el.boundingBox();
  if (!box) throw new Error(`No bounding box for: ${selector}`);

  const x = box.x + box.width  * (0.3 + Math.random() * 0.4);
  const y = box.y + box.height * (0.3 + Math.random() * 0.4);

  await moveMouse(page, x, y);
  await sleepRandom(80, 220);
  await page.mouse.click(x, y);
}
