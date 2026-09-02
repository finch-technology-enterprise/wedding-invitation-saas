/**
 * Scene construction.
 *
 * Builds the long cinematic canvas from `wedding` config. Each
 * chapter is a <section class="scene">; the canvas height is the
 * sum of its chapters rather than a hardcoded total, so editing
 * copy or swapping photography cannot desynchronise the timeline.
 */

import { el, svg, lines } from "./dom.js";
import { formatChineseDate, formatDottedDate, monthGrid } from "./datetime.js";

/* ---------------------------------------------------------------
   Shared pieces
   --------------------------------------------------------------- */

/** Hairline rule with a centred diamond. */
function rule(className = "") {
  return el("div", { class: `rule ${className}`.trim(), "aria-hidden": "true" }, [
    el("span", { class: "rule__gem" }),
  ]);
}

/** The 囍 seal, drawn rather than imaged. */
function seal() {
  return el("div", { class: "seal", "aria-hidden": "true", text: "囍" });
}

/**
 * A photography slot that holds its aspect ratio whether or not the
 * file exists yet. A missing image resolves to the neutral
 * placeholder instead of a broken-image icon or a console 404 storm:
 * the <img> is only attached after it decodes successfully.
 *
 * @param {{src:string, ratio:string, alt:string}} slot
 * @param {string} className
 * @param {string} label  shown while the slot is unfilled
 */
function photo(slot, className, label) {
  const frame = el("div", {
    class: `photo ${className}`.trim(),
    style: { "--ratio": slot.ratio },
  });

  frame.append(el("span", { class: "photo__pending", text: label }));

  // Probe first so a missing file never reaches the document as a
  // failed <img> request the user can see.
  const probe = new Image();
  probe.decoding = "async";
  probe.addEventListener("load", () => {
    const img = el("img", {
      src: slot.src,
      alt: slot.alt || "",
      decoding: "async",
      width: probe.naturalWidth,
      height: probe.naturalHeight,
    });
    frame.prepend(img);
    frame.classList.add("is-filled");
    requestAnimationFrame(() => img.classList.add("is-loaded"));
  });
  probe.addEventListener("error", () => {
    // Slot stays in its placeholder state. Intentionally silent.
  });
  probe.src = slot.src;

  return frame;
}

/** Mark an element for the reveal-on-approach observer. */
function reveal(node) {
  node.classList.add("reveal");
  return node;
}

/* ---------------------------------------------------------------
   Scene 1 — Cover
   --------------------------------------------------------------- */

function sceneCover(w, parts) {
  const c = w.copy.cover;
  return el("section", { class: "scene", id: "scene-cover" }, [
    reveal(el("p", { class: "t-title cover__title", text: c.bracket })),
    reveal(el("p", { class: "t-latin cover__welcome", text: c.welcome })),
    reveal(el("p", { class: "t-date cover__date", text: formatDottedDate(parts) })),
    photo(w.photos.hero, "cover__photo", "hero"),
  ]);
}

/* ---------------------------------------------------------------
   Scene 2 — Couple names
   --------------------------------------------------------------- */

function sceneNames(w) {
  const { groom, bride } = w.couple;
  return el("section", { class: "scene", id: "scene-names" }, [
    reveal(el("div", { class: "names__seal" }, [seal()])),
    reveal(el("p", { class: "names__zh", text: groom.zh })),
    reveal(el("p", { class: "names__en", text: groom.en })),
    reveal(el("p", { class: "names__amp", text: "&" })),
    reveal(el("p", { class: "names__zh", text: bride.zh })),
    reveal(el("p", { class: "names__en", text: bride.en })),
    reveal(rule("names__rule")),
  ]);
}

/* ---------------------------------------------------------------
   Scene 3 — Poem
   --------------------------------------------------------------- */

function scenePoem(w) {
  const p = w.copy.poem;
  return el("section", { class: "scene", id: "scene-poem" }, [
    reveal(el("h2", { class: "poem__heading", text: p.heading })),
    reveal(el("div", { class: "poem__lines t-body" }, lines(p.lines))),
    reveal(el("p", { class: "poem__motif", text: p.motif })),
    reveal(el("div", { class: "t-body" }, lines(p.after))),
  ]);
}

/* ---------------------------------------------------------------
   Scene 4 — Portrait
   --------------------------------------------------------------- */

function scenePortrait(w) {
  const { groom, bride } = w.couple;
  const lbl = w.copy.portrait;

  const side = (modifier, label, name) =>
    el("div", { class: `portrait__side portrait__side--${modifier}` }, [
      el("p", { class: "portrait__label" }, [
        document.createTextNode(name),
        el("small", { text: `　${label}` }),
      ]),
      el("span", { class: "vrule", "aria-hidden": "true" }),
    ]);

  return el("section", { class: "scene", id: "scene-portrait" }, [
    reveal(
      el("div", { class: "portrait__row" }, [
        side("start", lbl.brideLabel, bride.zh),
        photo(w.photos.portrait, "portrait__photo", "portrait"),
        side("end", lbl.groomLabel, groom.zh),
      ])
    ),
  ]);
}

/* ---------------------------------------------------------------
   Scene 5 — Story
   --------------------------------------------------------------- */

function sceneStory(w) {
  const s = w.copy.story;
  return el("section", { class: "scene", id: "scene-story" }, [
    reveal(
      el("div", { class: "story__head" }, [
        el("span", { class: "story__mark", "aria-hidden": "true", text: "❖" }),
        el("h2", { class: "story__heading", text: s.heading }),
      ])
    ),
    reveal(el("p", { class: "story__announce", text: s.announce })),
    reveal(photo(w.photos.story, "story__photo", "story")),
    reveal(el("p", { class: "story__badge", text: s.badge })),
    reveal(rule("story__badge-rule")),
    reveal(el("p", { class: "story__invite", text: s.invite })),
    reveal(el("div", { class: "story__letter t-body t-body-sm" }, lines(s.letter))),
    reveal(el("p", { class: "story__caption", text: s.caption })),
  ]);
}

/* ---------------------------------------------------------------
   Scene 6 — Full-bleed landscape
   --------------------------------------------------------------- */

function sceneLandscape(w) {
  return el("section", { class: "scene", id: "scene-landscape" }, [
    photo(w.photos.landscape, "landscape__photo", "landscape"),
  ]);
}

/* ---------------------------------------------------------------
   Scene 7 — Wedding time (calendar + countdown live here)
   --------------------------------------------------------------- */

function calendar(parts) {
  const { lead, days } = monthGrid(parts.year, parts.month);
  const mm = String(parts.month + 1).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");

  const grid = el("ul", { class: "calendar__grid" });
  for (let i = 0; i < lead; i++) {
    grid.append(el("li", { class: "calendar__day calendar__day--empty", "aria-hidden": "true" }));
  }
  for (const day of days) {
    const isWedding = day === parts.day;
    grid.append(
      el("li", {
        class: `calendar__day${isWedding ? " calendar__day--wedding" : ""}`,
        text: String(day),
        "aria-current": isWedding ? "date" : null,
      })
    );
  }

  return el("div", { class: "calendar", role: "img", "aria-label": `${parts.year}年${parts.month + 1}月，婚礼于${parts.day}日` }, [
    el("div", { class: "calendar__head" }, [
      el("div", { class: "calendar__month" }, [
        document.createTextNode(mm),
        el("span", { text: ` / ${dd}` }),
      ]),
      el("div", { class: "calendar__year", text: `-${parts.year}-` }),
    ]),
    el(
      "div",
      { class: "calendar__week", "aria-hidden": "true" },
      ["一", "二", "三", "四", "五", "六", "日"].map((d) => el("span", { text: d }))
    ),
    grid,
  ]);
}

function countdown() {
  const unit = (key, label) =>
    el("div", { class: "countdown__unit" }, [
      el("div", { class: "countdown__pair", dataset: { unit: key } }, [
        el("span", { class: "countdown__digit" }, [el("span", { text: "0" })]),
        el("span", { class: "countdown__digit" }, [el("span", { text: "0" })]),
      ]),
      el("span", { class: "countdown__label", text: label }),
    ]);

  return el(
    "div",
    { class: "countdown", id: "countdown", role: "timer", "aria-label": "距离婚礼还有" },
    [unit("days", "天"), unit("hours", "时"), unit("minutes", "分"), unit("seconds", "秒")]
  );
}

function icon(path) {
  return svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, [
    svg("path", { d: path, "stroke-linecap": "round", "stroke-linejoin": "round" }),
  ]);
}

function sceneTime(w, parts) {
  const t = w.copy.time;
  const v = w.copy.venue;

  const dateText = formatChineseDate(parts);
  const detail = [w.date.lunar, w.date.timeLabel].filter(Boolean).join("　");

  // Understated actions. The .ics href is attached by main.js once
  // the blob URL exists; the Maps link only renders when we have one.
  const actions = el("div", { class: "actions" }, [
    el("a", { class: "action", id: "cal-action", download: "wedding.ics" }, [
      icon("M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"),
      el("span", { text: v.calendarLabel }),
    ]),
    w.venue.mapsUrl
      ? el(
          "a",
          { class: "action", href: w.venue.mapsUrl, target: "_blank", rel: "noopener" },
          [
            icon("M12 21s7-6.5 7-11a7 7 0 1 0-14 0c0 4.5 7 11 7 11Z M12 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"),
            el("span", { text: v.mapLabel }),
          ]
        )
      : null,
  ]);

  return el("section", { class: "scene", id: "scene-time" }, [
    reveal(el("p", { class: "time__mark", "aria-hidden": "true", text: "❦" })),
    reveal(el("h2", { class: "t-heading", text: t.heading })),
    reveal(el("p", { class: "time__date", text: dateText })),
    detail ? reveal(el("p", { class: "time__date t-body-sm", text: detail })) : null,
    reveal(calendar(parts)),
    reveal(countdown()),
    reveal(el("p", { class: "t-quote time__quote", text: t.quote })),
    reveal(actions),
  ]);
}

/* ---------------------------------------------------------------
   Scene 8 — Venue
   --------------------------------------------------------------- */

function sceneVenue(w) {
  const v = w.copy.venue;
  const tba = w.venue.tba || !w.venue.name;

  return el("section", { class: "scene", id: "scene-venue" }, [
    reveal(el("h2", { class: "t-heading", text: v.heading })),
    reveal(photo(w.photos.venue, "venue__photo", "venue")),
    reveal(el("p", { class: "venue__name", text: tba ? v.tbaName : w.venue.name })),
    reveal(
      el("p", {
        class: "venue__address",
        text: tba ? v.tbaNote : w.venue.address,
      })
    ),
  ]);
}

/* ---------------------------------------------------------------
   Scene 9 — Closing
   --------------------------------------------------------------- */

function sceneClosing(w) {
  const c = w.copy.closing;
  const { groom, bride } = w.couple;
  return el("section", { class: "scene", id: "scene-closing" }, [
    reveal(el("div", { class: "closing__poem" }, lines(c.poem))),
    reveal(rule()),
    reveal(
      el("div", { class: "closing__thanks" }, [
        el("p", { text: c.thanks }),
        el("p", { text: c.thanksLine2 }),
      ])
    ),
    reveal(el("p", { class: "closing__names", text: `${groom.zh}　&　${bride.zh}` })),
  ]);
}

/* ---------------------------------------------------------------
   Scene 10 — RSVP
   --------------------------------------------------------------- */

function field({ id, label, required, control, hint }) {
  return el("div", { class: "field" }, [
    el("label", { class: "field__label", for: id }, [
      document.createTextNode(label),
      required ? el("span", { class: "req", text: " *" }) : null,
    ]),
    control,
    hint ? el("p", { class: "rsvp__hint", text: hint }) : null,
  ]);
}

function sceneRsvp(w) {
  const r = w.copy.rsvp;

  const guestOptions = Array.from({ length: w.rsvp.maxGuests }, (_, i) =>
    el("option", { value: String(i + 1), text: String(i + 1) })
  );

  const form = el("form", { class: "rsvp__form", id: "rsvp-form", novalidate: true }, [
    field({
      id: "rsvp-name",
      label: r.name,
      required: true,
      control: el("input", {
        class: "field__control",
        id: "rsvp-name",
        name: "name",
        type: "text",
        maxLength: 80,
        autocomplete: "name",
        placeholder: r.name,
      }),
    }),

    el("div", { class: "field" }, [
      el("span", { class: "field__label", id: "rsvp-attending-label" }, [
        document.createTextNode(r.attending),
        el("span", { class: "req", text: " *" }),
      ]),
      el(
        "div",
        { class: "choice", role: "radiogroup", "aria-labelledby": "rsvp-attending-label" },
        [
          el("label", { class: "choice__option" }, [
            el("input", { type: "radio", name: "attending", value: "yes", checked: true }),
            el("span", { text: r.yes }),
          ]),
          el("label", { class: "choice__option" }, [
            el("input", { type: "radio", name: "attending", value: "no" }),
            el("span", { text: r.no }),
          ]),
        ]
      ),
    ]),

    el("div", { class: "field", id: "rsvp-guests-field" }, [
      el("label", { class: "field__label", for: "rsvp-guests", text: r.guests }),
      el("select", { class: "field__control", id: "rsvp-guests", name: "guests" }, guestOptions),
    ]),

    // Optional details stay collapsed so the default form is short.
    el("button", {
      type: "button",
      class: "rsvp__more",
      id: "rsvp-more",
      text: r.optionalToggle,
      "aria-expanded": "false",
      "aria-controls": "rsvp-optional",
    }),

    el("div", { class: "rsvp__optional", id: "rsvp-optional", hidden: true }, [
      field({
        id: "rsvp-phone",
        label: r.phone,
        control: el("input", {
          class: "field__control",
          id: "rsvp-phone",
          name: "phone",
          type: "tel",
          inputMode: "tel",
          autocomplete: "tel",
          placeholder: "+60 12 345 6789",
        }),
      }),
      field({
        id: "rsvp-instagram",
        label: r.instagram,
        control: el("input", {
          class: "field__control",
          id: "rsvp-instagram",
          name: "instagram",
          type: "text",
          autocapitalize: "off",
          spellcheck: false,
          placeholder: "@yourname",
        }),
        hint: r.contactHint,
      }),
      field({
        id: "rsvp-message",
        label: r.message,
        control: el("textarea", {
          class: "field__control",
          id: "rsvp-message",
          name: "message",
          rows: 3,
          maxLength: 500,
        }),
      }),
    ]),

    // Honeypot — retained exactly as the Worker expects.
    el("label", { class: "hp", "aria-hidden": "true" }, [
      document.createTextNode("Website"),
      el("input", { name: "website", type: "text", tabIndex: -1, autocomplete: "off" }),
    ]),

    el("button", { type: "submit", class: "rsvp__submit", id: "rsvp-submit", text: r.submit }),
    el("p", { class: "rsvp__error", id: "rsvp-error", hidden: true, role: "alert" }),
  ]);

  const success = el("div", { class: "rsvp__success", id: "rsvp-success", hidden: true }, [
    seal(),
    el("p", { class: "rsvp__success-title", text: r.successTitle }),
    el("p", { class: "rsvp__success-body", text: r.successBody }),
  ]);

  return el("section", { class: "scene", id: "scene-rsvp" }, [
    reveal(el("h2", { class: "t-heading", text: r.heading })),
    reveal(el("p", { class: "rsvp__deadline", text: r.deadlineLabel })),
    reveal(form),
    success,
  ]);
}

/* ---------------------------------------------------------------
   Compose
   --------------------------------------------------------------- */

/**
 * Build the full canvas into `stage`.
 * @param {HTMLElement} stage
 * @param {object} w      wedding config
 * @param {object} parts  wedding date parts
 */
export function renderScenes(stage, w, parts) {
  stage.append(
    sceneCover(w, parts),
    sceneNames(w),
    scenePoem(w),
    scenePortrait(w),
    sceneStory(w),
    sceneLandscape(w),
    sceneTime(w, parts),
    sceneVenue(w),
    sceneClosing(w),
    sceneRsvp(w)
  );
}
