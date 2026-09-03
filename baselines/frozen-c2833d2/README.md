# Frozen public-invitation baseline — c2833d2

Visual and interaction source of truth for the cinematic invitation.
Recorded BEFORE any platform/SaaS restructuring (WS0).

- `snapshots/` — the 36 accepted Playwright screenshots (12 scenes ×
  375/390/430), copied verbatim from
  `tests/e2e/invitation.spec.ts-snapshots/` at the baseline commit.
- `metrics.json` — machine-readable geometry + performance budget:
  per-viewport stage height, scene offsets, rem, RSVP geometry, reveal
  count, request list, per-file transfer bytes, time-to-settled-load,
  stage offset after 2.5s of drift (timeline-startup proxy).

Frozen performance budget (390×844, local static server):

| Metric | Frozen value | Post-platform budget |
|---|---|---|
| HTML bytes | 2503 | +≤15% (inline bootstrap allowance) |
| Public JS bytes | 62935 | unchanged (adapter seams only) |
| Public CSS bytes | 32699 | unchanged |
| Same-origin requests | 15 | unchanged count, no admin bundles |
| D1 on cold render | n/a (static) | ≤ 1 on miss, 0 on hit |
| R2 on render | n/a (static) | only for real media |

Workstream gate: after every workstream, the visual suite must be GREEN
with NO snapshot updates and NO intentional visual changes. A diff is a
regression until proven otherwise.
