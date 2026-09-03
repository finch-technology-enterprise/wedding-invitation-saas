/**
 * Public media delivery: GET /media/{assetId}
 *
 * Two rules govern this path:
 *
 *  1. Only assets referenced by a *published* revision are public. An
 *     uploaded-but-unpublished photo is visible to the tenant admin and to
 *     preview holders, never to a guest who guesses an ID.
 *  2. The R2 key is never derived from the URL. The asset ID is looked up
 *     in D1 and the stored key is used, so no request can address an
 *     arbitrary object in the bucket.
 */

import { fail } from "../lib/respond.js";
import { isValidId } from "../lib/ids.js";
import { resolveSession } from "../lib/session.js";
import { nowMs } from "../lib/time.js";
import { hashToken } from "../lib/session.js";

interface AssetRow {
  storageKey: string;
  mimeType: string;
  byteSize: number;
  invitationId: string;
  tenantId: string;
}

async function loadAsset(env: Env, assetId: string): Promise<AssetRow | null> {
  return env.DB.prepare(
    `SELECT storage_key AS storageKey, mime_type AS mimeType, byte_size AS byteSize,
            invitation_id AS invitationId, tenant_id AS tenantId
     FROM media_assets WHERE id = ?`
  )
    .bind(assetId)
    .first<AssetRow>();
}

/** Published assets are listed in the revision's media manifest. */
async function isPublished(env: Env, assetId: string, invitationId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS hit FROM invitations i
     JOIN invitation_revisions r ON r.id = i.published_revision_id
     WHERE i.id = ? AND i.status = 'published' AND r.media_manifest_json LIKE ?`
  )
    .bind(invitationId, `%"${assetId}"%`)
    .first<{ hit: number }>();
  return row !== null;
}

/** A valid preview token grants access to that invitation's draft assets. */
async function hasPreviewAccess(
  req: Request,
  env: Env,
  invitationId: string
): Promise<boolean> {
  const url = new URL(req.url);
  const token = url.searchParams.get("preview");
  if (!token) return false;

  const row = await env.DB.prepare(
    `SELECT invitation_id AS invitationId FROM preview_tokens
     WHERE token_hash = ? AND expires_at > ?`
  )
    .bind(await hashToken(token), nowMs())
    .first<{ invitationId: string }>();

  return row?.invitationId === invitationId;
}

/** Tenant members may view their own draft assets in the admin UI. */
async function hasTenantAccess(req: Request, env: Env, tenantId: string): Promise<boolean> {
  const ctx = await resolveSession(req, env);
  if (!ctx) return false;

  const row = await env.DB.prepare(
    "SELECT 1 AS hit FROM tenant_members WHERE tenant_id = ? AND user_id = ?"
  )
    .bind(tenantId, ctx.user.id)
    .first<{ hit: number }>();
  return row !== null;
}

export async function serveMedia(req: Request, env: Env, assetId: string): Promise<Response> {
  if (!isValidId(assetId)) return fail("media_not_found", 404);

  const asset = await loadAsset(env, assetId);
  if (!asset) return fail("media_not_found", 404);

  const allowed =
    (await isPublished(env, assetId, asset.invitationId)) ||
    (await hasPreviewAccess(req, env, asset.invitationId)) ||
    (await hasTenantAccess(req, env, asset.tenantId));

  // A draft asset is reported as missing, not forbidden: a 403 would
  // confirm the ID is real.
  if (!allowed) return fail("media_not_found", 404);

  // Keys are immutable, so the object's own etag is a complete validator.
  const etag = `"${assetId}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  const object = await env.MEDIA.get(asset.storageKey);
  if (!object) {
    // D1 has a row R2 cannot satisfy. This should be impossible given the
    // upload ordering; surfaced as 404 rather than a 500 so a single bad
    // asset degrades one image instead of the page.
    console.error("media_missing_in_r2", { assetId, key: asset.storageKey });
    return fail("media_not_found", 404);
  }

  return new Response(object.body, {
    headers: {
      "content-type": asset.mimeType,
      "content-length": String(asset.byteSize),
      // Safe to cache forever: a replacement is a new asset ID.
      "cache-control": "public, max-age=31536000, immutable",
      etag,
      // The bucket also holds audio; stop any content-type games.
      "x-content-type-options": "nosniff",
    },
  });
}
