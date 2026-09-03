# wedding-invite — Project Workflow

A cinematic Chinese H5 wedding invitation served by a single Cloudflare
Worker with D1.

## Stack

- **Worker**: `src/index.ts` — API routes (`POST /api/rsvp`, key-gated
  `GET /api/rsvps`), photo-slot handling, and static assets
- **Static site**: `public/` — plain HTML/CSS/ES modules, no build step
- **Content**: all wedding data lives in `public/js/content.js`
  (`wedding`) — edit there, never in HTML/CSS/JS
- **DB**: D1 database `invite`, migrations in `migrations/`

## The invitation model

This is **not** a scrolling webpage. The document never scrolls.

- `#viewport` is a fixed, one-screen window that clips the content.
- `#stage` is a long canvas translated vertically by
  `public/js/timeline.js`.
- `html { font-size: viewportWidth / 10 }`, so `1rem` is one tenth of
  the canvas width and **everything scales proportionally**. Author new
  styles in `rem`, not `px`.
- The canvas drifts upward at a fixed ~46 px/s — the rate at which the
  reference's copy stays readable — rather than over a fixed duration,
  so editing copy does not change the reading pace. It can be dragged
  manually and parks itself at the RSVP form. A supplied soundtrack
  overrides the pace so the two finish together.
- Photography and audio are gated by a `ready` flag in `content.js`:
  unsupplied assets are never requested. See `public/assets/README.md`.

Frontend modules:

```
public/js/
  main.js       thin orchestration
  content.js    ALL wedding data (single source of truth)
  scenes.js     builds the ten scene chapters
  timeline.js   auto-drift + drag scrubbing
  countdown.js  flip-digit countdown
  datetime.js   every date derivation (calendar grid included)
  fonts.js      CJK webfont subsetting
  audio.js      background music + control state
  rsvp.js       form behaviour
  dom.js        small element helpers
```

## Local development

```sh
npm install
npx wrangler d1 migrations apply invite --local   # once, or after new migrations
npx wrangler dev --port 8788                      # 8787 is often taken here
```

Without the migration step `POST /api/rsvp` returns HTTP 500 locally,
because the local D1 has no `rsvps` table. The Vitest suite applies
migrations itself, so tests pass even when local dev is unmigrated —
run the command above if a local RSVP fails.

Secrets for local dev live in `.dev.vars` (never commit).

## Before finishing any change

1. `npm test` — Worker/API suite (vitest)
2. `npx tsc --noEmit` — typecheck
3. `node --check public/js/*.js` — if you touched frontend JS
4. `npm run test:e2e` — browser suite at 375/390/430, incl. visual
   baselines. Use `npm run test:e2e:update` after intentional visual
   changes.
5. Verify in a browser at a phone viewport (~390×844): the canvas
   drifts, drags, the countdown ticks, and the RSVP form submits.

Commit with a concise imperative message (`feat:`, `fix:`, `chore:`).

## Assets

Photography and music slots are documented in
`public/assets/README.md`. Missing files degrade gracefully: the
renderer reads the `ready` flag in `content.js` and never requests an
asset that has not been supplied, so an incomplete set produces no
network errors.

## Deploy — ALWAYS deploy after done

Every completed change must be deployed, not just committed:

```sh
npx wrangler deploy
```

Then verify the deployed URL loads and reflects the change.
