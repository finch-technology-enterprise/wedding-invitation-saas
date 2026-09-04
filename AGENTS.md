# wedding-invite — Project Workflow (V2)

A wedding-invitation SaaS on one Cloudflare Worker (Hono) + D1 + R2 +
Static Assets. Two themes, guest parties, idempotent RSVP, autosaving
editor, operator console.

## Stack

- **Worker**: `src/index.ts` — versioned API (`/api/v1/*`), public
  rendering (`/i/{slug}`, `?party=` personalized mode), previews,
  media delivery, SPA shells, `scheduled` housekeeping.
- **Routes**: `src/routes/` — `auth`, `tenants` (+`invitations`),
  `media`, `publish` (draft/version/publish/preview), `rsvp`
  (config/responses/CSV/public submit), `guests` (parties/invitees/
  import/check-in), `platform`, `cleanup` (invitation deletion),
  `ops` (`themes`, `platform/housekeeping`, invitation `delete`/
  `export` self-service), `invite`, `deliver`.
- **Libs**: `src/lib/` — `authz` (tenant choke point), `session`,
  `password` (scrypt), `guard` (CSRF/rate), `validate` (slugs/titles;
  theme IDs defer to the registry), `drafts` (canonical draft service +
  optimistic concurrency), `revisionAssets` (relational membership),
  `entitlements`, `housekeeping`, `locale` (en/zh-CN/zh-TW/ms),
  `guests` (tokens, RFC-4180 CSV), `media`, `email`, `csv`, `rsvp`.
- **Themes**: `src/themes/registry.ts` is authoritative
  (`cinematic-classic`, `modern-editorial`). Each theme exports
  `MANIFEST + validateConfig`. Never hard-code theme IDs elsewhere.
- **Guest renderers**: `public/themes/*/` — vanilla ES modules, zero
  dependencies (asserted by `tests/e2e/isolation.spec.ts`).
  `cinematic-classic` is frozen (baselines); `modern-editorial` has its
  own suite.
- **Admin**: `admin/src/` — React 19 + Router 7 + Mantine + TanStack
  Query. Tenant console + `platform/` operator console (separate Vite
  entries). Shared `lib/theme.ts` design layer.
- **DB**: D1, migrations in `migrations/` (`0001`, `0002`,
  `0003_v2_foundation`). `tests/setup.ts` loads all three.

## Canonical rules (V2)

- One draft path: `writeDraft()` in `lib/drafts.ts`. `PATCH /:id`
  `{draft}` is deprecated but routes through it. `PUT /draft` requires
  `expectedVersion`; stale writes get `409 draft_conflict`.
- Focal is canonical at `media.{slot}.focal`. Never write
  `draft.focal.{assetId}` (legacy migrated on read/write).
- Membership is relational (`revision_assets`), not
  `media_manifest_json LIKE`. The manifest stays as a snapshot artifact.
  Pre-V2 revisions still resolve media through the legacy fallback —
  do not rewrite old immutable revisions to make V2 cleaner.
- Public RSVP is `POST /i/{slug}/rsvp`. There is no guest-facing V1 RSVP
  route to call. Submit accepts `idempotencyKey` + `partyToken`
  (stripped before form validation). Same key → same submission
  (`deduped: true`).
- Invitation locale (`en|zh-CN|zh-TW|ms`) drives `<html lang>`, OG tags,
  countdown/RSVP strings. User content is never translated.
- Starter/seed content is neutral (`Alex & Jamie`). The frozen fixture's
  real-couple values stay in `defaults.js` / cinematic `fixture.mjs` /
  baselines only.

## Do not

- Bypass `src/lib/authz.ts`. No handler writes its own membership query.
  Platform admin is not implicit tenant membership.
- Weaken hosted email verification to make tests pass. Mark the local D1
  row verified the way existing suites do
  (`UPDATE users SET email_verified = 1 WHERE email = …`). Do not add
  application bypasses.
- Touch cinematic frozen snapshots or `baselines/frozen-c2833d2/` unless
  a visual change was explicitly approved, with before/after evidence.
  Editorial snapshots live only under
  `tests/e2e/editorial.spec.ts-snapshots/`.
- Put personal wedding names, phones, addresses, or media into
  starter config, seeds, editorial fixtures, CSV examples, or docs.
- Write destructive D1 migrations (`DROP`, table rebuilds, silent data
  loss). V2 changes are additive.
- Apply migrations to remote/production D1 as a side effect of local
  work. Local is `--local` only.
- Commit secrets, `.dev.vars`, `wrangler.jsonc`, `.admin-key.local`,
  `.wrangler/`, generated admin bundles, or `opencode.json`.
- Log RSVP bodies, guest names, phones, or party tokens. Housekeeping
  logs are structured counts only.
- Modify production data while developing.

## Local development

```sh
npm install
npx wrangler d1 migrations apply invite --local
npm run build
npx wrangler dev --port 8788   # 8787 is often taken here
npm run dev:admin              # :5173, proxies /api to :8788
```

Cron (housekeeping) locally: the `scheduled` handler runs on deploy only
if `triggers.crons` is set in the deployer's `wrangler.jsonc` (not in
the example file). Invoke manually via
`POST /api/v1/platform/housekeeping/run`.

## Before finishing any change

1. `npm run typecheck`
2. `npm test` — Worker/API suite (vitest, real D1+R2)
3. `node --check public/themes/*/js/*.js` — if you touched guest JS
4. `npm run build` — both consoles must compile
5. `npm run test:e2e` / `test:admin` — browser suites. Baselines:
   cinematic frozen (do not touch); editorial has its own.
6. Phone viewports (375/390/430): drift/countdown/RSVP/autosave/preview.

Do not merge to `production` until the workstream is green (feature-branch
workflow). Do not tag a release from a feature branch.

## Deploy

```sh
npx wrangler deploy
```

Verify the deployed URL reflects the change.
