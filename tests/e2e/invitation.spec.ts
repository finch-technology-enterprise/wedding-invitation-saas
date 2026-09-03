import { test, expect, type Page } from "@playwright/test";

/** Current translateY of the stage, in px (negative = advanced). */
async function stageY(page: Page): Promise<number> {
  return page.evaluate(() => {
    const stage = document.getElementById("stage")!;
    return new DOMMatrixReadOnly(getComputedStyle(stage).transform).m42;
  });
}

/**
 * Park the canvas on a given scene and settle it, so interaction tests
 * act on a stationary form rather than racing the cinematic drift.
 */
async function gotoScene(page: Page, id: string) {
  await page.evaluate((sceneId) => {
    const stage = document.getElementById("stage")!;
    const scene = document.getElementById(sceneId)!;
    const top = scene.getBoundingClientRect().top - stage.getBoundingClientRect().top;
    stage.style.transform = `translate3d(0,${-top}px,0)`;
    document.querySelectorAll(".reveal").forEach((n) => n.classList.add("is-visible"));
  }, id);
  // Give the timeline's own change-listeners a frame to react and park.
  await page.waitForTimeout(700);
}

/** Drag the canvas upward by `distance` px using a real gesture. */
async function dragUp(page: Page, distance = 420) {
  const box = page.viewportSize()!;
  const x = box.width / 2;
  const from = box.height * 0.85;
  await page.mouse.move(x, from);
  await page.mouse.down();
  for (let y = from; y >= from - distance; y -= 30) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(10);
  }
  await page.mouse.up();
  await page.waitForTimeout(350);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
});

test.describe("canvas model", () => {
  test("root font-size is one tenth of the canvas width", async ({ page }) => {
    const { root, width } = await page.evaluate(() => ({
      root: parseFloat(getComputedStyle(document.documentElement).fontSize),
      width: Math.min(window.innerWidth, 460),
    }));
    expect(root).toBeCloseTo(width / 10, 1);
  });

  test("the document itself never scrolls", async ({ page }) => {
    const doc = await page.evaluate(() => ({
      scrollH: document.documentElement.scrollHeight,
      clientH: document.documentElement.clientHeight,
      overflow: getComputedStyle(document.body).overflow,
      snap: getComputedStyle(document.documentElement).scrollSnapType,
    }));
    expect(doc.scrollH).toBe(doc.clientH);
    expect(doc.overflow).toBe("hidden");
    expect(doc.snap).toBe("none");
  });

  test("there is no horizontal overflow", async ({ page }) => {
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflows).toBe(false);
  });

  test("the stage is exactly 10rem wide", async ({ page }) => {
    const { stage, rem } = await page.evaluate(() => ({
      stage: document.getElementById("stage")!.getBoundingClientRect().width,
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    }));
    expect(stage).toBeCloseTo(rem * 10, 0);
  });

  test("all ten scenes render", async ({ page }) => {
    await expect(page.locator(".scene")).toHaveCount(10);
  });
});

test.describe("cinematic timeline", () => {
  test("advances on its own", async ({ page }) => {
    const before = await stageY(page);
    await page.waitForTimeout(2500);
    const after = await stageY(page);
    expect(after).toBeLessThan(before - 20);
  });

  test("manual drag moves the canvas", async ({ page }) => {
    await page.waitForTimeout(300);
    const before = await stageY(page);
    await dragUp(page, 400);
    const after = await stageY(page);
    expect(after).toBeLessThan(before - 200);
  });

  test("drag tracks the finger and takes over without jumping", async ({ page }) => {
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      document.getElementById("stage")!.style.transform = "translate3d(0,-1200px,0)";
    });
    await page.waitForTimeout(400);

    const atGrab = await stageY(page);
    await page.mouse.move(195, 600);
    await page.mouse.down();
    await page.waitForTimeout(120);
    // Grabbing a drifting canvas must stop it where it is, not snap.
    expect(Math.abs((await stageY(page)) - atGrab)).toBeLessThan(6);

    const held = await stageY(page);
    for (let y = 600; y >= 400; y -= 20) {
      await page.mouse.move(195, y);
      await page.waitForTimeout(20);
    }
    // 200px of finger travel should move the canvas 200px.
    expect(Math.abs((await stageY(page)) - held - -200)).toBeLessThan(12);
    await page.mouse.up();
  });

  test("a flick coasts past the finger's travel", async ({ page }) => {
    await page.evaluate(() => {
      document.getElementById("stage")!.style.transform = "translate3d(0,-1200px,0)";
    });
    await page.waitForTimeout(400);
    const start = await stageY(page);

    await page.mouse.move(195, 700);
    await page.mouse.down();
    for (let y = 700; y >= 300; y -= 50) {
      await page.mouse.move(195, y);
      await page.waitForTimeout(8);
    }
    const atRelease = await stageY(page);
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const settled = await stageY(page);

    expect(atRelease).toBeLessThan(start);
    // Without inertia the canvas would stop dead on release.
    expect(settled).toBeLessThan(atRelease - 60);
  });

  test("a horizontal gesture does not move the canvas", async ({ page }) => {
    await page.evaluate(() => {
      document.getElementById("stage")!.style.transform = "translate3d(0,-1000px,0)";
    });
    await page.waitForTimeout(400);
    const before = await stageY(page);
    await page.mouse.move(80, 500);
    await page.mouse.down();
    for (let x = 80; x <= 320; x += 30) {
      await page.mouse.move(x, 502);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
    expect(Math.abs((await stageY(page)) - before)).toBeLessThan(6);
  });

  test("the top boundary rubber-bands and settles back to zero", async ({ page }) => {
    await page.evaluate(() => {
      document.getElementById("stage")!.style.transform = "translate3d(0,0,0)";
    });
    await page.waitForTimeout(300);
    await page.mouse.move(195, 300);
    await page.mouse.down();
    for (let y = 300; y <= 700; y += 40) {
      await page.mouse.move(195, y);
      await page.waitForTimeout(16);
    }
    const stretched = await stageY(page);
    // Resistance: 400px of pull must not yield 400px of movement.
    expect(stretched).toBeGreaterThan(0);
    expect(stretched).toBeLessThan(300);
    await page.mouse.up();
    await page.waitForTimeout(900);
    expect(await stageY(page)).toBe(0);
  });

  test("advances at the reference's reading pace", async ({ page }) => {
    await page.waitForTimeout(800);
    const t0 = Date.now();
    const y0 = await stageY(page);
    await page.waitForTimeout(4000);
    const rate = (y0 - (await stageY(page))) / ((Date.now() - t0) / 1000);
    // The reference covers 3264px in 72s ≈ 45px/s. Matching the rate (not
    // a fixed duration) is what keeps the copy readable as it passes.
    expect(rate).toBeGreaterThan(35);
    expect(rate).toBeLessThan(58);
  });

  test("never advances past the end of the canvas", async ({ page }) => {
    for (let i = 0; i < 12; i++) await dragUp(page, 600);
    await page.waitForTimeout(600);

    const { y, travel } = await page.evaluate(() => {
      const stage = document.getElementById("stage")!;
      const viewport = document.getElementById("viewport")!;
      return {
        y: new DOMMatrixReadOnly(getComputedStyle(stage).transform).m42,
        travel: stage.scrollHeight - viewport.clientHeight,
      };
    });
    // Allow a pixel of rounding, but no real overshoot.
    expect(y).toBeGreaterThanOrEqual(-travel - 1);
  });

  test("content reveals progressively rather than all at once", async ({ page }) => {
    const visible = () =>
      page.evaluate(() => document.querySelectorAll(".reveal.is-visible").length);

    const atStart = await visible();
    const total = await page.evaluate(() => document.querySelectorAll(".reveal").length);
    expect(atStart).toBeGreaterThan(0);
    expect(atStart).toBeLessThan(total);

    for (let i = 0; i < 8; i++) await dragUp(page, 600);
    await page.waitForTimeout(500);
    expect(await visible()).toBe(total);
  });
});

test.describe("wedding data", () => {
  test("shows our configured couple and date everywhere", async ({ page }) => {
    await expect(page.locator(".cover__date")).toHaveText("2027.10.09");
    await expect(page.locator(".names__zh").first()).toHaveText("李天豪");
    await expect(page.locator(".names__zh").nth(1)).toHaveText("刘蔼蕴");
    // Weekday is derived, never hardcoded: 2027-10-09 is a Saturday.
    await expect(page.locator(".time__date").first()).toHaveText("2027年10月9日 星期六");
  });

  test("calendar is built from the wedding date and marks the right day", async ({ page }) => {
    await expect(page.locator(".calendar__month")).toContainText("10");
    await expect(page.locator(".calendar__year")).toHaveText("-2027-");
    const wedding = page.locator(".calendar__day--wedding");
    await expect(wedding).toHaveCount(1);
    await expect(wedding).toHaveText("9");
  });

  test("countdown renders four two-digit units", async ({ page }) => {
    await expect(page.locator(".countdown__pair")).toHaveCount(4);
    await expect(page.locator(".countdown__digit")).toHaveCount(8);
    for (const label of ["天", "时", "分", "秒"]) {
      await expect(page.locator(".countdown__label", { hasText: label })).toBeVisible();
    }
  });

  test("the add-to-calendar action has a real label and href", async ({ page }) => {
    const cal = page.locator("#cal-action");
    await expect(cal).toHaveText(/加入日历/);
    await expect(cal).toHaveAttribute("href", /^blob:/);
  });
});

test.describe("composition", () => {
  test("photography is never requested for an unsupplied slot", async ({ page }) => {
    const photoRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/assets/photos/")) photoRequests.push(r.url());
    });
    await page.goto("/", { waitUntil: "load" });
    await page.waitForTimeout(1500);
    // Every slot is `ready: false` until the owner supplies a file, so the
    // browser must make no request at all — no 404s, no wasted round-trips.
    expect(photoRequests).toEqual([]);
    await expect(page.locator(".photo__pending").first()).toBeVisible();
  });

  test("the cover is a full-screen plate with the title over the photograph", async ({ page }) => {
    const cover = await page.evaluate(() => {
      const scene = document.getElementById("scene-cover")!;
      const photo = scene.querySelector(".cover__photo")!.getBoundingClientRect();
      const type = scene.querySelector(".cover__type")!.getBoundingClientRect();
      const vp = document.getElementById("viewport")!.getBoundingClientRect();
      return {
        sceneH: Math.round(scene.getBoundingClientRect().height),
        viewportH: Math.round(vp.height),
        photoH: Math.round(photo.height),
        photoW: Math.round(photo.width),
        // The type must sit inside the photograph's bounds, not beneath it.
        typeOverlapsPhoto: type.top >= photo.top && type.bottom <= photo.bottom,
      };
    });
    expect(cover.sceneH).toBe(cover.viewportH);
    expect(cover.photoH).toBe(cover.viewportH);
    expect(cover.photoW).toBe(Math.round(page.viewportSize()!.width));
    expect(cover.typeOverlapsPhoto).toBe(true);
  });

  test("imagery occupies a comparable share of the canvas to the reference", async ({ page }) => {
    const coverage = await page.evaluate(() => {
      const stage = document.getElementById("stage")!;
      const top = stage.getBoundingClientRect().top;
      const bands = [...stage.querySelectorAll(".photo")]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return [r.top - top, r.bottom - top] as [number, number];
        })
        .sort((a, b) => a[0] - b[0]);
      const merged: [number, number][] = [];
      for (const band of bands) {
        const last = merged[merged.length - 1];
        if (last && band[0] <= last[1]) last[1] = Math.max(last[1], band[1]);
        else merged.push([...band]);
      }
      const covered = merged.reduce((s, [a, b]) => s + (b - a), 0);
      return covered / stage.scrollHeight;
    });
    // The reference measures 54.3%. Anything much below 40% means the
    // invitation has drifted back towards being typography-heavy.
    expect(coverage).toBeGreaterThan(0.4);
  });

  test("editorial alignment is not uniformly centred", async ({ page }) => {
    const align = await page.evaluate(() => ({
      storyHeading: getComputedStyle(document.querySelector(".story__heading")!).textAlign,
      storyAnnounce: getComputedStyle(document.querySelector(".story__announce")!).textAlign,
      portraitLabel: getComputedStyle(document.querySelector(".portrait__label")!).writingMode,
    }));
    expect(align.storyHeading).toBe("left");
    expect(align.storyAnnounce).toBe("right");
    expect(align.portraitLabel).toBe("vertical-rl");
  });

  test("reveal animation is used sparingly", async ({ page }) => {
    const reveals = await page.evaluate(() => document.querySelectorAll(".reveal").length);
    // One quiet fade per chapter. Dozens of them is the signature of a
    // scroll-animated template, which is what this must not look like.
    expect(reveals).toBeLessThanOrEqual(10);
  });

  test("headings carry no synthetic bold", async ({ page }) => {
    const weights = await page.evaluate(() =>
      [...document.querySelectorAll("h1, h2, h3")].map((h) => getComputedStyle(h).fontWeight)
    );
    expect(weights.every((w) => w === "400")).toBe(true);
  });
});

test.describe("typography", () => {
  test("the intended webfonts actually render", async ({ page }) => {
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      const check = (sel: string, text: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const family = getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim();
        // The text argument matters: CJK faces are split into unicode-range
        // subsets, so a family-only check reports false even when loaded.
        return { family, ok: document.fonts.check(`20px "${family}"`, text) };
      };
      return {
        body: check(".cover__title", "婚礼邀请函"),
        latin: check(".cover__welcome", "WELCOME"),
        script: check(".names__zh", document.querySelector(".names__zh")!.textContent!),
      };
    });
    expect(fonts.body).toEqual({ family: "Noto Serif SC", ok: true });
    expect(fonts.latin).toEqual({ family: "Cinzel", ok: true });
    expect(fonts.script).toEqual({ family: "Ma Shan Zheng", ok: true });
  });

  test("webfont arrival does not resize the canvas", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
    const early = await page.evaluate(() => document.getElementById("stage")?.scrollHeight ?? 0);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
    const settled = await page.evaluate(() => document.getElementById("stage")!.scrollHeight);
    // A large shift here would move the whole timeline under the visitor.
    if (early > 0) expect(Math.abs(settled - early)).toBeLessThan(40);
  });
});

test.describe("no blank controls", () => {
  test("every button and link has a visible label or accessible name", async ({ page }) => {
    const blank = await page.evaluate(() =>
      [...document.querySelectorAll("button, a[href]")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          return !el.textContent?.trim() && !el.getAttribute("aria-label");
        })
        .map((el) => el.id || el.className)
    );
    expect(blank).toEqual([]);
  });

  test("interactive targets are at least 44px in their smaller axis", async ({ page }) => {
    const small = await page.evaluate(() => {
      const hitHeight = (el: Element) => {
        const own = el.getBoundingClientRect().height;
        // ::before / ::after are used to enlarge deliberately small visuals.
        const pseudo = ["::before", "::after"].map((p) =>
          parseFloat(getComputedStyle(el, p).height) || 0
        );
        return Math.max(own, ...pseudo);
      };
      return [...document.querySelectorAll("button, a[href], input, select, textarea")]
        .filter((el) => el.getBoundingClientRect().width > 0)
        .filter((el) => hitHeight(el) < 43)
        .map((el) => `${el.tagName}#${el.id || el.className}`);
    });
    expect(small).toEqual([]);
  });
});

test.describe("music control", () => {
  test("survives a missing track and never blocks the timeline", async ({ page }) => {
    const errors: string[] = [];
    const audioRequests: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("request", (r) => {
      if (r.url().includes("/assets/audio/")) audioRequests.push(r.url());
    });

    await page.goto("/", { waitUntil: "load" });
    await page.waitForTimeout(1500);

    const toggle = page.locator("#music-toggle");
    await expect(toggle).toBeVisible();
    // No track is configured yet, so it presents muted and — importantly —
    // the file is never requested, so there is no 404 for every visitor.
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(audioRequests).toEqual([]);

    // Tapping the disabled control must be inert, not throw.
    await toggle.dispatchEvent("click");
    await page.waitForTimeout(400);
    expect(errors).toEqual([]);

    // The cinematic timeline runs regardless of audio state.
    const before = await stageY(page);
    await page.waitForTimeout(1800);
    expect(await stageY(page)).toBeLessThan(before);
  });

  test("keeps reference proportions with an accessible hit area", async ({ page }) => {
    const m = await page.evaluate(() => {
      const t = document.getElementById("music-toggle")!;
      const r = t.getBoundingClientRect();
      const vp = document.getElementById("viewport")!.getBoundingClientRect();
      const hit = getComputedStyle(t, "::before");
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      return {
        visualRem: +(r.width / rem).toFixed(3),
        hitPx: parseFloat(hit.width),
        topInset: Math.round(r.top - vp.top),
        rightInset: Math.round(vp.right - r.right),
      };
    });
    // The reference disc is 31.2px at a 390px canvas = 0.8rem. The visible
    // artwork stays that size; only the invisible hit area is enlarged.
    expect(m.visualRem).toBeCloseTo(0.8, 2);
    expect(m.hitPx).toBeGreaterThanOrEqual(44);
    expect(m.topInset).toBeGreaterThan(0);
    expect(m.rightInset).toBeGreaterThan(0);
  });
});

test.describe("rsvp", () => {
  test.beforeEach(async ({ page }) => {
    await gotoScene(page, "scene-rsvp");
  });

  test("reaching the form parks the cinematic drift so it can be used", async ({ page }) => {
    const before = await stageY(page);
    await page.waitForTimeout(1500);
    expect(Math.abs((await stageY(page)) - before)).toBeLessThan(2);
  });

  test("is compact by default and expands for optional details", async ({ page }) => {
    await expect(page.locator("#rsvp-optional")).toBeHidden();
    await page.locator("#rsvp-more").click();
    await expect(page.locator("#rsvp-optional")).toBeVisible();
    await expect(page.locator("#rsvp-phone")).toBeVisible();
    await expect(page.locator("#rsvp-message")).toBeVisible();
  });

  test("shows a specific error when the name is missing", async ({ page }) => {
    await page.locator("#rsvp-submit").click();
    const error = page.locator("#rsvp-error");
    await expect(error).toBeVisible();
    await expect(error).toHaveText("请填写姓名");
  });

  test("shows a specific error when no contact is given", async ({ page }) => {
    await page.locator("#rsvp-name").fill("测试宾客");
    await page.locator("#rsvp-submit").click();
    const error = page.locator("#rsvp-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("电话");
    // The collapsed section must open so the message is actionable.
    await expect(page.locator("#rsvp-optional")).toBeVisible();
  });

  test("submits successfully and confirms inline", async ({ page }) => {
    await page.locator("#rsvp-name").fill("测试宾客");
    await page.locator("#rsvp-more").click();
    await page.locator("#rsvp-phone").fill("+60123456789");

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/rsvp")),
      page.locator("#rsvp-submit").click(),
    ]);

    expect(response.status()).toBe(200);
    await expect(page.locator("#rsvp-form")).toBeHidden();
    await expect(page.locator("#rsvp-success")).toBeVisible();
  });

  test("reports a server failure visibly instead of failing silently", async ({ page }) => {
    await page.route("**/i/*/rsvp", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "server_error" }),
      })
    );

    await page.locator("#rsvp-name").fill("测试宾客");
    await page.locator("#rsvp-more").click();
    await page.locator("#rsvp-phone").fill("+60123456789");
    await page.locator("#rsvp-submit").click();

    const error = page.locator("#rsvp-error");
    await expect(error).toBeVisible();
    await expect(error).not.toHaveText("");
    // The form stays available so the guest can retry.
    await expect(page.locator("#rsvp-form")).toBeVisible();
    await expect(page.locator("#rsvp-submit")).toBeEnabled();
  });
});

test.describe("runtime health", () => {
  test("loads with no console errors and no failed project requests", async ({ page }) => {
    const errors: string[] = [];
    const failed: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("response", (r) => {
      if (r.status() >= 400 && new URL(r.url()).host.includes("127.0.0.1")) {
        failed.push(`${r.status()} ${r.url()}`);
      }
    });

    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
  });
});

test.describe("visual baselines", () => {
  /** Park the canvas on a scene and settle it for a deterministic shot. */
  async function frame(page: Page, sceneId: string) {
    await page.evaluate((id) => {
      const stage = document.getElementById("stage")!;
      const scene = document.getElementById(id)!;
      stage.style.transform = `translate3d(0,${-scene.offsetTop}px,0)`;
      document.querySelectorAll(".reveal").forEach((n) => n.classList.add("is-visible"));
    }, sceneId);
    await page.waitForTimeout(700);
  }

  // Baselines are named per scene rather than per timestamp, so a pacing
  // change does not invalidate them and a diff points at a real chapter.
  for (const scene of [
    "cover",
    "names",
    "poem",
    "portrait",
    "story",
    "landscape",
    "venue",
    "closing",
  ]) {
    test(scene, async ({ page }) => {
      await frame(page, `scene-${scene}`);
      await expect(page).toHaveScreenshot(`${scene}.png`, { animations: "disabled" });
    });
  }

  test("time", async ({ page }) => {
    await frame(page, "scene-time");
    await expect(page).toHaveScreenshot("time.png", {
      animations: "disabled",
      // The seconds digit changes between runs.
      mask: [page.locator(".countdown")],
    });
  });

  test("rsvp", async ({ page }) => {
    await frame(page, "scene-rsvp");
    await expect(page).toHaveScreenshot("rsvp.png", { animations: "disabled" });
  });

  test("rsvp expanded", async ({ page }) => {
    await frame(page, "scene-rsvp");
    await page.locator("#rsvp-more").click();
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot("rsvp-expanded.png", { animations: "disabled" });
  });

  test("rsvp success", async ({ page }) => {
    await frame(page, "scene-rsvp");
    await page.locator("#rsvp-name").fill("测试宾客");
    await page.locator("#rsvp-more").click();
    await page.locator("#rsvp-phone").fill("+60123456789");
    await page.locator("#rsvp-submit").click();
    await expect(page.locator("#rsvp-success")).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page).toHaveScreenshot("rsvp-success.png", { animations: "disabled" });
  });
});

test.describe("reduced motion", () => {
  test("does not auto-advance but still allows manual exploration", async ({ page }) => {
    // Emulated on the page directly. `test.use({ reducedMotion })` is
    // overridden by the per-project `use` block in the config, so the
    // preference is set explicitly and then verified before asserting.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/", { waitUntil: "networkidle" });
    expect(
      await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)
    ).toBe(true);
    await page.waitForTimeout(1500);
    const before = await stageY(page);
    await page.waitForTimeout(2500);
    // No cinematic drift. A pixel of tolerance covers sub-pixel rounding
    // in the transform readback; auto-play would move hundreds of px.
    expect(Math.abs((await stageY(page)) - before)).toBeLessThan(2);

    await dragUp(page, 400);
    expect(await stageY(page)).toBeLessThan(before - 200);
  });
});
