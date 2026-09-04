/**
 * Theme manifest + config schema for `modern-editorial` ("Modern Editorial /
 * Quiet Luxury").
 *
 * Deliberately different from cinematic-classic: magazine-like sections,
 * generous whitespace, restrained motion, editorial tokens. Shares the
 * platform contract (manifest + validateConfig + assetIds) so the same
 * draft/publish/media/RSVP machinery works unchanged.
 */

export const THEME_ID = "modern-editorial";
export const THEME_VERSION = 1;

export const SCENES = [
  "hero",
  "couple",
  "schedule",
  "gallery",
  "venue",
  "rsvp",
] as const;

export type SceneId = (typeof SCENES)[number];

export const MEDIA_SLOTS = {
  cover: { kind: "image", ratio: "4 / 5", focal: true, scene: "hero" },
  gallery_1: { kind: "image", ratio: "1 / 1", focal: true, scene: "gallery" },
  gallery_2: { kind: "image", ratio: "1 / 1", focal: true, scene: "gallery" },
  gallery_3: { kind: "image", ratio: "1 / 1", focal: true, scene: "gallery" },
  venue: { kind: "image", ratio: "16 / 10", focal: true, scene: "venue" },
  background_music: { kind: "audio", ratio: null, focal: false, scene: null },
} as const;

export type SlotId = keyof typeof MEDIA_SLOTS;

export const IMAGE_SLOTS = (Object.keys(MEDIA_SLOTS) as SlotId[]).filter(
  (s) => MEDIA_SLOTS[s].kind === "image"
);

interface FieldLimit {
  max: number;
  accepted: number;
  multiline?: boolean;
}

export const FIELD_LIMITS = {
  "couple.partnerA": { max: 40, accepted: 12 },
  "couple.partnerB": { max: 40, accepted: 12 },
  "couple.tagline": { max: 80, accepted: 24, multiline: true },
  "date.label": { max: 32, accepted: 10 },
  "copy.hero.kicker": { max: 32, accepted: 12 },
  "copy.hero.title": { max: 64, accepted: 20, multiline: true },
  "copy.hero.subtitle": { max: 120, accepted: 40, multiline: true },
  "copy.couple.heading": { max: 32, accepted: 12 },
  "copy.couple.body": { max: 600, accepted: 180, multiline: true },
  "copy.schedule.heading": { max: 32, accepted: 12 },
  "copy.schedule.note": { max: 200, accepted: 60, multiline: true },
  "copy.venue.heading": { max: 32, accepted: 12 },
  "copy.venue.note": { max: 200, accepted: 60, multiline: true },
  "copy.rsvp.heading": { max: 32, accepted: 12 },
  "copy.rsvp.body": { max: 200, accepted: 60, multiline: true },
  "venue.name": { max: 80, accepted: 0 },
  "venue.address": { max: 200, accepted: 0, multiline: true },
} satisfies Record<string, FieldLimit>;

export const LIST_LIMITS = {
  "schedule.items": { max: 12, accepted: 4 },
} as const;

export interface ThemeManifest {
  id: string;
  version: number;
  scenes: readonly string[];
  mediaSlots: typeof MEDIA_SLOTS;
  fieldLimits: typeof FIELD_LIMITS;
  listLimits: typeof LIST_LIMITS;
  focal: { min: number; max: number; default: { x: number; y: number } };
  motion: { levels: readonly string[]; default: string };
  tokens: {
    accents: readonly string[];
    papers: readonly string[];
    inks: readonly string[];
    typePresets: readonly string[];
  };
}

export const MANIFEST: ThemeManifest = {
  id: THEME_ID,
  version: THEME_VERSION,
  scenes: SCENES,
  mediaSlots: MEDIA_SLOTS,
  fieldLimits: FIELD_LIMITS,
  listLimits: LIST_LIMITS,
  focal: { min: 0, max: 100, default: { x: 50, y: 50 } },
  motion: { levels: ["still", "subtle", "gentle"], default: "subtle" },
  tokens: {
    accents: ["#1a1a1a", "#5c4a3a", "#7a2e2e", "#2e4a5c"],
    papers: ["#ffffff", "#faf8f4", "#f3efe7"],
    inks: ["#1a1a1a", "#3a3a3a"],
    typePresets: ["serif", "sans", "mixed"],
  },
};

export interface FieldError {
  path: string;
  code: string;
  limit?: number;
  actual?: number;
}

export interface ValidationResult {
  ok: boolean;
  errors: FieldError[];
  config?: Record<string, unknown>;
  assetIds?: string[];
}

export interface ValidatedConfig {
  themeId: string;
  themeVersion: number;
  couple: { partnerA?: string; partnerB?: string; tagline?: string };
  date: { iso?: string; label?: string; durationHours: number };
  copy: Record<string, unknown>;
  venue: { tba: boolean; name?: string; address?: string; mapsUrl?: string };
  rsvp: { deadlineISO?: string; maxGuests: number };
  media: Record<string, { assetId: string | null; focal?: { x: number; y: number } }>;
  music: { assetId: string | null; enabled: boolean; title?: string };
  motion: { level: string };
  tokens: { accent: string; paper: string; ink: string; typePreset: string };
  sections: Record<string, boolean>;
  schedule?: { items: Array<{ time?: string; title?: string; note?: string }> };
}

function charLength(s: string): number {
  return [...s].length;
}

function checkString(value: unknown, path: string, errors: FieldError[]): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    errors.push({ path, code: "expected_string" });
    return undefined;
  }
  const limit = (FIELD_LIMITS as Record<string, FieldLimit>)[path];
  if (limit) {
    if (charLength(value) > limit.max) {
      errors.push({ path, code: "too_long", limit: limit.max, actual: charLength(value) });
      return undefined;
    }
    if (!limit.multiline && value.includes("\n")) {
      errors.push({ path, code: "no_newlines" });
      return undefined;
    }
  }
  return value;
}

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
  if (typeof value !== "object" || Array.isArray(value)) {
    errors.push({ path, code: "invalid_focal" });
    return undefined;
  }
  const { x, y } = value as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number" || x < 0 || x > 100 || y < 0 || y > 100) {
    errors.push({ path, code: "focal_out_of_range" });
    return undefined;
  }
  return { x, y };
}

const ALLOWED_TOP = new Set([
  "themeId", "themeVersion", "couple", "date", "copy", "venue", "rsvp",
  "media", "music", "motion", "tokens", "sections", "schedule", "rsvpForm",
]);

export function validateConfig(input: unknown): ValidationResult {
  const errors: FieldError[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: [{ path: "", code: "expected_object" }] };
  }
  const raw = input as Record<string, any>;
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_TOP.has(key)) {
      errors.push({ path: key, code: "unknown_property" });
    }
  }

  const couple = {
    partnerA: checkString(raw.couple?.partnerA, "couple.partnerA", errors),
    partnerB: checkString(raw.couple?.partnerB, "couple.partnerB", errors),
    tagline: checkString(raw.couple?.tagline, "couple.tagline", errors),
  };

  const iso = checkDate(raw.date?.iso, "date.iso", errors);
  const durationHours = Number(raw.date?.durationHours ?? 4);
  if (!Number.isFinite(durationHours) || durationHours < 1 || durationHours > 24) {
    errors.push({ path: "date.durationHours", code: "out_of_range" });
  }

  const copy: Record<string, unknown> = {};
  for (const path of Object.keys(FIELD_LIMITS)) {
    if (!path.startsWith("copy.")) continue;
    const parts = path.split(".");
    let node: unknown = raw;
    for (const p of parts) node = (node as Record<string, unknown> | undefined)?.[p];
    if (node === undefined) continue;
    const checked = checkString(node, path, errors);
    if (checked !== undefined) {
      const sub = parts.slice(1);
      let target = copy;
      for (let i = 0; i < sub.length - 1; i++) {
        target[sub[i]!] ??= {};
        target = target[sub[i]!] as Record<string, unknown>;
      }
      target[sub[sub.length - 1]!] = checked;
    }
  }

  const venue = {
    tba: raw.venue?.tba !== false,
    name: checkString(raw.venue?.name, "venue.name", errors),
    address: checkString(raw.venue?.address, "venue.address", errors),
  } as ValidatedConfig["venue"];
  if (raw.venue?.mapsUrl) {
    const url = String(raw.venue.mapsUrl);
    if (!/^https?:\/\//.test(url) || url.length > 500) {
      errors.push({ path: "venue.mapsUrl", code: "invalid_url" });
    } else {
      venue.mapsUrl = url;
    }
  }

  const maxGuests = Number(raw.rsvp?.maxGuests ?? 12);
  if (!Number.isInteger(maxGuests) || maxGuests < 1 || maxGuests > 50) {
    errors.push({ path: "rsvp.maxGuests", code: "out_of_range" });
  }
  const deadlineISO =
    raw.rsvp?.deadlineISO === undefined || raw.rsvp?.deadlineISO === ""
      ? undefined
      : checkDate(raw.rsvp.deadlineISO, "rsvp.deadlineISO", errors);

  const media: ValidatedConfig["media"] = {};
  const assetIds: string[] = [];
  const rawMedia = raw.media ?? {};
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

  const musicAsset = raw.music?.assetId ?? null;
  if (musicAsset !== null && typeof musicAsset !== "string") {
    errors.push({ path: "music.assetId", code: "invalid_asset" });
  } else if (musicAsset) {
    assetIds.push(musicAsset);
  }

  const level = String(raw.motion?.level ?? MANIFEST.motion.default);
  if (!(MANIFEST.motion.levels as readonly string[]).includes(level)) {
    errors.push({ path: "motion.level", code: "invalid_option" });
  }

  const tokens = {
    accent: String(raw.tokens?.accent ?? MANIFEST.tokens.accents[0]),
    paper: String(raw.tokens?.paper ?? MANIFEST.tokens.papers[0]),
    ink: String(raw.tokens?.ink ?? MANIFEST.tokens.inks[0]),
    typePreset: String(raw.tokens?.typePreset ?? MANIFEST.tokens.typePresets[2]),
  };
  if (!(MANIFEST.tokens.accents as readonly string[]).includes(tokens.accent)) {
    errors.push({ path: "tokens.accent", code: "invalid_option" });
  }
  if (!(MANIFEST.tokens.papers as readonly string[]).includes(tokens.paper)) {
    errors.push({ path: "tokens.paper", code: "invalid_option" });
  }
  if (!(MANIFEST.tokens.inks as readonly string[]).includes(tokens.ink)) {
    errors.push({ path: "tokens.ink", code: "invalid_option" });
  }
  if (!(MANIFEST.tokens.typePresets as readonly string[]).includes(tokens.typePreset)) {
    errors.push({ path: "tokens.typePreset", code: "invalid_option" });
  }

  const sections: Record<string, boolean> = {};
  for (const s of SCENES) {
    const v = raw.sections?.[s];
    sections[s] = v !== false;
  }

  let schedule: ValidatedConfig["schedule"] | undefined;
  if (raw.schedule?.items !== undefined) {
    if (!Array.isArray(raw.schedule.items)) {
      errors.push({ path: "schedule.items", code: "expected_array" });
    } else {
      if (raw.schedule.items.length > LIST_LIMITS["schedule.items"].max) {
        errors.push({ path: "schedule.items", code: "too_many_items", limit: LIST_LIMITS["schedule.items"].max });
      } else {
        schedule = {
          items: raw.schedule.items.map((it: Record<string, unknown>) => ({
            time: typeof it.time === "string" ? it.time.slice(0, 24) : undefined,
            title: typeof it.title === "string" ? it.title.slice(0, 80) : undefined,
            note: typeof it.note === "string" ? it.note.slice(0, 160) : undefined,
          })),
        };
      }
    }
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
      date: { iso, label: checkString(raw.date?.label, "date.label", errors), durationHours },
      copy,
      venue,
      rsvp: { deadlineISO, maxGuests },
      media,
      music: {
        assetId: typeof musicAsset === "string" ? musicAsset : null,
        enabled: raw.music?.enabled === true,
        title: checkString(raw.music?.title, "music.title", errors),
      },
      motion: { level },
      tokens,
      sections,
      ...(schedule ? { schedule } : {}),
    },
  };
}

export const EDITORIAL_MANIFEST = MANIFEST;
