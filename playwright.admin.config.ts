import { defineConfig, devices } from "@playwright/test";

const PORT = 8788;

/**
 * Admin browser suite.
 *
 * Separate from the frozen invitation config because it needs the real
 * Worker: sessions, D1 and R2 are the point. `wrangler dev` hot-reloads on
 * file changes, which is why the frozen visual suite deliberately uses a
 * static server instead — but here that trade is worth it.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /admin\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "admin", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
  webServer: {
    // The admin bundle must exist before the Worker can serve it.
    command: `npm run build:admin && npx wrangler dev --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
