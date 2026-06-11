// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  outputDir: './test-results/artifacts',
  fullyParallel: true,
  retries: 0,
  globalTimeout: 20 * 60 * 1000, // hard ceiling: never hang the machine
  timeout: 20 * 1000,
  workers: 4,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/html-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    actionTimeout: 10 * 1000,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'node tests/serve.js',
    url: 'http://127.0.0.1:4173/www/index.html',
    reuseExistingServer: true,
    timeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Pixel 7'] }, // mobile-first app; primary target is Android WebView (Chromium)
      testIgnore: /visual/, // visual spec sets its own viewports; mobile emulation + forced wide viewports is invalid
    },
    {
      name: 'webkit',
      use: { ...devices['iPhone 13'] },
      testIgnore: /visual/,
    },
    // Desktop chromium for the responsive/visual specs that set their own viewports
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /visual|a11y/,
    },
  ],
});
