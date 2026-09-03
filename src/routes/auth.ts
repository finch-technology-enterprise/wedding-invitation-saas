/**
 * Authentication routes: /api/v1/auth/*
 *
 * Hosted mode allows open registration (each signup gets its own tenant).
 * Self-hosted mode allows exactly one bootstrap claim — the first person
 * to reach the instance becomes the platform admin — and then closes
 * registration, so a public self-hosted URL cannot be farmed for accounts.
 */

import { Hono } from "hono";
import { fail, ok } from "../lib/respond.js";
import { newId } from "../lib/ids.js";
import { nowMs } from "../lib/time.js";
import { deploymentMode } from "../lib/mode.js";
import { dummyVerify, hashPassword, passwordProblem, verifyPassword } from "../lib/password.js";
import {
  clearedCookieHeader,
  cookieName,
  createSession,
  readCookie,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  sessionCookieHeader,
  hashToken,
} from "../lib/session.js";
import { clearRateLimit, clientIpHash, isSameOrigin, rateLimit } from "../lib/guard.js";

export const auth = new Hono<{ Bindings: Env }>();

const LOGIN_LIMIT = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const REGISTER_LIMIT = 5;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;

/** RFC-pragmatic: reject the obviously invalid without pretending to
 * fully validate email syntax, which is a known dead end. */
function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null;
  return email;
}

function displayNameOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name) return null;
  return name.slice(0, 80);
}

/** Tenant slugs are public-ish; derive from email local part, then
 * disambiguate with random suffix rather than a guessable counter. */
function tenantSlugFrom(email: string): string {
  const base = email.split("@")[0]!.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const stem = (base || "tenant").slice(0, 24);
  return `${stem}-${newId().slice(0, 8)}`;
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function registrationOpen(env: Env): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT value_json AS v FROM platform_settings WHERE key = 'registration_enabled'"
  ).first<{ v: string }>();
  return row?.v === "true";
}

async function userCount(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM users").first<{ c: number }>();
  return row?.c ?? 0;
}

/**
 * Create user + tenant + membership in one D1 batch. Batches are atomic,
 * so a failure cannot leave a user without a tenant (which would be an
 * account that can log in but owns nothing).
 */
async function createUserWithTenant(
  env: Env,
  input: { email: string; password: string; displayName: string | null; isPlatformAdmin: boolean }
): Promise<{ userId: string; tenantId: string }> {
  const userId = newId();
  const tenantId = newId();
  const now = nowMs();
  const passwordHash = await hashPassword(input.password, env);
  const planId = deploymentMode(env) === "hosted" ? "plan_hosted_free" : "plan_self_hosted";
  const tenantName = input.displayName ?? input.email.split("@")[0]!;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, is_platform_admin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(userId, input.email, passwordHash, input.displayName, input.isPlatformAdmin ? 1 : 0, now, now),
    env.DB.prepare(
      `INSERT INTO tenants (id, name, slug, plan_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(tenantId, tenantName, tenantSlugFrom(input.email), planId, now, now),
    env.DB.prepare(
      `INSERT INTO tenant_members (tenant_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`
    ).bind(tenantId, userId, now),
  ]);

  return { userId, tenantId };
}

function publicUser(ctx: { user: { id: string; email: string; displayName: string | null; isPlatformAdmin: boolean } }) {
  return {
    id: ctx.user.id,
    email: ctx.user.email,
    displayName: ctx.user.displayName,
    isPlatformAdmin: ctx.user.isPlatformAdmin,
  };
}

// ------------------------------------------------------------------ status

/**
 * Lets the admin shell decide what to render before any credentials
 * exist. Deliberately leaks nothing beyond whether setup is still needed.
 */
auth.get("/status", async (c) => {
  const env = c.env;
  const mode = deploymentMode(env);
  const users = await userCount(env);
  return ok({
    mode,
    needsBootstrap: users === 0,
    registrationOpen: mode === "hosted" ? await registrationOpen(env) : users === 0,
  });
});

// --------------------------------------------------------------- bootstrap

/**
 * Self-hosted first-run claim. Only succeeds while the instance has zero
 * users, so it is safe to expose unauthenticated: the race is won once,
 * and the UNIQUE constraint on email settles concurrent attempts.
 */
auth.post("/bootstrap", async (c) => {
  const env = c.env;
  if (!isSameOrigin(c.req.raw)) return fail("csrf", 403);

  if (await userCount(env)) return fail("already_bootstrapped", 409);

  const body = await readJson(c);
  if (!body) return fail("invalid_body");

  const email = normalizeEmail(body.email);
  if (!email) return fail("invalid_email");

  const pwProblem = passwordProblem(body.password);
  if (pwProblem) return fail(pwProblem);

  let created: { userId: string };
  try {
    created = await createUserWithTenant(env, {
      email,
      password: body.password as string,
      displayName: displayNameOf(body.displayName),
      isPlatformAdmin: true,
    });
  } catch {
    // Lost the race with a concurrent bootstrap.
    return fail("already_bootstrapped", 409);
  }

  // Self-hosted instances close registration after the owner claims them.
  if (deploymentMode(env) === "self_hosted") {
    await env.DB.prepare(
      "INSERT INTO platform_settings (key, value_json) VALUES ('registration_enabled', 'false') " +
        "ON CONFLICT (key) DO UPDATE SET value_json = 'false'"
    ).run();
  }

  const session = await createSession(env, created.userId, {
    ipHash: await clientIpHash(c.req.raw),
    userAgent: c.req.header("user-agent") ?? null,
  });

  const res = ok({ userId: created.userId });
  res.headers.set("set-cookie", sessionCookieHeader(c.req.raw, session.token));
  return res;
});

// ---------------------------------------------------------------- register

auth.post("/register", async (c) => {
  const env = c.env;
  if (!isSameOrigin(c.req.raw)) return fail("csrf", 403);

  // Self-hosted deployments do not run an open signup surface.
  if (deploymentMode(env) !== "hosted") {
    return (await userCount(env)) === 0
      ? fail("use_bootstrap", 409)
      : fail("registration_closed", 403);
  }
  if (!(await registrationOpen(env))) return fail("registration_closed", 403);

  const ipHash = await clientIpHash(c.req.raw);
  const limit = await rateLimit(env, `register:${ipHash}`, REGISTER_LIMIT, REGISTER_WINDOW_MS);
  if (!limit.allowed) {
    return fail("rate_limited", 429, { retryAfter: limit.retryAfterSec });
  }

  const body = await readJson(c);
  if (!body) return fail("invalid_body");

  const email = normalizeEmail(body.email);
  if (!email) return fail("invalid_email");

  const pwProblem = passwordProblem(body.password);
  if (pwProblem) return fail(pwProblem);

  try {
    const created = await createUserWithTenant(env, {
      email,
      password: body.password as string,
      displayName: displayNameOf(body.displayName),
      isPlatformAdmin: false,
    });

    const session = await createSession(env, created.userId, {
      ipHash,
      userAgent: c.req.header("user-agent") ?? null,
    });
    const res = ok({ userId: created.userId });
    res.headers.set("set-cookie", sessionCookieHeader(c.req.raw, session.token));
    return res;
  } catch (err) {
    // Duplicate email must not confirm that the address is registered.
    if (String(err).includes("UNIQUE")) return fail("registration_failed", 409);
    throw err;
  }
});

// ------------------------------------------------------------------- login

auth.post("/login", async (c) => {
  const env = c.env;
  if (!isSameOrigin(c.req.raw)) return fail("csrf", 403);

  const body = await readJson(c);
  if (!body) return fail("invalid_body");

  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  const ipHash = await clientIpHash(c.req.raw);
  const ipKey = `login:ip:${ipHash}`;
  const ipLimit = await rateLimit(env, ipKey, LOGIN_LIMIT * 3, LOGIN_WINDOW_MS);
  if (!ipLimit.allowed) return fail("rate_limited", 429, { retryAfter: ipLimit.retryAfterSec });

  // Per-account bucket too, so one attacker cannot spread a password-spray
  // across many IPs against a single known account.
  let accountKey: string | null = null;
  if (email) {
    accountKey = `login:acct:${await hashToken(email)}`;
    const acctLimit = await rateLimit(env, accountKey, LOGIN_LIMIT, LOGIN_WINDOW_MS);
    if (!acctLimit.allowed) {
      return fail("rate_limited", 429, { retryAfter: acctLimit.retryAfterSec });
    }
  }

  if (!email || !password) {
    await dummyVerify(env);
    return fail("invalid_credentials", 401);
  }

  const row = await env.DB.prepare(
    "SELECT id, password_hash AS passwordHash, status FROM users WHERE email = ?"
  )
    .bind(email)
    .first<{ id: string; passwordHash: string; status: string }>();

  if (!row) {
    // Same work as a real verification: no timing oracle for "user exists".
    await dummyVerify(env);
    return fail("invalid_credentials", 401);
  }

  const valid = await verifyPassword(password, row.passwordHash);
  // A disabled account is reported exactly like a wrong password, so the
  // response cannot be used to enumerate suspended users.
  if (!valid || row.status !== "active") return fail("invalid_credentials", 401);

  await clearRateLimit(env, ipKey);
  if (accountKey) await clearRateLimit(env, accountKey);

  const session = await createSession(env, row.id, {
    ipHash,
    userAgent: c.req.header("user-agent") ?? null,
  });
  const res = ok({ userId: row.id });
  res.headers.set("set-cookie", sessionCookieHeader(c.req.raw, session.token));
  return res;
});

// ------------------------------------------------------------------ logout

auth.post("/logout", async (c) => {
  const env = c.env;
  if (!isSameOrigin(c.req.raw)) return fail("csrf", 403);

  const token = readCookie(c.req.raw, cookieName(c.req.raw));
  if (token) await revokeSession(env, await hashToken(token));

  // Always clear the cookie, even if the session was already gone.
  const res = ok({});
  res.headers.set("set-cookie", clearedCookieHeader(c.req.raw));
  return res;
});

auth.post("/logout-all", async (c) => {
  const env = c.env;
  if (!isSameOrigin(c.req.raw)) return fail("csrf", 403);

  const ctx = await resolveSession(c.req.raw, env);
  if (!ctx) return fail("unauthorized", 401);

  await revokeAllSessions(env, ctx.user.id);
  const res = ok({});
  res.headers.set("set-cookie", clearedCookieHeader(c.req.raw));
  return res;
});

// ------------------------------------------------------------------ whoami

auth.get("/session", async (c) => {
  const ctx = await resolveSession(c.req.raw, c.env);
  if (!ctx) return fail("unauthorized", 401);

  const memberships = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.slug, t.status, m.role
     FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = ? ORDER BY t.created_at`
  )
    .bind(ctx.user.id)
    .all<{ id: string; name: string; slug: string; status: string; role: string }>();

  return ok({ user: publicUser(ctx), tenants: memberships.results });
});

/** Change password, then drop every other session (classic hijack recovery). */
auth.post("/password", async (c) => {
  const env = c.env;
  if (!isSameOrigin(c.req.raw)) return fail("csrf", 403);

  const ctx = await resolveSession(c.req.raw, env);
  if (!ctx) return fail("unauthorized", 401);

  const body = await readJson(c);
  if (!body) return fail("invalid_body");

  const problem = passwordProblem(body.newPassword);
  if (problem) return fail(problem);

  const row = await env.DB.prepare("SELECT password_hash AS h FROM users WHERE id = ?")
    .bind(ctx.user.id)
    .first<{ h: string }>();
  if (!row) return fail("unauthorized", 401);

  const currentOk =
    typeof body.currentPassword === "string" &&
    (await verifyPassword(body.currentPassword, row.h));
  if (!currentOk) return fail("invalid_credentials", 401);

  const hash = await hashPassword(body.newPassword as string, env);
  await env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .bind(hash, nowMs(), ctx.user.id)
    .run();

  await revokeAllSessions(env, ctx.user.id);
  const session = await createSession(env, ctx.user.id, {
    ipHash: await clientIpHash(c.req.raw),
    userAgent: c.req.header("user-agent") ?? null,
  });
  const res = ok({});
  res.headers.set("set-cookie", sessionCookieHeader(c.req.raw, session.token));
  return res;
});
