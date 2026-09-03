/**
 * Orchestration.
 *
 * Sets the proportional root font-size, builds the canvas, then wires
 * the timeline, countdown, audio and RSVP together. Deliberately thin:
 * behaviour lives in the modules it imports.
 */

import { wedding } from "./content.js";
import { loadChineseFonts } from "./fonts.js";
import { $, $$ } from "./dom.js";
import { parseWeddingDate, weddingParts, formatDottedDate, buildIcsUrl } from "./datetime.js";
import { renderScenes } from "./scenes.js";
import { createTimeline } from "./timeline.js";
import { startCountdown } from "./countdown.js";
import { setupAudio } from "./audio.js";
import { setupRsvp } from "./rsvp.js";

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
  const PIXELS_PER_SECOND = 46;

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
  if (countdownRoot) startCountdown(countdownRoot, weddingDate, { reducedMotion });

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

  setupRsvp({ wedding, timeline, live });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
