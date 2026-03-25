/**
 * Browser fingerprint profiles.
 * Each profile defines a consistent set of properties that together
 * look like a real user's browser environment.
 */

export const profiles = {
  'chrome-win': {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    platform: 'Win32',
    vendor: 'Google Inc.',
    vendorSub: '',
    productSub: '20030107',
    appVersion:
      '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // WebGL
    webglVendor: 'Google Inc. (Intel)',
    webglRenderer:
      'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    // Screen
    screenWidth: 1920,
    screenHeight: 1080,
    availWidth: 1920,
    availHeight: 1040,
    colorDepth: 24,
    pixelDepth: 24,
    deviceScaleFactor: 1,
    // Navigator
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    languages: ['en-US', 'en'],
    // Timezone
    timezone: 'America/New_York',
    // Fonts present on Windows
    fonts: [
      'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Comic Sans MS',
      'Courier New', 'Georgia', 'Impact', 'Segoe UI', 'Tahoma',
      'Times New Roman', 'Trebuchet MS', 'Verdana',
    ],
    // Chrome version info for window.chrome
    chromeVersion: '120',
    // Accepted encodings / languages for HTTP headers
    acceptLanguage: 'en-US,en;q=0.9',
  },

  'chrome-mac': {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    vendor: 'Google Inc.',
    vendorSub: '',
    productSub: '20030107',
    appVersion:
      '5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // WebGL - Apple M1 Mac
    webglVendor: 'Apple',
    webglRenderer: 'Apple M1 Pro',
    // Screen - MacBook Pro 16"
    screenWidth: 1728,
    screenHeight: 1117,
    availWidth: 1728,
    availHeight: 1057,
    colorDepth: 30,
    pixelDepth: 30,
    deviceScaleFactor: 2,
    // Navigator
    hardwareConcurrency: 10,
    deviceMemory: 16,
    maxTouchPoints: 0,
    languages: ['en-US', 'en'],
    // Timezone
    timezone: 'America/Los_Angeles',
    // Fonts present on macOS
    fonts: [
      'Arial', 'Courier New', 'Georgia', 'Helvetica', 'Helvetica Neue',
      'Impact', 'Lucida Grande', 'Monaco', 'Times New Roman', 'Trebuchet MS',
      'Verdana',
    ],
    chromeVersion: '120',
    acceptLanguage: 'en-US,en;q=0.9',
  },

  'chrome-linux': {
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    platform: 'Linux x86_64',
    vendor: 'Google Inc.',
    vendorSub: '',
    productSub: '20030107',
    appVersion:
      '5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer:
      'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER/PCIe/SSE2, OpenGL 4.5.0)',
    screenWidth: 1920,
    screenHeight: 1080,
    availWidth: 1920,
    availHeight: 1053,
    colorDepth: 24,
    pixelDepth: 24,
    deviceScaleFactor: 1,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    languages: ['en-US', 'en'],
    timezone: 'America/Chicago',
    fonts: [
      'Arial', 'Courier New', 'DejaVu Sans', 'DejaVu Sans Mono',
      'Georgia', 'Liberation Mono', 'Liberation Sans', 'Times New Roman',
      'Ubuntu', 'Verdana',
    ],
    chromeVersion: '120',
    acceptLanguage: 'en-US,en;q=0.9',
  },
};

export const defaultProfile = 'chrome-win';
