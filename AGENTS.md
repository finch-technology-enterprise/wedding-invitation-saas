# wedding-invite — Project Workflow

Bilingual (zh/en) wedding invitation H5 served by a single Cloudflare Worker with D1.

## Stack

- **Worker**: `src/index.ts` — API routes (`POST /api/rsvp`, key-gated `GET /api/rsvps`) + static assets
- **Static site**: `public/` — plain HTML/CSS/JS, no build step
- **Content**: all invite text/names/date/photos live in `public/js/content.js` (`window.INVITE`) — edit there, not in HTML
- **DB**: D1 database `invite`, migrations in `migrations/`

## Local development

```sh
npm install
npx wrangler dev --port 8788   # port 8787 is often taken on this machine
```

Secrets for local dev live in `.dev.vars` (never commit).

## Before finishing any change

1. `npm test` — must pass (vitest, covers API + admin auth)
2. `node --check public/js/*.js` if you touched frontend JS
3. Verify UI changes in the browser at a phone viewport (~390×844): envelope → pages → lightbox → RSVP form
4. Commit with a concise imperative message (`feat:`, `fix:`, `chore:`)

## Deploy — ALWAYS deploy after done

Every completed change must be deployed, not just committed:

```sh
npx wrangler deploy
```

Then verify the deployed URL loads and reflects the change (e.g. `curl` the page, check new content is present).
