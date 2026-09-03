/**
 * Bootstrap adapter.
 *
 * The renderer used to import a hardcoded `wedding` object. It now
 * receives the same shape, assembled from the published revision that the
 * Worker inlined into the page as `window.__INVITATION__`.
 *
 * This is the whole adapter seam. Every other theme module is unchanged:
 * they still consume `wedding.copy.*`, `wedding.photos.hero.ready`, and so
 * on. Translating platform config into that shape happens here and only
 * here, which is what keeps the frozen runtime frozen.
 *
 * With no bootstrap present the defaults render on their own, so the theme
 * still works when opened as a static file.
 */

import { wedding as defaults } from "./defaults.js";

/** Deep merge, ignoring null/undefined so a partial config only overrides
 * what it actually specifies. Arrays replace wholesale — a poem with
 * fewer lines must not leave the old trailing lines behind. */
function merge(base, override) {
  if (override === null || override === undefined) return base;
  if (Array.isArray(override)) return override.slice();
  if (typeof override !== "object") return override;

  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    out[key] = key in out ? merge(out[key], value) : value;
  }
  return out;
}

/**
 * Map platform media into the slot shape the renderer already understands.
 *
 * `ready` remains the switch that decides whether a file is requested at
 * all. An unsupplied slot keeps its placeholder and costs no network
 * traffic — the same behaviour as the frozen baseline, now driven by
 * whether the published revision supplied an asset rather than by a
 * hand-edited boolean.
 */
function applyMedia(photos, mediaUrls, mediaConfig) {
  const out = { ...photos };

  for (const [slot, base] of Object.entries(photos)) {
    const url = mediaUrls[slot];
    if (!url) {
      // No published asset: placeholder, exactly as before.
      out[slot] = { ...base, ready: false };
      continue;
    }

    const focal = mediaConfig?.[slot]?.focal;
    out[slot] = {
      ...base,
      src: url,
      ready: true,
      // Focal point travels as a CSS object-position string. The default
      // is undefined rather than "50% 50%", so an unconfigured slot keeps
      // the stylesheet's own value and the cascade is untouched.
      ...(focal ? { position: `${focal.x}% ${focal.y}%` } : {}),
    };
  }

  return out;
}

/**
 * Build the renderer's config object.
 *
 * @param {object} [bootstrap] value of window.__INVITATION__
 * @returns {{wedding: object, meta: object}}
 */
export function buildConfig(bootstrap) {
  if (!bootstrap || typeof bootstrap !== "object") {
    return { wedding: defaults, meta: { isPreview: false, slug: null, revisionId: null } };
  }

  const config = bootstrap.config ?? {};
  const mediaUrls = bootstrap.mediaUrls ?? {};

  // Platform config carries only what a tenant can edit; everything else
  // (labels, ratios, alt text) comes from the theme defaults.
  const merged = merge(defaults, {
    couple: config.couple,
    date: config.date,
    copy: config.copy,
    venue: config.venue,
    rsvp: config.rsvp,
  });

  merged.photos = applyMedia(defaults.photos, mediaUrls, config.media);

  merged.music = {
    ...defaults.music,
    ...(config.music?.title ? { title: config.music.title } : {}),
    src: mediaUrls.background_music ?? defaults.music.src,
    // Music plays only when an asset was published AND the tenant enabled
    // it. Either alone leaves the control in its muted state.
    ready: Boolean(mediaUrls.background_music) && config.music?.enabled === true,
  };

  return {
    wedding: merged,
    meta: {
      isPreview: Boolean(bootstrap.isPreview),
      slug: bootstrap.slug ?? null,
      revisionId: bootstrap.revisionId ?? null,
      driftPxPerSec: config.motion?.driftPxPerSec,
    },
  };
}

/** Read the inlined bootstrap. Inline, so there is no config fetch and no
 * render waterfall — the theme has its data before it runs. */
export function readBootstrap() {
  return typeof window !== "undefined" ? window.__INVITATION__ : undefined;
}
