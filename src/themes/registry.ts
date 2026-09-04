/**
 * Theme registry (V2).
 *
 * Single authoritative source for theme metadata, manifests and
 * validation dispatch. Replaces the scattered KNOWN_THEMES allow-list.
 */

import {
  MANIFEST as CINEMATIC_MANIFEST,
  THEME_ID as CINEMATIC_ID,
  THEME_VERSION as CINEMATIC_VERSION,
  validateConfig as validateCinematic,
} from "./cinematic-classic.js";
import {
  EDITORIAL_MANIFEST,
  THEME_ID as EDITORIAL_ID,
  THEME_VERSION as EDITORIAL_VERSION,
  validateConfig as validateEditorial,
} from "./modern-editorial.js";

export interface ThemeRegistration {
  id: string;
  displayName: string;
  version: number;
  rendererPath: string;
  manifest: typeof CINEMATIC_MANIFEST | typeof EDITORIAL_MANIFEST;
  validate: (input: unknown) => {
    ok: boolean;
    errors?: Array<{ path: string; code: string }>;
    config?: Record<string, unknown>;
    assetIds?: string[];
  };
  capabilities: {
    sections: readonly string[];
    mediaSlots: readonly string[];
    customization: readonly string[];
  };
}

const REGISTRY = new Map<string, ThemeRegistration>([
  [
    CINEMATIC_ID,
    {
      id: CINEMATIC_ID,
      displayName: "Cinematic Classic",
      version: CINEMATIC_VERSION,
      rendererPath: `/themes/${CINEMATIC_ID}/index.html`,
      manifest: CINEMATIC_MANIFEST,
      validate: validateCinematic as ThemeRegistration["validate"],
      capabilities: {
        sections: CINEMATIC_MANIFEST.scenes as readonly string[],
        mediaSlots: Object.keys(CINEMATIC_MANIFEST.mediaSlots),
        customization: ["motion.driftPxPerSec"],
      },
    },
  ],
  [
    EDITORIAL_ID,
    {
      id: EDITORIAL_ID,
      displayName: "Modern Editorial",
      version: EDITORIAL_VERSION,
      rendererPath: `/themes/${EDITORIAL_ID}/index.html`,
      manifest: EDITORIAL_MANIFEST,
      validate: validateEditorial as ThemeRegistration["validate"],
      capabilities: {
        sections: EDITORIAL_MANIFEST.scenes as readonly string[],
        mediaSlots: Object.keys(EDITORIAL_MANIFEST.mediaSlots),
        customization: ["tokens.accent", "tokens.paper", "tokens.ink", "type.preset", "motion.level", "sections"],
      },
    },
  ],
]);

export function themeIds(): string[] {
  return [...REGISTRY.keys()];
}

export function getTheme(id: string): ThemeRegistration | null {
  return REGISTRY.get(id) ?? null;
}

export function listThemes(): Array<{
  id: string;
  displayName: string;
  version: number;
  sections: readonly string[];
  mediaSlots: readonly string[];
  customization: readonly string[];
}> {
  return [...REGISTRY.values()].map((t) => ({
    id: t.id,
    displayName: t.displayName,
    version: t.version,
    sections: t.capabilities.sections,
    mediaSlots: t.capabilities.mediaSlots,
    customization: t.capabilities.customization,
  }));
}

export function validateForTheme(
  themeId: string,
  input: unknown
): ReturnType<ThemeRegistration["validate"]> & { unknownTheme?: boolean } {
  const theme = REGISTRY.get(themeId);
  if (!theme) return { ok: false, unknownTheme: true, errors: [{ path: "themeId", code: "unknown_theme" }] };
  return theme.validate(input);
}
