# Self-hosting

Everything runs in your own Cloudflare account. There is no dependency
on any hosted service, no phone-home, and no shared infrastructure.

## What you need

- A Cloudflare account (the free plan is enough to start)
- Node.js 20 or newer
- `npx wrangler login`, or a `CLOUDFLARE_API_TOKEN`

R2 requires a payment method on file even within the free allowance.
Without R2 the platform still runs; media uploads are the only thing that
will fail.

---

## 1. Clone and install

```sh
git clone <your-fork>
cd wedding-invite
npm install
```

## 2. Create the resources

```sh
npx wrangler d1 create invite-platform
npx wrangler r2 bucket create invite-media
```

`d1 create` prints a `database_id`. Keep it for the next step.

## 3. Configure the Worker

```sh
cp wrangler.jsonc.example wrangler.jsonc
```

`wrangler.jsonc` is gitignored, because it holds your account and
database IDs. Fill in:

- `account_id` — from `npx wrangler whoami`
- `d1_databases[0].database_id` — from step 2
- `DEPLOYMENT_MODE` — leave as `self_hosted`

The bucket name must match what you created. If you chose a different
name, update `r2_buckets[0].bucket_name`.

## 4. Apply the schema

```sh
npx wrangler d1 migrations apply invite-platform --remote
```

This creates the full platform schema. Confirm it:

```sh
npx wrangler d1 execute invite-platform --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

You should see `users`, `tenants`, `invitations`, `media_assets`,
`rsvp_*` and friends.

## 5. Build and deploy

```sh
npm run build
npx wrangler deploy
```

`npm run build` produces both admin consoles. Deploying without it
leaves `/admin` returning a 501 rather than the console.

## 6. Claim the instance

Open `https://your-worker.workers.dev/admin`.

The first visitor to a self-hosted instance with no users sees a
first-run setup form. The account it creates becomes the platform
administrator, and registration closes immediately afterwards — a
public self-hosted URL cannot be farmed for accounts.

Do this promptly after deploying. Until you claim it, anyone who finds
the URL can.

If you need to reopen registration later, use the operator console at
`/platform-admin` → System.

## 7. Make an invitation

`/admin` → New invitation → fill in Content → upload photos in Media →
Publish. The public link is `/i/{your-slug}`.

---

## Local development

Wrangler simulates D1 and R2 locally, so you can develop with no
Cloudflare resources at all.

```sh
npx wrangler d1 migrations apply invite --local
npm run build
npm run dev
```

`--local` state lives in `.wrangler/` and is gitignored. Delete that
directory to start from an empty database.

For console work, run Vite with hot reload and proxy the API to a local
Worker:

```sh
npx wrangler dev --port 8788   # terminal 1
npm run dev:admin              # terminal 2, opens :5173
```

---

## Upgrading

```sh
git pull
npm install
npx wrangler d1 migrations apply invite-platform --remote
npm run build
npx wrangler deploy
```

Migrations are additive and tracked by Wrangler; applying twice is safe.
Read the release notes before upgrading across a major version.

---

## Secrets

The platform currently needs none. If you add an integration that does,
put it in `.dev.vars` locally and use `wrangler secret put NAME` for
deployed environments. Never put secrets in `wrangler.jsonc` — some
deployers commit it.

---

## Backups

D1 supports point-in-time recovery and exports:

```sh
npx wrangler d1 export invite-platform --remote --output backup.sql
```

R2 objects are not covered by that. If invitation photography matters to
you, mirror the bucket separately — `rclone` and the S3-compatible API
both work.

Nothing in this platform deletes anything on a schedule. Invitations and
media persist until someone deliberately removes them.

---

## Troubleshooting

**`/admin` returns 501.** The console was not built. Run `npm run build`,
then deploy again.

**Uploads fail with `storage_unavailable`.** The R2 binding is wrong or
the bucket does not exist. Check `r2_buckets[0].bucket_name` against
`npx wrangler r2 bucket list`.

**Login says `rate_limited`.** Working as intended — failed attempts are
throttled per IP and per account. Wait, or clear the bucket locally with
`npx wrangler d1 execute invite --local --command "DELETE FROM rate_limits"`.

**A deep link like `/admin/invitations/x/media` 404s.** `run_worker_first`
in `wrangler.jsonc` is missing its `/admin/*` entries; copy that block
from `wrangler.jsonc.example`.
