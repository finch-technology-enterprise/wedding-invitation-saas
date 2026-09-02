import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    setupFiles: ["./tests/setup.ts"],
    // Worker/API tests only. Browser specs under tests/e2e are driven by
    // Playwright (`npm run test:e2e`) and must not run in the Workers pool.
    include: ["tests/*.test.ts"],
  },
});
