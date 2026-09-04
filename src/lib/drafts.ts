/**
 * Canonical draft mutation service (V2 §1.1, §1.3, §1.4).
 *
 * One validation path for every draft write. Theme validation is always
 * server-authoritative (dispatched through the theme registry), media
 * ownership is always verified, focal is canonical
 * (media.{slot}.focal), and writes carry optimistic concurrency via
 * draft_version.
 */

import { newId } from "./ids.js";
import { nowMs } from "./time.js";
import { getTheme } from "../themes/registry.js";

export interface DraftWriteResult {
  ok: boolean;
  error?: string;
  errors?: Array<{ path: string; code: string }>;
  draftVersion?: number;
  draftUpdatedAt?: number;
}

interface StoredInvitation {
  id: string;
  theme_id: string;
  draft_json: string | null;
  draft_version: number | null;
}

export function migrateLegacyFocal(
  draft: Record<string, unknown>,
  slotByAssetId: Map<string, string>
): Record<string, unknown> {
  const legacy = (draft as Record<string, unknown>).focal as
    | Record<string, { x: number; y: number }>
    | undefined;
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return draft;
  const media = { ...((draft.media as Record<string, unknown>) ?? {}) };
  for (const [assetId, focal] of Object.entries(legacy)) {
    const slot = slotByAssetId.get(assetId);
    if (!slot) continue;
    const entry = { ...((media[slot] as Record<string, unknown>) ?? {}) };
    if (entry.assetId === assetId && entry.focal === undefined) {
      entry.focal = focal;
      media[slot] = entry;
    }
  }
  const next = { ...draft, media };
  delete (next as Record<string, unknown>).focal;
  return next;
}

export async function validateDraftForTheme(
  env: Env,
  invitationId: string,
  themeId: string,
  input: unknown
): Promise<
  | { ok: true; config: Record<string, unknown>; assetIds: string[] }
  | { ok: false; errors: Array<{ path: string; code: string }> }
> {
  const theme = getTheme(themeId);
  if (!theme) {
    return { ok: false, errors: [{ path: "themeId", code: "unknown_theme" }] };
  }
  let candidate = input;
  // Best-effort legacy focal migration before strict validation: map
  // draft.focal.{assetId} onto media.{slot}.focal using stored slots.
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    const maybeLegacy = (candidate as Record<string, unknown>).focal;
    if (maybeLegacy && typeof maybeLegacy === "object") {
      try {
        const { results } = await env.DB.prepare(
          "SELECT id, slot FROM media_assets WHERE invitation_id = ?"
        )
          .bind(invitationId)
          .all<{ id: string; slot: string | null }>();
        const slotByAsset = new Map(
          results.filter((r) => r.slot).map((r) => [r.id, r.slot as string])
        );
        candidate = migrateLegacyFocal(candidate as Record<string, unknown>, slotByAsset);
      } catch {
        /* fall through to strict validation */
      }
    }
  }
  const result = theme.validate(candidate);
  if (!result.ok || !result.config) {
    return { ok: false, errors: result.errors ?? [{ path: "", code: "invalid_config" }] };
  }

  // Ownership + kind: every referenced asset must belong to this
  // invitation and fit its slot (images in photo slots, audio as music).
  const wanted: string[] = result.assetIds ?? [];
  if (wanted.length) {
    const placeholders = wanted.map(() => "?").join(", ");
    const { results } = await env.DB.prepare(
      `SELECT id, kind FROM media_assets WHERE invitation_id = ? AND id IN (${placeholders})`
    )
      .bind(invitationId, ...wanted)
      .all<{ id: string; kind: string }>();
    const kindById = new Map(results.map((r) => [r.id, r.kind]));
    const missing = wanted.filter((id) => !kindById.has(id));
    if (missing.length) {
      return {
        ok: false,
        errors: missing.slice(0, 8).map((id) => ({ path: `media(asset:${id.slice(0, 8)})`, code: "asset_not_found" })),
      };
    }
    const cfg = result.config as Record<string, any>;
    const kindErrors: Array<{ path: string; code: string }> = [];
    for (const [slot, entry] of Object.entries((cfg.media as Record<string, any>) ?? {})) {
      const assetId = (entry as { assetId?: string | null })?.assetId;
      if (assetId && kindById.get(assetId) !== "image") {
        kindErrors.push({ path: `media.${slot}`, code: "asset_kind_mismatch" });
      }
    }
    const musicId = (cfg.music as { assetId?: string | null } | undefined)?.assetId;
    if (musicId && kindById.get(musicId) !== "audio") {
      kindErrors.push({ path: "music", code: "asset_kind_mismatch" });
    }
    if (kindErrors.length) return { ok: false, errors: kindErrors };
  }
  return { ok: true, config: result.config, assetIds: wanted };
}

/**
 * Canonical draft write. expectedVersion enforces optimistic concurrency;
 * pass null to skip the check (backfill paths only).
 */
export async function writeDraft(
  env: Env,
  invitation: StoredInvitation,
  input: unknown,
  opts: { expectedVersion?: number | null; updatedBy: string }
): Promise<DraftWriteResult> {
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== null) {
    const current = invitation.draft_version ?? 1;
    if (opts.expectedVersion !== current) {
      return { ok: false, error: "draft_conflict", draftVersion: current };
    }
  }
  const validated = await validateDraftForTheme(env, invitation.id, invitation.theme_id, input);
  if (!validated.ok) {
    return { ok: false, error: "invalid_config", errors: (validated as { errors: DraftWriteResult["errors"] }).errors };
  }
  const now = nowMs();
  const nextVersion = (invitation.draft_version ?? 1) + 1;
  const config = validated as { config: Record<string, unknown> };
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== null) {
    const res = await env.DB.prepare(
      `UPDATE invitations SET draft_json = ?, draft_updated_at = ?, draft_updated_by = ?,
        draft_version = ?, updated_at = ? WHERE id = ? AND draft_version = ?`
    )
      .bind(JSON.stringify(config.config), now, opts.updatedBy, nextVersion, now, invitation.id, opts.expectedVersion)
      .run();
    if (!res.meta.changes) {
      const row = await env.DB.prepare("SELECT draft_version AS v FROM invitations WHERE id = ?")
        .bind(invitation.id)
        .first<{ v: number }>();
      return { ok: false, error: "draft_conflict", draftVersion: row?.v ?? nextVersion };
    }
  } else {
    await env.DB.prepare(
      `UPDATE invitations SET draft_json = ?, draft_updated_at = ?, draft_updated_by = ?,
        draft_version = ?, updated_at = ? WHERE id = ?`
    )
      .bind(JSON.stringify(config.config), now, opts.updatedBy, nextVersion, now, invitation.id)
      .run();
  }
  return { ok: true, draftVersion: nextVersion, draftUpdatedAt: now };
}

export async function loadInvitationForDraft(
  env: Env,
  invitationId: string
): Promise<StoredInvitation | null> {
  return env.DB.prepare(
    "SELECT id, theme_id, draft_json, draft_version FROM invitations WHERE id = ?"
  )
    .bind(invitationId)
    .first<StoredInvitation>();
}

export function newDraftVersion(): number {
  return 1;
}

export function draftId(): string {
  return newId();
}
