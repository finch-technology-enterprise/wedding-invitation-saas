# Configuration

Everything is configured in `wrangler.jsonc` (per-deployer, gitignored),
`.dev.vars` (local secrets, gitignored), or the `platform_settings` table
edited through `/platform-admin` → System.

Copy `wrangler.jsonc.example` to start.

---

## Deployment modes

`vars.DEPLOYMENT_MODE` — `self_hosted` (default) or `hosted`.

| | `self_hosted` | `hosted` |
|---|---|---|
| Registration | First-claim only, then closed | Open, operator-toggleable |
| Quotas | Not enforced | Enforced from the tenant's plan |
| First user | Becomes platform admin | Ordinary tenant owner |

The schema and code are identical; the mode only changes these
behaviours. A self-hosted instance can be switched to `hosted` later
without a migration.

---

## Bindings

| Binding | Type | Purpose |
|---|---|---|
| `DB` | D1 | All application data |
| `MEDIA` | R2 | Uploaded photography and audio |
| `ASSETS` | Static Assets | The public theme and admin bundles |

### `run_worker_first`

```jsonc
"run_worker_first": [
  "/api/*", "/i/*", "/media/*", "/preview/*",
  "/admin", "/admin/*", "!/admin/assets/*",
  "/platform-admin", "/platform-admin/*", "!/platform-admin/assets/*"
]
```

Both consoles are single-page apps, so every path under them must reach
the Worker to be served the shell. The `!` exclusions let hashed bundle
files be served directly by Static Assets instead.

Removing the `/admin` entries breaks deep links and reloads. Removing the
exclusions makes every chunk request go through the Worker for no reason.

---

## Runtime variables

| Variable | Default | Meaning |
|---|---|---|
| `DEPLOYMENT_MODE` | `self_hosted` | See above |

**On password hashing:** there is no tuning variable. Passwords use
scrypt at OWASP parameters chosen to fit a Worker isolate's memory limit;
see SECURITY.md. Each hash records its own parameters, so raising them in
a future release upgrades users on their next login rather than needing a
migration.

---

## Platform settings

Stored in D1, edited at `/platform-admin` → System.

| Key | Type | Meaning |
|---|---|---|
| `site_name` | string | Display name |
| `registration_enabled` | boolean | Whether signup is open |

Unknown keys are rejected, not stored.

---

## Quotas

Enforced in `hosted` mode only. Each tenant has a plan, and may have
per-tenant overrides layered on top from `/platform-admin` → Workspaces.

| Limit | Meaning |
|---|---|
| `maxInvitations` | Invitations per workspace |
| `maxMediaBytesPerTenant` | Total media bytes per workspace |
| `maxMediaBytesPerInvitation` | Media bytes per invitation |
| `maxImageBytes` | Largest single image |
| `maxAudioBytes` | Largest single audio file |
| `maxRsvpResponses` | Replies per invitation |

`null` means unlimited. Seeded plans:

- `plan_self_hosted` — everything unlimited
- `plan_hosted_free` — 1 invitation, 200 MB per workspace, 100 MB per
  invitation, 8 MB images, 15 MB audio, 500 replies

There is a hard 64 MB ceiling on any single upload regardless of plan, so
a request cannot exhaust the Worker's memory before quotas are consulted.

---

## Theme limits

Content bounds live in `src/themes/cinematic-classic.ts`, not in
configuration. They are derived from the accepted design's measured
maxima plus headroom, and the admin reads them from the same manifest the
server validates against. See [THEMES.md](THEMES.md).

The RSVP form allows six custom questions. Beyond that the reply scene
stops reading as an invitation.

---

## What is not configurable, deliberately

- **Automatic expiry.** Nothing deletes itself. Invitations persist until
  a human removes them.
- **Scheduled cleanup.** There is no cron. Cleanup is an operator action.
- **`prefers-reduced-motion` override.** A guest who asked their device
  to stop animating is not overridden by a tenant setting.
- **Arbitrary theme CSS.** The theme owns its visual structure; tenants
  configure content and a small set of declared options.
