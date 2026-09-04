/**
 * Media upload and administration: /api/v1/invitations/:id/media/*
 *
 * Write ordering is deliberate and load-bearing:
 *
 *   1. write the object to R2
 *   2. record the metadata in D1
 *
 * If step 2 fails the object becomes an orphan — invisible, unreferenced,
 * and discoverable by the WS10 scanner because its key encodes the tenant
 * and invitation. That is a recoverable waste of bytes.
 *
 * The reverse order would produce the unrecoverable failure: D1 claiming an
 * asset exists while R2 never stored it, which surfaces as a broken image
 * on a published invitation. Never do that.
 */

import { Hono } from "hono";
import { fail, ok } from "../lib/respond.js";
import { newId, isValidId } from "../lib/ids.js";
import { nowMs } from "../lib/time.js";
import { isSameOrigin } from "../lib/guard.js";
import { requireInvitation } from "../lib/authz.js";
import { limitsFor } from "./tenants.js";
import { isAssetInAnyRevision } from "../lib/revisionAssets.js";
import { getTheme } from "../themes/registry.js";
import { writeDraft, loadInvitationForDraft } from "../lib/drafts.js";
import {
  readDimensions,
  sha256Hex,
  sniffType,
  storageKey,
  validateFocal,
  validateSlot,
} from "../lib/media.js";

export const media = new Hono<{ Bindings: Env }>();

/** Hard ceiling independent of plan limits: refuses to buffer a body large
 * enough to threaten the Worker's memory before quotas are consulted. */
const ABSOLUTE_MAX_BYTES = 64 * 1024 * 1024;

media.use("/*", async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && !isSameOrigin(c.req.raw)) {
    return fail("csrf", 403);
  }
  await next();
});

media.get("/:invitationId/media", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));

  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, slot, mime_type AS mimeType, byte_size AS byteSize,
            width, height, duration_ms AS durationMs,
            original_filename AS originalFilename, created_at AS createdAt
     FROM media_assets WHERE invitation_id = ?
     ORDER BY created_at DESC`
  )
    .bind(access.invitationId)
    .all();

  return ok({ media: results });
});

/**
 * Upload. The body is the raw file; slot and filename travel as query
 * parameters so the Worker never has to parse multipart, and the client
 * never influences the storage key.
 */
media.post("/:invitationId/media", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  const env = c.env;

  const declaredLength = Number(c.req.header("content-length") ?? "0");
  if (declaredLength > ABSOLUTE_MAX_BYTES) return fail("file_too_large", 413);

  const buffer = await c.req.raw.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (bytes.byteLength === 0) return fail("empty_file");
  if (bytes.byteLength > ABSOLUTE_MAX_BYTES) return fail("file_too_large", 413);

  // Type comes from the bytes, never from the client's Content-Type.
  const sniffed = sniffType(bytes);
  if (!sniffed) return fail("unsupported_type", 415);

  const slot = validateSlot(c.req.query("slot"));
  if (c.req.query("slot") && !slot) return fail("unknown_slot");

  // An audio file cannot occupy a photo slot, and vice versa.
  if (slot === "background_music" && sniffed.kind !== "audio") return fail("slot_kind_mismatch");
  if (slot && slot !== "background_music" && sniffed.kind !== "image") {
    return fail("slot_kind_mismatch");
  }

  const limits = await limitsFor(env, access.tenantId);
  const perFileLimit = sniffed.kind === "image" ? limits.maxImageBytes : limits.maxAudioBytes;
  if (perFileLimit !== null && bytes.byteLength > perFileLimit) {
    return fail("file_too_large", 413, { limit: perFileLimit });
  }

  if (limits.maxMediaBytesPerInvitation !== null) {
    const row = await env.DB.prepare("SELECT media_bytes AS b FROM invitations WHERE id = ?")
      .bind(access.invitationId)
      .first<{ b: number }>();
    if ((row?.b ?? 0) + bytes.byteLength > limits.maxMediaBytesPerInvitation) {
      return fail("quota_invitation_storage", 403);
    }
  }

  if (limits.maxMediaBytesPerTenant !== null) {
    const row = await env.DB.prepare(
      "SELECT COALESCE(SUM(byte_size), 0) AS b FROM media_assets WHERE tenant_id = ?"
    )
      .bind(access.tenantId)
      .first<{ b: number }>();
    if ((row?.b ?? 0) + bytes.byteLength > limits.maxMediaBytesPerTenant) {
      return fail("quota_tenant_storage", 403);
    }
  }

  const assetId = newId();
  const key = storageKey(access.tenantId, access.invitationId, assetId, sniffed.extension);
  const dimensions = sniffed.kind === "image" ? readDimensions(bytes, sniffed.mime) : null;
  const checksum = await sha256Hex(bytes);

  // Filename is recorded for display only; it is not part of the key.
  const rawName = c.req.query("filename") ?? `upload.${sniffed.extension}`;
  const filename = rawName.replace(/[\r\n\t]/g, "").slice(0, 200);

  // --- step 1: R2 ---
  try {
    await env.MEDIA.put(key, bytes as BufferSource, {
      httpMetadata: {
        contentType: sniffed.mime,
        // Keys are immutable, so the object may be cached indefinitely.
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        tenantId: access.tenantId,
        invitationId: access.invitationId,
        assetId,
      },
    });
  } catch {
    // Nothing was recorded, so there is nothing to reconcile.
    return fail("storage_unavailable", 503);
  }

  // --- step 2: D1 ---
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO media_assets
           (id, tenant_id, invitation_id, kind, slot, storage_key, original_filename,
            mime_type, byte_size, width, height, checksum_sha256, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        assetId,
        access.tenantId,
        access.invitationId,
        sniffed.kind,
        slot,
        key,
        filename,
        sniffed.mime,
        bytes.byteLength,
        dimensions?.width ?? null,
        dimensions?.height ?? null,
        checksum,
        access.auth.user.id,
        nowMs()
      ),
      // Counter maintained in the same batch as the row, so accounting
      // cannot drift from the assets it counts.
      env.DB.prepare(
        "UPDATE invitations SET media_bytes = media_bytes + ?, updated_at = ? WHERE id = ?"
      ).bind(bytes.byteLength, nowMs(), access.invitationId),
    ]);
  } catch {
    // The object is now an orphan. Its key encodes tenant and invitation,
    // so the WS10 scanner can find and reclaim it. Reported honestly
    // rather than pretending the upload succeeded.
    return fail("metadata_write_failed", 500, { orphanKey: key });
  }

  return ok({
    asset: {
      id: assetId,
      kind: sniffed.kind,
      slot,
      mimeType: sniffed.mime,
      byteSize: bytes.byteLength,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      url: `/media/${assetId}`,
    },
  });
});

/** Slot/focal assignment. The bytes are immutable; only the metadata that
 * points at them may change. */
media.patch("/:invitationId/media/:assetId", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  const assetId = c.req.param("assetId");
  if (!isValidId(assetId)) return fail("not_found", 404);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail("invalid_body");
  }

  // Scoped by invitation as well as asset: an asset ID from another
  // invitation matches nothing.
  const asset = await c.env.DB.prepare(
    "SELECT id, kind, slot FROM media_assets WHERE id = ? AND invitation_id = ?"
  )
    .bind(assetId, access.invitationId)
    .first<{ id: string; kind: string; slot: string | null }>();
  if (!asset) return fail("not_found", 404);

  if (body.slot !== undefined) {
    const slot = body.slot === null ? null : validateSlot(body.slot);
    if (body.slot !== null && !slot) return fail("unknown_slot");
    if (slot === "background_music" && asset.kind !== "audio") return fail("slot_kind_mismatch");
    if (slot && slot !== "background_music" && asset.kind !== "image") {
      return fail("slot_kind_mismatch");
    }
    await c.env.DB.prepare("UPDATE media_assets SET slot = ? WHERE id = ?")
      .bind(slot, assetId)
      .run();
    // Keep the draft's slot pointer in sync when assigning: canonical
    // focal lives at media.{slot}.focal, so a newly slotted asset needs
    // its draft entry present for the editor to write focal into.
    if (slot && slot !== "background_music") {
      try {
        const inv = await c.env.DB.prepare(
          "SELECT draft_json AS d, theme_id AS t FROM invitations WHERE id = ?"
        )
          .bind(access.invitationId)
          .first<{ d: string | null; t: string }>();
        if (inv?.d) {
          const draft = JSON.parse(inv.d) as Record<string, any>;
          const media = { ...(draft.media ?? {}) };
          const entry = { ...((media[slot] as Record<string, unknown>) ?? {}) };
          if (!entry.assetId) {
            entry.assetId = assetId;
            media[slot] = entry;
            const stored = await loadInvitationForDraft(c.env, access.invitationId);
            if (stored) {
              await writeDraft(c.env, stored, { ...draft, media }, {
                expectedVersion: null,
                updatedBy: access.auth.user.id,
              });
            }
          }
        }
      } catch {
        /* best-effort; focal write below still validates */
      }
    }
  }

  if (body.focal !== undefined) {
    const focal = validateFocal(body.focal);
    if (!focal) return fail("invalid_focal");
    // Canonical focal: media.{slot}.focal (theme manifest). The asset must
    // occupy a photo slot; the slot comes from the asset row (or an
    // explicit slot in this same request).
    const explicitSlot = body.slot === null ? null : validateSlot(body.slot);
    const slot = explicitSlot ?? asset.slot;
    if (!slot || slot === "background_music") return fail("focal_requires_slot", 422);
    const themeRow = await c.env.DB.prepare("SELECT theme_id AS t FROM invitations WHERE id = ?")
      .bind(access.invitationId)
      .first<{ t: string }>();
    const theme = getTheme(themeRow?.t ?? "cinematic-classic");
    if (!theme || !(theme.capabilities.mediaSlots as readonly string[]).includes(slot)) {
      return fail("unknown_slot", 422);
    }
    const inv = await c.env.DB.prepare("SELECT draft_json AS d FROM invitations WHERE id = ?")
      .bind(access.invitationId)
      .first<{ d: string | null }>();
    const draft = inv?.d ? (JSON.parse(inv.d) as Record<string, any>) : {};
    const media = { ...(draft.media ?? {}) };
    const entry = { ...((media[slot] as Record<string, unknown>) ?? {}) };
    entry.assetId = assetId;
    entry.focal = focal;
    media[slot] = entry;
    const stored = await loadInvitationForDraft(c.env, access.invitationId);
    if (!stored) return fail("not_found", 404);
    const result = await writeDraft(c.env, stored, { ...draft, media }, {
      expectedVersion: null,
      updatedBy: access.auth.user.id,
    });
    if (!result.ok) return fail("invalid_config", 422, { errors: result.errors ?? [] });
  }

  return ok({});
});

/**
 * Delete an asset.
 *
 * D1 first here, which is the opposite of upload and equally deliberate:
 * removing the row makes the asset unreachable immediately, and a failed
 * R2 delete leaves an orphan the scanner reclaims. Deleting from R2 first
 * would break a live invitation if the D1 delete then failed.
 *
 * An asset referenced by a published revision is refused outright.
 */
media.delete("/:invitationId/media/:assetId", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  const assetId = c.req.param("assetId");
  if (!isValidId(assetId)) return fail("not_found", 404);

  const asset = await c.env.DB.prepare(
    `SELECT id, storage_key AS storageKey, byte_size AS byteSize
     FROM media_assets WHERE id = ? AND invitation_id = ?`
  )
    .bind(assetId, access.invitationId)
    .first<{ id: string; storageKey: string; byteSize: number }>();
  if (!asset) return fail("not_found", 404);

  // Protected if referenced by ANY retained revision (relational first,
  // legacy manifest fallback for pre-V2 rows), not merely the live one.
  // Deleting the bytes behind a historical revision would make that
  // revision unreproducible, which defeats the point of keeping it.
  const referenced = await isAssetInAnyRevision(c.env, access.invitationId, assetId);
  if (referenced) return fail("asset_published", 409);

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM media_assets WHERE id = ?").bind(assetId),
    c.env.DB.prepare(
      "UPDATE invitations SET media_bytes = MAX(0, media_bytes - ?), updated_at = ? WHERE id = ?"
    ).bind(asset.byteSize, nowMs(), access.invitationId),
  ]);

  try {
    await c.env.MEDIA.delete(asset.storageKey);
  } catch {
    // Orphaned bytes only. The asset is already gone from the product's
    // point of view, so this is reported as success.
    return ok({ storageCleanupDeferred: true });
  }

  return ok({});
});
