/**
 * Platform operator API: /api/v1/platform/*
 *
 * A separate authorization domain from the tenant API. Every route here
 * requires platform_admin, and no tenant handler contains an
 * `isPlatformAdmin ? bypass : normal` branch — operator power is
 * exercised through these explicit, audited paths only.
 *
 * Reporting reads D1 metadata. The storage pages never enumerate R2; only
 * the manual orphan scanner does, and only when an operator starts it.
 */

import { Hono } from "hono";
import { fail, ok } from "../lib/respond.js";
import { newId } from "../lib/ids.js";
import { nowMs } from "../lib/time.js";
import { deploymentMode } from "../lib/mode.js";
import { isSameOrigin } from "../lib/guard.js";
import { requirePlatformAdmin } from "../lib/authz.js";
import { revokeAllSessions } from "../lib/session.js";

export const platform = new Hono<{ Bindings: Env }>();

/** Every platform route is operator-only and same-origin for mutations. */
platform.use("/*", async (c, next) => {
  await requirePlatformAdmin(c.req.raw, c.env);
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && !isSameOrigin(c.req.raw)) {
    return fail("csrf", 403);
  }
  await next();
});

/**
 * Audit trail for operator actions.
 *
 * Deliberately records identifiers, counts and outcome — never invitation
 * copy or RSVP answers. An audit log that accumulates guests' personal
 * data is a liability, not a control.
 */
async function audit(
  env: Env,
  actorUserId: string,
  action: string,
  target: { type: string; id: string },
  meta: Record<string, unknown> | null,
  okFlag: boolean
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO platform_audit_events
       (id, actor_user_id, action, target_type, target_id, meta_json, ok, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      newId(),
      actorUserId,
      action,
      target.type,
      target.id,
      meta ? JSON.stringify(meta) : null,
      okFlag ? 1 : 0,
      nowMs()
    )
    .run();
}

export { audit };

function paging(c: { req: { query: (k: string) => string | undefined } }) {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 25) || 25, 1), 100);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  return { limit, offset };
}

// ------------------------------------------------------------------ overview

platform.get("/overview", async (c) => {
  const [totals, storage, statuses] = await c.env.DB.batch<any>([
    c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM tenants) AS tenants,
         (SELECT COUNT(*) FROM invitations) AS invitations,
         (SELECT COUNT(*) FROM invitations WHERE status = 'published') AS published,
         (SELECT COUNT(*) FROM rsvp_submissions) AS submissions,
         (SELECT COUNT(*) FROM media_assets) AS mediaAssets`
    ),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(byte_size), 0) AS totalBytes,
              COALESCE(SUM(CASE WHEN kind = 'image' THEN byte_size ELSE 0 END), 0) AS imageBytes,
              COALESCE(SUM(CASE WHEN kind = 'audio' THEN byte_size ELSE 0 END), 0) AS audioBytes
       FROM media_assets`
    ),
    c.env.DB.prepare("SELECT status, COUNT(*) AS count FROM invitations GROUP BY status"),
  ]);

  return ok({
    totals: totals.results[0],
    storage: storage.results[0],
    statusCounts: statuses.results,
  });
});

// --------------------------------------------------------------------- users

platform.get("/users", async (c) => {
  const { limit, offset } = paging(c);
  const status = c.req.query("status");
  const search = (c.req.query("q") ?? "").trim();

  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (status === "active" || status === "disabled") {
    where.push("u.status = ?");
    params.push(status);
  }
  if (search) {
    where.push("(u.email LIKE ? OR u.display_name LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const clause = where.join(" AND ");

  const [page, total] = await c.env.DB.batch<any>([
    c.env.DB.prepare(
      `SELECT u.id, u.email, u.display_name AS displayName, u.status,
              u.is_platform_admin AS isPlatformAdmin, u.created_at AS createdAt,
              (SELECT COUNT(*) FROM tenant_members m WHERE m.user_id = u.id) AS tenantCount,
              (SELECT COUNT(*) FROM invitations i
                 JOIN tenant_members m ON m.tenant_id = i.tenant_id
                WHERE m.user_id = u.id) AS invitationCount,
              (SELECT COALESCE(SUM(a.byte_size), 0) FROM media_assets a
                 JOIN tenant_members m ON m.tenant_id = a.tenant_id
                WHERE m.user_id = u.id) AS storageBytes,
              (SELECT COUNT(*) FROM sessions s
                WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS activeSessions
       FROM users u WHERE ${clause}
       ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
    ).bind(nowMs(), ...params, limit, offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS c FROM users u WHERE ${clause}`).bind(...params),
  ]);

  // Password and session hashes are never selected, let alone returned.
  return ok({ users: page.results, total: total.results[0].c });
});

platform.post("/users/:userId/status", async (c) => {
  const actor = await requirePlatformAdmin(c.req.raw, c.env);
  const userId = c.req.param("userId");

  let body: { status?: string };
  try {
    body = (await c.req.json()) as { status?: string };
  } catch {
    return fail("invalid_body");
  }
  if (body.status !== "active" && body.status !== "disabled") return fail("invalid_status");

  // An operator must not be able to lock themselves out.
  if (userId === actor.user.id && body.status === "disabled") {
    return fail("cannot_disable_self", 409);
  }

  const result = await c.env.DB.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?")
    .bind(body.status, nowMs(), userId)
    .run();
  if (!result.meta.changes) return fail("not_found", 404);

  // Disabling must take effect immediately, not at token expiry.
  if (body.status === "disabled") await revokeAllSessions(c.env, userId);

  await audit(c.env, actor.user.id, `user.${body.status}`, { type: "user", id: userId }, null, true);
  return ok({});
});

platform.post("/users/:userId/revoke-sessions", async (c) => {
  const actor = await requirePlatformAdmin(c.req.raw, c.env);
  const userId = c.req.param("userId");

  const exists = await c.env.DB.prepare("SELECT 1 AS hit FROM users WHERE id = ?")
    .bind(userId)
    .first();
  if (!exists) return fail("not_found", 404);

  await revokeAllSessions(c.env, userId);
  await audit(c.env, actor.user.id, "user.revoke_sessions", { type: "user", id: userId }, null, true);
  return ok({});
});

// ------------------------------------------------------------------- tenants

const TENANT_SORTS: Record<string, string> = {
  newest: "t.created_at DESC",
  oldest: "t.created_at ASC",
  storage: "storageBytes DESC",
  invitations: "invitationCount DESC",
  responses: "rsvpCount DESC",
};

platform.get("/tenants", async (c) => {
  const { limit, offset } = paging(c);
  const sort = TENANT_SORTS[c.req.query("sort") ?? "newest"] ?? TENANT_SORTS.newest;

  const [page, total] = await c.env.DB.batch<any>([
    c.env.DB.prepare(
      `SELECT t.id, t.name, t.slug, t.status, t.plan_id AS planId,
              t.quota_overrides_json AS quotaOverridesJson, t.created_at AS createdAt,
              (SELECT u.email FROM tenant_members m JOIN users u ON u.id = m.user_id
                WHERE m.tenant_id = t.id AND m.role = 'owner'
                ORDER BY m.created_at LIMIT 1) AS ownerEmail,
              (SELECT COUNT(*) FROM tenant_members m WHERE m.tenant_id = t.id) AS memberCount,
              (SELECT COUNT(*) FROM invitations i WHERE i.tenant_id = t.id) AS invitationCount,
              (SELECT COUNT(*) FROM invitations i
                WHERE i.tenant_id = t.id AND i.status = 'published') AS publishedCount,
              (SELECT COALESCE(SUM(a.byte_size), 0) FROM media_assets a
                WHERE a.tenant_id = t.id) AS storageBytes,
              (SELECT COUNT(*) FROM rsvp_submissions s
                 JOIN invitations i ON i.id = s.invitation_id
                WHERE i.tenant_id = t.id) AS rsvpCount
       FROM tenants t ORDER BY ${sort} LIMIT ? OFFSET ?`
    ).bind(limit, offset),
    c.env.DB.prepare("SELECT COUNT(*) AS c FROM tenants"),
  ]);

  return ok({ tenants: page.results, total: total.results[0].c });
});

platform.post("/tenants/:tenantId/status", async (c) => {
  const actor = await requirePlatformAdmin(c.req.raw, c.env);
  const tenantId = c.req.param("tenantId");

  let body: { status?: string };
  try {
    body = (await c.req.json()) as { status?: string };
  } catch {
    return fail("invalid_body");
  }
  if (body.status !== "active" && body.status !== "suspended") return fail("invalid_status");

  // Suspension is reversible and destroys nothing.
  const result = await c.env.DB.prepare(
    "UPDATE tenants SET status = ?, updated_at = ? WHERE id = ?"
  )
    .bind(body.status, nowMs(), tenantId)
    .run();
  if (!result.meta.changes) return fail("not_found", 404);

  await audit(c.env, actor.user.id, `tenant.${body.status}`, { type: "tenant", id: tenantId }, null, true);
  return ok({});
});

platform.put("/tenants/:tenantId/quota", async (c) => {
  const actor = await requirePlatformAdmin(c.req.raw, c.env);
  const tenantId = c.req.param("tenantId");

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail("invalid_body");
  }

  const allowed = [
    "maxInvitations",
    "maxMediaBytesPerTenant",
    "maxMediaBytesPerInvitation",
    "maxImageBytes",
    "maxAudioBytes",
    "maxRsvpResponses",
  ];
  const overrides: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!allowed.includes(key)) return fail("unknown_quota_key", 422, { key });
    if (value === null) {
      overrides[key] = null;
      continue;
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fail("invalid_quota_value", 422, { key });
    overrides[key] = Math.floor(n);
  }

  const result = await c.env.DB.prepare(
    "UPDATE tenants SET quota_overrides_json = ?, updated_at = ? WHERE id = ?"
  )
    .bind(Object.keys(overrides).length ? JSON.stringify(overrides) : null, nowMs(), tenantId)
    .run();
  if (!result.meta.changes) return fail("not_found", 404);

  await audit(c.env, actor.user.id, "tenant.quota", { type: "tenant", id: tenantId }, overrides, true);
  return ok({});
});

// --------------------------------------------------------------- invitations

const INVITATION_SORTS: Record<string, string> = {
  newest: "i.created_at DESC",
  oldest: "i.created_at ASC",
  stale: "i.updated_at ASC",
  updated: "i.updated_at DESC",
  storage: "storageBytes DESC",
  media: "mediaCount DESC",
  responses: "i.rsvp_count DESC",
};

/**
 * The platform cleanup inventory.
 *
 * Sorting and filtering are entirely server-side: loading every
 * invitation into the browser to sort it would defeat the purpose of the
 * view and would not survive a real dataset.
 */
platform.get("/invitations", async (c) => {
  const { limit, offset } = paging(c);
  const sort = INVITATION_SORTS[c.req.query("sort") ?? "newest"] ?? INVITATION_SORTS.newest;

  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];

  const eq = (param: string, column: string) => {
    const value = c.req.query(param);
    if (value) {
      where.push(`${column} = ?`);
      params.push(value);
    }
  };
  eq("tenantId", "i.tenant_id");
  eq("status", "i.status");
  eq("themeId", "i.theme_id");

  const numeric = (param: string, expr: string) => {
    const raw = c.req.query(param);
    if (raw === undefined || raw === "") return;
    const n = Number(raw);
    if (Number.isFinite(n)) {
      where.push(expr);
      params.push(n);
    }
  };
  numeric("createdBefore", "i.created_at < ?");
  numeric("createdAfter", "i.created_at > ?");
  numeric("updatedBefore", "i.updated_at < ?");
  numeric("updatedAfter", "i.updated_at > ?");
  numeric("minStorage", "i.media_bytes >= ?");

  if (c.req.query("noRsvp") === "true") where.push("i.rsvp_count = 0");
  if (c.req.query("q")) {
    where.push("(i.title LIKE ? OR i.slug LIKE ?)");
    const like = `%${c.req.query("q")}%`;
    params.push(like, like);
  }

  const clause = where.join(" AND ");

  const [page, total] = await c.env.DB.batch<any>([
    c.env.DB.prepare(
      `SELECT i.id, i.title, i.slug, i.theme_id AS themeId, i.status,
              i.created_at AS createdAt, i.updated_at AS updatedAt,
              i.published_at AS publishedAt, i.rsvp_count AS rsvpCount,
              i.media_bytes AS counterBytes,
              t.id AS tenantId, t.name AS tenantName,
              (SELECT u.email FROM tenant_members m JOIN users u ON u.id = m.user_id
                WHERE m.tenant_id = t.id AND m.role = 'owner'
                ORDER BY m.created_at LIMIT 1) AS ownerEmail,
              (SELECT COUNT(*) FROM invitation_revisions r
                WHERE r.invitation_id = i.id) AS revisionCount,
              (SELECT COUNT(*) FROM media_assets a WHERE a.invitation_id = i.id) AS mediaCount,
              (SELECT COALESCE(SUM(a.byte_size), 0) FROM media_assets a
                WHERE a.invitation_id = i.id) AS storageBytes
       FROM invitations i JOIN tenants t ON t.id = i.tenant_id
       WHERE ${clause} ORDER BY ${sort} LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS c FROM invitations i JOIN tenants t ON t.id = i.tenant_id WHERE ${clause}`
    ).bind(...params),
  ]);

  return ok({ invitations: page.results, total: total.results[0].c });
});

platform.get("/invitations/:invitationId", async (c) => {
  const invitationId = c.req.param("invitationId");

  const invitation = await c.env.DB.prepare(
    `SELECT i.id, i.title, i.slug, i.theme_id AS themeId, i.status,
            i.created_at AS createdAt, i.updated_at AS updatedAt,
            i.published_at AS publishedAt, i.published_revision_id AS publishedRevisionId,
            i.rsvp_count AS rsvpCount, i.media_bytes AS counterBytes,
            t.id AS tenantId, t.name AS tenantName, t.status AS tenantStatus,
            (SELECT u.email FROM tenant_members m JOIN users u ON u.id = m.user_id
              WHERE m.tenant_id = t.id AND m.role = 'owner'
              ORDER BY m.created_at LIMIT 1) AS ownerEmail
     FROM invitations i JOIN tenants t ON t.id = i.tenant_id WHERE i.id = ?`
  )
    .bind(invitationId)
    .first();
  if (!invitation) return fail("not_found", 404);

  // Media metadata only; no draft bearer tokens are surfaced.
  const [media, revisions] = await c.env.DB.batch<any>([
    c.env.DB.prepare(
      `SELECT id, kind, slot, mime_type AS mimeType, byte_size AS byteSize,
              width, height, duration_ms AS durationMs, created_at AS createdAt
       FROM media_assets WHERE invitation_id = ? ORDER BY byte_size DESC`
    ).bind(invitationId),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS revisionCount FROM invitation_revisions WHERE invitation_id = ?`
    ).bind(invitationId),
  ]);

  return ok({
    invitation,
    media: media.results,
    revisionCount: revisions.results[0].revisionCount,
  });
});

// ------------------------------------------------------------------- storage

platform.get("/storage", async (c) => {
  const [totals, byTenant, byInvitation, largest] = await c.env.DB.batch<any>([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS assetCount,
              COALESCE(SUM(byte_size), 0) AS totalBytes,
              COALESCE(SUM(CASE WHEN kind = 'image' THEN byte_size ELSE 0 END), 0) AS imageBytes,
              COALESCE(SUM(CASE WHEN kind = 'audio' THEN byte_size ELSE 0 END), 0) AS audioBytes,
              COALESCE(SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END), 0) AS imageCount,
              COALESCE(SUM(CASE WHEN kind = 'audio' THEN 1 ELSE 0 END), 0) AS audioCount
       FROM media_assets`
    ),
    c.env.DB.prepare(
      `SELECT t.id, t.name, COUNT(a.id) AS assetCount,
              COALESCE(SUM(a.byte_size), 0) AS bytes
       FROM tenants t LEFT JOIN media_assets a ON a.tenant_id = t.id
       GROUP BY t.id ORDER BY bytes DESC LIMIT 20`
    ),
    c.env.DB.prepare(
      `SELECT i.id, i.title, i.slug, t.name AS tenantName,
              COUNT(a.id) AS assetCount, COALESCE(SUM(a.byte_size), 0) AS bytes
       FROM invitations i
       JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN media_assets a ON a.invitation_id = i.id
       GROUP BY i.id ORDER BY bytes DESC LIMIT 20`
    ),
    c.env.DB.prepare(
      `SELECT a.id, a.kind, a.mime_type AS mimeType, a.byte_size AS byteSize,
              a.width, a.height, a.duration_ms AS durationMs, a.created_at AS createdAt,
              i.title AS invitationTitle, i.id AS invitationId, t.name AS tenantName
       FROM media_assets a
       JOIN invitations i ON i.id = a.invitation_id
       JOIN tenants t ON t.id = a.tenant_id
       ORDER BY a.byte_size DESC LIMIT 20`
    ),
  ]);

  // Storage reporting reads D1 only; the bucket is never enumerated here.
  return ok({
    totals: totals.results[0],
    byTenant: byTenant.results,
    byInvitation: byInvitation.results,
    largestAssets: largest.results,
  });
});

/**
 * Detect drift between the denormalized counter and the assets it counts.
 * Read-only: repair is a separate, explicit action.
 */
platform.get("/storage/consistency", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.title, i.slug, i.media_bytes AS counterBytes,
            COALESCE((SELECT SUM(a.byte_size) FROM media_assets a
                       WHERE a.invitation_id = i.id), 0) AS actualBytes
     FROM invitations i
     WHERE i.media_bytes != COALESCE((SELECT SUM(a.byte_size) FROM media_assets a
                                       WHERE a.invitation_id = i.id), 0)
     LIMIT 200`
  ).all<{ id: string; counterBytes: number; actualBytes: number }>();

  return ok({
    drifted: results.map((r) => ({ ...r, delta: r.actualBytes - r.counterBytes })),
    count: results.length,
  });
});

platform.post("/storage/recalculate", async (c) => {
  const actor = await requirePlatformAdmin(c.req.raw, c.env);

  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.media_bytes AS counterBytes,
            COALESCE((SELECT SUM(a.byte_size) FROM media_assets a
                       WHERE a.invitation_id = i.id), 0) AS actualBytes
     FROM invitations i
     WHERE i.media_bytes != COALESCE((SELECT SUM(a.byte_size) FROM media_assets a
                                       WHERE a.invitation_id = i.id), 0)`
  ).all<{ id: string; counterBytes: number; actualBytes: number }>();

  if (results.length) {
    await c.env.DB.batch(
      results.map((r) =>
        c.env.DB.prepare("UPDATE invitations SET media_bytes = ? WHERE id = ?").bind(
          r.actualBytes,
          r.id
        )
      )
    );
  }

  await audit(
    c.env,
    actor.user.id,
    "storage.recalculate",
    { type: "platform", id: "storage" },
    { repaired: results.length },
    true
  );

  return ok({
    repaired: results.map((r) => ({
      invitationId: r.id,
      before: r.counterBytes,
      calculated: r.actualBytes,
      after: r.actualBytes,
    })),
    count: results.length,
  });
});

// -------------------------------------------------------------------- system

platform.get("/system", async (c) => {
  const settings = await c.env.DB.prepare("SELECT key, value_json AS value FROM platform_settings").all();

  // Binding health, checked by doing the cheapest real operation rather
  // than assuming the binding exists.
  let d1Healthy = false;
  let r2Healthy = false;
  try {
    await c.env.DB.prepare("SELECT 1").first();
    d1Healthy = true;
  } catch {
    d1Healthy = false;
  }
  try {
    await c.env.MEDIA.list({ limit: 1 });
    r2Healthy = true;
  } catch {
    r2Healthy = false;
  }

  // No secrets, tokens or credentials — only operational facts.
  return ok({
    mode: deploymentMode(c.env),
    bindings: { d1: d1Healthy, r2: r2Healthy },
    settings: settings.results,
    passwordIterations: Number(c.env.PASSWORD_ITERATIONS) || 210_000,
  });
});

platform.put("/system/settings", async (c) => {
  const actor = await requirePlatformAdmin(c.req.raw, c.env);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail("invalid_body");
  }

  // Allow-list: settings drive behaviour, so arbitrary keys are refused.
  const allowed: Record<string, (v: unknown) => boolean> = {
    site_name: (v) => typeof v === "string" && v.length > 0 && v.length <= 80,
    registration_enabled: (v) => typeof v === "boolean",
  };

  const statements = [];
  for (const [key, value] of Object.entries(body)) {
    const check = allowed[key];
    if (!check) return fail("unknown_setting", 422, { key });
    if (!check(value)) return fail("invalid_setting", 422, { key });
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO platform_settings (key, value_json) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`
      ).bind(key, JSON.stringify(value))
    );
  }
  if (statements.length) await c.env.DB.batch(statements);

  await audit(
    c.env,
    actor.user.id,
    "system.settings",
    { type: "platform", id: "settings" },
    { keys: Object.keys(body) },
    true
  );
  return ok({});
});

// --------------------------------------------------------------------- audit

platform.get("/audit", async (c) => {
  const { limit, offset } = paging(c);

  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.action, e.target_type AS targetType, e.target_id AS targetId,
            e.meta_json AS metaJson, e.ok, e.created_at AS createdAt,
            u.email AS actorEmail
     FROM platform_audit_events e
     LEFT JOIN users u ON u.id = e.actor_user_id
     ORDER BY e.created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(limit, offset)
    .all();

  return ok({ events: results });
});
