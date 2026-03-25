/**
 * CFPool — concurrent browser pool with rate limiting.
 *
 * Manages N workers (browser tabs or separate browsers) and dispatches
 * tasks from a shared queue at a controlled rate (RPS).
 *
 * Modes:
 *   'page'    — one browser, N tabs   (lighter, shares cf_clearance cookie)
 *   'browser' — N separate browsers   (fully isolated, heavier)
 *
 * Usage:
 *   const pool = await CFPool.launch({ threads: 5, rps: 3 });
 *   const html = await pool.open('https://example.com');
 *   const many = await pool.openAll(['https://a.com', 'https://b.com']);
 *   await pool.close();
 */

import { CFBrowser, CFPage } from './browser.js';
import { sleep } from './utils.js';

// ── Rate limiter ───────────────────────────────────────────────────────────
// Serialises "wait for a slot" so N concurrent callers respect the RPS cap.

class RateLimiter {
  #minInterval; // ms between requests
  #queue = [];
  #processing = false;
  #lastRelease = 0;

  constructor(rps) {
    this.#minInterval = rps > 0 ? 1000 / rps : 0;
  }

  /** Resolves when it is safe to fire the next request. */
  wait() {
    if (!this.#minInterval) return Promise.resolve();
    return new Promise((resolve) => {
      this.#queue.push(resolve);
      this.#drain();
    });
  }

  async #drain() {
    if (this.#processing) return;
    this.#processing = true;
    while (this.#queue.length > 0) {
      const gap = this.#lastRelease + this.#minInterval - Date.now();
      if (gap > 0) await sleep(gap);
      this.#lastRelease = Date.now();
      this.#queue.shift()(); // release next waiter
    }
    this.#processing = false;
  }
}

// ── Worker ─────────────────────────────────────────────────────────────────

class Worker {
  #browser; // CFBrowser
  #id;
  busy = false;

  constructor(browser, id) {
    this.#browser = browser;
    this.#id      = id;
  }

  get id() { return this.#id; }

  async newPage() {
    return this.#browser.newPage();
  }

  async close() {
    return this.#browser.close();
  }
}

// ── CFPool ─────────────────────────────────────────────────────────────────

export class CFPool {
  #workers  = [];
  #queue    = [];           // { fn, resolve, reject }
  #limiter;
  #running  = false;
  #opts;

  /**
   * @param {object}  opts
   * @param {number}  [opts.threads=3]       Concurrent workers
   * @param {number}  [opts.rps=2]           Max requests / second (0 = unlimited)
   * @param {string}  [opts.mode='page']     'page' | 'browser'
   * @param {string}  [opts.profile]         Fingerprint profile
   * @param {object}  [opts.proxy]           { host, port, username, password }
   * @param {boolean} [opts.disableXvfb]
   * @param {number}  [opts.cfTimeout]
   * @param {number}  [opts.navigationTimeout]
   */
  constructor(opts = {}) {
    this.#opts = {
      threads:   3,
      rps:       2,
      mode:      'page',     // 'page' is faster; 'browser' for full isolation
      ...opts,
    };
    this.#limiter = new RateLimiter(this.#opts.rps);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  async launch() {
    console.log(
      `[Pool] Launching ${this.#opts.threads} workers ` +
      `(mode=${this.#opts.mode}, rps=${this.#opts.rps || '∞'})`
    );

    if (this.#opts.mode === 'browser') {
      // Separate browser per worker — most isolated
      for (let i = 0; i < this.#opts.threads; i++) {
        const b = new CFBrowser(this.#opts);
        await b.launch();
        this.#workers.push(new Worker(b, i));
        console.log(`[Pool] Worker ${i} ready (browser mode)`);
      }
    } else {
      // Single browser, each worker opens its own tab
      const b = new CFBrowser(this.#opts);
      await b.launch();
      for (let i = 0; i < this.#opts.threads; i++) {
        this.#workers.push(new Worker(b, i));
      }
      console.log(`[Pool] ${this.#opts.threads} workers ready (page mode)`);
    }

    this.#running = true;
    this.#workers.forEach(w => this.#workerLoop(w));
    return this;
  }

  async close() {
    this.#running = false;
    // Deduplicate in page-mode (all workers share the same browser)
    const seen = new Set();
    for (const w of this.#workers) {
      if (!seen.has(w)) {
        seen.add(w);
        await w.close().catch(() => {});
      }
    }
    this.#workers = [];
    console.log('[Pool] Closed');
  }

  // ── Worker loop ────────────────────────────────────────────────────────

  async #workerLoop(worker) {
    while (this.#running) {
      if (this.#queue.length === 0) {
        await sleep(50);
        continue;
      }

      const task = this.#queue.shift();
      worker.busy = true;

      try {
        await this.#limiter.wait();          // respect RPS cap
        const page = await worker.newPage(); // CFPage
        const result = await task.fn(page);
        await page.close().catch(() => {});
        task.resolve(result);
      } catch (err) {
        task.reject(err);
      } finally {
        worker.busy = false;
      }
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Enqueue a custom task. Receives a CFPage, returns anything.
   * @param {(page: CFPage) => Promise<any>} fn
   */
  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.#queue.push({ fn, resolve, reject });
    });
  }

  /**
   * Navigate to a URL and optionally run a scrape function.
   * @param {string}   url
   * @param {(page: CFPage) => Promise<any>} [scrapeFn]  defaults to page.content()
   */
  open(url, scrapeFn) {
    return this.enqueue(async (page) => {
      await page.goto(url);
      return scrapeFn ? scrapeFn(page) : page.content();
    });
  }

  /**
   * Run open() on an array of URLs concurrently (respects threads + RPS).
   * @param {string[]} urls
   * @param {(page: CFPage) => Promise<any>} [scrapeFn]
   * @returns {Promise<Array<{ url, result, error }>>}
   */
  async openAll(urls, scrapeFn) {
    const tasks = urls.map(url =>
      this.open(url, scrapeFn)
        .then(result => ({ url, result, error: null }))
        .catch(error => ({ url, result: null, error: error.message }))
    );
    return Promise.all(tasks);
  }

  /** Current queue depth. */
  get queueSize() { return this.#queue.length; }

  /** Number of workers currently executing a task. */
  get activeWorkers() { return this.#workers.filter(w => w.busy).length; }

  /** Static factory. */
  static async launch(opts = {}) {
    return new CFPool(opts).launch();
  }
}
