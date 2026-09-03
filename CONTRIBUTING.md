# Contributing

Thanks for taking a look. This is a small project with a few firm rules
and not much ceremony.

## Setup

```sh
npm install
npx wrangler d1 migrations apply invite --local
npm run build
npm run dev
```

Wrangler simulates D1 and R2 locally, so you need no Cloudflare resources
to develop. Local state lives in `.wrangler/`; delete it to start clean.

For console work, run Vite with hot reload against a local Worker:

```sh
npx wrangler dev --port 8788   # terminal 1
npm run dev:admin              # terminal 2
```

## Before opening a pull request

```sh
npm run typecheck   # Worker + both consoles
npm test            # Worker/API suite
npm run test:e2e    # public invitation, incl. visual baselines
npm run test:admin  # admin + operator browser suite
```

All four should pass. The public suite is sensitive to other Chromium
instances competing for CPU — if it fails oddly, close them and rerun
before assuming a real regression.

There is no formatter config; match the surrounding style. Comments
should explain *why*, not restate the code.

## The public invitation is frozen

`public/themes/cinematic-classic/` reproduces a design that was accepted
pixel by pixel, and its appearance is protected by screenshot baselines
at 375, 390, 430 and desktop.

**Please do not change how it looks.** Not selector names, not spacing,
not timings, not token values. Those files are somebody's wedding
invitation, and "tidying" them is a change to it.

Do not run `npm run test:e2e:update` to make a failing baseline pass.
A snapshot diff means something moved; find out what.

Legitimate changes there are adapter seams — how configuration or media
reaches the renderer — not visual ones.

### Want it to look different? Add a theme

Theme #2 is the intended path, and the platform is built for it. See
**[THEMES.md](THEMES.md)** for the full contract; briefly:

```
public/themes/your-theme/
  index.html          shell with a <!--BOOTSTRAP--> marker
  css/                your styles
  js/main.js          reads window.__INVITATION__

src/themes/your-theme.ts
  manifest: scenes, media slots, field limits, validateConfig()
```

Then register it in the theme registry and the admin's theme chooser
(already a list, not a constant), and add visual baselines for it — in
their own files, not the cinematic suite's.

Two hard rules: a public theme may not take a runtime dependency, and
nothing under `admin/` may be imported into one. Both are enforced by
`tests/e2e/isolation.spec.ts`.

## Tests are part of the change

New behaviour needs tests, and negative cases matter more than happy
paths here. The suite leans heavily on things like cross-tenant access,
partial R2 failures, replayed tokens and formula injection, because those
are the failures that actually hurt.

If you find a bug, a test that reproduces it is the most useful possible
first contribution.

## Security issues

Please **do not** open a public issue. Report privately — see
**[SECURITY.md](SECURITY.md)**. You'll get an acknowledgement within a
few days.

Do not test against other people's deployments, and do not access real
RSVP data while investigating.

## Licensing

The project is Apache-2.0. By contributing, you agree your contributions
are licensed under it — that is Apache-2.0 §5, and there is no separate
CLA to sign.

If you add a dependency, check its licence is compatible. GPL and AGPL
dependencies cannot be accepted.

## Scope

Things likely to be accepted:

- bug fixes, especially with a failing test
- a second theme
- accessibility improvements in the admin
- documentation that clarifies something that confused you
- email providers behind the existing abstraction

Things to discuss first, in an issue:

- new dependencies, particularly in the public path
- schema changes
- anything touching authentication or tenant isolation
- new product surfaces

The design has deliberately said no to some things — automatic expiry,
scheduled cleanup, per-tenant databases, raw CSS editing. If one of those
seems missing, it is probably absent on purpose; ask before building it.
