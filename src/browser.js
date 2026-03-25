/**
 * CFBrowser — wraps puppeteer-real-browser with automatic CF bypass.
 *
 * puppeteer-real-browser handles:
 *   ✓ rebrowser-patches   (removes Runtime.enable CDP leak)
 *   ✓ xvfb on Linux       (real non-headless Chrome, no headless UA)
 *   ✓ real Chrome binary
 *   ✓ Turnstile auto-solve (turnstile: true)
 *
 * We add on top:
 *   ✓ Consistent fingerprint headers (UA, Sec-Ch-Ua, Accept-Language…)
 *   ✓ UAM poller          (wait for cf_clearance after 5-sec spinner)
 *   ✓ Turnstile fallback  (in case built-in solver needs help)
 *   ✓ proxy support
 */

import { connect } from 'puppeteer-real-browser';
import { handleCloudflare } from './cf-handler.js';
import { profiles, defaultProfile } from './fingerprints.js';

// ── CFPage ────────────────────────────────────────────────────────────────

export class CFPage {
  #page;
  #opts;

  constructor(page, opts) {
    this.#page = page;
    this.#opts = opts;
  }

  /**
   * Navigate to a URL and auto-handle any CF challenge.
   */
  async goto(url, navOpts = {}) {
    const res = await this.#page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout:   this.#opts.navigationTimeout ?? 30_000,
      ...navOpts,
    });

    await handleCloudflare(this.#page, {
      timeout:    this.#opts.cfTimeout    ?? 30_000,
      maxRetries: this.#opts.cfMaxRetries ?? 2,
    });

    return res;
  }

  /** cf_clearance cookie value, or null. */
  async getClearance() {
    const cookies = await this.#page.cookies();
    return cookies.find((c) => c.name === 'cf_clearance')?.value ?? null;
  }

  /** All cookies for the current page. */
  cookies() { return this.#page.cookies(); }

  /** Raw puppeteer Page — use for anything not exposed here. */
  get raw() { return this.#page; }

  // ── Puppeteer passthrough ──────────────────────────────────────────────
  content()                    { return this.#page.content(); }
  title()                      { return this.#page.title(); }
  url()                        { return this.#page.url(); }
  $(sel)                       { return this.#page.$(sel); }
  $$(sel)                      { return this.#page.$$(sel); }
  $eval(sel, fn, ...a)         { return this.#page.$eval(sel, fn, ...a); }
  $$eval(sel, fn, ...a)        { return this.#page.$$eval(sel, fn, ...a); }
  evaluate(fn, ...a)           { return this.#page.evaluate(fn, ...a); }
  waitForSelector(sel, opts)   { return this.#page.waitForSelector(sel, opts); }
  waitForNavigation(opts)      { return this.#page.waitForNavigation(opts); }
  screenshot(opts)             { return this.#page.screenshot(opts); }
  close()                      { return this.#page.close(); }
}

// ── CFBrowser ─────────────────────────────────────────────────────────────

export class CFBrowser {
  #browser = null;
  #opts;
  #fp;

  /**
   * @param {object} [opts]
   * @param {string}  [opts.profile='chrome-win']
   * @param {string}  [opts.proxy]               e.g. 'http://user:pass@host:port'
   * @param {number}  [opts.navigationTimeout=30000]
   * @param {number}  [opts.cfTimeout=30000]
   * @param {number}  [opts.cfMaxRetries=2]
   * @param {boolean} [opts.disableXvfb=false]   Set true on desktop with real display
   * @param {string[]}[opts.args]                Extra Chrome flags
   */
  constructor(opts = {}) {
    this.#opts = {
      profile:           defaultProfile,
      navigationTimeout: 30_000,
      cfTimeout:         30_000,
      cfMaxRetries:      2,
      disableXvfb:       false,
      args:              [],
      ...opts,
    };
    this.#fp = profiles[this.#opts.profile];
    if (!this.#fp) {
      throw new Error(
        `Unknown profile "${this.#opts.profile}". Available: ${Object.keys(profiles).join(', ')}`
      );
    }
  }

  /** Launch Chrome via puppeteer-real-browser. */
  async launch() {
    if (this.#browser) return this;

    const connectOpts = {
      headless: false,         // puppeteer-real-browser requires false
      turnstile: true,         // built-in Turnstile auto-solver
      disableXvfb: this.#opts.disableXvfb,
      args: [
        '--disable-blink-features=AutomationControlled',
        `--window-size=${this.#fp.screenWidth},${this.#fp.screenHeight}`,
        '--lang=en-US',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-infobars',
        ...this.#opts.args,
      ],
      connectOption: {
        defaultViewport: {
          width:  this.#fp.screenWidth,
          height: this.#fp.screenHeight - 80,
        },
      },
    };

    if (this.#opts.proxy) {
      connectOpts.args.push(`--proxy-server=${this.#opts.proxy}`);
    }

    const { browser } = await connect(connectOpts);
    this.#browser = browser;

    return this;
  }

  /** Open a new tab with stealth headers + CF bypass. */
  async newPage() {
    if (!this.#browser) await this.launch();

    const page = await this.#browser.newPage();

    await page.setUserAgent(this.#fp.userAgent);
    await page.setExtraHTTPHeaders({
      'Accept-Language':           this.#fp.acceptLanguage,
      'Sec-Ch-Ua':                 `"Not_A Brand";v="8", "Chromium";v="${this.#fp.chromeVersion}", "Google Chrome";v="${this.#fp.chromeVersion}"`,
      'Sec-Ch-Ua-Mobile':          '?0',
      'Sec-Ch-Ua-Platform':        JSON.stringify(
        this.#fp.platform === 'Win32'    ? 'Windows' :
        this.#fp.platform === 'MacIntel' ? 'macOS'   : 'Linux'
      ),
      'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding':           'gzip, deflate, br',
      'Upgrade-Insecure-Requests': '1',
    });

    return new CFPage(page, this.#opts);
  }

  /**
   * One-liner: launch + navigate + return page.
   * @param {string} url
   */
  async open(url, navOpts = {}) {
    const page = await this.newPage();
    await page.goto(url, navOpts);
    return page;
  }

  async close() {
    if (this.#browser) {
      await this.#browser.close();
      this.#browser = null;
    }
  }

  /** Static factory shorthand. */
  static async launch(opts = {}) {
    const b = new CFBrowser(opts);
    await b.launch();
    return b;
  }
}
