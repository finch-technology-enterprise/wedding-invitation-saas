/**
 * Opaque server-side sessions.
 *
 * The cookie holds a random 256-bit token and nothing else — no JWT, no
 * signed claims. Revocation therefore works instantly (delete/revoke the
 * row) rather than waiting for a token to expire, which is a hard
 * requirement for "disable user" and "log out everywhere".
 *
 * Only the SHA-256 of the token is stored. A leaked database dump cannot
 * be replayed as a set of live sessions.
 */

import { newToken } from "./ids.js";
import { nowMs } from "./time.js";

/**
 * `__Host-` prefix: the browser refuses to accept the cookie unless it is
 * Secure, path=/, and has no Domain attribute. That makes it impossible
 * for a subdomain to overwrite the session cookie of the apex host.
 */
export const SESSION_COOKIE = "__Host-session";

/** Local dev is plain http://localhost, where `__Host-` (Secure) is refused. */
const DEV_COOKIE = "session";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_RENEW_AFTER_MS = 24 * 60 * 60 * 1000; // slide at most daily

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
  isPlatformAdmin: boolean;
  status: string;
}

export interface AuthContext {
  sessionId: string;
  user: SessionUser;
}

function isSecureRequest(req: Request): boolean {
  return new URL(req.url).protocol === "https:";
}

export function cookieName(req: Request): string {
  return isSecureRequest(req) ? SESSION_COOKIE : DEV_COOKIE;
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function buildCookie(req: Request, value: string, maxAgeSec: number): string {
  const secure = isSecureRequest(req);
  const attrs = [
    `${cookieName(req)}=${value}`,
    "Path=/",
    "HttpOnly",
    // Lax (not Strict) so following a shared link into /admin keeps the
    // session; combined with the Origin check it still blocks CSRF, since
    // Lax does not send the cookie on cross-site POST.
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export interface CreatedSession {
  id: string;
  token: string;
  expiresAt: number;
}

export async function createSession(
  env: Env,
  userId: string,
  meta: { ipHash?: string | null; userAgent?: string | null } = {}
): Promise<CreatedSession> {
  const token = newToken(32);
  const id = await hashToken(token);
  const now = nowMs();
  const expiresAt = now + SESSION_TTL_MS;

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, created_ip_hash, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, userId, now, expiresAt, meta.ipHash ?? null, (meta.userAgent ?? "").slice(0, 256))
    .run();

  return { id, token, expiresAt };
}

export function sessionCookieHeader(req: Request, token: string): string {
  return buildCookie(req, token, Math.floor(SESSION_TTL_MS / 1000));
}

export function clearedCookieHeader(req: Request): string {
  return buildCookie(req, "", 0);
}

/**
 * Resolve the caller. Returns null for missing, unknown, expired, revoked
 * or disabled-user sessions — the caller cannot distinguish these, and
 * should not.
 */
export async function resolveSession(req: Request, env: Env): Promise<AuthContext | null> {
  const token = readCookie(req, cookieName(req));
  if (!token) return null;

  const id = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT s.id AS sid, s.expires_at AS expiresAt, s.revoked_at AS revokedAt,
            u.id AS uid, u.email, u.display_name AS displayName,
            u.is_platform_admin AS isPlatformAdmin, u.status
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`
  )
    .bind(id)
    .first<{
      sid: string;
      expiresAt: number;
      revokedAt: number | null;
      uid: string;
      email: string;
      displayName: string | null;
      isPlatformAdmin: number;
      status: string;
    }>();

  if (!row) return null;
  if (row.revokedAt !== null) return null;
  if (row.expiresAt <= nowMs()) return null;
  // A disabled user's existing sessions stop working immediately.
  if (row.status !== "active") return null;

  return {
    sessionId: row.sid,
    user: {
      id: row.uid,
      email: row.email,
      displayName: row.displayName,
      isPlatformAdmin: row.isPlatformAdmin === 1,
      status: row.status,
    },
  };
}

/**
 * Extend a session that is more than a day old. Sliding expiry keeps
 * active users logged in without making the token immortal.
 */
export async function maybeRenew(env: Env, sessionId: string): Promise<void> {
  const now = nowMs();
  await env.DB.prepare(
    `UPDATE sessions SET expires_at = ?
     WHERE id = ? AND expires_at < ?`
  )
    .bind(now + SESSION_TTL_MS, sessionId, now + SESSION_TTL_MS - SESSION_RENEW_AFTER_MS)
    .run();
}

export async function revokeSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(nowMs(), sessionId)
    .run();
}

/** Used by "log out everywhere" and by disabling a user. */
export async function revokeAllSessions(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL"
  )
    .bind(nowMs(), userId)
    .run();
}
