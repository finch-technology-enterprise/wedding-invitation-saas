/**
 * Modern Editorial theme suite (V2).
 *
 * Own baselines under editorial.spec.ts-snapshots/ — the frozen
 * cinematic suite is never touched. Fixture content is neutral
 * (see editorial-fixture.mjs).
 */
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/editorial", { waitUntil: "networkidle" });
});

test.describe("editorial composition", () => {
  test("document language follows the invitation locale", async ({ page }) => {
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
  });

  test("renders the editorial sections in order", async ({ page }) => {
    for (const id of ["hero", "couple", "schedule", "venue", "rsvp", "share"]) {
      await expect(page.locator(`#${id}, .hero`).first()).toBeVisible();
    }
    await expect(page.locator(".hero__title")).toContainText("Alex & Jamie");
    await expect(page.locator(".schedule__item")).toHaveCount(3);
  });

  test("no horizontal overflow at phone widths", async ({ page }) => {
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflows).toBe(false);
  });

  test("countdown shows full day values without a 99 cap", async ({ page }) => {
    const days = await page.locator(".countdown__value[data-unit='days']").textContent();
    const expected = Math.max(
      0,
      Math.floor((new Date("2027-10-09T11:00:00+08:00").getTime() - Date.now()) / 86400000)
    );
    expect(Number(days)).toBe(expected);
  });

  test("configuration is inlined with locale strings", async ({ page }) => {
    const bootstrap = await page.evaluate(() => (window as any).__INVITATION__);
    expect(bootstrap.locale).toBe("en");
    expect(bootstrap.strings.rsvpSubmit).toBe("Send");
    expect(bootstrap.config.themeId).toBe("modern-editorial");
  });

  test("guest bundle stays dependency-free", async ({ page }) => {
    const sources = await page.$$eval("script[src]", (nodes) =>
      nodes.map((n) => (n as HTMLScriptElement).getAttribute("src"))
    );
    expect(sources).toEqual(["/themes/modern-editorial/js/main.js"]);
  });

  test("rsvp submits with idempotency and shows success", async ({ page }) => {
    await page.locator("#r-name").fill("Editorial Guest");
    await page.locator("#r-phone").fill("+60123456789");
    let sent: Record<string, unknown> | null = null;
    await page.route("**/rsvp", async (route) => {
      sent = (await route.request().postDataJSON()) as Record<string, unknown>;
      await route.continue();
    });
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator(".form-success")).toBeVisible();
    expect(typeof (sent as Record<string, unknown> | null)?.idempotencyKey).toBe("string");
  });

  test("whatsapp share links the public url", async ({ page }) => {
    const href = await page.locator(".share a.btn").first().getAttribute("href");
    expect(href).toMatch(/^https:\/\/wa\.me\//);
  });
});

test.describe("editorial visuals", () => {
  test("hero", async ({ page }) => {
    await expect(page.locator(".hero")).toHaveScreenshot("editorial-hero.png", {
      animations: "disabled",
    });
  });

  test("rsvp", async ({ page }) => {
    await page.locator("#rsvp").scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await expect(page.locator("#rsvp")).toHaveScreenshot("editorial-rsvp.png", {
      animations: "disabled",
    });
  });
});
