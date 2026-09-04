# Security

## Reporting a vulnerability

Please report privately rather than opening a public issue. Use GitHub's
"Report a vulnerability" on the Security tab, or contact the maintainer
directly.

Include what you did, what happened, and what you expected. A proof of
concept helps. You will get an acknowledgement within a few days.

Please do not test against other people's deployments, and do not access
or exfiltrate real RSVP data while investigating.

---

## Authentication

Passwords are hashed with **scrypt** (`node:crypto.scryptSync`), salted
per user, using OWASP-sanctioned parameters:

    N = 2^14 (16 MiB), r = 8, p = 5

OWASP lists several equivalent scrypt configurations trading memory for
parallelism. We use the low-memory variant rather than the first-listed
`N=2^17, r=8, p=1` (128 MiB) deliberately: a Worker isolate has a 128 MiB
memory limit, and a 128 MiB scratch buffer would sit exactly on that
boundary and risk OOM under concurrent logins.

Argon2id would be preferable, but workerd does not implement it.

**Historical note.** This project originally used PBKDF2-HMAC-SHA256,
because it was the only OWASP-approved KDF workerd supported. That
carried a hard ceiling — workerd rejects PBKDF2 above 100,000 iterations,
well below OWASP's recommended 600,000. `node:crypto` is now available in
Workers, so scrypt replaced it: memory-hard, uncapped, and materially
stronger against GPU and ASIC cracking.

Hashes are stored in **PHC string format** (via `@phc/format`), so the
algorithm and its parameters travel with each hash:

    $scrypt$ln=14,r=8,p=5$<salt>$<hash>

**Existing users migrate transparently.** A correct login is the only
moment the plaintext is available, so it is the only moment an old hash
can be upgraded. PBKDF2 hashes are verified, then silently rewritten as
scrypt on the next successful sign-in — no reset, no forced rotation, and
no knowledge of anyone's password. The same mechanism re-hashes scrypt
entries whose parameters fall below current policy.

A hash written by a future version this build does not understand fails
closed: authenticating against an algorithm we cannot evaluate would be
worse than refusing the login.

**Cost.** Roughly 170 ms of wall time per hash on deployed Workers. That
exceeds the free plan's 10 ms CPU allowance — but so did the PBKDF2
configuration it replaces (production login measured ~32 ms CPU), so
self-hosting on a free account was already impractical for authenticated
use. This is not a new constraint.

**Sessions** are random 256-bit tokens. Only their SHA-256 is stored, so
a database dump cannot be replayed as live sessions. Revocation is
immediate because the server holds the state — there is no self-contained
token to wait out.

Cookies are `__Host-` prefixed, `HttpOnly`, `Secure`, `SameSite=Lax`. The
`__Host-` prefix means a subdomain cannot overwrite the session cookie.
Local development over plain HTTP falls back to an unprefixed name,
because browsers refuse `__Host-` without `Secure`.

**Enumeration resistance:** a wrong password, an unknown account and a
disabled account return byte-identical responses. The unknown-account
path performs a dummy verification so it costs the same wall time.

**Rate limiting** is per IP and per account, in D1. A successful login
clears the login buckets.

Disabling a user revokes their sessions in the same operation, so the
change takes effect on the next request rather than at token expiry.

---

## Tenant isolation

All authorization resolves through `src/lib/authz.ts`. No handler writes
its own membership query.

Two structural decisions do most of the work:

1. **Invitation routes carry no tenant path segment.** Access is derived
   from the row while joining membership in a single statement, so there
   is no client-supplied tenant that could disagree with the data, and no
   window between fetching a row and checking it.

2. **Foreign resources are indistinguishable from missing ones.** A 403
   would confirm that an ID exists in someone else's workspace, so
   tenant-scoped lookups return 404 either way. Tests assert the
   responses are byte-identical.

**Platform administrators get no implicit tenant membership.** Operator
power is exercised through `/api/v1/platform/*`, which is a separate
authorization domain with its own audit trail. A platform admin calling
the ordinary tenant API for a workspace they do not belong to gets 404,
like anyone else. There is deliberately no `isPlatformAdmin ? bypass`
branch anywhere in the tenant handlers.

Suspending a workspace takes its invitations offline, blocks its admin
surfaces, and stops its draft media and preview links resolving.

---

## CSRF

`SameSite=Lax` already prevents the session cookie riding along on a
cross-site POST. On top of that, every mutating endpoint verifies the
`Origin` (falling back to `Referer`) against the request's own host, so
no configuration is needed for a self-hoster to be protected. A request
with neither header must carry an `X-Requested-With: fetch` marker, which
a cross-site `<form>` cannot set.

---

## Media

Uploads are typed by **sniffing magic bytes**, never by trusting the
client's `Content-Type` or filename.

**SVG is rejected** rather than special-cased. It is an executable
document, and serving one from the media origin would be stored XSS.

Object keys are built entirely from server-generated IDs
(`t/{tenant}/i/{invitation}/a/{asset}/original.ext`). An uploaded
filename never reaches the key, so path traversal and collisions are
structurally impossible rather than filtered. Keys are immutable:
replacing a photo mints a new asset, which is also what lets a published
revision keep the exact bytes it shipped with.

Delivery serves `X-Content-Type-Options: nosniff` and looks the key up in
D1 — a request can never address an arbitrary bucket object.

**Draft assets are not public.** `/media/{assetId}` serves only assets
listed in a published revision's manifest, plus draft access for the
owning workspace's members and for a preview token that actually
references that asset. Holding a preview token is not blanket access to
everything ever uploaded to that invitation.

### Write ordering

Uploads write R2 first, then D1. A failed D1 write leaves an orphan whose
key encodes its tenant and invitation, recoverable by the operator's
scanner. The reverse order would let D1 claim an asset R2 never stored,
which surfaces as a broken image on a live invitation.

Deleting a whole invitation inverts this: the media rows are the only
record of which objects belong to it, so they are kept until R2 is
confirmed, and only rows whose objects are provably gone are dropped.

---

## RSVP and personal data

Guest replies are the most sensitive data here.

- Submissions are validated against the schema that was **published**,
  not the draft an admin may be editing
- The endpoint is scoped by slug, so a reply cannot land on another
  invitation
- Client IPs are hashed before storage; raw addresses are never kept
- Submission content is never logged. Error logs carry identifiers and
  error types only — not messages, because `JSON.parse` failures embed a
  snippet of their input
- The operator audit log records actions, counts and bytes, never
  invitation copy or guest answers
- **Idempotency.** A client-generated `idempotencyKey` (8–128 of
  `[A-Za-z0-9_-]`) is stored on the submission. A retry with the same
  key on the same invitation returns that row (`deduped: true`) and does
  not increment the counter. Keys are stripped before form validation.
  Legacy clients that omit a key behave as before; SQLite unique indexes
  allow multiple NULLs
- **Party binding.** An optional `partyToken` is resolved to a party id
  and stored on the row. An invalid token is ignored — the RSVP still
  lands as a public reply, and the response does not say whether a party
  exists

**CSV export** of RSVP answers neutralises cells beginning with `=`,
`+`, `-` or `@` by prefixing them. Quoting alone is not protection: the
quotes are consumed by the CSV parser and the formula still reaches the
cell.

Deleting an invitation removes its revisions, drafts, RSVP schema,
submissions, answers, preview tokens, guest parties, guests, media
metadata and R2 objects. Tenant self-service delete requires typing
`DELETE {title}`.

---

## Guest parties, personalized links, and check-in

Parties group households. Each party may carry an opaque token
(`newToken(24)`). Only the **SHA-256** of that token is stored
(`guest_parties.token_hash`, globally unique), the same construction as
sessions. Rotating the token replaces the hash; old links stop
resolving.

`GET /i/{slug}?party={token}`:

- A valid token for that invitation injects `{ id, title }` into the
  bootstrap payload as a greeting
- The response is `Cache-Control: private, no-store` and
  `X-Robots-Tag: noindex, nofollow` — personalized HTML must not sit in
  a shared cache
- An invalid, truncated, or foreign token is **not** a 404 and does not
  mention guests. The Worker falls through to the ordinary public page
  (public cache headers, no `party` in the payload)

Check-in is an authenticated tenant action
(`POST /api/v1/invitations/:id/guests/:guestId/check-in`) through
`requireInvitation`. The party token is a lookup aid, not
authorization. A repeat check-in returns the existing timestamp with
`deduped: true`. Foreign invitation IDs stay 404, same as every other
tenant route.

**Guest CSV import** is tenant-authenticated. Preview and commit cap the
body at 512 KiB and 1,000 rows. Duplicate detection is
case-insensitive full name against existing guests; `skipDuplicates`
defaults to true. The parser is RFC-4180 (quotes, commas, CRLF). Formula
neutralisation still applies on RSVP CSV export; import maps name/phone/
email/meal/dietary only.

---

## Revision membership and legacy media

Published media access prefers `revision_assets` (revision, invitation,
asset, slot). Pre-V2 revisions with no relational rows still resolve
through `media_manifest_json LIKE` so a guest is not stranded. The
manifest remains an immutable snapshot; it is no longer the
authoritative membership index.

Draft assets stay private. `/media/{assetId}` serves only assets in a
published revision (relational or legacy), plus draft access for the
owning workspace and for a preview token that actually references that
asset.

---

## Housekeeping and logging

`runHousekeeping()` deletes expired sessions, stale rate-limit rows,
used or expired auth tokens, expired preview tokens, and audit events
older than a year. It does not touch invitations, revisions, media,
RSVPs, or guests.

The only structured logs added in V2 are operational:

```
housekeeping_scheduled  { deleted, kinds }
housekeeping_run        { actor, deleted, kinds }
housekeeping_scheduled_failed  truncated error string
```

`actor` is a user id, not an email. Guest names, phones, RSVP answers,
and party tokens are not logged.

Invitation locale (`en` | `zh-CN` | `zh-TW` | `ms`) is not personal
data; it only selects system copy.

---

## Repository history

Two early commits tracked `wrangler.jsonc` before it was gitignored,
so the original deployment's Cloudflare account ID and D1 database ID
appear in git history.

Neither is a credential. They are identifiers — an account ID appears in
every dashboard URL — and cannot be used without an API token, which has
never been committed. History was deliberately left intact rather than
rewritten. No key, token, password or `.dev.vars` file has ever been
tracked.

Fresh clones are unaffected: `wrangler.jsonc.example` carries only
`REPLACE_WITH_...` placeholders.

## Known limitations

- **No MFA.** Password plus session only.
- **Password reset and email verification need a mail provider.** Without
  one configured, self-service recovery is unavailable and a forgotten
  password needs operator help. Self-hosted mode does not require
  verification, so an instance without email is otherwise fully usable.
- **No IP allow-listing** for the operator console.
- **Rate limiting is per-instance** and keyed on `CF-Connecting-IP`; it
  is a speed bump against credential stuffing, not a defence against a
  distributed attacker.

None of these are hard to add; they are simply not built yet.
