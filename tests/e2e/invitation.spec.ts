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
  test("survives blocked autoplay and toggles without crashing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const toggle = page.locator("#music-toggle");
    await expect(toggle).toBeVisible();
    // No audio file is supplied yet, so it must present as not-playing.
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await page.waitForTimeout(400);
    expect(errors).toEqual([]);

    // The timeline must keep running regardless of audio state.
    const before = await stageY(page);
    await page.waitForTimeout(1800);
    expect(await stageY(page)).toBeLessThan(before);
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
      page.waitForResponse((r) => r.url().includes("/api/rsvp")),
      page.locator("#rsvp-submit").click(),
    ]);

    expect(response.status()).toBe(200);
    await expect(page.locator("#rsvp-form")).toBeHidden();
    await expect(page.locator("#rsvp-success")).toBeVisible();
  });

  test("reports a server failure visibly instead of failing silently", async ({ page }) => {
    await page.route("**/api/rsvp", (route) =>
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
  test("cover", async ({ page }) => {
    // Freeze motion so the baseline is deterministic.
    await page.evaluate(() => {
      const stage = document.getElementById("stage")!;
      stage.style.transform = "translate3d(0,0,0)";
      document.querySelectorAll(".reveal").forEach((n) => n.classList.add("is-visible"));
    });
    await page.waitForTimeout(600);
    await expect(page).toHaveScreenshot("cover.png", { animations: "disabled" });
  });

  test("wedding time", async ({ page }) => {
    await page.evaluate(() => {
      const stage = document.getElementById("stage")!;
      const scene = document.getElementById("scene-time")!;
      const top = scene.getBoundingClientRect().top - stage.getBoundingClientRect().top;
      stage.style.transform = `translate3d(0,${-top}px,0)`;
      document.querySelectorAll(".reveal").forEach((n) => n.classList.add("is-visible"));
    });
    await page.waitForTimeout(600);
    await expect(page).toHaveScreenshot("time.png", {
      animations: "disabled",
      // The seconds digit changes between runs.
      mask: [page.locator(".countdown")],
    });
  });

  test("rsvp", async ({ page }) => {
    await page.evaluate(() => {
      const stage = document.getElementById("stage")!;
      const scene = document.getElementById("scene-rsvp")!;
      const top = scene.getBoundingClientRect().top - stage.getBoundingClientRect().top;
      stage.style.transform = `translate3d(0,${-top}px,0)`;
      document.querySelectorAll(".reveal").forEach((n) => n.classList.add("is-visible"));
    });
    await page.waitForTimeout(600);
    await expect(page).toHaveScreenshot("rsvp.png", { animations: "disabled" });
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
