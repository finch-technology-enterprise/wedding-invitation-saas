/**
 * WS2 — authentication.
 *
 * Emphasis is on the negative cases: CSRF, enumeration, revocation,
 * disabled users, rate limiting and cookie hardening. A green happy path
 * proves very little about an auth system.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { SELF, env } from "cloudflare:test";
import { hashPassword, verifyPassword, verifyPasswordDetailed } from "../src/lib/password.js";

const ORIGIN = "https://app.example.com";
const PASSWORD = "correct horse battery";

function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }
  // Same-origin marker: mirrors what the admin fetch client sends.
  if (!headers.has("origin")) headers.set("origin", ORIGIN);
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

function post(path: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return api(path, { method: "POST", body: JSON.stringify(body), ...init });
}

async function body<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Extract the session cookie so later requests can present it. */
function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0] ?? "";
}

async function reset(): Promise<void> {
  // Order matters: RESTRICT foreign keys forbid orphaning.
  for (const sql of [
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

/** Hosted mode is the default for these tests; SELF uses the configured env. */
beforeEach(async () => {
  await reset();
});

async function register(email: string, password = PASSWORD): Promise<Response> {
  return post("/api/v1/auth/register", { email, password });
}

async function signedInCookie(email: string): Promise<string> {
  const res = await register(email);
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

describe("password hashing", () => {
  test("verifies a correct password and rejects a wrong one", async () => {
    const stored = await hashPassword(PASSWORD, env);
    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
    expect(await verifyPassword("wrong password here", stored)).toBe(false);
  });

  test("hashes are salted, so identical passwords differ on disk", async () => {
    const a = await hashPassword(PASSWORD, env);
    const b = await hashPassword(PASSWORD, env);
    expect(a).not.toBe(b);
  });

  test("the stored format records its algorithm and parameters", async () => {
    const stored = await hashPassword(PASSWORD, env);
    // PHC string format: $scrypt$ln=14,r=8,p=5$<salt>$<hash>
    expect(stored.startsWith("$scrypt$")).toBe(true);
    expect(stored).toContain("ln=14");
    expect(stored).toContain("r=8");
    expect(stored).toContain("p=5");
    expect(stored.split("$")).toHaveLength(5);
  });

  test("a malformed or truncated hash never verifies", async () => {
    for (const bad of ["", "x", "pbkdf2$sha256$1000$$", "pbkdf2$md5$1000$aaaa$bbbb"]) {
      expect(await verifyPassword(PASSWORD, bad)).toBe(false);
    }
  });
});

describe("registration", () => {
  test("creates a user, an owned tenant and a session in one step", async () => {
    const res = await register("owner@example.com");
    expect(res.status).toBe(200);

    const cookie = cookieFrom(res);
    expect(cookie).toBeTruthy();

    const session = await api("/api/v1/auth/session", { headers: { cookie } });
    expect(session.status).toBe(200);

    const data = await body<{
      user: { email: string; isPlatformAdmin: boolean };
      tenants: Array<{ role: string }>;
    }>(session);
    expect(data.user.email).toBe("owner@example.com");
    expect(data.user.isPlatformAdmin).toBe(false);
    expect(data.tenants).toHaveLength(1);
    expect(data.tenants[0]!.role).toBe("owner");
  });

  test("the session cookie is HttpOnly, SameSite=Lax and __Host- scoped", async () => {
    const res = await register("cookie@example.com");
    const raw = res.headers.get("set-cookie") ?? "";

    expect(raw).toContain("__Host-session=");
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("SameSite=Lax");
    expect(raw).toContain("Secure");
    expect(raw).toContain("Path=/");
    // __Host- forbids Domain; a subdomain must not be able to overwrite it.
    expect(raw.toLowerCase()).not.toContain("domain=");
  });

  test("the raw session token is never stored in the database", async () => {
    const res = await register("token@example.com");
    const token = cookieFrom(res).split("=")[1]!;

    const row = await env.DB.prepare("SELECT id FROM sessions").first<{ id: string }>();
    expect(row?.id).toBeTruthy();
    expect(row!.id).not.toBe(token);
    expect(row!.id).toHaveLength(64); // sha-256 hex
  });

  test("a duplicate email does not confirm the address is taken", async () => {
    await register("dupe@example.com");
    const res = await register("dupe@example.com");

    expect(res.status).toBe(409);
    const data = await body<{ error: string }>(res);
    // Deliberately not "email_taken".
    expect(data.error).toBe("registration_failed");
  });

  test("rejects weak or missing passwords", async () => {
    const short = await post("/api/v1/auth/register", { email: "a@example.com", password: "abc" });
    expect(short.status).toBe(400);
    expect((await body<{ error: string }>(short)).error).toBe("password_too_short");

    const missing = await post("/api/v1/auth/register", { email: "b@example.com" });
    expect((await body<{ error: string }>(missing)).error).toBe("password_required");
  });

  test("rejects malformed emails", async () => {
    for (const email of ["not-an-email", "a@b", "@example.com", ""]) {
      const res = await post("/api/v1/auth/register", { email, password: PASSWORD });
      expect(res.status).toBe(400);
    }
  });

  test("normalizes email case so Bob and bob are one account", async () => {
    await register("Mixed@Example.com");
    const dupe = await register("mixed@example.com");
    expect(dupe.status).toBe(409);
  });
});

describe("CSRF", () => {
  test("rejects a cross-origin POST even with a valid session", async () => {
    const cookie = await signedInCookie("csrf@example.com");

    const res = await SELF.fetch(`${ORIGIN}/api/v1/auth/logout`, {
      method: "POST",
      headers: { cookie, origin: "https://evil.example.com" },
    });

    expect(res.status).toBe(403);
    expect((await body<{ error: string }>(res)).error).toBe("csrf");
  });

  test("rejects a POST with no Origin, Referer or fetch marker", async () => {
    const cookie = await signedInCookie("noorigin@example.com");
    const res = await SELF.fetch(`${ORIGIN}/api/v1/auth/logout`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(403);
  });

  test("accepts a same-origin request identified only by Referer", async () => {
    const cookie = await signedInCookie("referer@example.com");
    const res = await SELF.fetch(`${ORIGIN}/api/v1/auth/logout`, {
      method: "POST",
      headers: { cookie, referer: `${ORIGIN}/admin` },
    });
    expect(res.status).toBe(200);
  });

  test("treats a null origin as hostile", async () => {
    const cookie = await signedInCookie("nullorigin@example.com");
    const res = await SELF.fetch(`${ORIGIN}/api/v1/auth/logout`, {
      method: "POST",
      headers: { cookie, origin: "null" },
    });
    expect(res.status).toBe(403);
  });
});

describe("login", () => {
  test("succeeds with correct credentials and issues a fresh session", async () => {
    await register("login@example.com");
    const res = await post("/api/v1/auth/login", {
      email: "login@example.com",
      password: PASSWORD,
    });

    expect(res.status).toBe(200);
    const session = await api("/api/v1/auth/session", { headers: { cookie: cookieFrom(res) } });
    expect(session.status).toBe(200);
  });

  test("a wrong password and an unknown account are indistinguishable", async () => {
    await register("real@example.com");

    const wrong = await post("/api/v1/auth/login", {
      email: "real@example.com",
      password: "definitely wrong password",
    });
    const unknown = await post("/api/v1/auth/login", {
      email: "ghost@example.com",
      password: "definitely wrong password",
    });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await body(wrong)).toEqual(await body(unknown));
  });

  test("a disabled user cannot log in, and is not told why", async () => {
    await register("disabled@example.com");
    await env.DB.prepare("UPDATE users SET status = 'disabled' WHERE email = ?")
      .bind("disabled@example.com")
      .run();

    const res = await post("/api/v1/auth/login", {
      email: "disabled@example.com",
      password: PASSWORD,
    });
    expect(res.status).toBe(401);
    expect((await body<{ error: string }>(res)).error).toBe("invalid_credentials");
  });

  test("rate limits repeated failures against one account", async () => {
    await register("brute@example.com");

    let limited = false;
    for (let i = 0; i < 12; i++) {
      const res = await post("/api/v1/auth/login", {
        email: "brute@example.com",
        password: `guess-${i}`,
      });
      if (res.status === 429) {
        limited = true;
        const data = await body<{ retryAfter: number }>(res);
        expect(data.retryAfter).toBeGreaterThan(0);
        break;
      }
    }
    expect(limited).toBe(true);
  });

  test("a successful login clears the failure counter", async () => {
    await register("recover@example.com");

    for (let i = 0; i < 3; i++) {
      await post("/api/v1/auth/login", { email: "recover@example.com", password: "nope" });
    }
    const good = await post("/api/v1/auth/login", {
      email: "recover@example.com",
      password: PASSWORD,
    });
    expect(good.status).toBe(200);

    // Only the login buckets are cleared; the registration bucket is a
    // separate abuse signal and must survive a login.
    const after = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM rate_limits WHERE key LIKE 'login:%'"
    ).first<{ c: number }>();
    expect(after?.c).toBe(0);
  });
});

describe("sessions", () => {
  test("an unauthenticated caller gets 401, not a redirect or 500", async () => {
    const res = await api("/api/v1/auth/session");
    expect(res.status).toBe(401);
  });

  test("a forged or random cookie is rejected", async () => {
    const res = await api("/api/v1/auth/session", {
      headers: { cookie: "__Host-session=totally-made-up-token" },
    });
    expect(res.status).toBe(401);
  });

  test("logout revokes the session immediately", async () => {
    const cookie = await signedInCookie("logout@example.com");

    expect((await api("/api/v1/auth/session", { headers: { cookie } })).status).toBe(200);

    const out = await api("/api/v1/auth/logout", { method: "POST", headers: { cookie } });
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");

    // The token is dead even though the client still holds it.
    expect((await api("/api/v1/auth/session", { headers: { cookie } })).status).toBe(401);
  });

  test("logout-all revokes every session for the user", async () => {
    await register("multi@example.com");
    const first = cookieFrom(
      await post("/api/v1/auth/login", { email: "multi@example.com", password: PASSWORD })
    );
    const second = cookieFrom(
      await post("/api/v1/auth/login", { email: "multi@example.com", password: PASSWORD })
    );

    await api("/api/v1/auth/logout-all", { method: "POST", headers: { cookie: second } });

    expect((await api("/api/v1/auth/session", { headers: { cookie: first } })).status).toBe(401);
    expect((await api("/api/v1/auth/session", { headers: { cookie: second } })).status).toBe(401);
  });

  test("disabling a user kills their live sessions without a logout", async () => {
    const cookie = await signedInCookie("kill@example.com");
    expect((await api("/api/v1/auth/session", { headers: { cookie } })).status).toBe(200);

    await env.DB.prepare("UPDATE users SET status = 'disabled' WHERE email = ?")
      .bind("kill@example.com")
      .run();

    expect((await api("/api/v1/auth/session", { headers: { cookie } })).status).toBe(401);
  });

  test("an expired session is refused", async () => {
    const cookie = await signedInCookie("expired@example.com");
    await env.DB.prepare("UPDATE sessions SET expires_at = 1").run();
    expect((await api("/api/v1/auth/session", { headers: { cookie } })).status).toBe(401);
  });
});

describe("password change", () => {
  test("requires the current password", async () => {
    const cookie = await signedInCookie("pw@example.com");
    const res = await api("/api/v1/auth/password", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ currentPassword: "wrong", newPassword: "a brand new secret" }),
    });
    expect(res.status).toBe(401);
  });

  test("changing the password revokes other sessions but keeps the caller in", async () => {
    await register("rotate@example.com");
    const other = cookieFrom(
      await post("/api/v1/auth/login", { email: "rotate@example.com", password: PASSWORD })
    );
    const mine = cookieFrom(
      await post("/api/v1/auth/login", { email: "rotate@example.com", password: PASSWORD })
    );

    const res = await api("/api/v1/auth/password", {
      method: "POST",
      headers: { cookie: mine },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "a brand new secret" }),
    });
    expect(res.status).toBe(200);

    // The stolen/other session is gone...
    expect((await api("/api/v1/auth/session", { headers: { cookie: other } })).status).toBe(401);
    // ...and the caller was re-issued a working cookie.
    const fresh = cookieFrom(res);
    expect((await api("/api/v1/auth/session", { headers: { cookie: fresh } })).status).toBe(200);

    const relogin = await post("/api/v1/auth/login", {
      email: "rotate@example.com",
      password: "a brand new secret",
    });
    expect(relogin.status).toBe(200);
  });
});

describe("bootstrap and status", () => {
  test("reports that a fresh instance needs bootstrapping", async () => {
    const res = await api("/api/v1/auth/status");
    const data = await body<{ needsBootstrap: boolean; mode: string }>(res);
    expect(data.needsBootstrap).toBe(true);
    expect(["hosted", "self_hosted"]).toContain(data.mode);
  });

  test("the first claim becomes platform admin, and cannot be repeated", async () => {
    const res = await post("/api/v1/auth/bootstrap", {
      email: "root@example.com",
      password: PASSWORD,
    });
    expect(res.status).toBe(200);

    const session = await api("/api/v1/auth/session", { headers: { cookie: cookieFrom(res) } });
    const data = await body<{ user: { isPlatformAdmin: boolean } }>(session);
    expect(data.user.isPlatformAdmin).toBe(true);

    const again = await post("/api/v1/auth/bootstrap", {
      email: "usurper@example.com",
      password: PASSWORD,
    });
    expect(again.status).toBe(409);
  });

  test("bootstrap is CSRF-protected like every other mutation", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/auth/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example.com" },
      body: JSON.stringify({ email: "root@example.com", password: PASSWORD }),
    });
    expect(res.status).toBe(403);
  });

  test("status stops advertising bootstrap once a user exists", async () => {
    await post("/api/v1/auth/bootstrap", { email: "root2@example.com", password: PASSWORD });
    const data = await body<{ needsBootstrap: boolean }>(await api("/api/v1/auth/status"));
    expect(data.needsBootstrap).toBe(false);
  });

  test("registration can be closed by the operator", async () => {
    await env.DB.prepare(
      "UPDATE platform_settings SET value_json = 'false' WHERE key = 'registration_enabled'"
    ).run();

    const res = await register("late@example.com");
    expect(res.status).toBe(403);
    expect((await body<{ error: string }>(res)).error).toBe("registration_closed");
  });
});

describe("algorithm migration", () => {
  /** The exact legacy format deployed users' hashes are stored in. */
  async function legacyPbkdf2Hash(password: string, iterations = 100_000): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      key,
      256
    );
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    return `pbkdf2$sha256$${iterations}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
  }

  test("an existing PBKDF2 hash still verifies", async () => {
    const legacy = await legacyPbkdf2Hash(PASSWORD);
    const result = await verifyPasswordDetailed(PASSWORD, legacy);
    expect(result.valid).toBe(true);
    expect(result.needsUpgrade).toBe(true);
  });

  test("a wrong password against a legacy hash is refused", async () => {
    const legacy = await legacyPbkdf2Hash(PASSWORD);
    expect((await verifyPasswordDetailed("wrong password here", legacy)).valid).toBe(false);
  });

  test("a current scrypt hash verifies and needs no upgrade", async () => {
    const stored = await hashPassword(PASSWORD, env);
    const result = await verifyPasswordDetailed(PASSWORD, stored);
    expect(result.valid).toBe(true);
    expect(result.needsUpgrade).toBe(false);
  });

  test("scrypt with weaker-than-policy parameters earns an upgrade", async () => {
    // Hand-built at ln=12, below the ln=14 policy.
    const { scryptSync } = await import("node:crypto");
    const { serialize } = await import("@phc/format");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = scryptSync(PASSWORD, Buffer.from(salt), 32, { N: 2 ** 12, r: 8, p: 1 });
    const weak = serialize({
      id: "scrypt",
      params: { ln: 12, r: 8, p: 1 },
      salt: Buffer.from(salt),
      hash,
    });

    const result = await verifyPasswordDetailed(PASSWORD, weak);
    expect(result.valid).toBe(true);
    expect(result.needsUpgrade).toBe(true);
  });

  test("a malformed or unsupported hash never authenticates", async () => {
    for (const bad of [
      "",
      "x",
      "not-a-phc-string",
      "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA",
      "$scrypt$ln=99,r=8,p=5$c2FsdA$aGFzaA",
      "pbkdf2$sha256$notanumber$aaaa$bbbb",
    ]) {
      const result = await verifyPasswordDetailed(PASSWORD, bad);
      expect(result.valid, bad).toBe(false);
    }
  });

  test("logging in with a legacy hash transparently upgrades it in place", async () => {
    await register("upgrade@example.com");

    // Rewrite the stored hash to the legacy format, as a pre-migration
    // production row would be.
    const legacy = await legacyPbkdf2Hash(PASSWORD);
    await env.DB.prepare("UPDATE users SET password_hash = ? WHERE email = ?")
      .bind(legacy, "upgrade@example.com")
      .run();

    const login = await post("/api/v1/auth/login", {
      email: "upgrade@example.com",
      password: PASSWORD,
    });
    expect(login.status).toBe(200);

    // The row now holds scrypt, without the user doing anything.
    const row = await env.DB.prepare("SELECT password_hash AS h FROM users WHERE email = ?")
      .bind("upgrade@example.com")
      .first<{ h: string }>();
    expect(row!.h.startsWith("$scrypt$")).toBe(true);

    // And the upgraded hash still accepts the same password.
    const again = await post("/api/v1/auth/login", {
      email: "upgrade@example.com",
      password: PASSWORD,
    });
    expect(again.status).toBe(200);
  });

  test("a failed login against a legacy hash does not rewrite it", async () => {
    await register("nowrite@example.com");
    const legacy = await legacyPbkdf2Hash(PASSWORD);
    await env.DB.prepare("UPDATE users SET password_hash = ? WHERE email = ?")
      .bind(legacy, "nowrite@example.com")
      .run();

    const bad = await post("/api/v1/auth/login", {
      email: "nowrite@example.com",
      password: "definitely the wrong one",
    });
    expect(bad.status).toBe(401);

    const row = await env.DB.prepare("SELECT password_hash AS h FROM users WHERE email = ?")
      .bind("nowrite@example.com")
      .first<{ h: string }>();
    expect(row!.h).toBe(legacy);
  });
});
