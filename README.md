# Invitation platform

A cinematic wedding-invitation platform that runs entirely on Cloudflare:
one Worker, one D1 database, one R2 bucket.

Guests get a slow vertical film — full-bleed photography, Chinese
typography, a flip countdown and an RSVP form that the canvas parks
itself on. Couples get an admin console to write it. Operators get an
inventory and a manual cleanup tool.

The public invitation is deliberately **not** a framework app. It is
plain ES modules with zero runtime dependencies, and the build asserts
that no admin code can reach it.

---

## Two ways to run it

**Self-hosted.** Clone, point it at your own Cloudflare account, deploy.
The first person to open `/admin` claims the instance as its
administrator, after which registration closes. No quotas, no
dependency on anyone else's infrastructure.

**Hosted.** Open registration, per-tenant quotas, and an operator
console for whoever runs the service.

Both modes share one schema and one codebase; `DEPLOYMENT_MODE` decides
which behaviours are active. See [CONFIGURATION.md](CONFIGURATION.md).

---

## What it does

- **Multiple invitations per workspace**, each with its own public link
- **Draft → preview → publish**, where publishing is an atomic pointer
  flip onto an immutable revision, so a guest never sees half an edit
- **Preview links** you can send to a partner — no account required, and
  scoped to only the media that draft references
- **Media** uploaded to R2 with immutable keys: replacing a photo mints a
  new object, so a published invitation keeps the exact bytes it shipped
- **Focal points** per photo, previewed at the real aspect ratio the
  invitation uses
- **Configurable RSVP** with custom questions, validated against the
  schema that was published rather than the one currently being edited
- **CSV export** with spreadsheet-formula neutralisation
- **Operator console** for users, workspaces, storage and manual cleanup

Everything a tenant edits is bounded by a theme manifest. The cinematic
composition was designed for short copy, and the platform enforces that
rather than letting a long string quietly reflow the design.

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers (workerd) |
| Router | Hono |
| Database | D1 (SQLite) |
| Object storage | R2 |
| Public invitation | Plain ES modules, no dependencies |
| Admin consoles | React, Vite, Mantine, TanStack Query, React Router |
| Tests | Vitest (Workers pool) + Playwright |

Authentication is built directly on WebCrypto — PBKDF2-SHA256 with
opaque server-side sessions in `__Host-` cookies. See
[SECURITY.md](SECURITY.md) for why, and for the tenancy model.

---

## Self-host quickstart

```sh
git clone <your-fork>
cd wedding-invite
npm install

cp wrangler.jsonc.example wrangler.jsonc   # fill in your account/database IDs
npx wrangler d1 create invite-platform
npx wrangler r2 bucket create invite-media

npx wrangler d1 migrations apply invite-platform --remote
npm run build
npx wrangler deploy
```

Then open `/admin` on your deployed URL and create the first account —
it becomes the administrator.

Full walkthrough, including local development against a local D1 and R2:
[SELFHOST.md](SELFHOST.md).

---

## Development

```sh
npm install
npx wrangler d1 migrations apply invite --local
npm run build          # both admin consoles
npm run dev            # wrangler dev on :8787
```

The admin consoles can also run against Vite's dev server with hot
reload, proxying the API to a local `wrangler dev` on port 8788:

```sh
npx wrangler dev --port 8788   # terminal 1
npm run dev:admin              # terminal 2
```

### Commands

| Command | What it does |
|---|---|
| `npm run build` | Builds both admin consoles into `public/` |
| `npm test` | Worker/API suite against real D1 and R2 (Vitest) |
| `npm run typecheck` | Typechecks the Worker and both consoles |
| `npm run test:e2e` | Public invitation suite, including visual baselines |
| `npm run test:admin` | Admin + operator browser suite against a real Worker |
| `npm run deploy` | Builds, then deploys |

### The public invitation is frozen

`public/themes/cinematic-classic/` reproduces an accepted design, and its
appearance is protected by screenshot baselines at 375/390/430 plus
desktop. Changes there are expected to be adapter seams, not redesigns.
If you are adding a theme, add a theme — see [THEMES.md](THEMES.md).

---

## Repository layout

```
src/                  Worker: routes, auth, authz, theme schema
  lib/                sessions, authorization, validation, R2 keys
  routes/             API surfaces, one file per domain
  themes/             server-side theme manifests
public/themes/        the public invitation (no build step)
admin/                React consoles (tenant + operator)
migrations/           D1 schema
tests/                Vitest suites
tests/e2e/            Playwright suites and visual baselines
baselines/            archived frozen-design metrics and screenshots
```

---

## Licence

Not yet chosen. Until one is added, no permissions are granted beyond
viewing the source.
