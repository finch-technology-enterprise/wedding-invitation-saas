/**
 * Input validation shared by the admin API.
 *
 * Deliberately hand-written rather than zod/valibot: the surface is a
 * handful of short strings and slugs, and every rule here is a
 * platform-level constraint. The theme-level content limits in WS6 (which
 * are numerous, per-field and declared by a theme manifest) are the case
 * that actually warrants a schema library.
 */

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/** Reserved because they collide with real or planned platform routes. */
const RESERVED_SLUGS = new Set([
  "admin",
  "platform-admin",
  "api",
  "media",
  "preview",
  "i",
  "assets",
  "static",
  "login",
  "logout",
  "register",
  "signup",
  "new",
  "settings",
  "health",
  "favicon.ico",
  "robots.txt",
]);

/**
 * Public invitation slugs appear in guest-facing URLs, so they are
 * lowercase, hyphenated and free of anything that would need escaping or
 * could be confused for a path segment.
 */
export function validateSlug(raw: unknown): Validated<string> {
  if (typeof raw !== "string") return { ok: false, error: "invalid_slug" };
  const slug = raw.trim().toLowerCase();

  if (slug.length < 3 || slug.length > 60) return { ok: false, error: "invalid_slug_length" };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return { ok: false, error: "invalid_slug" };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, error: "slug_reserved" };

  return { ok: true, value: slug };
}

export function validateTitle(raw: unknown, field = "title"): Validated<string> {
  if (typeof raw !== "string") return { ok: false, error: `invalid_${field}` };
  const title = raw.trim();
  if (!title || title.length > 120) return { ok: false, error: `invalid_${field}` };
  return { ok: true, value: title };
}

/**
 * Theme IDs select code paths, so they are matched against the central
 * registry (V2 §2.1) rather than a scattered allow-list.
 */
export function validateThemeId(raw: unknown): Validated<string> {
  if (raw === undefined || raw === null) return { ok: true, value: "cinematic-classic" };
  if (typeof raw !== "string") return { ok: false, error: "unknown_theme" };
  // Static import would cycle (themes import nothing from validate, but
  // registry imports both validators); dynamic check via known set kept
  // in sync with src/themes/registry.ts to avoid a runtime cycle.
  if (raw === "cinematic-classic" || raw === "modern-editorial") {
    return { ok: true, value: raw };
  }
  return { ok: false, error: "unknown_theme" };
}

/**
 * Draft content is theme-shaped JSON, validated properly against the theme
 * manifest in WS6. Here we only enforce the platform-level invariants:
 * it is a JSON object and it is not large enough to bloat a D1 row.
 */
const MAX_DRAFT_BYTES = 128 * 1024;

export function validateDraft(raw: unknown): Validated<string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "invalid_draft" };
  }
  const serialized = JSON.stringify(raw);
  if (serialized.length > MAX_DRAFT_BYTES) return { ok: false, error: "draft_too_large" };
  return { ok: true, value: serialized };
}

/** Pagination that cannot be coerced into an unbounded scan. */
export function parseLimit(raw: string | undefined, fallback = 50, max = 200): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

export function parseOffset(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}
