/**
 * Tenant + invitation administration: /api/v1/tenants/*
 *
 * Every handler resolves ownership through src/lib/authz.ts. No handler
 * writes its own membership SQL, and no handler trusts a tenant or
 * invitation ID because the client sent one — the ID is only ever used as
 * a lookup key inside a membership-joined query.
 */

import { Hono } from "hono";
import { fail, ok } from "../lib/respond.js";
import { newId } from "../lib/ids.js";
import { nowMs } from "../lib/time.js";
import { deploymentMode } from "../lib/mode.js";
import { isSameOrigin } from "../lib/guard.js";
import {
  requireInvitation,
  requireTenant,
  requireTenantOwner,
  requireUser,
} from "../lib/authz.js";
import {
  parseLimit,
  parseOffset,
  validateDraft,
  validateSlug,
  validateThemeId,
  validateTitle,
} from "../lib/validate.js";

export const tenants = new Hono<{ Bindings: Env }>();

/** Mutations are same-origin only; see lib/guard.ts for the reasoning. */
tenants.use("/*", async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && !isSameOrigin(c.req.raw)) {
    return fail("csrf", 403);
  }
  await next();
});

async function readJson(c: {
  req: { json: () => Promise<unknown> };
}): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface PlanLimits {
  maxInvitations: number | null;
  maxMediaBytesPerTenant: number | null;
  maxMediaBytesPerInvitation: number | null;
  maxImageBytes: number | null;
  maxAudioBytes: number | null;
  maxRsvpResponses: number | null;
}

const UNLIMITED: PlanLimits = {
  maxInvitations: null,
  maxMediaBytesPerTenant: null,
  maxMediaBytesPerInvitation: null,
  maxImageBytes: null,
  maxAudioBytes: null,
  maxRsvpResponses: null,
};

/**
 * Effective quota for a tenant: plan limits, with per-tenant operator
 * overrides layered on top. Self-hosted deployments never enforce quotas.
 */
export async function limitsFor(env: Env, tenantId: string): Promise<PlanLimits> {
  if (deploymentMode(env) !== "hosted") return UNLIMITED;

  const row = await env.DB.prepare(
    `SELECT p.limits_json AS planLimits, t.quota_overrides_json AS overrides
     FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
     WHERE t.id = ?`
  )
    .bind(tenantId)
    .first<{ planLimits: string | null; overrides: string | null }>();

  const parse = (raw: string | null): Partial<PlanLimits> => {
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Partial<PlanLimits>;
    } catch {
      return {};
    }
  };

  return { ...UNLIMITED, ...parse(row?.planLimits ?? null), ...parse(row?.overrides ?? null) };
}

// ------------------------------------------------------------------ tenants

/** Tenants the caller actually belongs to — never "all tenants". */
tenants.get("/", async (c) => {
  const auth = await requireUser(c.req.raw, c.env);

  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.slug, t.status, m.role, t.created_at AS createdAt,
            (SELECT COUNT(*) FROM invitations i WHERE i.tenant_id = t.id) AS invitationCount
     FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = ?
     ORDER BY t.created_at`
  )
    .bind(auth.user.id)
    .all();

  return ok({ tenants: results });
});

tenants.get("/:tenantId", async (c) => {
  const access = await requireTenant(c.req.raw, c.env, c.req.param("tenantId"));

  const tenant = await c.env.DB.prepare(
    `SELECT id, name, slug, status, plan_id AS planId, created_at AS createdAt
     FROM tenants WHERE id = ?`
  )
    .bind(access.tenantId)
    .first();

  return ok({ tenant, role: access.role, limits: await limitsFor(c.env, access.tenantId) });
});

tenants.patch("/:tenantId", async (c) => {
  // Renaming the tenant is an owner action; members administer invitations.
  const access = await requireTenantOwner(c.req.raw, c.env, c.req.param("tenantId"));

  const body = await readJson(c);
  if (!body) return fail("invalid_body");

  const name = validateTitle(body.name, "name");
  if (!name.ok) return fail(name.error);

  await c.env.DB.prepare("UPDATE tenants SET name = ?, updated_at = ? WHERE id = ?")
    .bind(name.value, nowMs(), access.tenantId)
    .run();

  return ok({});
});

// --------------------------------------------------------------- membership

tenants.get("/:tenantId/members", async (c) => {
  const access = await requireTenant(c.req.raw, c.env, c.req.param("tenantId"));

  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.display_name AS displayName, u.status,
            m.role, m.created_at AS createdAt
     FROM tenant_members m JOIN users u ON u.id = m.user_id
     WHERE m.tenant_id = ?
     ORDER BY m.created_at`
  )
    .bind(access.tenantId)
    .all();

  return ok({ members: results });
});

/**
 * Add an existing user to the tenant. Owner-only.
 *
 * Responds identically whether or not the email exists, so this cannot be
 * used as a membership-check oracle against the platform's user list.
 */
tenants.post("/:tenantId/members", async (c) => {
  const access = await requireTenantOwner(c.req.raw, c.env, c.req.param("tenantId"));

  const body = await readJson(c);
  if (!body) return fail("invalid_body");

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body.role === "owner" ? "owner" : "member";
  if (!email) return fail("invalid_email");

  const user = await c.env.DB.prepare("SELECT id FROM users WHERE email = ? AND status = 'active'")
    .bind(email)
    .first<{ id: string }>();

  if (user) {
    await c.env.DB.prepare(
      `INSERT INTO tenant_members (tenant_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = excluded.role`
    )
      .bind(access.tenantId, user.id, role, nowMs())
      .run();
  }

  return ok({});
});

tenants.delete("/:tenantId/members/:userId", async (c) => {
  const access = await requireTenantOwner(c.req.raw, c.env, c.req.param("tenantId"));
  const userId = c.req.param("userId");

  // A tenant must always retain at least one owner, or it becomes
  // permanently unadministrable.
  const owners = await c.env.DB.prepare(
    "SELECT COUNT(*) AS c FROM tenant_members WHERE tenant_id = ? AND role = 'owner'"
  )
    .bind(access.tenantId)
    .first<{ c: number }>();

  const target = await c.env.DB.prepare(
    "SELECT role FROM tenant_members WHERE tenant_id = ? AND user_id = ?"
  )
    .bind(access.tenantId, userId)
    .first<{ role: string }>();

  if (!target) return fail("not_found", 404);
  if (target.role === "owner" && (owners?.c ?? 0) <= 1) return fail("last_owner", 409);

  await c.env.DB.prepare("DELETE FROM tenant_members WHERE tenant_id = ? AND user_id = ?")
    .bind(access.tenantId, userId)
    .run();

  return ok({});
});

// -------------------------------------------------------------- invitations

tenants.get("/:tenantId/invitations", async (c) => {
  const access = await requireTenant(c.req.raw, c.env, c.req.param("tenantId"));
  const limit = parseLimit(c.req.query("limit"));
  const offset = parseOffset(c.req.query("offset"));

  const { results } = await c.env.DB.prepare(
    `SELECT id, title, slug, theme_id AS themeId, status,
            media_bytes AS mediaBytes, rsvp_count AS rsvpCount,
            created_at AS createdAt, updated_at AS updatedAt, published_at AS publishedAt
     FROM invitations
     WHERE tenant_id = ?
     ORDER BY updated_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(access.tenantId, limit, offset)
    .all();

  return ok({ invitations: results });
});

/**
 * Create an invitation. Multiple invitations per tenant are supported by
 * the schema from day one; hosted plans may cap the count, but nothing in
 * the data model assumes a single invitation.
 */
tenants.post("/:tenantId/invitations", async (c) => {
  const access = await requireTenant(c.req.raw, c.env, c.req.param("tenantId"));

  const body = await readJson(c);
  if (!body) return fail("invalid_body");

  const title = validateTitle(body.title);
  if (!title.ok) return fail(title.error);

  const slug = validateSlug(body.slug);
  if (!slug.ok) return fail(slug.error);

  const theme = validateThemeId(body.themeId);
  if (!theme.ok) return fail(theme.error);

  const limits = await limitsFor(c.env, access.tenantId);
  if (limits.maxInvitations !== null) {
    const row = await c.env.DB.prepare(
      "SELECT COUNT(*) AS c FROM invitations WHERE tenant_id = ?"
    )
      .bind(access.tenantId)
      .first<{ c: number }>();
    if ((row?.c ?? 0) >= limits.maxInvitations) return fail("quota_invitations", 403);
  }

  const id = newId();
  const now = nowMs();

  try {
    await c.env.DB.prepare(
      `INSERT INTO invitations
         (id, tenant_id, title, slug, theme_id, status, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
    )
      .bind(id, access.tenantId, title.value, slug.value, theme.value, now, now, access.auth.user.id)
      .run();
  } catch (err) {
    // Slugs are globally unique: report the clash without revealing which
    // tenant holds the existing slug.
    if (String(err).includes("UNIQUE")) return fail("slug_taken", 409);
    throw err;
  }

  return ok({ invitationId: id, slug: slug.value });
});

/**
 * Invitation routes are keyed by invitation ID alone — no tenant segment
 * in the path. requireInvitation derives the tenant from the row while
 * joining membership, so a foreign ID 404s exactly like a nonexistent one
 * and there is no client-supplied tenant to disagree with the row.
 */
export const invitations = new Hono<{ Bindings: Env }>();

invitations.use("/*", async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && !isSameOrigin(c.req.raw)) {
    return fail("csrf", 403);
  }
  await next();
});

invitations.get("/:invitationId", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));

  const invitation = await c.env.DB.prepare(
    `SELECT id, tenant_id AS tenantId, title, slug, theme_id AS themeId, status,
            draft_json AS draftJson, published_revision_id AS publishedRevisionId,
            media_bytes AS mediaBytes, rsvp_count AS rsvpCount,
            created_at AS createdAt, updated_at AS updatedAt, published_at AS publishedAt
     FROM invitations WHERE id = ?`
  )
    .bind(access.invitationId)
    .first();

  return ok({ invitation, role: access.role });
});

invitations.patch("/:invitationId", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));

  const body = await readJson(c);
  if (!body) return fail("invalid_body");

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.title !== undefined) {
    const title = validateTitle(body.title);
    if (!title.ok) return fail(title.error);
    sets.push("title = ?");
    values.push(title.value);
  }

  if (body.slug !== undefined) {
    const slug = validateSlug(body.slug);
    if (!slug.ok) return fail(slug.error);
    sets.push("slug = ?");
    values.push(slug.value);
  }

  if (body.draft !== undefined) {
    const draft = validateDraft(body.draft);
    if (!draft.ok) return fail(draft.error);
    sets.push("draft_json = ?", "draft_updated_at = ?", "draft_updated_by = ?");
    values.push(draft.value, nowMs(), access.auth.user.id);
  }

  if (!sets.length) return fail("nothing_to_update");

  sets.push("updated_at = ?");
  values.push(nowMs(), access.invitationId);

  try {
    await c.env.DB.prepare(`UPDATE invitations SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();
  } catch (err) {
    if (String(err).includes("UNIQUE")) return fail("slug_taken", 409);
    throw err;
  }

  return ok({});
});

// Draft, publish, unpublish, revisions, diff and preview live in
// routes/publish.ts, mounted on this same prefix.
