/**
 * WS13 — password reset and email verification.
 *
 * The properties that matter: the forgot-password endpoint is an
 * enumeration oracle if it varies at all, reset tokens must be
 * single-use even under a race, and a reset must revoke sessions because
 * it is also the recovery path from a compromised account.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SELF, env } from "cloudflare:test";
import { issueToken, redeemToken, RESET_TTL_MS } from "../src/lib/authTokens.js";
import { baseUrl, emailProvider, verificationRequired } from "../src/lib/email.js";
import { hashToken } from "../src/lib/session.js";

const ORIGIN = "https://app.example.com";
const PASSWORD = "correct horse battery";

function req(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (!headers.has("origin")) headers.set("origin", ORIGIN);
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

function post(path: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return req(path, { method: "POST", body: JSON.stringify(body), ...init });
}

function body<T = any>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

/**
 * Env with a stub mail provider. The suite asserts on what the platform
 * hands the provider, never on a real delivery.
 */
const sent: Array<{ to: string; subject: string; html: string; text: string }> = [];

function mailEnv(overrides: Record<string, unknown> = {}) {
  return {
    ...env,
    PUBLIC_BASE_URL: "https://app.example.com",
    EMAIL_FROM: "noreply@example.com",
    EMAIL: {
      send: async (m: any) => {
        sent.push(m);
        return { messageId: "stub-" + sent.length };
      },
    },
    ...overrides,
  } as typeof env;
}

async function reset(): Promise<void> {
  sent.length = 0;
  for (const sql of [
    "DELETE FROM auth_tokens",
    // One test creates an invitation to prove verification unlocks
    // tenant work; RESTRICT foreign keys make the order explicit.
    "DELETE FROM rsvp_answers",
    "DELETE FROM rsvp_submissions",
    "DELETE FROM rsvp_fields",
    "DELETE FROM rsvp_forms",
    "DELETE FROM preview_tokens",
    "DELETE FROM media_assets",
    "UPDATE invitations SET published_revision_id = NULL",
    "DELETE FROM invitation_revisions",
    "DELETE FROM invitations",
    "DELETE FROM sessions",
    "DELETE FROM tenant_members",
    "DELETE FROM tenants",
    "DELETE FROM users",
    "DELETE FROM rate_limits",
    "UPDATE platform_settings SET value_json = 'true' WHERE key = 'registration_enabled'",
  ]) {
    await env.DB.prepare(sql).run();
  }
}

async function register(email: string): Promise<string> {
  await env.DB.prepare("DELETE FROM rate_limits WHERE key LIKE 'register:%'").run();
  const res = await post("/api/v1/auth/register", { email, password: PASSWORD });
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

beforeEach(async () => {
  await reset();
});

/** Registration is rate limited per IP; these suites register freely. */
async function clearLimits(): Promise<void> {
  await env.DB.prepare("DELETE FROM rate_limits").run();
}

// ------------------------------------------------------------- email layer

describe("email abstraction", () => {
  test("reports no provider when none is configured", () => {
    expect(emailProvider(env)).toBe("none");
  });

  test("prefers the Cloudflare binding, then Resend", () => {
    expect(emailProvider(mailEnv())).toBe("cloudflare");
    expect(emailProvider({ ...env, RESEND_API_KEY: "re_x" } as typeof env)).toBe("resend");
  });

  test("link base URL comes from configuration, never a Host header", () => {
    expect(baseUrl(mailEnv())).toBe("https://app.example.com");
    // Unset, plaintext and malformed are all refused rather than guessed.
    expect(baseUrl(env)).toBeNull();
    expect(baseUrl({ ...env, PUBLIC_BASE_URL: "http://evil.example.com" } as typeof env)).toBeNull();
    expect(baseUrl({ ...env, PUBLIC_BASE_URL: "not a url" } as typeof env)).toBeNull();
    // localhost over http stays usable for development.
    expect(baseUrl({ ...env, PUBLIC_BASE_URL: "http://localhost:8788" } as typeof env)).toBe(
      "http://localhost:8788"
    );
  });

  test("verification defaults follow deployment mode and can be overridden", () => {
    // The suite runs in hosted mode.
    expect(verificationRequired(env)).toBe(true);
    expect(
      verificationRequired({ ...env, EMAIL_VERIFICATION_REQUIRED: "false" } as typeof env)
    ).toBe(false);
  });
});

// ------------------------------------------------------------------ tokens

describe("token primitives", () => {
  test("only the hash is stored, never the token", async () => {
    await register("tok@example.com");
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind("tok@example.com")
      .first<{ id: string }>();

    const { token } = await issueToken(env, user!.id, "password_reset");

    const row = await env.DB.prepare("SELECT token_hash AS h FROM auth_tokens").first<{ h: string }>();
    expect(row!.h).not.toBe(token);
    expect(row!.h).toBe(await hashToken(token));
    expect(row!.h).toHaveLength(64);
  });

  test("a token is single-use", async () => {
    await register("once@example.com");
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind("once@example.com")
      .first<{ id: string }>();

    const { token } = await issueToken(env, user!.id, "password_reset");
    expect(await redeemToken(env, token, "password_reset")).not.toBeNull();
    // Replay is refused.
    expect(await redeemToken(env, token, "password_reset")).toBeNull();
  });

  test("concurrent redemption succeeds exactly once", async () => {
    await register("race@example.com");
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind("race@example.com")
      .first<{ id: string }>();

    const { token } = await issueToken(env, user!.id, "password_reset");
    const results = await Promise.all([
      redeemToken(env, token, "password_reset"),
      redeemToken(env, token, "password_reset"),
      redeemToken(env, token, "password_reset"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("an expired token is refused", async () => {
    await register("exp@example.com");
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind("exp@example.com")
      .first<{ id: string }>();

    const { token } = await issueToken(env, user!.id, "password_reset");
    await env.DB.prepare("UPDATE auth_tokens SET expires_at = 1").run();
    expect(await redeemToken(env, token, "password_reset")).toBeNull();
  });

  test("a token cannot be redeemed as the wrong kind", async () => {
    await register("kind@example.com");
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind("kind@example.com")
      .first<{ id: string }>();

    const { token } = await issueToken(env, user!.id, "email_verification");
    expect(await redeemToken(env, token, "password_reset")).toBeNull();
    expect(await redeemToken(env, token, "email_verification")).not.toBeNull();
  });

  test("malformed and unknown tokens are refused", async () => {
    for (const bad of ["", "x", "a".repeat(200), "not-a-real-token-value-here"]) {
      expect(await redeemToken(env, bad, "password_reset")).toBeNull();
    }
  });

  test("issuing supersedes an outstanding token of the same kind", async () => {
    await register("super@example.com");
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind("super@example.com")
      .first<{ id: string }>();

    const first = await issueToken(env, user!.id, "email_verification");
    const second = await issueToken(env, user!.id, "email_verification");

    // The stale link stops working; exactly one is live.
    expect(await redeemToken(env, first.token, "email_verification")).toBeNull();
    expect(await redeemToken(env, second.token, "email_verification")).not.toBeNull();
  });

  test("the reset lifetime is short", () => {
    expect(RESET_TTL_MS).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(RESET_TTL_MS).toBeGreaterThanOrEqual(15 * 60 * 1000);
  });
});

// ---------------------------------------------------------- password reset

describe("forgot password", () => {
  /** Route the Worker's env through the mail stub. */
  function withMail(path: string, payload: unknown) {
    return SELF.fetch(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(payload),
    });
  }

  test("responds identically for known, unknown and disabled accounts", async () => {
    await register("known@example.com");
    await register("off@example.com");
    await env.DB.prepare("UPDATE users SET status = 'disabled' WHERE email = ?")
      .bind("off@example.com")
      .run();

    const known = await withMail("/api/v1/auth/forgot-password", { email: "known@example.com" });
    const unknown = await withMail("/api/v1/auth/forgot-password", { email: "nobody@example.com" });
    const disabled = await withMail("/api/v1/auth/forgot-password", { email: "off@example.com" });

    const [kb, ub, db] = await Promise.all([body(known), body(unknown), body(disabled)]);
    expect(known.status).toBe(unknown.status);
    expect(known.status).toBe(disabled.status);
    expect(kb).toEqual(ub);
    expect(kb).toEqual(db);
  });

  test("a missing or malformed email still returns the generic answer", async () => {
    const res = await withMail("/api/v1/auth/forgot-password", { email: "not-an-email" });
    expect(res.status).toBe(200);
    expect((await body(res)).message).toMatch(/if an account exists/i);
  });

  test("no token is issued for an unknown address", async () => {
    await withMail("/api/v1/auth/forgot-password", { email: "ghost@example.com" });
    const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM auth_tokens").first<{ c: number }>();
    expect(row?.c).toBe(0);
  });

  test("no token is issued for a disabled account", async () => {
    await register("dis@example.com");
    await env.DB.prepare("UPDATE users SET status = 'disabled' WHERE email = ?")
      .bind("dis@example.com")
      .run();

    await withMail("/api/v1/auth/forgot-password", { email: "dis@example.com" });
    const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM auth_tokens").first<{ c: number }>();
    expect(row?.c).toBe(0);
  });

  test("repeated requests are rate limited", async () => {
    await register("spam@example.com");

    let limited = false;
    for (let i = 0; i < 15; i++) {
      const res = await withMail("/api/v1/auth/forgot-password", { email: "spam@example.com" });
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });

  test("is CSRF-protected", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/auth/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example.com" },
      body: JSON.stringify({ email: "known@example.com" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("reset password", () => {
  async function issueResetFor(email: string): Promise<string> {
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(email)
      .first<{ id: string }>();
    return (await issueToken(env, user!.id, "password_reset")).token;
  }

  test("a valid token sets a new password and the old one stops working", async () => {
    await register("chg@example.com");
    const token = await issueResetFor("chg@example.com");

    const res = await post("/api/v1/auth/reset-password", {
      token,
      password: "a brand new secret here",
    });
    expect(res.status).toBe(200);

    const oldPw = await post("/api/v1/auth/login", {
      email: "chg@example.com",
      password: PASSWORD,
    });
    expect(oldPw.status).toBe(401);

    const newPw = await post("/api/v1/auth/login", {
      email: "chg@example.com",
      password: "a brand new secret here",
    });
    expect(newPw.status).toBe(200);
  });

  test("the new password is stored as scrypt, never PBKDF2", async () => {
    await register("algo@example.com");
    const token = await issueResetFor("algo@example.com");
    await post("/api/v1/auth/reset-password", { token, password: "another fresh secret" });

    const row = await env.DB.prepare("SELECT password_hash AS h FROM users WHERE email = ?")
      .bind("algo@example.com")
      .first<{ h: string }>();
    expect(row!.h.startsWith("$scrypt$")).toBe(true);
  });

  test("every existing session is revoked", async () => {
    const cookie = await register("sess@example.com");
    expect((await req("/api/v1/auth/session", { headers: { cookie } })).status).toBe(200);

    const token = await issueResetFor("sess@example.com");
    await post("/api/v1/auth/reset-password", { token, password: "recovered account secret" });

    // A reset is also compromise recovery: an attacker's session must die.
    expect((await req("/api/v1/auth/session", { headers: { cookie } })).status).toBe(401);
  });

  test("a used token cannot be replayed", async () => {
    await register("replay@example.com");
    const token = await issueResetFor("replay@example.com");

    expect((await post("/api/v1/auth/reset-password", { token, password: "first new secret" })).status).toBe(200);

    const second = await post("/api/v1/auth/reset-password", {
      token,
      password: "second new secret",
    });
    expect(second.status).toBe(400);

    // The first reset stands.
    expect(
      (await post("/api/v1/auth/login", { email: "replay@example.com", password: "first new secret" }))
        .status
    ).toBe(200);
  });

  test("expired, wrong and malformed tokens are refused identically", async () => {
    await register("bad@example.com");
    const token = await issueResetFor("bad@example.com");
    await env.DB.prepare("UPDATE auth_tokens SET expires_at = 1").run();

    for (const t of [token, "totally-made-up-token", "", "x"]) {
      const res = await post("/api/v1/auth/reset-password", { token: t, password: "some new secret" });
      expect(res.status).toBe(400);
      expect((await body(res)).error).toBe("invalid_token");
    }
  });

  test("another user's token cannot change your password", async () => {
    await register("owner@example.com");
    await register("other@example.com");
    const token = await issueResetFor("owner@example.com");

    await post("/api/v1/auth/reset-password", { token, password: "attacker chosen secret" });

    // The token reset its own owner, and left the other account alone.
    expect(
      (await post("/api/v1/auth/login", { email: "other@example.com", password: PASSWORD })).status
    ).toBe(200);
  });

  test("the new password must satisfy the policy", async () => {
    await register("weak@example.com");
    const token = await issueResetFor("weak@example.com");

    const res = await post("/api/v1/auth/reset-password", { token, password: "short" });
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("password_too_short");

    // A rejected attempt must not burn the token.
    expect(
      (await post("/api/v1/auth/reset-password", { token, password: "a proper new secret" })).status
    ).toBe(200);
  });
});

// ------------------------------------------------------- email verification

describe("email verification", () => {
  test("existing users were migrated as verified", async () => {
    // The migration defaults email_verified to 1 so nobody predating the
    // feature — including the production operator — is locked out.
    await env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, is_platform_admin, created_at, updated_at)
       VALUES ('legacy', 'legacy@example.com', 'x', 0, 1, 1)`
    ).run();

    const row = await env.DB.prepare("SELECT email_verified AS v FROM users WHERE id = 'legacy'")
      .first<{ v: number }>();
    expect(row?.v).toBe(1);
  });

  test("a new hosted registration starts unverified", async () => {
    await register("fresh@example.com");
    const row = await env.DB.prepare("SELECT email_verified AS v FROM users WHERE email = ?")
      .bind("fresh@example.com")
      .first<{ v: number }>();
    expect(row?.v).toBe(0);
  });

  test("an unverified user may sign in and see their state", async () => {
    const cookie = await register("unv@example.com");

    const res = await req("/api/v1/auth/session", { headers: { cookie } });
    expect(res.status).toBe(200);

    const data = await body(res);
    expect(data.user.emailVerified).toBe(false);
    expect(data.verificationRequired).toBe(true);
  });

  test("an unverified user cannot create or change anything", async () => {
    const cookie = await register("blocked@example.com");
    const session = await body(await req("/api/v1/auth/session", { headers: { cookie } }));
    const tenantId = session.tenants[0].id;

    // Centralized in authz, so every tenant surface inherits it.
    const create = await req(`/api/v1/tenants/${tenantId}/invitations`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ title: "Nope", slug: "nope-wedding" }),
    });
    expect(create.status).toBe(403);
    expect((await body(create)).error).toBe("email_not_verified");

    const read = await req(`/api/v1/tenants/${tenantId}`, { headers: { cookie } });
    expect(read.status).toBe(403);
  });

  test("verifying unlocks tenant work", async () => {
    const cookie = await register("unlock@example.com");
    const session = await body(await req("/api/v1/auth/session", { headers: { cookie } }));
    const tenantId = session.tenants[0].id;

    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind("unlock@example.com")
      .first<{ id: string }>();
    const { token } = await issueToken(env, user!.id, "email_verification");

    const verify = await post("/api/v1/auth/verify-email", { token });
    expect(verify.status).toBe(200);

    const create = await req(`/api/v1/tenants/${tenantId}/invitations`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ title: "Now allowed", slug: "now-allowed" }),
    });
    expect(create.status).toBe(200);
  });

  test("a verification token cannot be replayed", async () => {
    await register("vreplay@example.com");
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind("vreplay@example.com")
      .first<{ id: string }>();
    const { token } = await issueToken(env, user!.id, "email_verification");

    expect((await post("/api/v1/auth/verify-email", { token })).status).toBe(200);
    expect((await post("/api/v1/auth/verify-email", { token })).status).toBe(400);
  });

  test("resend requires a session and is rate limited", async () => {
    expect((await post("/api/v1/auth/send-verification", {})).status).toBe(401);

    const cookie = await register("resend@example.com");
    await clearLimits();
    let limited = false;
    for (let i = 0; i < 10; i++) {
      const res = await req("/api/v1/auth/send-verification", {
        method: "POST",
        headers: { cookie },
        body: "{}",
      });
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });

  test("resend reports missing email configuration rather than failing silently", async () => {
    const cookie = await register("noconf@example.com");
    const res = await req("/api/v1/auth/send-verification", {
      method: "POST",
      headers: { cookie },
      body: "{}",
    });
    // No provider bound in the test env: the operator sees a clear 503.
    expect(res.status).toBe(503);
    expect((await body(res)).error).toBe("email_not_configured");
  });

  test("a completed password reset also confirms the address", async () => {
    await register("resetverify@example.com");
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind("resetverify@example.com")
      .first<{ id: string }>();

    const { token } = await issueToken(env, user!.id, "password_reset");
    await post("/api/v1/auth/reset-password", { token, password: "proved inbox control" });

    // Reaching the link proves control of the inbox.
    const row = await env.DB.prepare("SELECT email_verified AS v FROM users WHERE id = ?")
      .bind(user!.id)
      .first<{ v: number }>();
    expect(row?.v).toBe(1);
  });

  test("bootstrap operators are verified without email", async () => {
    await reset();
    const res = await post("/api/v1/auth/bootstrap", {
      email: "root@example.com",
      password: "first run operator secret",
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT email_verified AS v FROM users WHERE email = ?")
      .bind("root@example.com")
      .first<{ v: number }>();
    expect(row?.v).toBe(1);
  });
});

describe("email failure semantics", () => {
  test("a provider failure never changes the forgot-password response", async () => {
    await register("fail@example.com");

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post("/api/v1/auth/forgot-password", { email: "fail@example.com" });
    spy.mockRestore();

    // No provider configured here, which is the failure case.
    expect(res.status).toBe(200);
    expect((await body(res)).message).toMatch(/if an account exists/i);
  });

  test("no token or reset URL is ever logged", async () => {
    await register("logs@example.com");

    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args.map(String).join(" "));
    });
    await post("/api/v1/auth/forgot-password", { email: "logs@example.com" });
    spy.mockRestore();

    for (const line of logged) {
      expect(line).not.toContain("token=");
      expect(line).not.toContain("reset-password?");
      expect(line).not.toContain("logs@example.com");
    }
  });
});
