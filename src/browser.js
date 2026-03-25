/**
 * CFBrowser — the main browser manager.
 *
 * Launches Chromium/Chrome with all stealth patches applied and provides a
 * `goto()` method that automatically handles Cloudflare challenges.
 *
 * Usage:
 *   const browser = await CFBrowser.launch({ profile: 'chrome-win' });
 *   const page    = await browser.newPage();
 *   await page.goto('https://some-cf-protected-site.com');
 *   const html    = await page.content();
 *   await browser.close();
 */

import { chromium } from 'playwright';
import { existsSync } from 'fs';
import { buildStealthScript } from './stealth.js';
import { handleCloudflare } from './cf-handler.js';
import { profiles, defaultProfile } from './fingerprints.js';
import { sleep } from './utils.js';

// ── Chrome executable detection ───────────────────────────────────────────

const CHROME_PATHS = {
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
};

function findChrome() {
  const platform = process.platform;
  const paths = CHROME_PATHS[platform] || [];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null; // Playwright will use bundled Chromium
}

// ── Launch args ───────────────────────────────────────────────────────────

function buildLaunchArgs(fp, opts) {
  const args = [
    // Critical: removes the `AutomationControlled` feature flag
    '--disable-blink-features=AutomationControlled',

    // Disable various telltale headless behaviours
    '--disable-features=IsolateOrigins,site-per-process',
    '--allow-running-insecure-content',
    '--disable-web-security',

    // Appearance / display
    `--window-size=${fp.screenWidth},${fp.screenHeight}`,
    '--start-maximized',
    '--lang=en-US',

    // Performance / sandbox
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',           // needed in headless Linux environments
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-infobars',
    '--disable-notifications',
    '--disable-popup-blocking',

    // Make extensions look real
    '--disable-extensions-except=',
  ];

  if (opts.proxy) {
    args.push(`--proxy-server=${opts.proxy}`);
  }

  return args;
}

// ── CFPage wrapper ────────────────────────────────────────────────────────

/**
 * Thin wrapper around a Playwright Page that:
 *   - Applies stealth scripts on every new document
 *   - Auto-handles CF challenges after navigation
 */
export class CFPage {
  /** @type {import('playwright').Page} */
  #page;
  /** @type {import('playwright').BrowserContext} */
  #context;
  #options;

  constructor(page, context, options) {
    this.#page    = page;
    this.#context = context;
    this.#options = options;
  }

  /**
   * Navigate to a URL and automatically bypass any CF challenge.
   *
   * @param {string} url
   * @param {object} [navOptions]  Playwright goto options (waitUntil, timeout…)
   * @returns {Promise<import('playwright').Response|null>}
   */
  async goto(url, navOptions = {}) {
    const response = await this.#page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: this.#options.navigationTimeout ?? 30_000,
      ...navOptions,
    });

    await handleCloudflare(this.#page, this.#context, {
      timeout:    this.#options.cfTimeout    ?? 30_000,
      maxRetries: this.#options.cfMaxRetries ?? 2,
    });

    return response;
  }

  /**
   * Get cookies from the current context (includes cf_clearance).
   */
  async cookies(url) {
    return this.#context.cookies(url);
  }

  /**
   * Get cf_clearance cookie value, or null if not yet obtained.
   */
  async getClearance() {
    const cookies = await this.#context.cookies();
    const c = cookies.find((x) => x.name === 'cf_clearance');
    return c ? c.value : null;
  }

  /** Expose the raw Playwright page for advanced operations. */
  get raw() {
    return this.#page;
  }

  // ── Proxy commonly used Playwright methods ────────────────────────────────

  content()                         { return this.#page.content(); }
  title()                           { return this.#page.title(); }
  url()                             { return this.#page.url(); }
  $(selector)                       { return this.#page.$(selector); }
  $$(selector)                      { return this.#page.$$(selector); }
  $eval(sel, fn, ...args)           { return this.#page.$eval(sel, fn, ...args); }
  $$eval(sel, fn, ...args)          { return this.#page.$$eval(sel, fn, ...args); }
  evaluate(fn, ...args)             { return this.#page.evaluate(fn, ...args); }
  waitForSelector(sel, opts)        { return this.#page.waitForSelector(sel, opts); }
  waitForNavigation(opts)           { return this.#page.waitForNavigation(opts); }
  waitForLoadState(state, opts)     { return this.#page.waitForLoadState(state, opts); }
  screenshot(opts)                  { return this.#page.screenshot(opts); }
  close()                           { return this.#page.close(); }
}

// ── CFBrowser ─────────────────────────────────────────────────────────────

export class CFBrowser {
  /** @type {import('playwright').Browser} */
  #browser = null;
  /** @type {import('playwright').BrowserContext} */
  #context = null;
  #options;
  #fp;

  /**
   * @param {object} [opts]
   * @param {string}  [opts.profile='chrome-win']   Fingerprint profile name
   * @param {boolean} [opts.headless=false]          Run headlessly?
   * @param {string}  [opts.proxy]                   Optional proxy URL
   * @param {string}  [opts.userDataDir]             Persist sessions here
   * @param {number}  [opts.navigationTimeout=30000]
   * @param {number}  [opts.cfTimeout=30000]         CF challenge timeout
   * @param {number}  [opts.cfMaxRetries=2]
   */
  constructor(opts = {}) {
    this.#options = {
      profile:             defaultProfile,
      headless:            false,
      navigationTimeout:   30_000,
      cfTimeout:           30_000,
      cfMaxRetries:        2,
      ...opts,
    };
    this.#fp = profiles[this.#options.profile];
    if (!this.#fp) {
      throw new Error(
        `Unknown fingerprint profile: "${this.#options.profile}". ` +
        `Available: ${Object.keys(profiles).join(', ')}`
      );
    }
  }

  /**
   * Launch the browser and create a context.
   * Automatically called by `newPage()` if not already launched.
   */
  async launch() {
    if (this.#browser) return this;

    const executablePath = findChrome();
    if (executablePath) {
      console.log(`[Browser] Using installed Chrome: ${executablePath}`);
    } else {
      console.log('[Browser] Installed Chrome not found — using bundled Chromium');
    }

    const launchOpts = {
      headless: this.#options.headless,
      args: buildLaunchArgs(this.#fp, this.#options),
      ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=AutomationControlled'],
    };
    if (executablePath) launchOpts.executablePath = executablePath;

    this.#browser = await chromium.launch(launchOpts);

    const contextOpts = {
      userAgent:         this.#fp.userAgent,
      viewport:          { width: this.#fp.screenWidth, height: this.#fp.screenHeight - 80 },
      locale:            this.#fp.languages[0],
      timezoneId:        this.#fp.timezone,
      colorScheme:       'light',
      deviceScaleFactor: this.#fp.deviceScaleFactor,
      extraHTTPHeaders: {
        'Accept-Language': this.#fp.acceptLanguage,
      },
    };

    if (this.#options.proxy) {
      contextOpts.proxy = { server: this.#options.proxy };
    }

    this.#context = await this.#browser.newContext(contextOpts);

    // Inject stealth script on every new page/frame
    const stealthScript = buildStealthScript(this.#fp);
    await this.#context.addInitScript(stealthScript);

    return this;
  }

  /**
   * Open a new tab with full stealth + CF bypass support.
   * @returns {Promise<CFPage>}
   */
  async newPage() {
    if (!this.#browser) await this.launch();

    const page = await this.#context.newPage();

    // Intercept requests to set realistic headers
    await page.setExtraHTTPHeaders({
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': this.#fp.acceptLanguage,
      'Sec-Ch-Ua':       `"Not_A Brand";v="8", "Chromium";v="${this.#fp.chromeVersion}", "Google Chrome";v="${this.#fp.chromeVersion}"`,
      'Sec-Ch-Ua-Mobile':   '?0',
      'Sec-Ch-Ua-Platform': JSON.stringify(this.#fp.platform === 'Win32' ? 'Windows' : this.#fp.platform === 'MacIntel' ? 'macOS' : 'Linux'),
      'Upgrade-Insecure-Requests': '1',
    });

    return new CFPage(page, this.#context, this.#options);
  }

  /**
   * Convenience: launch, navigate, and return the page in one call.
   *
   * @param {string} url
   * @param {object} [navOptions]
   * @returns {Promise<CFPage>}
   */
  async open(url, navOptions = {}) {
    const page = await this.newPage();
    await page.goto(url, navOptions);
    return page;
  }

  /** Close the browser and release all resources. */
  async close() {
    if (this.#browser) {
      await this.#browser.close();
      this.#browser = null;
      this.#context = null;
    }
  }

  /**
   * Static factory — same as `new CFBrowser(opts).launch()`.
   */
  static async launch(opts = {}) {
    const b = new CFBrowser(opts);
    await b.launch();
    return b;
  }
}
