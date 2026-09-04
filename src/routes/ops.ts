/**
 * Operational endpoints (V2).
 *
 * Three small apps with explicit mount prefixes (see index.ts) — never
 * mounted at "/" (a root mount shadows sibling routes in Hono):
 *   themes       GET  /api/v1/themes            public catalogue
 *   housekeeping POST /api/v1/platform/housekeeping/run   operator
 *                GET  /api/v1/platform/housekeeping/runs  operator
 *   selfService  POST /api/v1/invitations/:id/delete      tenant
 *                GET  /api/v1/invitations/:id/export       tenant
 */

import { Hono } from "hono";
import { fail, ok } from "../lib/respond.js";
import { isSameOrigin } from "../lib/guard.js";
import { requireInvitation, requirePlatformAdmin } from "../lib/authz.js";
import { recordHousekeepingRun, runHousekeeping } from "../lib/housekeeping.js";
import { computeImpact, deleteInvitation } from "./cleanup.js";
import { listThemes } from "../themes/registry.js";

function csrfGuard(app: Hono<{ Bindings: Env }>): void {
  app.use("/*", async (c, next) => {
    const method = c.req.method;
    if (method !== "GET" && method !== "HEAD" && !isSameOrigin(c.req.raw)) {
      return fail("csrf", 403);
    }
    await next();
  });
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

// Public theme catalogue (no auth needed for the creation UI after login;
// the list itself carries no private data).
export const themes = new Hono<{ Bindings: Env }>();
csrfGuard(themes);

themes.get("/", async (c) => {
  return ok({ themes: listThemes() });
});

// Manual housekeeping trigger (operator only).
export const housekeeping = new Hono<{ Bindings: Env }>();

housekeeping.use("/*", async (c, next) => {
  await requirePlatformAdmin(c.req.raw, c.env);
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && !isSameOrigin(c.req.raw)) {
    return fail("csrf", 403);
  }
  await next();
});

housekeeping.post("/run", async (c) => {
  const actor = await requirePlatformAdmin(c.req.raw, c.env);
  let results;
  try {
    results = await runHousekeeping(c.env);
  } catch (err) {
    await recordHousekeepingRun(c.env, "all", 0, false, String(err));
    return fail("housekeeping_failed", 500);
  }
  const deleted = results.reduce((n, r) => n + r.deleted, 0);
  await recordHousekeepingRun(c.env, "all", deleted, true);
  // Structured, PII-free operational event.
  console.log("housekeeping_run", {
    actor: actor.user.id,
    deleted,
    kinds: results.map((r) => `${r.kind}:${r.deleted}`).join(","),
  });
  return ok({ results, deleted });
});

housekeeping.get("/runs", async (c) => {
  await requirePlatformAdmin(c.req.raw, c.env);
  const limit = Math.min(Number(c.req.query("limit") ?? 25) || 25, 100);
  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, started_at AS startedAt, finished_at AS finishedAt,
            deleted, ok, error FROM housekeeping_runs
     ORDER BY started_at DESC LIMIT ?`
  )
    .bind(limit)
    .all();
  return ok({ runs: results });
});

// Tenant self-service: delete my invitation (reuses proven engine) +
// export everything. Mounted on /invitations like the other
// invitation-scoped apps.
export const selfService = new Hono<{ Bindings: Env }>();
csrfGuard(selfService);

selfService.post("/:invitationId/delete", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  let body: { confirm?: string } = {};
  try {
    body = (await c.req.json()) as { confirm?: string };
  } catch {
    return fail("invalid_body");
  }
  const impact = await computeImpact(c.env, access.invitationId);
  if (!impact) return fail("not_found", 404);
  const expected = `DELETE ${impact.title}`;
  if (body.confirm !== expected) {
    return fail("confirm_mismatch", 422, { expected });
  }
  const result = await deleteInvitation(c.env, access.invitationId, access.auth.user.id);
  return ok({ result });
});

// Tenant self-service: export everything (invitation JSON + guests + RSVP CSV hint).
selfService.get("/:invitationId/export", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  const invitation = await c.env.DB.prepare(
    `SELECT id, title, slug, theme_id AS themeId, status, locale,
            draft_json AS draftJson, created_at AS createdAt
     FROM invitations WHERE id = ?`
  )
    .bind(access.invitationId)
    .first();
  const { results: guests } = await c.env.DB.prepare(
    `SELECT id, full_name AS fullName, phone, email, meal, dietary,
            is_child AS isChild, rsvp_status AS rsvpStatus,
            checked_in_at AS checkedInAt, party_id AS partyId
     FROM guests WHERE invitation_id = ? ORDER BY created_at`
  )
    .bind(access.invitationId)
    .all();
  const { results: parties } = await c.env.DB.prepare(
    "SELECT id, title, note, max_seats AS maxSeats, source FROM guest_parties WHERE invitation_id = ? ORDER BY created_at"
  )
    .bind(access.invitationId)
    .all();
  return ok({ invitation, guests, parties, exportedAt: Date.now() });
});
