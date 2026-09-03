/**
 * Admin browser tests.
 *
 * These run against a real `wrangler dev` Worker with local D1 and R2, so
 * sessions, cookies, uploads and publishing are exercised end to end
 * rather than mocked. The static fixture server used by the frozen visual
 * suite cannot do that.
 */
import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.ADMIN_BASE_URL || "http://127.0.0.1:8788";

/** Unique per run so repeated local runs do not collide in D1. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const PASSWORD = "correct horse battery";

async function signUp(page: Page): Promise<{ email: string }> {
  const email = `${unique("user")}@example.com`;

  await page.goto(`${BASE}/admin`);

  // A pristine instance shows first-run setup; once a user exists it
  // shows sign-in, and creating an account needs the explicit switch.
  const heading = page.getByRole("heading", {
    name: /sign in|create account|set up this instance/i,
  });
  await expect(heading).toBeVisible();

  if (/sign in/i.test((await heading.textContent()) ?? "")) {
    await page.getByRole("button", { name: "Create one" }).click();
  }

  await page.getByLabel("Email").fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: /^(create account|create administrator)$/i }).click();

  // The account menu carries the email once the session resolves.
  await expect(page.getByRole("button", { name: email, exact: false })).toBeVisible({
    timeout: 15_000,
  });
  return { email };
}

/**
 * Set the ceremony date.
 *
 * The Mantine picker is a popover whose value cannot be typed, so the
 * date is written through the canonical hidden ISO input the panel
 * exposes. What is under test here is that a valid date reaches the
 * server, not the third-party calendar's own interaction model.
 */
async function setCeremonyDate(page: Page, iso = "2027-10-09T11:00:00+08:00"): Promise<void> {
  await page.locator('[data-testid="ceremony-iso"]').evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, iso);

  await expect(page.locator('[data-testid="ceremony-iso"]')).toHaveValue(iso);
}

async function createInvitation(page: Page): Promise<{ slug: string; title: string }> {
  const slug = unique("wedding");
  const title = `Test ${slug}`;

  await page.getByRole("link", { name: "New invitation" }).first().click();
  await page.getByLabel("Name").fill(title);
  await page.getByLabel("Public link").fill(slug);
  await page.getByRole("button", { name: "Create invitation" }).click();

  await expect(page.getByRole("tab", { name: "Content" })).toBeVisible({ timeout: 15_000 });
  return { slug, title };
}

test.describe.configure({ mode: "serial" });

/**
 * Registration is rate-limited per IP, which is correct in production but
 * throttles a suite that creates a fresh account per test. The bucket is
 * cleared against the local database rather than raising the limit, so
 * the protection under test stays exactly as it ships.
 */
test.beforeEach(async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "invite",
      "--local",
      "--command",
      "DELETE FROM rate_limits",
    ],
    { cwd: process.cwd() }
  ).catch(() => {
    /* a missing local DB is not a test failure here */
  });
});

test.describe("admin", () => {
  test("an unauthenticated visitor gets the sign-in screen, not the console", async ({ page }) => {
    await page.goto(`${BASE}/admin`);

    await expect(page.getByRole("heading", { name: /sign in|set up this instance/i })).toBeVisible();
    // No session, so no workspace chrome.
    await expect(page.getByRole("link", { name: "Invitations" })).toHaveCount(0);
  });

  test("a deep link survives a reload", async ({ page }) => {
    await signUp(page);
    await createInvitation(page);

    const url = page.url();
    await page.reload();
    // Client routing is real routing: the path is served the same shell.
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("tab", { name: "Content" })).toBeVisible();
  });

  test("sign out ends the session", async ({ page }) => {
    const { email } = await signUp(page);

    await page.getByRole("button", { name: email, exact: false }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();

    // Back to the unauthenticated screen: the workspace chrome is gone.
    await expect(page.getByRole("link", { name: "Invitations" })).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();

    // The cookie is gone, so a reload cannot resurrect the console.
    await page.reload();
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Invitations" })).toHaveCount(0);
  });

  test("a draft saves, and over-limit content is rejected with a field error", async ({ page }) => {
    await signUp(page);
    await createInvitation(page);

    await page.getByRole("tab", { name: "Content" }).click();

    await page.getByLabel("Partner 1 — name").fill("李天豪");
    await page.getByLabel("Partner 2 — name").fill("刘蔼蕴");
    // The theme requires a ceremony date; without it the draft is
    // legitimately invalid and the server refuses it.
    await setCeremonyDate(page);

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved")).toBeVisible({ timeout: 10_000 });

    // The counter warns before the server is consulted...
    await page.getByLabel("Partner 1 — name").fill("李".repeat(40));
    await expect(page.getByText(/40 \/ 24/)).toBeVisible();
    // ...and the field is marked invalid.
    await expect(page.getByText(/Too long/i).first()).toBeVisible();
  });

  test("publishing makes the invitation public and unpublishing withdraws it", async ({
    page,
    request,
  }) => {
    await signUp(page);
    const { slug } = await createInvitation(page);

    await page.getByRole("tab", { name: "Content" }).click();
    await page.getByLabel("Partner 1 — name").fill("A");
    await page.getByLabel("Partner 2 — name").fill("B");

    await setCeremonyDate(page);

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved")).toBeVisible({ timeout: 10_000 });

    // Not published yet.
    expect((await request.get(`${BASE}/i/${slug}`)).status()).toBe(404);

    await page.getByRole("tab", { name: "Publish" }).click();
    await page.getByRole("button", { name: /^Publish invitation$/ }).click();
    await expect(page.getByText("Invitation published")).toBeVisible({ timeout: 10_000 });

    const live = await request.get(`${BASE}/i/${slug}`);
    expect(live.status()).toBe(200);
    expect(await live.text()).toContain("window.__INVITATION__=");

    await page.getByRole("button", { name: "Unpublish" }).click();
    // Destructive actions are confirmed; the dialog owns the second button.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Unpublish" }).click();

    await expect(async () => {
      expect((await request.get(`${BASE}/i/${slug}`)).status()).toBe(404);
    }).toPass({ timeout: 10_000 });
  });

  test("a draft edit does not reach guests until published", async ({ page, request }) => {
    await signUp(page);
    const { slug } = await createInvitation(page);

    await page.getByRole("tab", { name: "Content" }).click();
    await page.getByLabel("Partner 1 — name").fill("Original");
    await page.getByLabel("Partner 2 — name").fill("Names");
    await setCeremonyDate(page);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("tab", { name: "Publish" }).click();
    await page.getByRole("button", { name: /^Publish invitation$/ }).click();
    await expect(page.getByText("Invitation published")).toBeVisible({ timeout: 10_000 });

    // Edit and save, but do NOT publish.
    await page.getByRole("tab", { name: "Content" }).click();
    await page.getByLabel("Partner 1 — name").fill("Changed");
    await page.getByRole("button", { name: "Save draft" }).click();
    // The save is complete when the button returns to its disabled
    // (nothing-to-save) state; a toast from the earlier save may still
    // be on screen, so it is not a reliable signal here.
    await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled({
      timeout: 10_000,
    });

    const html = await (await request.get(`${BASE}/i/${slug}`)).text();
    expect(html).toContain("Original");
    expect(html).not.toContain("Changed");
  });

  test("unsaved changes are confirmed before navigating away", async ({ page }) => {
    await signUp(page);
    await createInvitation(page);

    await page.getByRole("tab", { name: "Content" }).click();
    await page.getByLabel("Partner 1 — name").fill("Unsaved");

    await expect(page.getByText("Unsaved changes")).toBeVisible();

    await page.getByRole("link", { name: "Invitations" }).first().click();
    await expect(page.getByRole("heading", { name: "Discard unsaved changes?" })).toBeVisible();

    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(page.getByLabel("Partner 1 — name")).toHaveValue("Unsaved");
  });

  test("a foreign invitation id is not reachable", async ({ page }) => {
    await signUp(page);

    // A well-formed but foreign UUID must look exactly like a missing one.
    await page.goto(`${BASE}/admin/invitations/00000000-0000-4000-8000-000000000000/content`);
    await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("the reply form builder adds a question and enforces the theme cap", async ({ page }) => {
    await signUp(page);
    await createInvitation(page);

    await page.getByRole("tab", { name: "RSVP" }).click();
    await expect(page.getByRole("heading", { name: "Reply form" })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "Add question" }).click();
    await page.getByRole("menuitem", { name: "Short text" }).click();

    await expect(page.getByText("1 / 6 extra questions")).toBeVisible();

    await page.getByRole("button", { name: "Save reply form" }).click();
    await expect(page.getByText("Reply form saved")).toBeVisible({ timeout: 10_000 });
  });
});
