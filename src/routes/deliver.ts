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
import { requireTenant } from "../lib/authz.js";
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

/** Published assets are listed in the live revision's media manifest. */
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

/**
 * A preview token grants access only to assets the previewed draft
 * actually references. Holding a token for an invitation is not blanket
 * permission to fetch every asset ever uploaded to it.
 */
async function hasPreviewAccess(
  req: Request,
  env: Env,
  invitationId: string,
  assetId: string
): Promise<boolean> {
  const url = new URL(req.url);
  const token = url.searchParams.get("preview");
  if (!token) return false;

  const row = await env.DB.prepare(
    `SELECT i.draft_json AS draftJson, p.invitation_id AS invitationId
     FROM preview_tokens p
     JOIN invitations i ON i.id = p.invitation_id
     WHERE p.token_hash = ? AND p.expires_at > ?`
  )
    .bind(await hashToken(token), nowMs())
    .first<{ draftJson: string | null; invitationId: string }>();

  // Token must be for this invitation...
  if (!row || row.invitationId !== invitationId || !row.draftJson) return false;

  // ...and the draft must actually reference this asset.
  try {
    const config = JSON.parse(row.draftJson) as Record<string, any>;
    for (const entry of Object.values(config.media ?? {})) {
      if ((entry as { assetId?: string | null })?.assetId === assetId) return true;
    }
    return config.music?.assetId === assetId;
  } catch {
    return false;
  }
}

/**
 * Tenant members may view their own draft assets in the admin UI.
 *
 * Routed through requireTenant rather than a private membership query, so
 * this path inherits the tenant-status gate. Re-implementing the check
 * here previously let a member of a *suspended* tenant keep pulling draft
 * media after every other surface had started refusing them.
 */
async function hasTenantAccess(req: Request, env: Env, tenantId: string): Promise<boolean> {
  try {
    await requireTenant(req, env, tenantId);
    return true;
  } catch {
    // Not signed in, not a member, or the tenant is suspended.
    return false;
  }
}

export async function serveMedia(req: Request, env: Env, assetId: string): Promise<Response> {
  if (!isValidId(assetId)) return fail("media_not_found", 404);

  const asset = await loadAsset(env, assetId);
  if (!asset) return fail("media_not_found", 404);

  const allowed =
    (await isPublished(env, assetId, asset.invitationId)) ||
    (await hasPreviewAccess(req, env, asset.invitationId, assetId)) ||
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
