/**
 * Public invitation resolution.
 *
 * One indexed query returns everything the renderer needs: invitation,
 * theme, published config and the media manifest. There is no second
 * round trip for configuration — WS6 inlines the result into the HTML, so
 * the guest never pays for a config waterfall.
 *
 * The published revision ID is the natural cache identity. Because a
 * revision is immutable, `slug + publishedRevisionId` uniquely names a
 * rendering; publishing writes a new revision ID, which changes the key
 * and makes the new version render without any explicit invalidation.
 */

import { hashToken } from "./session.js";
import { nowMs } from "./time.js";

export interface ResolvedInvitation {
  invitationId: string;
  tenantId: string;
  slug: string;
  title: string;
  themeId: string;
  revisionId: string;
  publishedAt: number | null;
  locale: string;
  shareTitle: string | null;
  shareDescription: string | null;
  shareImageAssetId: string | null;
  config: Record<string, unknown>;
  /** Asset IDs this revision is allowed to serve. */
  assetIds: string[];
  /** Slot → public URL, pre-resolved so the theme does no lookups. */
  mediaUrls: Record<string, string>;
  isPreview: boolean;
  party?: { id: string; title: string } | null;
}

interface Row {
  invitationId: string;
  tenantId: string;
  slug: string;
  title: string;
  themeId: string;
  revisionId: string;
  publishedAt: number | null;
  locale: string;
  shareTitle: string | null;
  shareDescription: string | null;
  shareImageAssetId: string | null;
  configJson: string;
  mediaManifestJson: string;
}

function build(row: Row, isPreview: boolean, party?: { id: string; title: string } | null): ResolvedInvitation {
  const config = JSON.parse(row.configJson) as Record<string, any>;
  const assetIds = JSON.parse(row.mediaManifestJson) as string[];

  // Media URLs are derived from the manifest rather than from the config's
  // raw asset IDs, so a slot can never point at an asset the revision does
  // not authorize.
  const allowed = new Set(assetIds);
  const mediaUrls: Record<string, string> = {};

  for (const [slot, entry] of Object.entries(config.media ?? {})) {
    const assetId = (entry as { assetId?: string | null })?.assetId;
    if (assetId && allowed.has(assetId)) {
      mediaUrls[slot] = `/media/${assetId}`;
    }
  }
  const musicAsset = config.music?.assetId;
  if (musicAsset && allowed.has(musicAsset)) {
    mediaUrls.background_music = `/media/${musicAsset}`;
  }

  return {
    invitationId: row.invitationId,
    tenantId: row.tenantId,
    slug: row.slug,
    title: row.title,
    themeId: row.themeId,
    revisionId: row.revisionId,
    publishedAt: row.publishedAt,
    locale: row.locale ?? "zh-CN",
    shareTitle: row.shareTitle ?? null,
    shareDescription: row.shareDescription ?? null,
    shareImageAssetId: row.shareImageAssetId ?? null,
    config,
    assetIds,
    mediaUrls,
    isPreview,
    party: party ?? null,
  };
}

// Joining tenants makes suspension effective on the public surface too:
// an operator suspending a tenant must take its invitations offline, not
// merely lock the tenant out of the admin.
const SELECT = `
  SELECT i.id AS invitationId, i.tenant_id AS tenantId, i.slug, i.title,
         i.theme_id AS themeId, i.published_at AS publishedAt,
         i.locale AS locale, i.share_title AS shareTitle,
         i.share_description AS shareDescription,
         i.share_image_asset_id AS shareImageAssetId,
         r.id AS revisionId, r.config_json AS configJson,
         r.media_manifest_json AS mediaManifestJson
  FROM invitations i
  JOIN invitation_revisions r ON r.id = i.published_revision_id
  JOIN tenants t ON t.id = i.tenant_id AND t.status = 'active'
`;

/**
 * Resolve the live invitation for a public slug. Uses idx_inv_slug; a
 * cache miss costs exactly one D1 query.
 */
export async function resolvePublishedInvitation(
  env: Env,
  slug: string
): Promise<ResolvedInvitation | null> {
  const row = await env.DB.prepare(`${SELECT} WHERE i.slug = ? AND i.status = 'published'`)
    .bind(slug)
    .first<Row>();

  return row ? build(row, false) : null;
}

/**
 * Resolve a draft preview from an opaque token.
 *
 * A preview renders the *draft*, which by definition has no revision yet,
 * so a synthetic revision is assembled from the draft config. The asset
 * manifest is computed from that draft — which is what scopes preview
 * media access to exactly the assets this preview references.
 */
export async function resolvePreviewInvitation(
  env: Env,
  token: string
): Promise<ResolvedInvitation | null> {
  const row = await env.DB.prepare(
    `SELECT i.id AS invitationId, i.tenant_id AS tenantId, i.slug, i.title,
            i.theme_id AS themeId, i.published_at AS publishedAt,
            i.locale AS locale, i.share_title AS shareTitle,
            i.share_description AS shareDescription,
            i.share_image_asset_id AS shareImageAssetId,
            i.draft_json AS draftJson, p.id AS tokenId
     FROM preview_tokens p
     JOIN invitations i ON i.id = p.invitation_id
     JOIN tenants t ON t.id = i.tenant_id AND t.status = 'active'
     WHERE p.token_hash = ? AND p.expires_at > ?`
  )
    .bind(await hashToken(token), nowMs())
    .first<{
      invitationId: string;
      tenantId: string;
      slug: string;
      title: string;
      themeId: string;
      publishedAt: number | null;
      locale: string;
      shareTitle: string | null;
      shareDescription: string | null;
      shareImageAssetId: string | null;
      draftJson: string | null;
      tokenId: string;
    }>();

  if (!row?.draftJson) return null;

  const config = JSON.parse(row.draftJson) as Record<string, any>;
  const assetIds: string[] = [];
  for (const entry of Object.values(config.media ?? {})) {
    const assetId = (entry as { assetId?: string | null })?.assetId;
    if (assetId) assetIds.push(assetId);
  }
  if (config.music?.assetId) assetIds.push(config.music.assetId);

  return build(
    {
      invitationId: row.invitationId,
      tenantId: row.tenantId,
      slug: row.slug,
      title: row.title,
      themeId: row.themeId,
      publishedAt: row.publishedAt,
      locale: row.locale ?? "zh-CN",
      shareTitle: row.shareTitle ?? null,
      shareDescription: row.shareDescription ?? null,
      shareImageAssetId: row.shareImageAssetId ?? null,
      // Previews are keyed by token, not by a revision that does not exist.
      revisionId: `draft-${row.tokenId}`,
      configJson: row.draftJson,
      mediaManifestJson: JSON.stringify(assetIds),
    },
    true
  );
}

/** Cache identity. Immutable revisions make this sufficient on its own. */
export function cacheKeyFor(resolved: ResolvedInvitation): string {
  return `/i/${resolved.slug}?rev=${resolved.revisionId}`;
}
