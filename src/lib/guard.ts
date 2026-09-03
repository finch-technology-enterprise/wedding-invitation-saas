/**
 * Request-level defences shared by every mutating API route: CSRF origin
 * checking and D1-backed rate limiting.
 */

import { nowMs } from "./time.js";

/**
 * CSRF: SameSite=Lax already prevents the session cookie from riding along
 * on a cross-site POST in every browser we target. This origin check is the
 * defence-in-depth second layer, and it is what protects against the
 * same-site-but-untrusted case that SameSite does not cover.
 *
 * Checked against the request's own Host rather than a configured origin,
 * so self-hosters need no extra configuration to be protected.
 */
export function isSameOrigin(req: Request): boolean {
  const target = new URL(req.url);
  const origin = req.headers.get("origin");

  if (origin) {
    // "null" (sandboxed iframe, some file:// contexts) is never trusted.
    if (origin === "null") return false;
    try {
      return new URL(origin).host === target.host;
    } catch {
      return false;
    }
  }

  // No Origin header: fall back to Referer. Browsers always send Origin on
  // cross-origin POST, so a request with neither is not a browser form post.
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === target.host;
    } catch {
      return false;
    }
  }

  // Same-origin fetch()/XHR may omit both. Require an explicit marker so a
  // cross-site <form> (which cannot set custom headers) is still rejected.
  return req.headers.get("x-requested-with") === "fetch";
}

/** Hashed client IP — used for rate-limit keys and abuse records, never
 * stored raw, so RSVP/audit rows hold no plain personal network data. */
export async function clientIpHash(req: Request): Promise<string> {
  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Fixed-window counter in D1.
 *
 * A sliding window or token bucket would be smoother, but this is one
 * indexed upsert per attempt and needs no KV, Durable Object or Redis —
 * which the infrastructure decision explicitly rules out. At the expected
 * scale the extra precision buys nothing.
 */
export async function rateLimit(
  env: Env,
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = nowMs();

  // Reset the window in the same statement that increments, so two
  // concurrent requests cannot both observe a stale window and reset it.
  await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN excluded.window_start - rate_limits.window_start >= ?
                    THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN excluded.window_start - rate_limits.window_start >= ?
                          THEN excluded.window_start ELSE rate_limits.window_start END`
  )
    .bind(key, now, windowMs, windowMs)
    .run();

  const row = await env.DB.prepare(
    "SELECT count, window_start AS windowStart FROM rate_limits WHERE key = ?"
  )
    .bind(key)
    .first<{ count: number; windowStart: number }>();

  const count = row?.count ?? 1;
  const windowStart = row?.windowStart ?? now;
  const allowed = count <= limit;

  return {
    allowed,
    remaining: Math.max(0, limit - count),
    retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)),
  };
}

/** Clear a bucket after a success, so a legitimate login does not leave
 * the user throttled by their own earlier typos. */
export async function clearRateLimit(env: Env, key: string): Promise<void> {
  await env.DB.prepare("DELETE FROM rate_limits WHERE key = ?").bind(key).run();
}
