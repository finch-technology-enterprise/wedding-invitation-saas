/**
 * Relational revision↔asset membership (V2 §1.2).
 *
 * media_manifest_json stays inside immutable revisions as a snapshot
 * artifact, but all lookups use revision_assets.
 */

import { nowMs } from "./time.js";

export interface RevisionAssetRow {
  assetId: string;
  slot: string;
}

/** Slots referenced by a validated config (media.* + music). */
export function slotsOf(config: Record<string, any>): RevisionAssetRow[] {
  const out: RevisionAssetRow[] = [];
  for (const [slot, entry] of Object.entries(config.media ?? {})) {
    const assetId = (entry as { assetId?: string | null })?.assetId;
    if (assetId) out.push({ assetId, slot });
  }
  const music = config.music?.assetId;
  if (music) out.push({ assetId: music, slot: "background_music" });
  return out;
}

export async function writeRevisionAssets(
  env: Env,
  revisionId: string,
  invitationId: string,
  rows: RevisionAssetRow[]
): Promise<void> {
  if (!rows.length) return;
  const now = nowMs();
  await env.DB.batch(
    rows.map((r) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO revision_assets
          (revision_id, invitation_id, asset_id, slot, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(revisionId, invitationId, r.assetId, r.slot, now)
    )
  );
}

/** Backfill from a legacy manifest (ordered by manifest order). */
export async function backfillRevisionAssets(
  env: Env,
  revisionId: string,
  invitationId: string,
  manifest: string[],
  slotByAssetId?: Map<string, string>
): Promise<number> {
  if (!manifest.length) return 0;
  const now = nowMs();
  let inserted = 0;
  const stmts = manifest.map((assetId) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO revision_assets
        (revision_id, invitation_id, asset_id, slot, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(revisionId, invitationId, assetId, slotByAssetId?.get(assetId) ?? "unknown", now)
  );
  // Batch in chunks to stay within D1 limits.
  for (let i = 0; i < stmts.length; i += 50) {
    const res = await env.DB.batch(stmts.slice(i, i + 50));
    for (const r of res) inserted += r.meta.changes ?? 0;
  }
  return inserted;
}

export async function isAssetInLiveRevision(
  env: Env,
  invitationId: string,
  assetId: string
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS hit FROM invitations i
     JOIN revision_assets ra ON ra.revision_id = i.published_revision_id
     WHERE i.id = ? AND i.status = 'published' AND ra.asset_id = ?`
  )
    .bind(invitationId, assetId)
    .first<{ hit: number }>();
  if (row) return true;
  // Fallback for pre-V2 revisions not yet backfilled.
  const legacy = await env.DB.prepare(
    `SELECT 1 AS hit FROM invitations i
     JOIN invitation_revisions r ON r.id = i.published_revision_id
     WHERE i.id = ? AND i.status = 'published' AND r.media_manifest_json LIKE ?`
  )
    .bind(invitationId, `%"${assetId}"%`)
    .first<{ hit: number }>();
  return legacy !== null;
}

export async function isAssetInAnyRevision(
  env: Env,
  invitationId: string,
  assetId: string
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS hit FROM revision_assets WHERE invitation_id = ? AND asset_id = ? LIMIT 1`
  )
    .bind(invitationId, assetId)
    .first<{ hit: number }>();
  if (row) return true;
  const legacy = await env.DB.prepare(
    `SELECT id FROM invitation_revisions
     WHERE invitation_id = ? AND media_manifest_json LIKE ? LIMIT 1`
  )
    .bind(invitationId, `%"${assetId}"%`)
    .first<{ id: string }>();
  return legacy !== null;
}

export async function assetIdsForRevision(env: Env, revisionId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT asset_id AS id FROM revision_assets WHERE revision_id = ?"
  )
    .bind(revisionId)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}
