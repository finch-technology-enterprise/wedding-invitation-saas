/**
 * Public performance probe.
 *
 * Reproducible measurement against the frozen baseline in
 * baselines/frozen-c2833d2/metrics.json. Runs each viewport several times
 * and reports the median, because first-render on a cold browser is noisy
 * enough that a single sample cannot support a claim either way.
 *
 * Usage:  node tests/e2e/server.mjs &  node tests/e2e/measure.mjs
 */

import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const BASE = JSON.parse(readFileSync("baselines/frozen-c2833d2/metrics.json", "utf8"));
const URL_UNDER_TEST = process.env.TARGET || "http://127.0.0.1:8789/i/demo";
const RUNS = Number(process.env.RUNS || 5);

const VIEWPORTS = {
  375: [375, 812],
  390: [390, 844],
  430: [430, 932],
  desktop: [1440, 900],
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

async function measureOnce(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  const sizes = {};
  const paths = [];
  page.on("response", async (r) => {
    const u = new global.URL(r.url());
    if (!u.host.startsWith("127.0.0.1")) return; // ignore font CDN
    paths.push(u.pathname);
    try {
      sizes[u.pathname] = (await r.body()).length;
    } catch {
      /* redirects and 304s have no body */
    }
  });

  await page.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });

  // First render: when the canvas actually has its scenes on screen.
  const firstRenderMs = await page.evaluate(async () => {
    const t0 = performance.timeOrigin;
    const start = performance.now();
    while (performance.now() - start < 10000) {
      if (document.querySelectorAll(".scene").length >= 10) {
        return Math.round(performance.now());
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    void t0;
    return -1;
  });

  // Timeline startup: when the stage first moves under its own power.
  const timelineStartMs = await page.evaluate(async () => {
    const stage = document.getElementById("stage");
    const y = () => new DOMMatrixReadOnly(getComputedStyle(stage).transform).m42;
    const start = performance.now();
    const initial = y();
    while (performance.now() - start < 8000) {
      if (Math.abs(y() - initial) > 0.5) return Math.round(performance.now());
      await new Promise((r) => requestAnimationFrame(r));
    }
    return -1;
  });

  // Geometry must be sampled after the webfont swap: CJK fallback metrics
  // differ from the loaded face, so measuring early reports a canvas
  // shorter by a pixel or two and invents a regression that is not there.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);

  const geometry = await page.evaluate(() => {
    const stage = document.getElementById("stage");
    return {
      stageH: stage.getBoundingClientRect().height,
      rsvpOffsetTop: document.getElementById("scene-rsvp")?.offsetTop,
      reveals: document.querySelectorAll(".reveal").length,
      docScrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

  await ctx.close();

  const sum = (pred) =>
    Object.entries(sizes)
      .filter(([p]) => pred(p))
      .reduce((a, [, v]) => a + v, 0);

  return {
    firstRenderMs,
    timelineStartMs,
    requestCount: paths.length,
    htmlBytes: sum((p) => !p.endsWith(".js") && !p.endsWith(".css")),
    jsBytes: sum((p) => p.endsWith(".js")),
    cssBytes: sum((p) => p.endsWith(".css")),
    ...geometry,
  };
}

const browser = await chromium.launch();
const results = {};

for (const [name, [w, h]] of Object.entries(VIEWPORTS)) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measureOnce(browser, w, h));
  results[name] = {
    ...runs[0],
    firstRenderMs: median(runs.map((r) => r.firstRenderMs)),
    timelineStartMs: median(runs.map((r) => r.timelineStartMs)),
  };
}

await browser.close();

const rows = [];
for (const [name, n] of Object.entries(results)) {
  const b = BASE.viewports[name];
  const bJs = Object.entries(b.sizes).filter(([p]) => p.endsWith(".js")).reduce((a, [, v]) => a + v, 0);
  const bCss = Object.entries(b.sizes).filter(([p]) => p.endsWith(".css")).reduce((a, [, v]) => a + v, 0);
  const d = (from, to) => (to - from === 0 ? "0" : `${to - from > 0 ? "+" : ""}${to - from}`);

  rows.push(
    [name, "HTML bytes", b.sizes["/"], n.htmlBytes, d(b.sizes["/"], n.htmlBytes)],
    [name, "JS bytes", bJs, n.jsBytes, d(bJs, n.jsBytes)],
    [name, "CSS bytes", bCss, n.cssBytes, d(bCss, n.cssBytes)],
    [name, "Requests", b.requestCount, n.requestCount, d(b.requestCount, n.requestCount)],
    [name, `First render (median of ${RUNS})`, `${b.firstRenderMs}ms`, `${n.firstRenderMs}ms`, "—"],
    [name, `Timeline start (median of ${RUNS})`, "n/a", `${n.timelineStartMs}ms`, "—"],
    [name, "stage height", b.stageH, Math.round(n.stageH), d(b.stageH, Math.round(n.stageH))],
    [name, "rsvp offsetTop", b.rsvpOffsetTop, n.rsvpOffsetTop, d(b.rsvpOffsetTop, n.rsvpOffsetTop)],
    [name, "reveals", b.reveals, n.reveals, d(b.reveals, n.reveals)],
    [
      name,
      "scroll / overflow",
      `${b.docScrolls}/${b.hOverflow}`,
      `${n.docScrolls}/${n.hOverflow}`,
      b.docScrolls === n.docScrolls && b.hOverflow === n.hOverflow ? "same" : "DIFF",
    ]
  );
}

console.log("| Viewport | Metric | Frozen | Current | Delta |");
console.log("|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.join(" | ")} |`);
