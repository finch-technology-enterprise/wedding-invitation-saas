/**
 * Theme manifest + config schema for `cinematic-classic`.
 *
 * This is the contract between the platform and the frozen invitation. The
 * platform never inspects theme internals; it validates a config against
 * this manifest and hands the result to the renderer as bootstrap data.
 *
 * CONTENT LIMITS ARE NOT ARBITRARY. The cinematic composition was designed
 * around bounded text: scene heights, reveal timings and the 10rem canvas
 * all assume copy of roughly the accepted length. Every `max` below is
 * derived from the longest value in the accepted baseline plus deliberate
 * headroom, so a tenant has room to write their own words without the
 * layout being redesigned to accommodate an arbitrarily long string.
 *
 * The measured maxima of the accepted baseline (characters) were:
 *   copy.time.quote 36 · copy.rsvp.errors.contact 24 · cover.welcome 22
 *   story.invite 20 · closing.thanks 18 · poem.heading 13 · names 13
 */

export const THEME_ID = "cinematic-classic";
export const THEME_VERSION = 1;

/** Scenes, in fixed composition order. Order is theme-owned, not editable. */
export const SCENES = [
  "cover",
  "names",
  "poem",
  "portrait",
  "story",
  "landscape",
  "time",
  "venue",
  "closing",
  "rsvp",
] as const;

export type SceneId = (typeof SCENES)[number];

/**
 * Media slots and the aspect ratio each occupies. Ratios are part of the
 * frozen composition: the placeholder holds the same shape whether or not
 * a photograph has been supplied, so supplying one cannot reflow the page.
 */
export const MEDIA_SLOTS = {
  hero: { kind: "image", ratio: "825 / 1000", focal: true, scene: "cover" },
  portrait: { kind: "image", ratio: "666 / 1000", focal: true, scene: "portrait" },
  story: { kind: "image", ratio: "1 / 1", focal: true, scene: "story" },
  landscape: { kind: "image", ratio: "1418 / 1000", focal: true, scene: "landscape" },
  venue: { kind: "image", ratio: "1110 / 1000", focal: true, scene: "venue" },
  closing: { kind: "image", ratio: "1 / 1", focal: true, scene: "closing" },
  background_music: { kind: "audio", ratio: null, focal: false, scene: null },
} as const;

export type SlotId = keyof typeof MEDIA_SLOTS;

export const IMAGE_SLOTS = Object.entries(MEDIA_SLOTS)
  .filter(([, v]) => v.kind === "image")
  .map(([k]) => k) as SlotId[];

/**
 * Field limits. `max` is the hard validation ceiling; `accepted` records
 * what the frozen baseline actually uses, so the headroom is auditable.
 */
interface FieldLimit {
  max: number;
  accepted: number;
  /** Multi-line fields permit \n; single-line fields strip it. */
  multiline?: boolean;
}

export const FIELD_LIMITS = {
  "couple.groom.zh": { max: 24, accepted: 3 },
  "couple.groom.en": { max: 40, accepted: 13 },
  "couple.bride.zh": { max: 24, accepted: 3 },
  "couple.bride.en": { max: 40, accepted: 13 },

  "date.lunar": { max: 24, accepted: 6 },
  "date.timeLabel": { max: 12, accepted: 5 },

  "copy.cover.bracket": { max: 24, accepted: 8 },
  "copy.cover.welcome": { max: 48, accepted: 22 },

  "copy.poem.heading": { max: 32, accepted: 13 },
  "copy.poem.motif": { max: 8, accepted: 3 },
  "copy.poem.lines": { max: 28, accepted: 13 },
  "copy.poem.after": { max: 28, accepted: 13 },

  "copy.portrait.brideLabel": { max: 12, accepted: 2 },
  "copy.portrait.groomLabel": { max: 12, accepted: 2 },

  "copy.story.heading": { max: 32, accepted: 11, multiline: true },
  "copy.story.announce": { max: 24, accepted: 6 },
  "copy.story.badge": { max: 16, accepted: 5 },
  "copy.story.invite": { max: 40, accepted: 20, multiline: true },
  "copy.story.letter": { max: 28, accepted: 14 },
  "copy.story.caption": { max: 36, accepted: 16 },

  "copy.time.heading": { max: 16, accepted: 4 },
  "copy.time.quote": { max: 64, accepted: 36 },

  "copy.venue.heading": { max: 16, accepted: 4 },
  "copy.venue.tbaName": { max: 24, accepted: 6 },
  "copy.venue.tbaNote": { max: 32, accepted: 9 },
  "copy.venue.mapLabel": { max: 16, accepted: 4 },
  "copy.venue.calendarLabel": { max: 16, accepted: 4 },

  "copy.closing.poem": { max: 28, accepted: 10 },
  "copy.closing.thanks": { max: 40, accepted: 18 },
  "copy.closing.thanksLine2": { max: 16, accepted: 3 },

  "copy.rsvp.heading": { max: 16, accepted: 4 },
  "copy.rsvp.deadlineLabel": { max: 40, accepted: 17 },
  "copy.rsvp.name": { max: 12, accepted: 2 },
  "copy.rsvp.attending": { max: 16, accepted: 4 },
  "copy.rsvp.yes": { max: 16, accepted: 4 },
  "copy.rsvp.no": { max: 16, accepted: 4 },
  "copy.rsvp.guests": { max: 16, accepted: 4 },
  "copy.rsvp.optionalToggle": { max: 32, accepted: 11 },
  "copy.rsvp.optionalToggleOpen": { max: 24, accepted: 4 },
  "copy.rsvp.phone": { max: 16, accepted: 4 },
  "copy.rsvp.instagram": { max: 16, accepted: 9 },
  "copy.rsvp.contactHint": { max: 40, accepted: 20 },
  "copy.rsvp.message": { max: 16, accepted: 4 },
  "copy.rsvp.submit": { max: 12, accepted: 4 },
  "copy.rsvp.submitting": { max: 16, accepted: 4 },
  "copy.rsvp.successTitle": { max: 16, accepted: 3 },
  "copy.rsvp.successBody": { max: 48, accepted: 12 },
  "copy.rsvp.errors.name": { max: 32, accepted: 5 },
  "copy.rsvp.errors.contact": { max: 48, accepted: 24 },
  "copy.rsvp.errors.network": { max: 48, accepted: 15 },
  "copy.rsvp.errors.server": { max: 48, accepted: 12 },

  "venue.name": { max: 40, accepted: 0 },
  "venue.address": { max: 120, accepted: 0, multiline: true },
} satisfies Record<string, FieldLimit>;

/** Max entries in the repeated-line arrays, again from the composition. */
export const LIST_LIMITS = {
  "copy.poem.lines": { max: 5, accepted: 3 },
  "copy.poem.after": { max: 5, accepted: 3 },
  "copy.story.letter": { max: 8, accepted: 6 },
  "copy.closing.poem": { max: 6, accepted: 4 },
} as const;

export interface ThemeManifest {
  id: string;
  version: number;
  scenes: readonly string[];
  mediaSlots: typeof MEDIA_SLOTS;
  fieldLimits: typeof FIELD_LIMITS;
  listLimits: typeof LIST_LIMITS;
  focal: { min: number; max: number; default: { x: number; y: number } };
  motion: { driftPxPerSec: { min: number; max: number; default: number } };
}

/**
 * Motion bounds. The default is the accepted drift rate — the pace at
 * which the reference's copy stays readable. The range is deliberately
 * narrow: this is a tuning control, not a redesign lever.
 */
export const MANIFEST: ThemeManifest = {
  id: THEME_ID,
  version: THEME_VERSION,
  scenes: SCENES,
  mediaSlots: MEDIA_SLOTS,
  fieldLimits: FIELD_LIMITS,
  listLimits: LIST_LIMITS,
  focal: { min: 0, max: 100, default: { x: 50, y: 50 } },
  motion: { driftPxPerSec: { min: 30, max: 70, default: 46 } },
};

// ------------------------------------------------------------- validation

export interface FieldError {
  path: string;
  code: string;
  limit?: number;
  actual?: number;
}

/** Grapheme-ish length. CJK copy is what the limits were measured against,
 * so count code points rather than UTF-16 units. */
function charLength(s: string): number {
  return [...s].length;
}

function getLimit(path: string): FieldLimit | undefined {
  return (FIELD_LIMITS as Record<string, FieldLimit>)[path];
}

function checkString(value: unknown, path: string, errors: FieldError[]): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    errors.push({ path, code: "expected_string" });
    return undefined;
  }

  const limit = getLimit(path);
  if (limit) {
    const length = charLength(value);
    if (length > limit.max) {
      errors.push({ path, code: "too_long", limit: limit.max, actual: length });
      return undefined;
    }
    if (!limit.multiline && value.includes("\n")) {
      errors.push({ path, code: "no_newlines" });
      return undefined;
    }
  }
  return value;
}

function checkList(value: unknown, path: string, errors: FieldError[]): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    errors.push({ path, code: "expected_array" });
    return undefined;
  }

  const listLimit = (LIST_LIMITS as Record<string, { max: number }>)[path];
  if (listLimit && value.length > listLimit.max) {
    errors.push({ path, code: "too_many_items", limit: listLimit.max, actual: value.length });
    return undefined;
  }

  const out: string[] = [];
  value.forEach((entry, i) => {
    const checked = checkString(entry, path, errors);
    if (checked === undefined && entry !== undefined) {
      // checkString already recorded the error; annotate the index.
      const last = errors[errors.length - 1];
      if (last && last.path === path) last.path = `${path}[${i}]`;
      return;
    }
    if (checked !== undefined) out.push(checked);
  });
  return out;
}

/** ISO-8601 with an explicit offset. Everything date-derived depends on it. */
function checkDate(value: unknown, path: string, errors: FieldError[]): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)$/.test(value)) {
    errors.push({ path, code: "invalid_datetime" });
    return undefined;
  }
  if (Number.isNaN(Date.parse(value))) {
    errors.push({ path, code: "invalid_datetime" });
    return undefined;
  }
  return value;
}

function checkFocal(value: unknown, path: string, errors: FieldError[]): { x: number; y: number } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") {
    errors.push({ path, code: "invalid_focal" });
    return undefined;
  }
  const { x, y } = value as Record<string, unknown>;
  const inRange = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && n >= MANIFEST.focal.min && n <= MANIFEST.focal.max;

  if (!inRange(x) || !inRange(y)) {
    errors.push({ path, code: "focal_out_of_range", limit: MANIFEST.focal.max });
    return undefined;
  }
  return { x, y };
}

export interface ValidatedConfig {
  themeId: string;
  themeVersion: number;
  couple: Record<string, { zh?: string; en?: string }>;
  date: { iso: string; lunar?: string; timeLabel?: string; durationHours: number };
  copy: Record<string, unknown>;
  venue: { tba: boolean; name?: string; address?: string; mapsUrl?: string };
  rsvp: { deadlineISO?: string; maxGuests: number };
  media: Record<string, { assetId: string | null; focal?: { x: number; y: number } }>;
  music: { assetId: string | null; enabled: boolean; title?: string };
  motion: { driftPxPerSec: number };
}

export interface ValidationResult {
  ok: boolean;
  errors: FieldError[];
  config?: ValidatedConfig;
  /** Asset IDs referenced by this config — the publish manifest. */
  assetIds?: string[];
}

/**
 * The complete set of accepted configuration paths, derived from the
 * manifest so the schema stays the single source of truth.
 *
 * Anything not described here is rejected rather than dropped: silently
 * discarding a key loses tenant data, turns a typo into a mystery, and
 * makes import/export ambiguous. A future theme version that wants
 * forward-compatible extras must declare an explicit namespace for them,
 * not rely on arbitrary keys being tolerated.
 */
function buildAllowedPaths(): Set<string> {
  const allowed = new Set<string>([
    // Stamped by validation; accepted on input so a round-tripped config
    // (export → import) does not fail on its own metadata.
    "themeId",
    "themeVersion",
    "couple",
    "couple.groom",
    "couple.groom.zh",
    "couple.groom.en",
    "couple.bride",
    "couple.bride.zh",
    "couple.bride.en",
    "date",
    "date.iso",
    "date.lunar",
    "date.timeLabel",
    "date.durationHours",
    "venue",
    "venue.tba",
    "venue.name",
    "venue.address",
    "venue.mapsUrl",
    "rsvp",
    "rsvp.deadlineISO",
    "rsvp.maxGuests",
    "media",
    "music",
    "music.assetId",
    "music.enabled",
    "music.title",
    "motion",
    "motion.driftPxPerSec",
    "copy",
  ]);

  // Copy paths and their intermediate containers.
  for (const path of Object.keys(FIELD_LIMITS)) {
    const parts = path.split(".");
    for (let i = 1; i <= parts.length; i++) allowed.add(parts.slice(0, i).join("."));
  }

  // Media slots plus their per-slot properties.
  for (const slot of Object.keys(MEDIA_SLOTS)) {
    if (slot === "background_music") continue; // audio lives under `music`
    allowed.add(`media.${slot}`);
    allowed.add(`media.${slot}.assetId`);
    allowed.add(`media.${slot}.focal`);
    allowed.add(`media.${slot}.focal.x`);
    allowed.add(`media.${slot}.focal.y`);
  }

  return allowed;
}

const ALLOWED_PATHS = buildAllowedPaths();

/** Leaf paths whose value is opaque to the walk (arrays of strings, etc.). */
const LEAF_PATHS = new Set<string>([
  ...Object.keys(LIST_LIMITS),
  ...Object.keys(FIELD_LIMITS),
]);

/** Walk the supplied object and record every path the theme does not declare. */
function collectUnknownPaths(
  node: unknown,
  prefix: string,
  errors: FieldError[],
  depth = 0
): void {
  // Bound the walk: a deeply nested payload is itself a red flag, and
  // unbounded recursion here would be a cheap denial-of-service.
  if (depth > 8) return;
  if (typeof node !== "object" || node === null || Array.isArray(node)) return;

  for (const key of Object.keys(node)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (!ALLOWED_PATHS.has(path)) {
      errors.push({ path, code: "unknown_property" });
      continue;
    }
    // Declared leaves are validated by their own checkers; do not descend
    // into a string's characters or a list's entries.
    if (LEAF_PATHS.has(path)) continue;

    collectUnknownPaths((node as Record<string, unknown>)[key], path, errors, depth + 1);
  }
}

/**
 * Validate a draft against the theme contract.
 *
 * Unknown properties are rejected, not dropped. The manifest is
 * authoritative: if the theme does not declare a path, the config is
 * invalid and the caller is told exactly which path offended.
 */
export function validateConfig(input: unknown): ValidationResult {
  const errors: FieldError[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: [{ path: "", code: "expected_object" }] };
  }
  const raw = input as Record<string, any>;

  // Structural check first: an unknown key is reported on its own terms
  // rather than as a confusing downstream type error.
  collectUnknownPaths(raw, "", errors);

  // --- couple ---
  const couple: ValidatedConfig["couple"] = {};
  for (const role of ["groom", "bride"] as const) {
    const source = raw.couple?.[role] ?? {};
    couple[role] = {
      zh: checkString(source.zh, `couple.${role}.zh`, errors),
      en: checkString(source.en, `couple.${role}.en`, errors),
    };
  }

  // --- date ---
  const iso = checkDate(raw.date?.iso, "date.iso", errors);
  const durationHours = Number(raw.date?.durationHours ?? 4);
  if (!Number.isFinite(durationHours) || durationHours < 1 || durationHours > 24) {
    errors.push({ path: "date.durationHours", code: "out_of_range" });
  }

  // --- copy: walk the limit table so the schema is the single source ---
  const copy: Record<string, any> = {};
  const setPath = (target: Record<string, any>, path: string, value: unknown) => {
    const parts = path.split(".").slice(1); // drop leading "copy"
    let node = target;
    for (let i = 0; i < parts.length - 1; i++) {
      node[parts[i]!] ??= {};
      node = node[parts[i]!];
    }
    if (value !== undefined) node[parts[parts.length - 1]!] = value;
  };
  const readPath = (source: Record<string, any>, path: string): unknown => {
    return path.split(".").reduce<any>((node, part) => (node == null ? undefined : node[part]), source);
  };

  for (const path of Object.keys(FIELD_LIMITS)) {
    if (!path.startsWith("copy.")) continue;
    const value = readPath(raw, path);
    if (value === undefined) continue;

    const isList = path in LIST_LIMITS;
    const checked = isList ? checkList(value, path, errors) : checkString(value, path, errors);
    setPath(copy, path, checked);
  }

  // --- venue ---
  const venue: ValidatedConfig["venue"] = {
    tba: raw.venue?.tba !== false,
    name: checkString(raw.venue?.name, "venue.name", errors),
    address: checkString(raw.venue?.address, "venue.address", errors),
  };
  if (raw.venue?.mapsUrl) {
    const url = String(raw.venue.mapsUrl);
    // Only http(s): a javascript: URL here would be an XSS sink.
    if (!/^https?:\/\//.test(url) || url.length > 500) {
      errors.push({ path: "venue.mapsUrl", code: "invalid_url" });
    } else {
      venue.mapsUrl = url;
    }
  }

  // --- rsvp ---
  const maxGuests = Number(raw.rsvp?.maxGuests ?? 12);
  if (!Number.isInteger(maxGuests) || maxGuests < 1 || maxGuests > 50) {
    errors.push({ path: "rsvp.maxGuests", code: "out_of_range" });
  }
  const deadlineISO =
    raw.rsvp?.deadlineISO === undefined || raw.rsvp?.deadlineISO === ""
      ? undefined
      : checkDate(raw.rsvp.deadlineISO, "rsvp.deadlineISO", errors);

  // --- media slots ---
  const media: ValidatedConfig["media"] = {};
  const assetIds: string[] = [];
  const rawMedia = raw.media ?? {};

  // Unknown slots are caught by the structural walk above as
  // `unknown_property`; no separate check is needed here.
  for (const slot of IMAGE_SLOTS) {
    const entry = rawMedia[slot];
    if (!entry) {
      media[slot] = { assetId: null };
      continue;
    }
    const assetId = entry.assetId ?? null;
    if (assetId !== null && typeof assetId !== "string") {
      errors.push({ path: `media.${slot}.assetId`, code: "invalid_asset" });
      continue;
    }
    if (assetId) assetIds.push(assetId);

    const focal = checkFocal(entry.focal, `media.${slot}.focal`, errors);
    media[slot] = { assetId, ...(focal ? { focal } : {}) };
  }

  // --- music ---
  const musicAsset = raw.music?.assetId ?? null;
  if (musicAsset !== null && typeof musicAsset !== "string") {
    errors.push({ path: "music.assetId", code: "invalid_asset" });
  } else if (musicAsset) {
    assetIds.push(musicAsset);
  }

  // --- motion ---
  const drift = Number(raw.motion?.driftPxPerSec ?? MANIFEST.motion.driftPxPerSec.default);
  if (
    !Number.isFinite(drift) ||
    drift < MANIFEST.motion.driftPxPerSec.min ||
    drift > MANIFEST.motion.driftPxPerSec.max
  ) {
    errors.push({ path: "motion.driftPxPerSec", code: "out_of_range" });
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    assetIds,
    config: {
      themeId: THEME_ID,
      themeVersion: THEME_VERSION,
      couple,
      date: {
        iso: iso!,
        lunar: checkString(raw.date?.lunar, "date.lunar", errors),
        timeLabel: checkString(raw.date?.timeLabel, "date.timeLabel", errors),
        durationHours,
      },
      copy,
      venue,
      rsvp: { deadlineISO, maxGuests },
      media,
      music: {
        assetId: typeof musicAsset === "string" ? musicAsset : null,
        enabled: raw.music?.enabled === true,
        title: checkString(raw.music?.title, "music.title", errors),
      },
      motion: { driftPxPerSec: drift },
    },
  };
}
