/**
 * pageController — copied from puppeteer-real-browser, extended.
 *
 * Original: https://github.com/zfcsoftware/puppeteer-real-browser
 *
 * Changes:
 *  - UAM detection loop added alongside Turnstile loop
 *  - ghost-cursor realClick/realCursor exposed on page
 *  - screenX/screenY MouseEvent patch kept as-is
 */

import { createCursor } from 'ghost-cursor';
import { checkTurnstile, waitForUAM } from './turnstile.js';
import kill from 'tree-kill';

export async function pageController({
  browser,
  page,
  proxy,
  turnstile,
  xvfbsession,
  pid,
  plugins,
  killProcess = false,
  chrome,
}) {
  let solveStatus = turnstile;

  // Stop solving when page/browser closes
  page.on('close', () => { solveStatus = false; });

  browser.on('disconnected', async () => {
    solveStatus = false;
    if (killProcess) {
      if (xvfbsession) try { xvfbsession.stopSync(); } catch (_) {}
      if (chrome)      try { chrome.kill(); }          catch (_) {}
      if (pid)         try { kill(pid, 'SIGKILL', () => {}); } catch (_) {}
    }
  });

  // ── Turnstile + UAM solver loop ──────────────────────────────────────────
  async function solverLoop() {
    while (solveStatus) {
      try {
        const title = await page.title().catch(() => '');

        if (/just a moment/i.test(title)) {
          // Could be UAM or Turnstile — try both
          await checkTurnstile({ page }).catch(() => {});
          await waitForUAM({ page, timeout: 25000 }).catch(() => {});
        } else {
          // Page looks normal — still check for embedded Turnstile widgets
          await checkTurnstile({ page }).catch(() => {});
        }
      } catch (_) {}

      await new Promise(r => setTimeout(r, 1000));
    }
  }

  solverLoop(); // fire-and-forget

  // ── Proxy auth ──────────────────────────────────────────────────────────
  if (proxy?.username && proxy?.password) {
    await page.authenticate({ username: proxy.username, password: proxy.password });
  }

  // ── Plugin hooks ─────────────────────────────────────────────────────────
  if (plugins?.length > 0) {
    for (const plugin of plugins) {
      plugin.onPageCreated(page);
    }
  }

  // ── Mouse coordinate patch ───────────────────────────────────────────────
  // Makes screenX/screenY look like a real windowed browser.
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(MouseEvent.prototype, 'screenX', {
      get() { return this.clientX + window.screenX; },
    });
    Object.defineProperty(MouseEvent.prototype, 'screenY', {
      get() { return this.clientY + window.screenY; },
    });
  });

  // ── ghost-cursor ─────────────────────────────────────────────────────────
  const cursor = createCursor(page);
  page.realCursor = cursor;
  page.realClick  = cursor.click;

  return page;
}
