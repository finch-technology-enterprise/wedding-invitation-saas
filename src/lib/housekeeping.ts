/**
 * Housekeeping / retention (V2 §1.6).
 *
 * Deterministic, batch-bounded, retry-safe. Invoked from the scheduled
 * handler and from the manual platform endpoint. Never touches
 * invitations, revisions, media, RSVPs or guests.
 */

import { newId } from "./ids.js";
import { nowMs } from "./time.js";

export interface RetentionRule {
  kind: string;
  deleted: number;
}

const BATCH = 200;

async function deleteBatched(
  env: Env,
  sql: string,
  params: unknown[],
  limit = BATCH
): Promise<number> {
  // D1 has no DELETE ... LIMIT; select ids then delete by IN.
  const ids = await env.DB.prepare(sql)
    .bind(...params)
    .all<{ id?: string; key?: string }>();
  const keys = ids.results.map((r) => r.id ?? r.key).filter(Boolean) as string[];
  if (!keys.length) return 0;
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const placeholders = chunk.map(() => "?").join(", ");
    const table = sql.includes("rate_limits") ? "rate_limits" : sql.match(/FROM (\w+)/)?.[1];
    const col = sql.includes("rate_limits") ? "key" : "id";
    if (!table) continue;
    const res = await env.DB.prepare(`DELETE FROM ${table} WHERE ${col} IN (${placeholders})`)
      .bind(...chunk)
      .run();
    deleted += res.meta.changes ?? 0;
  }
  return deleted;
}

export async function purgeExpiredSessions(env: Env, olderThanMs = 30 * 24 * 3600 * 1000): Promise<number> {
  const cutoff = nowMs() - olderThanMs;
  return deleteBatched(
    env,
    `SELECT id FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?) LIMIT ${BATCH}`,
    [cutoff, cutoff]
  );
}

export async function purgeRateLimits(env: Env, olderThanMs = 24 * 3600 * 1000): Promise<number> {
  const cutoff = nowMs() - olderThanMs;
  return deleteBatched(env, `SELECT key FROM rate_limits WHERE window_start < ? LIMIT ${BATCH}`, [cutoff]);
}

export async function purgeAuthTokens(env: Env, olderThanMs = 7 * 24 * 3600 * 1000): Promise<number> {
  const cutoff = nowMs() - olderThanMs;
  return deleteBatched(
    env,
    `SELECT id FROM auth_tokens WHERE (used_at IS NOT NULL AND used_at < ?) OR expires_at < ? LIMIT ${BATCH}`,
    [cutoff, cutoff]
  );
}

export async function purgePreviewTokens(env: Env, olderThanMs = 7 * 24 * 3600 * 1000): Promise<number> {
  const cutoff = nowMs() - olderThanMs;
  return deleteBatched(env, `SELECT id FROM preview_tokens WHERE expires_at < ? LIMIT ${BATCH}`, [cutoff]);
}

export async function purgeAuditEvents(env: Env, olderThanMs = 365 * 24 * 3600 * 1000): Promise<number> {
  const cutoff = nowMs() - olderThanMs;
  return deleteBatched(env, `SELECT id FROM platform_audit_events WHERE created_at < ? LIMIT ${BATCH}`, [cutoff]);
}

export async function runHousekeeping(
  env: Env,
  opts: { auditRetentionMs?: number } = {}
): Promise<RetentionRule[]> {
  const out: RetentionRule[] = [];
  out.push({ kind: "sessions", deleted: await purgeExpiredSessions(env) });
  out.push({ kind: "rate_limits", deleted: await purgeRateLimits(env) });
  out.push({ kind: "auth_tokens", deleted: await purgeAuthTokens(env) });
  out.push({ kind: "preview_tokens", deleted: await purgePreviewTokens(env) });
  out.push({ kind: "audit_events", deleted: await purgeAuditEvents(env, opts.auditRetentionMs) });
  return out;
}

export async function recordHousekeepingRun(
  env: Env,
  kind: string,
  deleted: number,
  ok: boolean,
  error?: string
): Promise<void> {
  const now = nowMs();
  try {
    await env.DB.prepare(
      `INSERT INTO housekeeping_runs (id, kind, started_at, finished_at, deleted, ok, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(newId(), kind, now, now, deleted, ok ? 1 : 0, error?.slice(0, 500) ?? null)
      .run();
  } catch {
    /* housekeeping must never fail the request that triggered it */
  }
}
