/**
 * Operator console browser tests.
 *
 * Runs against the real Worker so authorization, D1 and R2 are exercised
 * rather than mocked.
 */
import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.ADMIN_BASE_URL || "http://127.0.0.1:8788";
const PASSWORD = "correct horse battery";

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Registration is rate-limited per IP; clear the bucket rather than
 *  weakening the protection the suite is meant to preserve. */
test.beforeEach(async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)(
    "npx",
    ["wrangler", "d1", "execute", "invite", "--local", "--command", "DELETE FROM rate_limits"],
    { cwd: process.cwd() }
  ).catch(() => {
    /* a missing local DB is not a failure here */
  });
});

async function signUp(page: Page): Promise<string> {
  const email = `${unique("op")}@example.com`;

  await page.goto(`${BASE}/admin`);
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

  // Hosted mode requires a confirmed address before tenant work. These
  // suites test the console, not the verification gate, so the account
  // is marked verified exactly as a completed confirmation would —
  // verification itself is covered in tests/recovery.test.ts.
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
      `UPDATE users SET email_verified = 1 WHERE email = '${email}'`,
    ],
    { cwd: process.cwd() }
  );
  await page.reload();

  await expect(page.getByRole("button", { name: email, exact: false })).toBeVisible();


  return email;
}

/** Promote in the database, then re-read the session. */
async function promote(email: string): Promise<void> {
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
      `UPDATE users SET is_platform_admin = 1 WHERE email = '${email}'`,
    ],
    { cwd: process.cwd() }
  );
}

test.describe.configure({ mode: "serial" });

test.describe("platform admin", () => {
  test("an ordinary tenant user is refused the operator console", async ({ page }) => {
    await signUp(page);

    await page.goto(`${BASE}/platform-admin`);
    await expect(page.getByRole("heading", { name: "Not available" })).toBeVisible();
    // No operator navigation is rendered at all.
    await expect(page.getByRole("link", { name: "Cleanup" })).toHaveCount(0);
  });

  test("an operator sees the console and its inventories", async ({ page }) => {
    const email = await signUp(page);
    await promote(email);

    await page.goto(`${BASE}/platform-admin`);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

    // Operator navigation and the storage summary are both present.
    await expect(page.getByRole("link", { name: "Users" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Cleanup" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tracked storage" })).toBeVisible();
  });

  test("deep links into operator sections survive a reload", async ({ page }) => {
    const email = await signUp(page);
    await promote(email);

    await page.goto(`${BASE}/platform-admin/storage`);
    await expect(page.getByRole("heading", { name: "Storage" })).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/\/platform-admin\/storage$/);
    await expect(page.getByRole("heading", { name: "Storage" })).toBeVisible();
  });

  test("the invitation inventory and cleanup candidates render", async ({ page }) => {
    const email = await signUp(page);
    await promote(email);

    await page.goto(`${BASE}/platform-admin/invitations`);
    await expect(page.getByRole("heading", { name: "Invitations" })).toBeVisible();
    // The inventory renders with its operational columns.
    await expect(page.getByRole("columnheader", { name: "Storage" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Replies" })).toBeVisible();

    await page.goto(`${BASE}/platform-admin/cleanup`);
    await expect(page.getByRole("heading", { name: "Cleanup" })).toBeVisible();
    // The wording must not imply automatic expiry.
    await expect(page.getByText(/cleanup candidates/i)).toBeVisible();
    await expect(page.getByText(/stays until you deliberately delete it/i)).toBeVisible();
  });

  test("the orphan scanner is explicitly started, never automatic", async ({ page }) => {
    const email = await signUp(page);
    await promote(email);

    await page.goto(`${BASE}/platform-admin/cleanup`);
    await page.getByRole("tab", { name: "Storage orphans" }).click();

    await expect(page.getByRole("button", { name: "Start scan" })).toBeVisible();
    await expect(page.getByText(/only operation that enumerates storage/i)).toBeVisible();
  });

  test("the operator console loads no tenant-admin chunks", async ({ page }) => {
    const email = await signUp(page);
    await promote(email);

    const requested: string[] = [];
    page.on("request", (r) => requested.push(new URL(r.url()).pathname));

    await page.goto(`${BASE}/platform-admin`, { waitUntil: "networkidle" });

    // Separate build output: no /admin/ asset may be fetched here.
    expect(requested.filter((p) => p.startsWith("/admin/"))).toEqual([]);
  });
});
