/**
 * Seed a demo invitation through the public API.
 *
 * Goes through the real endpoints rather than writing SQL, so what gets
 * created is exactly what the admin console would produce — validation,
 * revision snapshot and pinned RSVP schema included.
 *
 * Content is the neutral starter template, never the frozen regression
 * fixture: that fixture holds a real couple's names and exists only so
 * the visual baselines have something to compare against.
 *
 * Usage:
 *   BASE=https://your-worker.workers.dev \
 *   COOKIE="__Host-session=..." \
 *   SLUG=demo \
 *   node scripts/seed-invitation.mjs
 */

const BASE = process.env.BASE;
const COOKIE = process.env.COOKIE;
const SLUG = process.env.SLUG || "demo";
const TITLE = process.env.TITLE || "Alex & Jamie";

if (!BASE || !COOKIE) {
  console.error("BASE and COOKIE are required");
  process.exit(1);
}

async function api(path, init = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      cookie: COOKIE,
      origin: BASE,
      "x-requested-with": "fetch",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(body)}`);
  return body;
}

const session = await api("/auth/session");
const tenantId = session.tenants[0].id;
console.log(`workspace: ${session.tenants[0].name}`);

// Lift the plan cap so seeding a demo does not consume the operator's
// own allowance. Ignored when quotas are not enforced.
await api(`/platform/tenants/${tenantId}/quota`, {
  method: "PUT",
  body: JSON.stringify({ maxInvitations: null }),
}).catch(() => {});

// The platform seeds new invitations with the neutral starter template,
// so creating one is enough — there is no config to supply here.
const created = await api(`/tenants/${tenantId}/invitations`, {
  method: "POST",
  body: JSON.stringify({ title: TITLE, slug: SLUG, themeId: "cinematic-classic" }),
});
console.log(`invitation: ${created.invitationId} (/i/${created.slug})`);

const published = await api(`/invitations/${created.invitationId}/publish`, {
  method: "POST",
  body: JSON.stringify({ note: "Demo invitation" }),
});
console.log(`published: revision ${published.revisionId}`);
console.log(`\npublic URL: ${BASE}/i/${created.slug}`);
