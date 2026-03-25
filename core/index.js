/**
 * core/index.js — connect() function
 *
 * Copied from puppeteer-real-browser (ESM version), adapted for our project.
 * Original: https://github.com/zfcsoftware/puppeteer-real-browser
 *
 * Changes:
 *  - ES module import style
 *  - Fingerprint profile support (UA, headers)
 *  - userDataDir support for session persistence
 *  - verbose logging
 */

import { launch, Launcher } from 'chrome-launcher';
import puppeteer from 'rebrowser-puppeteer-core';
import { pageController } from './module/pageController.js';

/**
 * Launch a real Chrome instance and connect puppeteer to it.
 *
 * @param {object} opts
 * @param {string[]} [opts.args=[]]             Extra Chrome flags
 * @param {boolean}  [opts.headless=false]       Never set true — defeats the purpose
 * @param {object}   [opts.customConfig={}]      Passed to chrome-launcher
 * @param {object}   [opts.proxy={}]             { host, port, username, password }
 * @param {boolean}  [opts.turnstile=true]       Auto-solve Turnstile/UAM
 * @param {object}   [opts.connectOption={}]     Passed to puppeteer.connect()
 * @param {boolean}  [opts.disableXvfb=false]    Skip xvfb on Linux
 * @param {any[]}    [opts.plugins=[]]           puppeteer-extra plugins
 * @param {boolean}  [opts.ignoreAllFlags=false] Use ONLY opts.args (skip defaults)
 * @param {string}   [opts.userAgent]            Override user-agent
 * @param {object}   [opts.extraHeaders={}]      Extra HTTP headers for all requests
 * @returns {Promise<{ browser, page }>}
 */
export async function connect({
  args          = [],
  headless      = false,
  customConfig  = {},
  proxy         = {},
  turnstile     = true,
  connectOption = {},
  disableXvfb   = false,
  plugins       = [],
  ignoreAllFlags = false,
  userAgent     = null,
  extraHeaders  = {},
} = {}) {

  // ── xvfb (Linux only) ───────────────────────────────────────────────────
  let xvfbsession = null;

  if (process.platform === 'linux' && !disableXvfb) {
    try {
      const { default: Xvfb } = await import('xvfb');
      xvfbsession = new Xvfb({
        silent: true,
        xvfb_args: ['-screen', '0', '1920x1080x24', '-ac'],
      });
      xvfbsession.startSync();
      console.log('[Core] xvfb started');
    } catch (err) {
      console.warn(
        '[Core] xvfb not available — browser may be detected as headless.\n' +
        '       Install with: sudo apt-get install xvfb\n' +
        '       Error:', err.message
      );
    }
  }

  // ── Chrome flags ─────────────────────────────────────────────────────────
  let chromeFlags;

  if (ignoreAllFlags) {
    chromeFlags = [
      ...args,
      ...(headless ? [`--headless=${headless}`] : []),
      ...(proxy.host && proxy.port ? [`--proxy-server=${proxy.host}:${proxy.port}`] : []),
    ];
  } else {
    // Start from chrome-launcher defaults (mirrors a real Chrome install)
    const flags = Launcher.defaultFlags();

    // Append AutomationControlled to the existing --disable-features flag
    const dfIdx = flags.findIndex(f => f.startsWith('--disable-features'));
    flags[dfIdx] = `${flags[dfIdx]},AutomationControlled`;

    // Remove --disable-component-update (causes fingerprint differences)
    const dcuIdx = flags.findIndex(f => f.startsWith('--disable-component-update'));
    if (dcuIdx !== -1) flags.splice(dcuIdx, 1);

    chromeFlags = [
      ...flags,
      ...args,
      ...(headless ? [`--headless=${headless}`] : []),
      ...(proxy.host && proxy.port ? [`--proxy-server=${proxy.host}:${proxy.port}`] : []),
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ];
  }

  // ── Launch Chrome ────────────────────────────────────────────────────────
  const chrome = await launch({
    ignoreDefaultFlags: true,
    chromeFlags,
    ...customConfig,
  });

  console.log(`[Core] Chrome launched on port ${chrome.port} (pid ${chrome.pid})`);

  // ── Connect puppeteer ────────────────────────────────────────────────────
  let pptr = puppeteer;

  if (plugins.length > 0) {
    const { addExtra } = await import('puppeteer-extra');
    pptr = addExtra(puppeteer);
    for (const plugin of plugins) pptr.use(plugin);
  }

  const browser = await pptr.connect({
    browserURL: `http://127.0.0.1:${chrome.port}`,
    ...connectOption,
  });

  let [page] = await browser.pages();

  // ── Apply UA + headers ───────────────────────────────────────────────────
  if (userAgent) await page.setUserAgent(userAgent);
  if (Object.keys(extraHeaders).length > 0) await page.setExtraHTTPHeaders(extraHeaders);

  // ── pageController: cursor, Turnstile/UAM solver, proxy auth ─────────────
  const pcConfig = { browser, page, proxy, turnstile, xvfbsession, pid: chrome.pid, plugins };

  page = await pageController({ ...pcConfig, chrome, killProcess: true });

  // Apply the same setup to every new tab
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      let newPage = await target.page();
      if (userAgent) await newPage.setUserAgent(userAgent);
      if (Object.keys(extraHeaders).length > 0) await newPage.setExtraHTTPHeaders(extraHeaders);
      pcConfig.page = newPage;
      await pageController(pcConfig);
    }
  });

  return { browser, page };
}
