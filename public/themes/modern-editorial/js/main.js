/**
 * Modern Editorial — guest renderer (vanilla ES, zero dependencies).
 *
 * Scrolling magazine composition, driven by the same bootstrap contract
 * as cinematic-classic: window.__INVITATION__ = { slug, revisionId,
 * isPreview, locale, strings, party, config, mediaUrls }.
 */

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "htmlFor") node.htmlFor = value;
    else if (key in node && key !== "list") node[key] = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

const $ = (sel, root = document) => root.querySelector(sel);

function randomKey() {
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return `k-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}

function formatLongDate(iso, locale) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(d);
  } catch {
    return iso;
  }
}

function breakdown(ms) {
  if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  const s = Math.floor(ms / 1000);
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

function photo(url, alt, ratio, eager) {
  if (!url) return null;
  const img = el("img", {
    src: url,
    alt: alt || "",
    loading: eager ? "eager" : "lazy",
    decoding: "async",
    ...(eager ? { fetchpriority: "high" } : {}),
  });
  if (ratio) img.style.aspectRatio = ratio;
  return img;
}

function startCountdown(root, target, units) {
  const cells = {
    days: $(".countdown__value[data-unit='days']", root),
    hours: $(".countdown__value[data-unit='hours']", root),
    minutes: $(".countdown__value[data-unit='minutes']", root),
    seconds: $(".countdown__value[data-unit='seconds']", root),
  };
  function tick() {
    const { days, hours, minutes, seconds } = breakdown(target.getTime() - Date.now());
    if (cells.days) cells.days.textContent = String(days);
    if (cells.hours) cells.hours.textContent = String(hours).padStart(2, "0");
    if (cells.minutes) cells.minutes.textContent = String(minutes).padStart(2, "0");
    if (cells.seconds) cells.seconds.textContent = String(seconds).padStart(2, "0");
    root.setAttribute(
      "aria-label",
      `${days} ${units.days} ${hours} ${units.hours} ${minutes} ${units.minutes} ${seconds} ${units.seconds}`
    );
    if (target.getTime() - Date.now() <= 0) clearInterval(timer);
  }
  tick();
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}

function setupReveals() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!("IntersectionObserver" in window)) {
    for (const n of document.querySelectorAll(".reveal")) n.classList.add("is-visible");
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12 }
  );
  for (const n of document.querySelectorAll(".reveal")) io.observe(n);
}

function rsvpSection({ strings, slug, deadlineISO, maxGuests, partyToken }) {
  const section = el("section", { class: "section", id: "rsvp" });
  section.append(
    el("p", { class: "section__kicker", text: "RSVP" }),
    el("h2", { class: "section__title", text: strings.rsvpHeading })
  );
  if (deadlineISO) {
    section.append(
      el("p", {
        class: "rsvp__deadline",
        text: strings.rsvpDeadline.replace("{date}", formatLongDate(deadlineISO, document.documentElement.lang || "en")),
      })
    );
  }
  const form = el("form", { class: "rsvp", noValidate: true });
  const err = el("p", { class: "form-error", role: "alert" });
  const name = el("input", { type: "text", id: "r-name", name: "name", autocomplete: "name", required: true });
  const attendingYes = el("input", { type: "radio", name: "attending", value: "yes", checked: true });
  const attendingNo = el("input", { type: "radio", name: "attending", value: "no" });
  const guests = el("input", { type: "number", id: "r-guests", value: "1", min: "1", max: String(maxGuests || 12) });
  const phone = el("input", { type: "tel", id: "r-phone", autocomplete: "tel" });
  const message = el("textarea", { id: "r-message" });
  const honey = el("input", {
    type: "text", name: "website", autocomplete: "off", tabindex: "-1",
    style: "position:absolute;left:-9999px;",
    "aria-hidden": "true",
  });
  const submit = el("button", { class: "btn btn--solid", type: "submit", text: strings.rsvpSubmit });
  const success = el("div", { class: "form-success", hidden: true }, [
    el("h3", { text: strings.rsvpSuccessTitle }),
    el("p", { text: strings.rsvpSuccessBody }),
  ]);

  form.append(
    el("div", { class: "field" }, [el("label", { htmlFor: "r-name", text: strings.rsvpName }), name]),
    el("div", { class: "field" }, [
      el("span", { text: strings.rsvpAttending }),
      el("div", { class: "radio-row" }, [
        el("label", {}, [attendingYes, strings.rsvpYes]),
        el("label", {}, [attendingNo, strings.rsvpNo]),
      ]),
    ]),
    el("div", { class: "field" }, [el("label", { htmlFor: "r-guests", text: strings.rsvpGuests }), guests]),
    el("div", { class: "field" }, [el("label", { htmlFor: "r-phone", text: strings.rsvpPhone }), phone]),
    el("div", { class: "field" }, [el("label", { htmlFor: "r-message", text: strings.rsvpMessage }), message]),
    honey,
    err,
    submit
  );
  const idempotencyKey = randomKey();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    err.textContent = "";
    const payload = {
      name: name.value.trim(),
      attending: form.elements.attending.value === "yes",
      guests: Number(guests.value || 1),
      phone: phone.value.trim(),
      message: message.value.trim(),
      website: honey.value,
      idempotencyKey,
      ...(partyToken ? { partyToken } : {}),
    };
    if (!payload.name) {
      err.textContent = strings.rsvpName;
      name.setAttribute("aria-invalid", "true");
      name.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = strings.rsvpSubmitting;
    try {
      const res = await fetch(`/i/${slug}/rsvp`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "fetch" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        form.hidden = true;
        success.hidden = false;
        const live = $("#live-region");
        if (live) live.textContent = `${strings.rsvpSuccessTitle}. ${strings.rsvpSuccessBody}`;
        return;
      }
      err.textContent = res.status === 403 ? strings.rsvpDeadline.replace("{date}", "") : JSON.stringify(data?.errors ?? data ?? {});
    } catch {
      err.textContent = strings.rsvpSubmit;
    } finally {
      submit.disabled = false;
      submit.textContent = strings.rsvpSubmit;
    }
  });
  section.append(form, success);
  return section;
}

function shareSection({ strings, slug }) {
  const url = `${window.location.origin}/i/${slug}`;
  const section = el("section", { class: "section", id: "share" });
  section.append(el("h2", { class: "section__title", text: strings.shareTitle }));
  const row = el("div", { class: "share" });
  const wa = el(
    "a",
    {
      class: "btn",
      href: `https://wa.me/?text=${encodeURIComponent(`${strings.openInvitation} ${url}`)}`,
      target: "_blank",
      rel: "noopener",
    },
    [strings.shareTitle]
  );
  const copy = el("button", { class: "btn", type: "button", text: strings.copyLink });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      copy.textContent = strings.copied;
    } catch {
      window.prompt(strings.copyLink, url);
    }
  });
  row.append(wa, copy);
  section.append(row);
  return section;
}

function boot() {
  const bootstrap = typeof window !== "undefined" ? window.__INVITATION__ : undefined;
  const root = $("#editorial");
  if (!bootstrap || !root) return;

  const config = bootstrap.config ?? {};
  const mediaUrls = bootstrap.mediaUrls ?? {};
  const strings = bootstrap.strings ?? {
    rsvpHeading: "RSVP", rsvpName: "Name", rsvpAttending: "Attending?",
    rsvpYes: "Yes", rsvpNo: "No", rsvpGuests: "Guests", rsvpPhone: "Phone",
    rsvpMessage: "Message", rsvpSubmit: "Send", rsvpSubmitting: "Sending…",
    rsvpSuccessTitle: "Thank you", rsvpSuccessBody: "Received.",
    rsvpDeadline: "Reply by {date}", countdownDays: "days", countdownHours: "hours",
    countdownMinutes: "min", countdownSeconds: "sec", addToCalendar: "Add to calendar",
    viewMap: "View map", shareTitle: "Share", copyLink: "Copy link", copied: "Copied",
    openInvitation: "Invitation",
  };
  const locale = bootstrap.locale || "en";
  try {
    document.documentElement.lang = locale;
  } catch { /* noop */ }

  const tokens = config.tokens ?? {};
  const css = document.documentElement.style;
  if (tokens.accent) css.setProperty("--accent", tokens.accent);
  if (tokens.paper) css.setProperty("--paper", tokens.paper);
  if (tokens.ink) css.setProperty("--ink", tokens.ink);
  document.body.classList.add(`type-${tokens.typePreset === "serif" ? "serif" : tokens.typePreset === "sans" ? "sans" : "serif"}`);
  const motion = config.motion?.level ?? "subtle";
  if (motion !== "still") document.body.classList.add(`motion-${motion}`);

  const sections = config.sections ?? {};
  const show = (id) => sections[id] !== false;

  const slug = bootstrap.slug;
  const couple = config.couple ?? {};
  const names = [couple.partnerA, couple.partnerB].filter(Boolean).join(" & ") || "Alex & Jamie";
  document.title = `${names} — Wedding`;
  root.setAttribute("aria-label", names);

  if (bootstrap.party?.title) {
    root.append(el("p", { class: "party-greeting", role: "note", text: bootstrap.party.title }));
  }

  const dateIso = config.date?.iso;
  const date = dateIso ? new Date(dateIso) : null;
  const validDate = date && !Number.isNaN(date.getTime()) ? date : null;

  // Hero
  if (show("hero")) {
    const hero = el("header", { class: "hero reveal" });
    const copy = config.copy?.hero ?? {};
    hero.append(
      el("p", { class: "hero__kicker", text: copy.kicker || "The Wedding Of" }),
      el("h1", { class: "hero__title", text: copy.title || names }),
      el("p", { class: "hero__subtitle", text: copy.subtitle || couple.tagline || "" }),
      validDate ? el("p", { class: "hero__date", text: formatLongDate(dateIso, locale) }) : null
    );
    const cover = photo(mediaUrls.cover, copy.title || names, "4 / 5", true);
    if (cover) {
      const wrap = el("div", { class: "hero__cover" });
      wrap.append(cover);
      hero.append(wrap);
    }
    root.append(hero);
  }

  // Couple
  if (show("couple")) {
    const copy = config.copy?.couple ?? {};
    const s = el("section", { class: "section reveal" });
    s.append(el("h2", { class: "section__title", text: copy.heading || "The Couple" }));
    s.append(el("p", { class: "couple-names", text: names }));
    if (copy.body) for (const para of String(copy.body).split("\n")) s.append(el("p", { class: "body", text: para }));
    if (validDate) {
      const cd = el("div", { class: "countdown", role: "timer" });
      for (const unit of ["days", "hours", "minutes", "seconds"]) {
        cd.append(
          el("div", { class: "countdown__cell" }, [
            el("div", { class: "countdown__value", "data-unit": unit, text: "–" }),
            el("div", { class: "countdown__unit", text: strings[`countdown${unit[0].toUpperCase()}${unit.slice(1)}`] || unit }),
          ])
        );
      }
      s.append(cd);
      startCountdown(s, validDate, {
        days: strings.countdownDays, hours: strings.countdownHours,
        minutes: strings.countdownMinutes, seconds: strings.countdownSeconds,
      });
      const label = config.date?.label ? el("p", { class: "body", text: config.date.label }) : null;
      if (label) s.append(label);
    }
    root.append(s);
  }

  // Schedule
  if (show("schedule") && Array.isArray(config.schedule?.items) && config.schedule.items.length) {
    const copy = config.copy?.schedule ?? {};
    const s = el("section", { class: "section reveal" });
    s.append(el("h2", { class: "section__title", text: copy.heading || "Schedule" }));
    if (copy.note) s.append(el("p", { class: "body", text: copy.note }));
    const list = el("ol", { class: "schedule" });
    for (const item of config.schedule.items) {
      list.append(
        el("li", { class: "schedule__item" }, [
          el("span", { class: "schedule__time", text: item.time || "" }),
          el("span", {}, [
            el("div", { class: "schedule__name", text: item.title || "" }),
            item.note ? el("div", { class: "schedule__note", text: item.note }) : null,
          ]),
        ])
      );
    }
    s.append(list);
    root.append(s);
  }

  // Gallery
  if (show("gallery")) {
    const urls = [mediaUrls.gallery_1, mediaUrls.gallery_2, mediaUrls.gallery_3].filter(Boolean);
    if (urls.length) {
      const s = el("section", { class: "section reveal" });
      const g = el("div", { class: "gallery" });
      urls.forEach((url, i) => {
        const fig = el("figure", {});
        const img = photo(url, `Gallery photo ${i + 1}`, "1 / 1", false);
        if (img) fig.append(img);
        g.append(fig);
      });
      s.append(g);
      root.append(s);
    }
  }

  // Venue
  if (show("venue")) {
    const copy = config.copy?.venue ?? {};
    const venue = config.venue ?? {};
    const s = el("section", { class: "section reveal venue" });
    s.append(el("h2", { class: "section__title", text: copy.heading || "Venue" }));
    if (!venue.tba) {
      if (venue.name) s.append(el("p", { class: "body", text: venue.name }));
      if (venue.address) s.append(el("p", { class: "body", text: venue.address }));
    } else {
      if (copy.note) s.append(el("p", { class: "body", text: copy.note }));
    }
    const vimg = photo(mediaUrls.venue, venue.name || "Venue", "16 / 10", false);
    if (vimg) s.append(vimg);
    const actions = el("div", { class: "actions" });
    if (venue.mapsUrl) {
      actions.append(
        el("a", { class: "btn", href: venue.mapsUrl, target: "_blank", rel: "noopener", text: strings.viewMap })
      );
    }
    if (validDate) {
      const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      const end = new Date(validDate.getTime() + (config.date?.durationHours || 4) * 3600000);
      const ics = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//invitation-platform//EN",
        "BEGIN:VEVENT", `UID:${randomKey()}@invitation`, `DTSTAMP:${stamp(new Date())}`,
        `DTSTART:${stamp(validDate)}`, `DTEND:${stamp(end)}`,
        `SUMMARY:${names} Wedding`, "END:VEVENT", "END:VCALENDAR",
      ].join("\r\n");
      actions.append(
        el("a", {
          class: "btn", href: `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`,
          download: "wedding.ics", text: strings.addToCalendar,
        })
      );
    }
    if (actions.children.length) s.append(actions);
    root.append(s);
  }

  // RSVP
  if (show("rsvp")) {
    let partyToken = null;
    try {
      partyToken = new URLSearchParams(window.location.search).get("party");
    } catch { /* noop */ }
    root.append(
      rsvpSection({
        strings,
        slug,
        deadlineISO: config.rsvp?.deadlineISO,
        maxGuests: config.rsvp?.maxGuests || 12,
        partyToken,
      })
    );
  }

  // Share
  root.append(shareSection({ strings, slug }));
  root.append(el("footer", { class: "colophon", text: `${names}` }));

  setupReveals();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
