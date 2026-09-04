/**
 * Manual cleanup: /api/v1/platform/cleanup/*
 *
 * Operator-driven only. Nothing here runs on a schedule, nothing expires,
 * and no invitation is ever removed without a human explicitly asking.
 *
 * DELETION ORDERING — the important part.
 *
 * WS4 deletes a single unused asset D1-first, because a failed R2 delete
 * then leaves a harmless orphan. Deleting a whole invitation is the
 * opposite problem: the media rows are the ONLY record of which R2 keys
 * belong to it. Removing them before R2 is confirmed would strand those
 * objects permanently, with nothing left to retry from.
 *
 * So the invitation flow is:
 *
 *   active → deleting → R2 objects removed → D1 removed → gone
 *                    ↘ delete_failed (keys preserved, retry safe)
 *
 * The status is persisted before any destructive step, so an interrupted
 * run is always resumable and always visible to the operator.
 */

import { Hono } from "hono";
import { fail, ok } from "../lib/respond.js";
import { nowMs } from "../lib/time.js";
import { isSameOrigin } from "../lib/guard.js";
import { requirePlatformAdmin } from "../lib/authz.js";
import { audit } from "./platform.js";

export const cleanup = new Hono<{ Bindings: Env }>();

cleanup.use("/*", async (c, next) => {
  await requirePlatformAdmin(c.req.raw, c.env);
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && !isSameOrigin(c.req.raw)) {
    return fail("csrf", 403);
  }
  await next();
});

/** Bounded so a batch cannot exceed the Worker's execution budget. */
const MAX_BULK = 20;

export interface DeletionImpact {
  invitationId: string;
  title: string;
  slug: string;
  tenantId: string;
  tenantName: string;
  ownerEmail: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
  revisionCount: number;
  mediaCount: number;
  storageBytes: number;
  rsvpSubmissionCount: number;
  rsvpAnswerCount: number;
  rsvpFieldCount: number;
  previewTokenCount: number;
}

/**
 * Compute what deleting an invitation would actually destroy.
 *
 * Every number is counted live from the relational data rather than read
 * from a denormalized counter — a destructive confirmation must not be
 * based on a value that might have drifted.
 */
export async function computeImpact(
  env: Env,
  invitationId: string
): Promise<DeletionImpact | null> {
  const row = await env.DB.prepare(
    `SELECT i.id AS invitationId, i.title, i.slug, i.status,
            i.created_at AS createdAt, i.updated_at AS updatedAt,
            t.id AS tenantId, t.name AS tenantName,
            (SELECT u.email FROM tenant_members m JOIN users u ON u.id = m.user_id
              WHERE m.tenant_id = t.id AND m.role = 'owner'
              ORDER BY m.created_at LIMIT 1) AS ownerEmail,
            (SELECT COUNT(*) FROM invitation_revisions r
              WHERE r.invitation_id = i.id) AS revisionCount,
            (SELECT COUNT(*) FROM media_assets a WHERE a.invitation_id = i.id) AS mediaCount,
            (SELECT COALESCE(SUM(a.byte_size), 0) FROM media_assets a
              WHERE a.invitation_id = i.id) AS storageBytes,
            (SELECT COUNT(*) FROM rsvp_submissions s
              WHERE s.invitation_id = i.id) AS rsvpSubmissionCount,
            (SELECT COUNT(*) FROM rsvp_answers an
               JOIN rsvp_submissions s ON s.id = an.submission_id
              WHERE s.invitation_id = i.id) AS rsvpAnswerCount,
            (SELECT COUNT(*) FROM rsvp_fields f
               JOIN rsvp_forms fo ON fo.id = f.form_id
              WHERE fo.invitation_id = i.id) AS rsvpFieldCount,
            (SELECT COUNT(*) FROM preview_tokens p
              WHERE p.invitation_id = i.id) AS previewTokenCount
     FROM invitations i JOIN tenants t ON t.id = i.tenant_id
     WHERE i.id = ?`
  )
    .bind(invitationId)
    .first<DeletionImpact>();

  return row ?? null;
}

export interface DeletionResult {
  invitationId: string;
  ok: boolean;
  status: "removed" | "delete_failed";
  deletedObjects: number;
  failedObjects: number;
  bytesFreed: number;
  error?: string;
}

/**
 * Delete one invitation, retry-safely.
 *
 * Idempotent: an R2 object that is already gone is a success, not a
 * failure, so a retry after partial progress can finish rather than
 * deadlock. Equally, a run that already removed every object but failed
 * to finalize D1 will complete on the next attempt.
 */
export async function deleteInvitation(
  env: Env,
  invitationId: string,
  actorUserId: string
): Promise<DeletionResult> {
  const assets = await env.DB.prepare(
    `SELECT id, storage_key AS storageKey, byte_size AS byteSize
     FROM media_assets WHERE invitation_id = ?`
  )
    .bind(invitationId)
    .all<{ id: string; storageKey: string; byteSize: number }>();

  // Mark intent before touching anything. If the isolate dies mid-run the
  // operator sees `deleting` rather than a silently half-deleted row.
  await env.DB.prepare(
    "UPDATE invitations SET status = 'deleting', updated_at = ? WHERE id = ?"
  )
    .bind(nowMs(), invitationId)
    .run();

  // --- phase 1: R2. The media rows still exist, so every key is known. ---
  const failed: string[] = [];
  let deleted = 0;
  let bytesFreed = 0;

  for (const asset of assets.results) {
    try {
      await env.MEDIA.delete(asset.storageKey);
      deleted++;
      bytesFreed += asset.byteSize;
    } catch {
      // Keep going: one unreachable key must not block the rest, and the
      // survivors stay recorded for the retry.
      failed.push(asset.id);
    }
  }

  if (failed.length) {
    await env.DB.prepare(
      "UPDATE invitations SET status = 'delete_failed', updated_at = ? WHERE id = ?"
    )
      .bind(nowMs(), invitationId)
      .run();

    // Drop only the rows whose objects are definitely gone, so a retry
    // does not re-attempt them and the remaining keys stay authoritative.
    const settled = assets.results.filter((a) => !failed.includes(a.id)).map((a) => a.id);
    if (settled.length) {
      const placeholders = settled.map(() => "?").join(", ");
      await env.DB.prepare(
        `DELETE FROM media_assets WHERE id IN (${placeholders})`
      )
        .bind(...settled)
        .run();
    }

    await audit(
      env,
      actorUserId,
      "cleanup.invitation_failed",
      { type: "invitation", id: invitationId },
      { deletedObjects: deleted, failedObjects: failed.length, bytesFreed },
      false
    );

    return {
      invitationId,
      ok: false,
      status: "delete_failed",
      deletedObjects: deleted,
      failedObjects: failed.length,
      bytesFreed,
      error: "r2_delete_failed",
    };
  }

  // --- phase 2: D1, in dependency order. RESTRICT foreign keys mean the
  // order is enforced by the database rather than by hope. ---
  try {
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM rsvp_answers WHERE submission_id IN
           (SELECT id FROM rsvp_submissions WHERE invitation_id = ?)`
      ).bind(invitationId),
      env.DB.prepare("DELETE FROM guests WHERE invitation_id = ?").bind(invitationId),
      env.DB.prepare("DELETE FROM guest_parties WHERE invitation_id = ?").bind(invitationId),
      env.DB.prepare("DELETE FROM rsvp_submissions WHERE invitation_id = ?").bind(invitationId),
      env.DB.prepare(
        `DELETE FROM rsvp_fields WHERE form_id IN
           (SELECT id FROM rsvp_forms WHERE invitation_id = ?)`
      ).bind(invitationId),
      env.DB.prepare("DELETE FROM rsvp_forms WHERE invitation_id = ?").bind(invitationId),
      env.DB.prepare("DELETE FROM preview_tokens WHERE invitation_id = ?").bind(invitationId),
      env.DB.prepare("DELETE FROM revision_assets WHERE invitation_id = ?").bind(invitationId),
      env.DB.prepare("DELETE FROM media_assets WHERE invitation_id = ?").bind(invitationId),
      // Release the pointer before deleting the revisions it references.
      env.DB.prepare(
        "UPDATE invitations SET published_revision_id = NULL, share_image_asset_id = NULL WHERE id = ?"
      ).bind(invitationId),
      env.DB.prepare("DELETE FROM invitation_revisions WHERE invitation_id = ?").bind(invitationId),
      env.DB.prepare("DELETE FROM invitations WHERE id = ?").bind(invitationId),
    ]);
  } catch (err) {
    // R2 is already empty for this invitation, so the remaining work is
    // pure D1. Leaving it in delete_failed lets a retry finish: the
    // deletes above are all idempotent, and missing objects are fine.
    await env.DB.prepare(
      "UPDATE invitations SET status = 'delete_failed', updated_at = ? WHERE id = ?"
    )
      .bind(nowMs(), invitationId)
      .run()
      .catch(() => {
        /* if this fails too, the row simply stays in `deleting` */
      });

    await audit(
      env,
      actorUserId,
      "cleanup.invitation_failed",
      { type: "invitation", id: invitationId },
      { deletedObjects: deleted, bytesFreed, phase: "d1" },
      false
    );

    return {
      invitationId,
      ok: false,
      status: "delete_failed",
      deletedObjects: deleted,
      failedObjects: 0,
      bytesFreed,
      error: String(err).slice(0, 120),
    };
  }

  // Counts and bytes only — never invitation copy or RSVP answers.
  await audit(
    env,
    actorUserId,
    "cleanup.invitation_removed",
    { type: "invitation", id: invitationId },
    { deletedObjects: deleted, bytesFreed },
    true
  );

  return {
    invitationId,
    ok: true,
    status: "removed",
    deletedObjects: deleted,
    failedObjects: 0,
    bytesFreed,
  };
}

// -------------------------------------------------------------------- routes

cleanup.post("/impact", async (c) => {
  let body: { invitationIds?: unknown };
  try {
    body = (await c.req.json()) as { invitationIds?: unknown };
  } catch {
    return fail("invalid_body");
  }

  const ids = Array.isArray(body.invitationIds) ? body.invitationIds.map(String) : [];
  if (!ids.length) return fail("no_selection");
  if (ids.length > MAX_BULK) return fail("too_many", 422, { limit: MAX_BULK });

  const impacts: DeletionImpact[] = [];
  for (const id of ids) {
    const impact = await computeImpact(c.env, id);
    if (impact) impacts.push(impact);
  }

  const totals = impacts.reduce(
    (acc, i) => ({
      invitations: acc.invitations + 1,
      revisions: acc.revisions + i.revisionCount,
      media: acc.media + i.mediaCount,
      bytes: acc.bytes + i.storageBytes,
      submissions: acc.submissions + i.rsvpSubmissionCount,
      answers: acc.answers + i.rsvpAnswerCount,
      fields: acc.fields + i.rsvpFieldCount,
      previewTokens: acc.previewTokens + i.previewTokenCount,
    }),
    {
      invitations: 0,
      revisions: 0,
      media: 0,
      bytes: 0,
      submissions: 0,
      answers: 0,
      fields: 0,
      previewTokens: 0,
    }
  );

  return ok({ impacts, totals, missing: ids.length - impacts.length });
});

/**
 * Perform the deletion.
 *
 * The typed confirmation is checked here, not only in the dialog: a UI
 * that is the sole guard against a destructive API is not a guard at all.
 */
cleanup.post("/delete", async (c) => {
  const actor = await requirePlatformAdmin(c.req.raw, c.env);

  let body: { invitationIds?: unknown; confirm?: unknown };
  try {
    body = (await c.req.json()) as { invitationIds?: unknown; confirm?: unknown };
  } catch {
    return fail("invalid_body");
  }

  const ids = Array.isArray(body.invitationIds) ? body.invitationIds.map(String) : [];
  if (!ids.length) return fail("no_selection");
  if (ids.length > MAX_BULK) return fail("too_many", 422, { limit: MAX_BULK });

  const expected = `DELETE ${ids.length} INVITATION${ids.length === 1 ? "" : "S"}`;
  if (body.confirm !== expected) return fail("confirmation_mismatch", 422, { expected });

  // Bounded, sequential, per-invitation. Not one giant cross-tenant
  // transaction: a single failure must not obscure the successes.
  const results: DeletionResult[] = [];
  for (const id of ids) {
    const exists = await c.env.DB.prepare("SELECT 1 AS hit FROM invitations WHERE id = ?")
      .bind(id)
      .first();
    if (!exists) continue;
    results.push(await deleteInvitation(c.env, id, actor.user.id));
  }

  return ok({
    results,
    removed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    bytesFreed: results.reduce((sum, r) => sum + r.bytesFreed, 0),
  });
});

/** Retry an invitation left in delete_failed. */
cleanup.post("/retry/:invitationId", async (c) => {
  const actor = await requirePlatformAdmin(c.req.raw, c.env);
  const invitationId = c.req.param("invitationId");

  const row = await c.env.DB.prepare("SELECT status FROM invitations WHERE id = ?")
    .bind(invitationId)
    .first<{ status: string }>();
  if (!row) return fail("not_found", 404);
  if (row.status !== "delete_failed" && row.status !== "deleting") {
    return fail("not_retryable", 409, { status: row.status });
  }

  return ok({ result: await deleteInvitation(c.env, invitationId, actor.user.id) });
});

// ------------------------------------------------------------ orphan scanner

/** R2 pages are capped, so a scan is explicitly cursor-driven. */
const SCAN_PAGE = 200;

/**
 * Compare R2 objects against D1 references.
 *
 * One of the few operations permitted to enumerate the bucket, and only
 * because an operator asked. Results are labelled candidates rather than
 * garbage: an object may simply belong to a write that is still in
 * flight, and nothing is deleted automatically.
 */
cleanup.get("/orphans", async (c) => {
  const cursor = c.req.query("cursor") || undefined;

  const listed = await c.env.MEDIA.list({ limit: SCAN_PAGE, cursor });
  if (!listed.objects.length) {
    return ok({ candidates: [], cursor: null, done: true, scanned: 0 });
  }

  // Check each key against D1 rather than inferring ownership from the
  // key's shape alone.
  const keys = listed.objects.map((o) => o.key);
  const placeholders = keys.map(() => "?").join(", ");
  const { results } = await c.env.DB.prepare(
    `SELECT a.storage_key AS storageKey FROM media_assets a
      WHERE a.storage_key IN (${placeholders})`
  )
    .bind(...keys)
    .all<{ storageKey: string }>();

  const referenced = new Set(results.map((r) => r.storageKey));

  const candidates = [];
  for (const object of listed.objects) {
    if (referenced.has(object.key)) continue;

    // t/{tenantId}/i/{invitationId}/a/{assetId}/...
    const parts = object.key.split("/");
    const tenantId = parts[0] === "t" ? (parts[1] ?? null) : null;
    const invitationId = parts[2] === "i" ? (parts[3] ?? null) : null;

    // Resolve the prefix against D1 so the operator sees whether it
    // points at anything real.
    let tenantName: string | null = null;
    let invitationTitle: string | null = null;
    if (tenantId) {
      const t = await c.env.DB.prepare("SELECT name FROM tenants WHERE id = ?")
        .bind(tenantId)
        .first<{ name: string }>();
      tenantName = t?.name ?? null;
    }
    if (invitationId) {
      const i = await c.env.DB.prepare("SELECT title FROM invitations WHERE id = ?")
        .bind(invitationId)
        .first<{ title: string }>();
      invitationTitle = i?.title ?? null;
    }

    candidates.push({
      key: object.key,
      size: object.size,
      uploaded: object.uploaded?.getTime?.() ?? null,
      tenantId,
      tenantName,
      invitationId,
      invitationTitle,
      referencedInD1: false,
    });
  }

  return ok({
    candidates,
    cursor: listed.truncated ? listed.cursor : null,
    done: !listed.truncated,
    scanned: listed.objects.length,
  });
});

cleanup.post("/orphans/delete", async (c) => {
  const actor = await requirePlatformAdmin(c.req.raw, c.env);

  let body: { keys?: unknown; confirm?: unknown };
  try {
    body = (await c.req.json()) as { keys?: unknown; confirm?: unknown };
  } catch {
    return fail("invalid_body");
  }

  const keys = Array.isArray(body.keys) ? body.keys.map(String) : [];
  if (!keys.length) return fail("no_selection");
  if (keys.length > 100) return fail("too_many", 422, { limit: 100 });

  const expected = `DELETE ${keys.length} OBJECT${keys.length === 1 ? "" : "S"}`;
  if (body.confirm !== expected) return fail("confirmation_mismatch", 422, { expected });

  // Re-check against D1 immediately before deleting. A key that became
  // referenced since the scan is no longer an orphan, and deleting it
  // would break a live invitation.
  const placeholders = keys.map(() => "?").join(", ");
  const { results } = await c.env.DB.prepare(
    `SELECT storage_key AS storageKey FROM media_assets WHERE storage_key IN (${placeholders})`
  )
    .bind(...keys)
    .all<{ storageKey: string }>();
  const referenced = new Set(results.map((r) => r.storageKey));

  let deleted = 0;
  const skipped: string[] = [];
  const failed: string[] = [];

  for (const key of keys) {
    if (referenced.has(key)) {
      skipped.push(key);
      continue;
    }
    try {
      await c.env.MEDIA.delete(key);
      deleted++;
    } catch {
      failed.push(key);
    }
  }

  await audit(
    c.env,
    actor.user.id,
    "cleanup.orphans_deleted",
    { type: "platform", id: "storage" },
    { deleted, skipped: skipped.length, failed: failed.length },
    failed.length === 0
  );

  return ok({ deleted, skipped, failed });
});
