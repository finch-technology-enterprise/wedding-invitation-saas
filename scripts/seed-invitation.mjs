/**
 * Seed an invitation from the frozen fixture through the public API.
 *
 * Goes through the real endpoints rather than writing SQL, so what gets
 * created is exactly what the admin console would produce — including
 * validation, the revision snapshot and the pinned RSVP schema.
 *
 * Usage:
 *   BASE=https://your-worker.workers.dev \
 *   COOKIE="__Host-session=..." \
 *   SLUG=our-wedding \
 *   node scripts/seed-invitation.mjs
 */

import { DEMO_BOOTSTRAP } from "../tests/e2e/fixture.mjs";

const BASE = process.env.BASE;
const COOKIE = process.env.COOKIE;
const SLUG = process.env.SLUG || "demo";
const TITLE = process.env.TITLE || "李天豪 ❤ 刘蔼蕴";

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
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

const session = await api("/auth/session");
const tenantId = session.tenants[0].id;
console.log(`workspace: ${session.tenants[0].name}`);

// Lift the plan cap: the seeded invitation should not consume the
// operator's own hosted-free allowance.
await api(`/platform/tenants/${tenantId}/quota`, {
  method: "PUT",
  body: JSON.stringify({ maxInvitations: null }),
}).catch(() => {
  /* not an operator, or quotas not enforced */
});

const created = await api(`/tenants/${tenantId}/invitations`, {
  method: "POST",
  body: JSON.stringify({ title: TITLE, slug: SLUG, themeId: "cinematic-classic" }),
});
console.log(`invitation: ${created.invitationId} (/i/${created.slug})`);

// The fixture's config is exactly the accepted baseline.
await api(`/invitations/${created.invitationId}/draft`, {
  method: "PUT",
  body: JSON.stringify({ config: DEMO_BOOTSTRAP.config }),
});
console.log("draft saved");

const published = await api(`/invitations/${created.invitationId}/publish`, {
  method: "POST",
  body: JSON.stringify({ note: "Initial publish from frozen fixture" }),
});
console.log(`published: revision ${published.revisionId}`);
console.log(`\npublic URL: ${BASE}/i/${created.slug}`);
