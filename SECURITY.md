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

Passwords are hashed with **PBKDF2-HMAC-SHA256** via WebCrypto, salted
per user, at a cost recorded in the stored hash so it can be raised
without invalidating anyone.

**Iteration count is capped at 100,000 by the platform.** workerd refuses
anything higher (`NotSupportedError: iteration counts above 100000 are
not supported`), so the OWASP recommendation of 600,000 is not reachable
here. This is a real gap and worth stating plainly: a stolen database
would be cheaper to attack offline than OWASP guidance intends. The
compensating controls are per-user salts, a 10-character minimum, and
rate limiting that makes online guessing impractical. If workerd raises
the ceiling, `PASSWORD_ITERATIONS` will pick it up without invalidating
existing hashes, because each hash records its own cost.

The mature options — better-auth, Lucia, bcrypt or argon2 bindings —
either require `nodejs_compat` plus an ORM and bring their own
`user`/`session` tables that collide with the tenant schema, or ship
native code that does not run on workerd. PBKDF2 is the one
OWASP-approved KDF workerd implements natively, so this adds no
dependency and no compatibility flag. Argon2id would be preferable on
CPU-hardness grounds if it were available.

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

**CSV export** neutralises cells beginning with `=`, `+`, `-` or `@` by
prefixing them. Quoting alone is not protection: the quotes are consumed
by the CSV parser and the formula still reaches the cell.

Deleting an invitation removes its revisions, drafts, RSVP schema,
submissions, answers, preview tokens, media metadata and R2 objects.

---

## Known limitations

- **No MFA.** Password plus session only.
- **No email verification or password reset.** There is no mail
  integration, so a forgotten password currently needs operator help.
- **No IP allow-listing** for the operator console.
- **Rate limiting is per-instance** and keyed on `CF-Connecting-IP`; it
  is a speed bump against credential stuffing, not a defence against a
  distributed attacker.

None of these are hard to add; they are simply not built yet.
