/**
 * Draft → preview → publish engine: /api/v1/invitations/:id/{draft,publish,...}
 *
 * The guarantee this module exists to provide: a guest always sees one
 * coherent revision. Never new copy with an old venue, never a new photo
 * with a stale focal point, never a half-saved config.
 *
 * That falls out of two decisions rather than defensive checks:
 *   1. A published revision is an immutable snapshot of the *whole* config.
 *   2. Going live is a single pointer flip inside one D1 batch.
 */

import { Hono } from "hono";
import { fail, ok } from "../lib/respond.js";
import { newId, newToken, isValidId } from "../lib/ids.js";
import { nowMs } from "../lib/time.js";
import { isSameOrigin } from "../lib/guard.js";
import { requireInvitation } from "../lib/authz.js";
import { hashToken } from "../lib/session.js";
import { getTheme } from "../themes/registry.js";
import { loadInvitationForDraft, writeDraft } from "../lib/drafts.js";
import { slotsOf, writeRevisionAssets } from "../lib/revisionAssets.js";
import { snapshotForm } from "./rsvp.js";

export const publish = new Hono<{ Bindings: Env }>();

publish.use("/*", async (c, next) => {
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
    const parsed = await c.req.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Confirm every referenced asset belongs to this invitation and fits its
 * slot. An asset ID inside draft JSON is just a string the client sent —
 * ownership is re-derived here, never inferred.
 */
async function validateAssetReferences(
  env: Env,
  invitationId: string,
  config: Record<string, any>
): Promise<{ path: string; code: string }[]> {
  const errors: { path: string; code: string }[] = [];

  const wanted: Array<{ assetId: string; path: string; expected: "image" | "audio" }> = [];
  const media = (config.media ?? {}) as Record<string, { assetId?: string | null }>;
  for (const [slot, entry] of Object.entries(media)) {
    if (entry?.assetId) wanted.push({ assetId: entry.assetId, path: `media.${slot}`, expected: "image" });
  }
  const musicAsset = (config.music as { assetId?: string | null } | undefined)?.assetId;
  if (musicAsset) {
    wanted.push({ assetId: musicAsset, path: "music", expected: "audio" });
  }
  if (!wanted.length) return errors;

  // Scoped by invitation: an asset from another invitation — even inside
  // the same tenant — simply will not be found.
  const placeholders = wanted.map(() => "?").join(", ");
  const { results } = await env.DB.prepare(
    `SELECT id, kind FROM media_assets WHERE invitation_id = ? AND id IN (${placeholders})`
  )
    .bind(invitationId, ...wanted.map((w) => w.assetId))
    .all<{ id: string; kind: string }>();

  const found = new Map(results.map((r) => [r.id, r.kind]));

  for (const want of wanted) {
    const kind = found.get(want.assetId);
    if (!kind) {
      errors.push({ path: want.path, code: "asset_not_found" });
    } else if (kind !== want.expected) {
      errors.push({ path: want.path, code: "asset_kind_mismatch" });
    }
  }

  return errors;
}

// -------------------------------------------------------------------- draft

publish.get("/:invitationId/draft", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));

  const row = await c.env.DB.prepare(
    `SELECT draft_json AS draftJson, draft_updated_at AS draftUpdatedAt,
            draft_version AS draftVersion, theme_id AS themeId,
            published_revision_id AS publishedRevisionId, status
     FROM invitations WHERE id = ?`
  )
    .bind(access.invitationId)
    .first<{
      draftJson: string | null;
      draftUpdatedAt: number | null;
      draftVersion: number | null;
      themeId: string;
      publishedRevisionId: string | null;
      status: string;
    }>();

  const theme = getTheme(row?.themeId ?? "cinematic-classic");
  return ok({
    draft: row?.draftJson ? JSON.parse(row.draftJson) : null,
    draftUpdatedAt: row?.draftUpdatedAt ?? null,
    draftVersion: row?.draftVersion ?? 1,
    status: row?.status ?? "draft",
    hasPublished: Boolean(row?.publishedRevisionId),
    manifest: theme?.manifest ?? null,
    theme: theme ? { id: theme.id, displayName: theme.displayName, version: theme.version } : null,
  });
});

/**
 * Save the draft. Single canonical path (V2 §1.1): theme validation via
 * the registry + ownership check + optimistic concurrency. Invalid configs
 * fail here, never silently at publish time.
 */
publish.put("/:invitationId/draft", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));

  const body = await readJson(c);
  if (!body) return fail("invalid_body");

  const stored = await loadInvitationForDraft(c.env, access.invitationId);
  if (!stored) return fail("not_found", 404);

  const rawExpected = (body as Record<string, unknown>).expectedVersion;
  const expectedVersion =
    typeof rawExpected === "number" && Number.isInteger(rawExpected) ? rawExpected : null;
  // expectedVersion is required for concurrency protection, but legacy
  // clients that omit it still get full validation (no silent weak path).
  const result = await writeDraft(c.env, stored, (body as Record<string, unknown>).config ?? body, {
    expectedVersion,
    updatedBy: access.auth.user.id,
  });
  if (!result.ok) {
    if (result.error === "draft_conflict") {
      return fail("draft_conflict", 409, { draftVersion: result.draftVersion });
    }
    return fail("invalid_config", 422, { errors: result.errors ?? [] });
  }

  return ok({ draftUpdatedAt: result.draftUpdatedAt, draftVersion: result.draftVersion });
});

// ------------------------------------------------------------------ publish

/**
 * Publish.
 *
 * Validate → resolve snapshot → one atomic batch. If any step before the
 * batch fails, nothing changed. If the batch itself fails, D1 rolls the
 * whole thing back, so `published_revision_id` still points at the
 * previous good revision and the live invitation is untouched.
 */
publish.post("/:invitationId/publish", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));

  const row = await c.env.DB.prepare(
    "SELECT draft_json AS draftJson, theme_id AS themeId FROM invitations WHERE id = ?"
  )
    .bind(access.invitationId)
    .first<{ draftJson: string | null; themeId: string }>();

  if (!row?.draftJson) return fail("nothing_to_publish", 409);

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.draftJson);
  } catch {
    return fail("invalid_config", 422, { errors: [{ path: "", code: "corrupt_draft" }] });
  }

  // Re-validate at publish time via the registry: limits may have
  // tightened, or a referenced asset may have been deleted.
  const theme = getTheme(row.themeId ?? "cinematic-classic");
  if (!theme) return fail("unknown_theme", 422);
  const result = theme.validate(parsed);
  if (!result.ok || !result.config) return fail("invalid_config", 422, { errors: result.errors ?? [] });

  const assetErrors = await validateAssetReferences(c.env, access.invitationId, result.config as Record<string, any>);
  if (assetErrors.length) return fail("invalid_config", 422, { errors: assetErrors });

  const revisionId = newId();
  const now = nowMs();
  const body = await readJson(c);
  const note = typeof body?.note === "string" ? body.note.slice(0, 200) : null;

  // Pin the RSVP schema into the revision. Guests must be validated
  // against the form they were actually shown, so editing the form
  // afterwards cannot retroactively invalidate replies to the live
  // version — the draft only takes effect on the next publish.
  const rsvpForm = await snapshotForm(c.env, access.invitationId);
  const publishedConfig = { ...(result.config as Record<string, unknown>), rsvpForm };

  // The manifest lists exactly the assets this revision needs (snapshot
  // artifact); revision_assets is the authoritative relational lookup.
  const manifest = result.assetIds ?? [];
  const slots = slotsOf(result.config as Record<string, any>);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO invitation_revisions
         (id, invitation_id, config_json, media_manifest_json, created_by, created_at, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      revisionId,
      access.invitationId,
      JSON.stringify(publishedConfig),
      JSON.stringify(manifest),
      access.auth.user.id,
      now,
      note
    ),
    c.env.DB.prepare(
      `UPDATE invitations
       SET published_revision_id = ?, status = 'published', published_at = ?, updated_at = ?
       WHERE id = ?`
    ).bind(revisionId, now, now, access.invitationId),
    ...slots.map((s) =>
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO revision_assets
          (revision_id, invitation_id, asset_id, slot, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(revisionId, access.invitationId, s.assetId, s.slot, now)
    ),
  ]);
  // Keep helper import referenced for backfill paths.
  void writeRevisionAssets;

  return ok({ revisionId, publishedAt: now });
});

/**
 * Unpublish removes the invitation from public view without destroying
 * anything: the pointer, the revision history, the draft and the media all
 * survive, so republishing is always possible.
 */
publish.post("/:invitationId/unpublish", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));

  await c.env.DB.prepare(
    `UPDATE invitations SET status = 'unpublished', updated_at = ?
     WHERE id = ? AND status = 'published'`
  )
    .bind(nowMs(), access.invitationId)
    .run();

  return ok({});
});

publish.get("/:invitationId/revisions", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));

  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.created_at AS createdAt, r.note,
            r.media_manifest_json AS mediaManifestJson,
            (r.id = i.published_revision_id) AS isLive
     FROM invitation_revisions r
     JOIN invitations i ON i.id = r.invitation_id
     WHERE r.invitation_id = ?
     ORDER BY r.created_at DESC
     LIMIT 100`
  )
    .bind(access.invitationId)
    .all<{ id: string; createdAt: number; note: string | null; mediaManifestJson: string; isLive: number }>();

  return ok({
    revisions: results.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      note: r.note,
      isLive: r.isLive === 1,
      assetCount: (JSON.parse(r.mediaManifestJson) as string[]).length,
    })),
  });
});

// --------------------------------------------------------------------- diff

/** Structured, section-level comparison. Enough for an admin to see what
 * publishing would change; not a text diff engine. */
function diffSections(
  draft: Record<string, any> | null,
  published: Record<string, any> | null
): { changed: string[]; mediaChanged: string[]; hasChanges: boolean } {
  const changed: string[] = [];
  const mediaChanged: string[] = [];

  if (!published) {
    return {
      changed: draft ? ["everything"] : [],
      mediaChanged: [],
      hasChanges: Boolean(draft),
    };
  }
  if (!draft) return { changed: [], mediaChanged: [], hasChanges: false };

  for (const section of ["couple", "date", "copy", "venue", "rsvp", "music", "motion"]) {
    if (JSON.stringify(draft[section]) !== JSON.stringify(published[section])) {
      changed.push(section);
    }
  }

  const slots = new Set([...Object.keys(draft.media ?? {}), ...Object.keys(published.media ?? {})]);
  for (const slot of slots) {
    if (JSON.stringify(draft.media?.[slot]) !== JSON.stringify(published.media?.[slot])) {
      mediaChanged.push(slot);
    }
  }

  return { changed, mediaChanged, hasChanges: changed.length > 0 || mediaChanged.length > 0 };
}

publish.get("/:invitationId/diff", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));

  const row = await c.env.DB.prepare(
    `SELECT i.draft_json AS draftJson, r.config_json AS publishedJson
     FROM invitations i
     LEFT JOIN invitation_revisions r ON r.id = i.published_revision_id
     WHERE i.id = ?`
  )
    .bind(access.invitationId)
    .first<{ draftJson: string | null; publishedJson: string | null }>();

  const draft = row?.draftJson ? JSON.parse(row.draftJson) : null;
  const published = row?.publishedJson ? JSON.parse(row.publishedJson) : null;

  return ok(diffSections(draft, published));
});

// ------------------------------------------------------------------ preview

const PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Mint a preview link. The raw token is returned exactly once and only its
 * hash is stored, so the database cannot be used to recover live preview
 * URLs. Scope is a single invitation.
 */
publish.post("/:invitationId/preview", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));

  const token = newToken(32);
  const id = newId();
  const now = nowMs();

  await c.env.DB.prepare(
    `INSERT INTO preview_tokens (id, invitation_id, token_hash, scope, expires_at, created_by, created_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?)`
  )
    .bind(id, access.invitationId, await hashToken(token), now + PREVIEW_TTL_MS, access.auth.user.id, now)
    .run();

  return ok({
    id,
    token,
    url: `/preview/${token}`,
    expiresAt: now + PREVIEW_TTL_MS,
  });
});

publish.get("/:invitationId/preview", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));

  const { results } = await c.env.DB.prepare(
    `SELECT id, scope, expires_at AS expiresAt, created_at AS createdAt
     FROM preview_tokens WHERE invitation_id = ? ORDER BY created_at DESC`
  )
    .bind(access.invitationId)
    .all();

  // Deliberately no token/hash in the response.
  return ok({ tokens: results });
});

publish.delete("/:invitationId/preview/:tokenId", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  const tokenId = c.req.param("tokenId");
  if (!isValidId(tokenId)) return fail("not_found", 404);

  // Scoped by invitation so a token ID from elsewhere matches nothing.
  const result = await c.env.DB.prepare(
    "DELETE FROM preview_tokens WHERE id = ? AND invitation_id = ?"
  )
    .bind(tokenId, access.invitationId)
    .run();

  if (!result.meta.changes) return fail("not_found", 404);
  return ok({});
});
