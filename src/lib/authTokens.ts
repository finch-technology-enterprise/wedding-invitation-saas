/**
 * Single-use tokens for password reset and email verification.
 *
 * The raw token exists only in the email. D1 stores its SHA-256, so a
 * database leak cannot be turned into working reset links — the same
 * reasoning as sessions and preview tokens.
 */

import { newId, newToken } from "./ids.js";
import { hashToken } from "./session.js";
import { nowMs } from "./time.js";

export type TokenKind = "password_reset" | "email_verification";

/**
 * Lifetimes.
 *
 * Reset is 45 minutes: long enough to find the email and act, short
 * enough that a link sitting in an unattended inbox stops being useful.
 * Verification is 24 hours because it is not a credential-recovery path
 * and a longer window costs far less.
 */
export const RESET_TTL_MS = 45 * 60 * 1000;
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export function ttlFor(kind: TokenKind): number {
  return kind === "password_reset" ? RESET_TTL_MS : VERIFICATION_TTL_MS;
}

/**
 * Mint a token, superseding any outstanding one of the same kind.
 *
 * Superseding matters: without it, "resend" would leave several live
 * links, and revoking one would not revoke the rest.
 */
export async function issueToken(
  env: Env,
  userId: string,
  kind: TokenKind
): Promise<{ token: string; expiresAt: number }> {
  const token = newToken(32);
  const now = nowMs();
  const expiresAt = now + ttlFor(kind);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_tokens WHERE user_id = ? AND kind = ? AND used_at IS NULL")
      .bind(userId, kind),
    env.DB.prepare(
      `INSERT INTO auth_tokens (id, user_id, kind, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(newId(), userId, kind, await hashToken(token), expiresAt, now),
  ]);

  return { token, expiresAt };
}

export interface RedeemedToken {
  userId: string;
  email: string;
  status: string;
}

/**
 * Redeem a token atomically.
 *
 * The UPDATE ... WHERE used_at IS NULL is the whole concurrency story: two
 * simultaneous redemptions race on the same row and exactly one reports a
 * change, so a token cannot be replayed even under a deliberate race.
 */
export async function redeemToken(
  env: Env,
  rawToken: string,
  kind: TokenKind
): Promise<RedeemedToken | null> {
  if (typeof rawToken !== "string" || rawToken.length < 16 || rawToken.length > 128) {
    return null;
  }

  const hash = await hashToken(rawToken);
  const now = nowMs();

  const row = await env.DB.prepare(
    `SELECT t.id, t.user_id AS userId, u.email, u.status
     FROM auth_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.kind = ? AND t.used_at IS NULL AND t.expires_at > ?`
  )
    .bind(hash, kind, now)
    .first<{ id: string; userId: string; email: string; status: string }>();

  if (!row) return null;

  const claimed = await env.DB.prepare(
    "UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL"
  )
    .bind(now, row.id)
    .run();

  // Lost the race: another request redeemed it first.
  if (!claimed.meta.changes) return null;

  return { userId: row.userId, email: row.email, status: row.status };
}

/** Drop a user's outstanding tokens — used after a completed reset. */
export async function revokeTokens(env: Env, userId: string, kind: TokenKind): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM auth_tokens WHERE user_id = ? AND kind = ? AND used_at IS NULL"
  )
    .bind(userId, kind)
    .run();
}
