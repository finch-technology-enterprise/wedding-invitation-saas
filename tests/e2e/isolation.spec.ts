/**
 * Public bundle isolation.
 *
 * The admin is a React SPA; the invitation is plain ES modules. Nothing
 * from the admin stack may load on a guest's page — not React, not the
 * router, not the query or table libraries, not the uploader.
 *
 * This is asserted at the network level rather than trusted to
 * convention, because the failure mode (a stray import pulling 880 kB of
 * admin bundle into the invitation) is silent and expensive.
 */
import { expect, test } from "@playwright/test";

const FORBIDDEN_PATH = /\/admin\//;

/** Fingerprints of the admin stack, checked against every fetched script. */
const FORBIDDEN_SOURCE = [
  "react-dom",
  "@tanstack/react-query",
  "react-router",
  "@mantine",
  "@dnd-kit",
  "@tabler/icons",
];

test.describe("public bundle isolation", () => {
  test("the invitation requests no admin bundle and stays within its request budget", async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      // Ignore the font CDN: it is a deliberate, pre-existing dependency
      // of the frozen theme and not part of the app's own budget.
      if (url.host.startsWith("127.0.0.1")) requested.push(url.pathname);
    });

    await page.goto("/i/demo", { waitUntil: "networkidle" });

    expect(requested.filter((p) => FORBIDDEN_PATH.test(p))).toEqual([]);
    expect(requested.filter((p) => p.includes("platform-admin"))).toEqual([]);

    // The frozen baseline is 15 requests. Growth here means the public
    // page has quietly acquired a new dependency.
    expect(requested.length).toBeLessThanOrEqual(15);
  });

  test("no admin framework code is present in any public script", async ({ page }) => {
    const scripts: string[] = [];

    page.on("response", async (r) => {
      const url = new URL(r.url());
      if (!url.host.startsWith("127.0.0.1")) return;
      if (!url.pathname.endsWith(".js")) return;
      try {
        scripts.push(await r.text());
      } catch {
        /* body already consumed or unavailable */
      }
    });

    await page.goto("/i/demo", { waitUntil: "networkidle" });
    expect(scripts.length).toBeGreaterThan(0);

    const combined = scripts.join("\n");
    for (const marker of FORBIDDEN_SOURCE) {
      expect(combined).not.toContain(marker);
    }
  });

  test("the invitation loads exactly one module entry point, from the theme", async ({ page }) => {
    await page.goto("/i/demo", { waitUntil: "domcontentloaded" });

    const sources = await page.$$eval("script[src]", (nodes) =>
      nodes.map((n) => (n as HTMLScriptElement).getAttribute("src"))
    );

    expect(sources).toEqual(["/themes/cinematic-classic/js/main.js"]);
  });

  test("configuration is inlined, so there is no config request before render", async ({ page }) => {
    const apiCalls: string[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (url.pathname.startsWith("/api/")) apiCalls.push(url.pathname);
    });

    await page.goto("/i/demo", { waitUntil: "networkidle" });

    // The theme has its data before it runs; nothing is fetched to render.
    expect(apiCalls).toEqual([]);
    const inlined = await page.evaluate(() => Boolean((window as any).__INVITATION__));
    expect(inlined).toBe(true);
  });
});
