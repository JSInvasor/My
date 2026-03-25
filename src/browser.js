/**
 * CFBrowser — high-level wrapper around our embedded core (puppeteer-real-browser fork).
 *
 * Adds:
 *  - Fingerprint profile management (UA, Sec-Ch-Ua, Accept-Language…)
 *  - UAM / Turnstile fallback poller
 *  - CFPage convenience wrapper
 */

import { connect } from '../core/index.js';
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

  /** Navigate to URL and auto-handle CF challenges. */
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
    return cookies.find(c => c.name === 'cf_clearance')?.value ?? null;
  }

  cookies()   { return this.#page.cookies(); }
  get raw()   { return this.#page; }

  // Puppeteer passthrough
  content()                  { return this.#page.content(); }
  title()                    { return this.#page.title(); }
  url()                      { return this.#page.url(); }
  $(s)                       { return this.#page.$(s); }
  $$(s)                      { return this.#page.$$(s); }
  $eval(s, f, ...a)          { return this.#page.$eval(s, f, ...a); }
  $$eval(s, f, ...a)         { return this.#page.$$eval(s, f, ...a); }
  evaluate(f, ...a)          { return this.#page.evaluate(f, ...a); }
  waitForSelector(s, o)      { return this.#page.waitForSelector(s, o); }
  waitForNavigation(o)       { return this.#page.waitForNavigation(o); }
  screenshot(o)              { return this.#page.screenshot(o); }
  close()                    { return this.#page.close(); }

  // ghost-cursor (real human-like clicks)
  realClick(selector, opts)  { return this.#page.realClick(selector, opts); }
  get realCursor()           { return this.#page.realCursor; }
}

// ── CFBrowser ─────────────────────────────────────────────────────────────

export class CFBrowser {
  #browser = null;
  #opts;
  #fp;

  /**
   * @param {object}  [opts]
   * @param {string}  [opts.profile='chrome-win']
   * @param {object}  [opts.proxy]             { host, port, username, password }
   * @param {boolean} [opts.disableXvfb=false]
   * @param {string[]}[opts.args=[]]           Extra Chrome flags
   * @param {number}  [opts.navigationTimeout=30000]
   * @param {number}  [opts.cfTimeout=30000]
   * @param {number}  [opts.cfMaxRetries=2]
   * @param {any[]}   [opts.plugins=[]]        puppeteer-extra plugins
   */
  constructor(opts = {}) {
    this.#opts = {
      profile:           defaultProfile,
      disableXvfb:       false,
      args:              [],
      plugins:           [],
      navigationTimeout: 30_000,
      cfTimeout:         30_000,
      cfMaxRetries:      2,
      ...opts,
    };
    this.#fp = profiles[this.#opts.profile];
    if (!this.#fp) {
      throw new Error(
        `Unknown profile "${this.#opts.profile}". Available: ${Object.keys(profiles).join(', ')}`
      );
    }
  }

  async launch() {
    if (this.#browser) return this;

    const platform = this.#fp.platform === 'Win32' ? 'Windows'
                   : this.#fp.platform === 'MacIntel' ? 'macOS'
                   : 'Linux';

    const { browser } = await connect({
      headless:     false,   // MUST be false for CF bypass
      turnstile:    true,    // built-in Turnstile solver
      disableXvfb:  this.#opts.disableXvfb,
      proxy:        this.#opts.proxy ?? {},
      plugins:      this.#opts.plugins,
      userAgent:    this.#fp.userAgent,
      extraHeaders: {
        'Accept-Language':           this.#fp.acceptLanguage,
        'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding':           'gzip, deflate, br',
        'Sec-Ch-Ua':                 `"Not_A Brand";v="8", "Chromium";v="${this.#fp.chromeVersion}", "Google Chrome";v="${this.#fp.chromeVersion}"`,
        'Sec-Ch-Ua-Mobile':          '?0',
        'Sec-Ch-Ua-Platform':        JSON.stringify(platform),
        'Upgrade-Insecure-Requests': '1',
      },
      args: [
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
    });

    this.#browser = browser;
    return this;
  }

  async newPage() {
    if (!this.#browser) await this.launch();
    const page = await this.#browser.newPage();
    return new CFPage(page, this.#opts);
  }

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

  static async launch(opts = {}) {
    const b = new CFBrowser(opts);
    await b.launch();
    return b;
  }
}
