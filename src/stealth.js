/**
 * Stealth scripts injected via page.addInitScript()
 * These run BEFORE any page script, overriding automation indicators.
 *
 * Each script is a self-contained IIFE string evaluated in page context.
 * The fingerprint profile is serialized and passed in via template literals.
 */

/**
 * Build the full stealth init script string for a given profile.
 * @param {object} fp - Fingerprint profile from fingerprints.js
 * @returns {string} JS source to be injected
 */
export function buildStealthScript(fp) {
  return `
(function () {
  // ── 1. navigator.webdriver ────────────────────────────────────────────────
  // This is the #1 automation signal. Remove it entirely.
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });

  // Also remove from the prototype chain so toString() inspection fails
  delete navigator.__proto__.webdriver;

  // ── 2. window.chrome ──────────────────────────────────────────────────────
  // Headless Chrome lacks window.chrome — Cloudflare checks this.
  if (!window.chrome) {
    const chrome = {
      app: {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      },
      runtime: {
        OnInstalledReason: {
          CHROME_UPDATE: 'chrome_update',
          INSTALL: 'install',
          SHARED_MODULE_UPDATE: 'shared_module_update',
          UPDATE: 'update',
        },
        OnRestartRequiredReason: {
          APP_UPDATE: 'app_update',
          OS_UPDATE: 'os_update',
          PERIODIC: 'periodic',
        },
        PlatformArch: {
          ARM: 'arm',
          ARM64: 'arm64',
          MIPS: 'mips',
          MIPS64: 'mips64',
          X86_32: 'x86-32',
          X86_64: 'x86-64',
        },
        PlatformNaclArch: {
          ARM: 'arm',
          MIPS: 'mips',
          MIPS64: 'mips64',
          X86_32: 'x86-32',
          X86_64: 'x86-64',
        },
        PlatformOs: {
          ANDROID: 'android',
          CROS: 'cros',
          LINUX: 'linux',
          MAC: 'mac',
          OPENBSD: 'openbsd',
          WIN: 'win',
        },
        RequestUpdateCheckStatus: {
          NO_UPDATE: 'no_update',
          THROTTLED: 'throttled',
          UPDATE_AVAILABLE: 'update_available',
        },
        connect: function () {},
        sendMessage: function () {},
      },
      loadTimes: function () {
        return {
          commitLoadTime: Date.now() / 1000 - Math.random() * 2,
          connectionInfo: 'h2',
          finishDocumentLoadTime: 0,
          finishLoadTime: 0,
          firstPaintAfterLoadTime: 0,
          firstPaintTime: 0,
          navigationType: 'Other',
          npnNegotiatedProtocol: 'h2',
          requestTime: Date.now() / 1000 - Math.random() * 3,
          startLoadTime: Date.now() / 1000 - Math.random() * 2.5,
          wasAlternateProtocolAvailable: false,
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
        };
      },
      csi: function () {
        return {
          onloadT: Date.now(),
          pageT: Math.random() * 5000 + 1000,
          startE: Date.now() - Math.random() * 5000,
          tran: 15,
        };
      },
    };
    // Make it non-enumerable to look native
    Object.defineProperty(window, 'chrome', {
      value: chrome,
      writable: true,
      enumerable: false,
      configurable: false,
    });
  }

  // ── 3. navigator.plugins ──────────────────────────────────────────────────
  // Headless Chrome has 0 plugins. Real Chrome has at least 3.
  if (navigator.plugins.length === 0) {
    const mockPlugin = (name, filename, description, mimeTypes) => {
      const plugin = Object.create(Plugin.prototype);
      Object.defineProperties(plugin, {
        name:        { value: name,        enumerable: true },
        filename:    { value: filename,    enumerable: true },
        description: { value: description, enumerable: true },
        length:      { value: mimeTypes.length, enumerable: true },
      });
      mimeTypes.forEach((mt, i) => {
        const mime = Object.create(MimeType.prototype);
        Object.defineProperties(mime, {
          type:        { value: mt.type,        enumerable: true },
          description: { value: mt.description, enumerable: true },
          suffixes:    { value: mt.suffixes,    enumerable: true },
          enabledPlugin: { value: plugin,       enumerable: true },
        });
        Object.defineProperty(plugin, i, { value: mime, enumerable: true });
        Object.defineProperty(plugin, mt.type, { value: mime });
      });
      return plugin;
    };

    const plugins = [
      mockPlugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', [
        { type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
        { type: 'text/pdf',        description: 'Portable Document Format', suffixes: 'pdf' },
      ]),
      mockPlugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', [
        { type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
        { type: 'text/pdf',        description: 'Portable Document Format', suffixes: 'pdf' },
      ]),
      mockPlugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', [
        { type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
        { type: 'text/pdf',        description: 'Portable Document Format', suffixes: 'pdf' },
      ]),
      mockPlugin('Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', [
        { type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
        { type: 'text/pdf',        description: 'Portable Document Format', suffixes: 'pdf' },
      ]),
      mockPlugin('WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format', [
        { type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
        { type: 'text/pdf',        description: 'Portable Document Format', suffixes: 'pdf' },
      ]),
    ];

    const pluginArray = Object.create(PluginArray.prototype);
    Object.defineProperty(pluginArray, 'length', { value: plugins.length });
    plugins.forEach((p, i) => {
      Object.defineProperty(pluginArray, i, { value: p, enumerable: true });
      Object.defineProperty(pluginArray, p.name, { value: p });
    });
    pluginArray.item    = (i) => plugins[i] || null;
    pluginArray.namedItem = (name) => plugins.find(p => p.name === name) || null;
    pluginArray.refresh = () => {};

    Object.defineProperty(navigator, 'plugins', {
      get: () => pluginArray,
      configurable: true,
    });
  }

  // ── 4. navigator properties ───────────────────────────────────────────────
  const navigatorOverrides = {
    platform:            ${JSON.stringify(fp.platform)},
    vendor:              ${JSON.stringify(fp.vendor)},
    vendorSub:           ${JSON.stringify(fp.vendorSub)},
    productSub:          ${JSON.stringify(fp.productSub)},
    hardwareConcurrency: ${fp.hardwareConcurrency},
    deviceMemory:        ${fp.deviceMemory},
    maxTouchPoints:      ${fp.maxTouchPoints},
    languages:           ${JSON.stringify(fp.languages)},
    language:            ${JSON.stringify(fp.languages[0])},
  };
  for (const [key, value] of Object.entries(navigatorOverrides)) {
    try {
      Object.defineProperty(navigator, key, {
        get: () => value,
        configurable: true,
      });
    } catch (_) {}
  }

  // ── 5. navigator.permissions ──────────────────────────────────────────────
  // Fix the notifications permission query — headless Chrome returns 'denied',
  // which is a known bot signal.
  if (navigator.permissions && navigator.permissions.query) {
    const _origQuery = navigator.permissions.query.bind(navigator.permissions);
    Object.defineProperty(navigator.permissions, 'query', {
      value: async (params) => {
        if (params.name === 'notifications') {
          return Promise.resolve({
            state: 'default',
            name: 'notifications',
            onchange: null,
          });
        }
        return _origQuery(params);
      },
      configurable: true,
    });
  }

  // ── 6. WebGL fingerprint ──────────────────────────────────────────────────
  // Spoof UNMASKED_VENDOR and UNMASKED_RENDERER to match real hardware.
  const _patchWebGL = (ctx) => {
    const _getParam = ctx.prototype.getParameter.bind(ctx.prototype);
    Object.defineProperty(ctx.prototype, 'getParameter', {
      value: function (param) {
        // UNMASKED_VENDOR_WEBGL
        if (param === 37445) return ${JSON.stringify(fp.webglVendor)};
        // UNMASKED_RENDERER_WEBGL
        if (param === 37446) return ${JSON.stringify(fp.webglRenderer)};
        return _getParam.call(this, param);
      },
      configurable: true,
    });
  };
  if (window.WebGLRenderingContext)  _patchWebGL(WebGLRenderingContext);
  if (window.WebGL2RenderingContext) _patchWebGL(WebGL2RenderingContext);

  // ── 7. Canvas noise ───────────────────────────────────────────────────────
  // Add imperceptible, seeded noise to canvas readbacks so each session has a
  // unique fingerprint that still passes visual sanity checks.
  (() => {
    const SEED = Math.random();
    const noise = () => (SEED * 0.01) % 1;  // tiny, stable per-session

    const _toDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
      const ctx2d = this.getContext('2d');
      if (ctx2d && this.width > 0 && this.height > 0) {
        const imgData = ctx2d.getImageData(0, 0, this.width, this.height);
        for (let i = 0; i < imgData.data.length; i += 4) {
          imgData.data[i]     = Math.min(255, imgData.data[i]     + noise());
          imgData.data[i + 1] = Math.min(255, imgData.data[i + 1] + noise());
        }
        ctx2d.putImageData(imgData, 0, 0);
      }
      return _toDataURL.apply(this, arguments);
    };

    const _getImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h) {
      const data = _getImageData.apply(this, arguments);
      for (let i = 0; i < data.data.length; i += 4) {
        data.data[i]     = Math.min(255, data.data[i]     + noise());
        data.data[i + 1] = Math.min(255, data.data[i + 1] + noise());
      }
      return data;
    };
  })();

  // ── 8. AudioContext fingerprint ───────────────────────────────────────────
  (() => {
    const _orig = window.AudioContext || window.webkitAudioContext;
    if (!_orig) return;
    const AudioCtx = _orig;
    const _createOscillator = AudioCtx.prototype.createOscillator;
    AudioCtx.prototype.createOscillator = function () {
      const node = _createOscillator.call(this);
      const _connect = node.connect.bind(node);
      node.connect = function (dest, ...args) {
        // Slightly detune to change audio fingerprint
        if (node.detune) node.detune.value = (Math.random() - 0.5) * 0.01;
        return _connect(dest, ...args);
      };
      return node;
    };
  })();

  // ── 9. Screen properties ──────────────────────────────────────────────────
  const screenProps = {
    width:       ${fp.screenWidth},
    height:      ${fp.screenHeight},
    availWidth:  ${fp.availWidth},
    availHeight: ${fp.availHeight},
    colorDepth:  ${fp.colorDepth},
    pixelDepth:  ${fp.pixelDepth},
  };
  for (const [key, value] of Object.entries(screenProps)) {
    try {
      Object.defineProperty(screen, key, { get: () => value, configurable: true });
    } catch (_) {}
  }

  // ── 10. Object.getOwnPropertyDescriptor trap ──────────────────────────────
  // Some detectors call this to inspect navigator.webdriver directly.
  const _origGetOPD = Object.getOwnPropertyDescriptor;
  Object.getOwnPropertyDescriptor = function (obj, prop) {
    if (obj === navigator && prop === 'webdriver') return undefined;
    return _origGetOPD.apply(this, arguments);
  };

  // ── 11. navigator.connection ──────────────────────────────────────────────
  if (!navigator.connection) {
    Object.defineProperty(navigator, 'connection', {
      get: () => ({
        downlink: 10,
        effectiveType: '4g',
        rtt: 50,
        saveData: false,
        onchange: null,
      }),
      configurable: true,
    });
  }

  // ── 12. Notification.permission ───────────────────────────────────────────
  // Real browsers return 'default' until user decides. Headless returns 'denied'.
  try {
    Object.defineProperty(Notification, 'permission', {
      get: () => 'default',
      configurable: true,
    });
  } catch (_) {}

})();
`.trim();
}
