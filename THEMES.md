# Themes

A theme owns how an invitation looks and moves. The platform owns
identity, ownership, media, publishing and replies. The contract between
them is a manifest.

There is currently one theme, `cinematic-classic`. This document
describes the contract so a second can be added without touching the
backend.

---

## Why the public bundle has no dependencies

The guest-facing invitation is plain ES modules. No React, no router, no
component library — and a test asserts that none of those strings appear
in any script the public page loads.

This is not minimalism for its own sake. The invitation is the product:
it is opened once, on a phone, often on a poor connection, and the first
frame is the whole impression. Shipping a framework to render a fixed
composition would cost real milliseconds for no benefit. The admin
consoles are a different problem — logged-in, repeat-use, form-heavy —
and they use a framework happily.

The rule that keeps this true: **admin code may never become a shared
chunk with the public theme.** `tests/e2e/isolation.spec.ts` enforces it
at the network level.

---

## Anatomy

```
public/themes/cinematic-classic/
  index.html            shell, with a <!--BOOTSTRAP--> marker
  css/
    tokens.css          colour, type scale, spacing
    base.css            resets and shared primitives
    canvas.css          the viewport/stage model
    scenes.css          per-scene composition
  js/
    main.js             boot, config adapter, timeline wiring
    defaults.js         fallback values and micro-copy
    scenes.js           builds the ten scene chapters
    timeline.js         auto-drift, drag, inertia
    countdown.js        flip-digit countdown
    datetime.js         every date derivation
    fonts.js            CJK webfont subsetting
    audio.js            soundtrack and control state
    rsvp.js             reply form behaviour
    dom.js              small element helpers

src/themes/cinematic-classic.ts   the manifest and validator
```

---

## The canvas model

The document never scrolls.

- `#viewport` is a fixed one-screen window that clips the content
- `#stage` is a long canvas translated vertically by `timeline.js`
- `html { font-size: viewportWidth / 10 }`, so `1rem` is one tenth of the
  canvas width and everything scales proportionally

Author in `rem`, never `px`. The canvas drifts upward at a configurable
rate (default 46 px/s), so editing copy changes the duration rather than
the reading pace. A supplied soundtrack overrides the rate so the two
finish together.

---

## How config reaches the theme

The Worker resolves one published revision and inlines it:

```html
<script>window.__INVITATION__={"slug":…,"config":…,"mediaUrls":…}</script>
```

Inline, so there is no configuration fetch in front of first paint.
`main.js` merges it over `defaults.js` and hands the result to the
renderer. That merge is the entire adapter seam — every other module
still reads the same object shape it always did.

Media arrives pre-resolved as slot → URL. A slot with no published asset
gets no URL, and the renderer draws its placeholder without requesting
anything.

---

## The manifest

`src/themes/cinematic-classic.ts` declares:

| Export | Purpose |
|---|---|
| `SCENES` | Ordered scene IDs |
| `MEDIA_SLOTS` | Slot → kind, aspect ratio, focal support |
| `FIELD_LIMITS` | Per-path character limits, with the accepted value recorded |
| `LIST_LIMITS` | Maximum entries in repeated-line fields |
| `MANIFEST.focal` | Focal range and default |
| `MANIFEST.motion` | Drift rate range and default |
| `validateConfig()` | The authoritative validator |

The admin fetches the manifest and renders its limits inline, so the
counter a tenant sees and the rule the server enforces cannot drift
apart.

### Limits are measured, not guessed

Each entry records both the ceiling and what the accepted design actually
uses:

```ts
"copy.time.quote": { max: 64, accepted: 36 },
```

The composition was built for bounded text. Rather than reflowing the
layout to absorb any string, the platform rejects values beyond the range
the design was proven at. The headroom is auditable because `accepted` is
right there.

### Unknown properties are rejected

Not dropped. Silently discarding a key loses tenant data and turns a typo
into a mystery. A theme wanting forward-compatible extras must declare a
namespace for them.

---

## Media slots

```ts
hero:             image, 825 / 1000,  focal
portrait:         image, 666 / 1000,  focal
story:            image, 1 / 1,       focal
landscape:        image, 1418 / 1000, focal
venue:            image, 1110 / 1000, focal
closing:          image, 1 / 1,       focal
background_music: audio
```

Ratios are part of the composition: the placeholder holds the same shape
whether or not a photograph exists, so supplying one cannot reflow the
page.

Focal points are stored as `{ x, y }` percentages and applied as
`object-position`. The theme is never re-cropped or re-encoded; the
original bytes are served untouched.

---

## RSVP

Schema controls data; the theme controls presentation. The public form is
rendered by `rsvp.js` using the theme's own controls, never by importing
admin components.

Six custom questions is the declared capacity. Past that the reply scene
stops reading as an invitation and starts reading as a survey.

---

## Adding a theme

1. Create `public/themes/your-theme/` with a shell containing
   `<!--BOOTSTRAP-->` and a `main.js` that reads `window.__INVITATION__`.
2. Create `src/themes/your-theme.ts` exporting a manifest and a
   `validateConfig()` with the same shape as the cinematic one.
3. Register it in the theme registry and in the admin's theme chooser
   (`admin/src/routes/NewInvitation.tsx`), which is already a list rather
   than a hardcoded constant.
4. Add visual baselines for it. Do not add them to the cinematic suite.

What you must not do:

- import anything from `admin/` into a theme
- add a runtime dependency to a public theme
- change `cinematic-classic` while building yours

The cinematic theme's appearance is protected by screenshot baselines at
375, 390, 430 and desktop. If your change alters those pixels, it is a
change to someone's wedding invitation, not a refactor.
