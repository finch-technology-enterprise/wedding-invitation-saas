/**
 * Orchestration.
 *
 * Sets the proportional root font-size, builds the canvas, then wires
 * the timeline, countdown, audio and RSVP together. Deliberately thin:
 * behaviour lives in the modules it imports.
 */

import { wedding as defaults } from "./defaults.js";
import { loadChineseFonts } from "./fonts.js";
import { $, $$ } from "./dom.js";
import { parseWeddingDate, weddingParts, formatDottedDate, buildIcsUrl } from "./datetime.js";
import { renderScenes } from "./scenes.js";
import { createTimeline } from "./timeline.js";
import { startCountdown } from "./countdown.js";
import { setupAudio } from "./audio.js";
import { setupRsvp } from "./rsvp.js";

/* ---------------------------------------------------------------
   Bootstrap adapter

   The renderer used to import a hardcoded `wedding` object. It now
   receives the same shape, assembled from the published revision the
   Worker inlined as window.__INVITATION__.

   This lives in main.js rather than its own module so the public page
   costs no extra request: the adapter is a handful of pure functions
   used once at boot, and the frozen request budget is 15.

   Every other theme module is untouched — they still read
   `wedding.copy.*` and `wedding.photos.hero.ready`. Translating platform
   config into that shape happens here and only here.
   --------------------------------------------------------------- */

/** Deep merge, ignoring null/undefined so a partial config only overrides
 *  what it actually specifies. Arrays replace wholesale — a poem with
 *  fewer lines must not leave the old trailing lines behind. */
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
      // Focal point travels as a CSS object-position string. Left
      // undefined rather than "50% 50%" when unconfigured, so the
      // stylesheet's own value keeps applying and the cascade is
      // untouched.
      ...(focal ? { position: `${focal.x}% ${focal.y}%` } : {}),
    };
  }

  return out;
}

/** Build the renderer's config from the inlined bootstrap. With none
 *  present the defaults render alone, so the theme still works when
 *  opened as a plain static file. */
function buildConfig(bootstrap) {
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
      // V2: invitation-level locale + system strings + optional
      // personalized party greeting (?party= token, server-resolved).
      locale: bootstrap.locale ?? "zh-CN",
      strings: bootstrap.strings ?? null,
      party: bootstrap.party ?? null,
    },
  };
}

/* ---------------------------------------------------------------
   Proportional scaling: 1rem === 1/10 of the canvas width.

   This is the reference's scaling law. Every rem in the stylesheets
   therefore resolves identically-proportioned at 375, 390 and 430.
   On desktop the canvas is clamped so the invitation stays
   phone-shaped instead of stretching.
   --------------------------------------------------------------- */

const MAX_CANVAS_WIDTH = 460;

function applyRootFontSize() {
  const width = Math.min(window.innerWidth, MAX_CANVAS_WIDTH);
  document.documentElement.style.fontSize = `${width / 10}px`;
}

/* ---------------------------------------------------------------
   Reveal-on-approach
   --------------------------------------------------------------- */

/**
 * Reveal elements as the timeline brings them into frame.
 *
 * IntersectionObserver is deliberately NOT used here. The stage moves
 * by transform rather than by scrolling, and observers do not re-run
 * for transform changes on an already-intersecting ancestor — reveals
 * would fire once at boot and then stop. Positions are instead
 * measured once (they are static within the canvas) and compared
 * against the timeline offset on each change, which is a handful of
 * numeric comparisons and no layout reads.
 */
function setupReveals(root, timeline, viewport) {
  const nodes = $$(".reveal", root);
  if (!nodes.length) return;

  let pending = [];

  const measurePositions = () => {
    const stageTop = root.getBoundingClientRect().top;
    pending = nodes
      .filter((n) => !n.classList.contains("is-visible"))
      .map((n) => ({ node: n, top: n.getBoundingClientRect().top - stageTop }));
  };

  const check = (offset) => {
    if (!pending.length) return;
    // Trigger a little before the element reaches the bottom edge.
    const threshold = viewport.clientHeight * 0.92 - offset;
    let revealed = false;
    for (const item of pending) {
      if (item.top <= threshold) {
        item.node.classList.add("is-visible");
        revealed = true;
      }
    }
    if (revealed) pending = pending.filter((i) => !i.node.classList.contains("is-visible"));
  };

  measurePositions();
  check(timeline.offset);
  timeline.onChange(check);
  window.addEventListener("resize", () => {
    measurePositions();
    check(timeline.offset);
  });
}

/* ---------------------------------------------------------------
   Boot
   --------------------------------------------------------------- */

function boot() {
  // Configuration arrives inlined by the Worker (published revision or
  // preview draft). Falls back to the theme defaults when opened without
  // a bootstrap, so the theme remains runnable on its own.
  const { wedding, meta } = buildConfig(
    typeof window !== "undefined" ? window.__INVITATION__ : undefined
  );

  // Request the CJK subsets first: the sooner they start, the smaller the
  // window in which fallback metrics are on screen.
  loadChineseFonts(wedding);

  applyRootFontSize();
  window.addEventListener("resize", applyRootFontSize);
  window.addEventListener("orientationchange", applyRootFontSize);

  const stage = $("#stage");
  const viewport = $("#viewport");
  const live = $("#live-region");

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reducedMotion = motionQuery.matches;

  // Everything date-derived comes from this single parse.
  const weddingDate = parseWeddingDate(wedding.date.iso);
  const parts = weddingParts(weddingDate, wedding.date.iso);

  // Title and description derive from the same config as the invitation,
  // so the couple and date are never stated twice.
  const coupleLine = `${wedding.couple.groom.zh} ❤ ${wedding.couple.bride.zh}`;
  document.title = `${wedding.copy.cover.bracket.replace(/[【】]/g, "")} | ${coupleLine}`;
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.content = `${coupleLine} · ${formatDottedDate(parts)}`;

  // V2: document language follows the invitation locale (server also sets
  // it during render; this covers static-file opens). Personalized party
  // greeting, when the Worker resolved a ?party= token.
  try {
    if (meta.locale) document.documentElement.lang = meta.locale;
  } catch { /* noop */ }
  if (meta.party?.title) {
    const banner = document.createElement("p");
    banner.className = "party-greeting";
    banner.textContent = meta.party.title;
    banner.setAttribute("role", "note");
    stage.prepend(banner);
  }

  renderScenes(stage, wedding, parts);

  /* ---- timeline ---- */

  // Pacing is set by scroll *speed*, not by a fixed total duration. The
  // reference covers 3264px in 72s ≈ 45px/s, which is the rate at which
  // its Chinese body text stays readable as it passes. Our canvas is
  // longer (the cover and the RSVP each occupy a deliberate full frame),
  // so holding 72s would move 29% faster and rush the copy. Matching the
  // rate instead keeps the reading experience the same.
  //
  // A supplied soundtrack overrides this: setDuration() retimes the
  // canvas to the track so the two finish together.
  //
  // Configurable within the theme's narrow published range; absent a
  // value this is exactly the accepted rate.
  const PIXELS_PER_SECOND = meta.driftPxPerSec ?? 46;

  const timeline = createTimeline({
    stage,
    viewport,
    duration: 72_000, // replaced below once the canvas has been measured
    reducedMotion,
  });

  // Honour the preference if it changes after load (OS setting toggled,
  // or an assistive tool enabling it mid-session).
  motionQuery.addEventListener("change", (e) => {
    timeline.setAuto(!e.matches);
    if (!e.matches) timeline.play();
  });

  // Measure once fonts are settled — webfont swap changes text height
  // and therefore the canvas length.
  let started = false;
  const startTimeline = () => {
    if (started) return;
    started = true;
    timeline.measure();
    // Derive the duration from the measured canvas so editing copy or
    // swapping photography keeps the reading pace constant.
    if (timeline.travel > 0) {
      timeline.setDuration((timeline.travel / PIXELS_PER_SECOND) * 1000);
    }
    setupReveals(stage, timeline, viewport);
    if (!reducedMotion) timeline.play();
  };

  if (document.fonts?.ready) {
    document.fonts.ready.then(startTimeline);
    // Don't let a slow font CDN delay the experience.
    setTimeout(startTimeline, 1200);
  } else {
    startTimeline();
  }

  /* ---- countdown ---- */

  const countdownRoot = $("#countdown");
  if (countdownRoot) startCountdown(countdownRoot, weddingDate, { reducedMotion, strings: meta.strings });

  /* ---- calendar download ---- */

  const calAction = $("#cal-action");
  if (calAction) {
    calAction.href = buildIcsUrl({
      date: weddingDate,
      durationHours: wedding.date.durationHours,
      summary: `${wedding.couple.groom.zh} & ${wedding.couple.bride.zh} 婚礼`,
      description: wedding.copy.cover.bracket,
      location: wedding.venue.tba ? "" : `${wedding.venue.name} ${wedding.venue.address}`.trim(),
    });
  }

  /* ---- music ---- */

  const music = setupAudio({
    audio: $("#bgm"),
    toggle: $("#music-toggle"),
    src: wedding.music.src,
    ready: wedding.music.ready,
    title: wedding.music.title,
    // If a real track is supplied, pace the canvas to its length so the
    // invitation and the music finish together.
    onDuration: (ms) => timeline.setDuration(ms),
  });

  music.attemptAutoplay().then((ok) => {
    // Blocked autoplay is expected. Start on the first gesture instead;
    // the timeline is already running regardless.
    if (!ok) music.armFirstGesture();
  });

  /* ---- rsvp ----
     The invitation ends on a form. Letting the canvas keep drifting
     while someone is trying to tap a field makes it genuinely hard to
     use, so the timeline parks itself once the RSVP scene is reached
     and stays parked — the guest is now doing something, not watching. */

  const rsvpScene = $("#scene-rsvp");
  if (rsvpScene) {
    // Park so the whole form sits centred in the viewport — heading at the
    // top, submit comfortably above the fold — rather than at an arbitrary
    // fraction that leaves the title stranded low on the screen.
    // offsetTop is relative to #stage and is unaffected by its transform,
    // so this stays correct as the canvas moves.
    timeline.stopAt(() => {
      const slack = Math.max(0, viewport.clientHeight - rsvpScene.offsetHeight);
      return rsvpScene.offsetTop - slack / 2;
    });
  }

  // Scoped to this invitation. A preview posts to its own slug too, so a
  // shared draft link cannot be used to write into the live invitation.
  // The party token rides along when present (?party= personalized link).
  let partyToken = null;
  try {
    partyToken = new URLSearchParams(window.location.search).get("party");
  } catch { /* noop */ }
  setupRsvp({
    wedding,
    timeline,
    live,
    endpoint: meta.slug ? `/i/${meta.slug}/rsvp` : "/i/demo/rsvp",
    partyToken,
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
