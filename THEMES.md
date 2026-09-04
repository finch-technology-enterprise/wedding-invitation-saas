# Themes

A theme owns how an invitation looks and moves. The platform owns
identity, ownership, media, publishing, guests, and replies. The
contract between them is a **manifest plus a registry entry**.

Two themes ship:

| ID | Role |
|---|---|
| `cinematic-classic` | Frozen vertical film. Visual baselines at 375/390/430 and desktop. Do not casually update those snapshots. |
| `modern-editorial` | Magazine layout. Own suite and snapshots. Configurable tokens, type preset, motion level, and section visibility. |

`src/themes/registry.ts` is the only catalogue. Never hard-code theme IDs
in routes, validators, or the admin chooser. The admin loads
`GET /api/v1/themes` and falls back to the same two IDs only if that
request fails.

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

## Registry contract

Each theme module exports:

| Export | Purpose |
|---|---|
| `THEME_ID` | Stable string (`cinematic-classic`, `modern-editorial`) |
| `THEME_VERSION` | Integer; stored on the invitation |
| `MANIFEST` | Scenes, media slots, field limits, list limits, focal, motion, and (editorial) tokens |
| `validateConfig(input)` | Authoritative validator. Returns `{ ok, errors, config, assetIds }` |

The registry wraps those exports with `displayName`, `rendererPath`
(`/themes/{id}/index.html`), and a `capabilities` summary the admin uses
for the chooser.

`validateForTheme(id, input)` is the only dispatch. Unknown IDs fail with
`unknown_theme`. Unknown properties in a config are **rejected**, not
dropped — silently discarding a key loses tenant data and turns a typo
into a mystery.

Limits are measured, not guessed. Each field records both the ceiling
and what the accepted design actually uses:

```ts
"copy.time.quote": { max: 64, accepted: 36 },
```

The admin fetches the manifest and renders those limits inline, so the
counter a tenant sees and the rule the server enforces cannot drift
apart.

---

## How config reaches the theme

The Worker resolves one published revision and inlines it:

```html
<script>window.__INVITATION__={"slug":…,"locale":…,"strings":…,"party":…,"config":…,"mediaUrls":…}</script>
```

Inline, so there is no configuration fetch in front of first paint. The
shell contains a `<!--BOOTSTRAP-->` marker; the Worker replaces it.

`locale` is one of `en`, `zh-CN`, `zh-TW`, `ms`. `strings` is system copy
for that locale (RSVP chrome, countdown units, share labels).
User-authored content stays in `config` and is never translated.
`party` is `{ id, title }` on a valid `?party=` token, otherwise `null`.

Media arrives pre-resolved as slot → URL. A slot with no published asset
gets no URL, and the renderer draws its placeholder without requesting
anything.

Focal points live at `config.media.{slot}.focal` as `{ x, y }`
percentages, applied as `object-position`. The original bytes are never
re-encoded. Legacy `draft.focal.{assetId}` is migrated on draft write.

---

## Cinematic Classic

```
public/themes/cinematic-classic/
  index.html            shell, with a <!--BOOTSTRAP--> marker
  css/                  tokens, base, canvas, scenes
  js/
    main.js             boot, config adapter, timeline wiring
    defaults.js         frozen fixture fallbacks (real-couple values stay here)
    scenes.js           ten scene chapters
    timeline.js         auto-drift, drag, inertia
    countdown.js        flip-digit countdown (days grow past 99)
    datetime.js         every date derivation
    fonts.js            CJK webfont subsetting
    audio.js            soundtrack and control state
    rsvp.js             reply form behaviour
    dom.js              small element helpers

src/themes/cinematic-classic.ts   manifest and validator
```

The document never scrolls. `#viewport` clips a long `#stage` that
`timeline.js` translates. `html { font-size: viewportWidth / 10 }`, so
`1rem` is one tenth of the canvas width. Author in `rem`, never `px`.

Media slots:

```
hero, portrait, story, landscape, venue, closing   image + focal
background_music                                   audio
```

Customization exposed to the tenant: `motion.driftPxPerSec`.

**Frozen rule.** Screenshot baselines at 375, 390, 430, and desktop
guard appearance. Do not run `npm run test:e2e:update` to silence a
diff. A snapshot change is a change to someone's wedding invitation.
Legitimate edits are adapter seams (how config, locale, or media reach
the renderer), not visual ones. The historical couple names in
`defaults.js` / the cinematic fixture stay isolated there. New seeds
use `Alex & Jamie`.

---

## Modern Editorial

```
public/themes/modern-editorial/
  index.html            shell, <!--BOOTSTRAP-->, one CSS file, one JS module
  css/editorial.css     tokens and layout
  js/main.js            boot, sections, RSVP, locale strings

src/themes/modern-editorial.ts   manifest and validator
```

Scenes: `hero`, `couple`, `schedule`, `gallery`, `venue`, `rsvp`.

Media slots:

```
cover            image 4/5     focal
gallery_1..3     image 1/1     focal
venue            image 16/10   focal
background_music audio
```

Declared customization:

- `tokens.accent` / `tokens.paper` / `tokens.ink` (closed palettes)
- `type.preset` — `serif` | `sans` | `mixed`
- `motion.level` — `still` | `subtle` | `gentle`
- `sections` — per-scene on/off

Visual baselines live in `tests/e2e/editorial.spec.ts-snapshots/`. They
are not part of the cinematic suite. Update them only when the editorial
UI itself changed, with evidence.

---

## RSVP

Schema controls data; the theme controls presentation. The public form
is rendered by the theme's own JS, never by importing admin components.

Protocol fields `idempotencyKey` and `partyToken` are stripped before
form validation. Same key on the same invitation returns the original
submission (`deduped: true`).

Six custom questions is the declared capacity.

---

## Adding a theme (Theme #3)

1. Create `public/themes/your-theme/` with a shell containing
   `<!--BOOTSTRAP-->` and a `main.js` that reads `window.__INVITATION__`.
2. Create `src/themes/your-theme.ts` exporting `THEME_ID`,
   `THEME_VERSION`, `MANIFEST`, and `validateConfig()` with the same
   result shape as the existing themes.
3. Register it **only** in `src/themes/registry.ts`. The admin chooser
   already lists `GET /api/v1/themes`.
4. Add a starter branch in `src/themes/starter.ts` (neutral names:
   Alex & Jamie — never the frozen cinematic couple).
5. Add a Playwright suite and snapshots of your own. Do not add them to
   `tests/e2e/invitation.spec.ts` or `baselines/frozen-c2833d2/`.
6. Keep the public bundle free of runtime dependencies.

What you must not do:

- import anything from `admin/` into a theme
- add a runtime dependency to a public theme
- change `cinematic-classic` pixels while building yours
- hard-code the new ID in `src/lib/validate.ts` or routes — the registry
  is the allow-list
- put real personal wedding data in starter content or fixtures
