import { defineConfig, devices } from "@playwright/test";

const PORT = 8789;

export default defineConfig({
  testDir: "./tests/e2e",
  // The admin suite needs a real Worker (sessions, D1, R2) and has its own
  // config; this one runs against the static fixture server.
  testIgnore: /admin\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // Font rasterisation differs slightly between machines and OS
      // versions. Allow small per-pixel drift and a modest overall
      // budget so baselines catch layout regressions, not antialiasing.
      maxDiffPixelRatio: 0.03,
      threshold: 0.25,
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  // Chromium with iPhone metrics. The device presets default to WebKit,
  // which would require a separate browser download; the assertions here
  // are about layout, geometry and behaviour rather than engine quirks.
  projects: [
    { name: "375", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: "390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: "430", use: { ...devices["Desktop Chrome"], viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
  // A plain static server rather than `wrangler dev`: wrangler watches the
  // filesystem and hot-reloads, dropping connections partway through a long
  // run. The Worker's own behaviour is covered by the Vitest suite.
  webServer: {
    command: `node tests/e2e/server.mjs`,
    env: { PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
