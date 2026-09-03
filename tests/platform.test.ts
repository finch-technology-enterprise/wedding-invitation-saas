/**
 * WS9 + WS10 — operator console and manual cleanup.
 *
 * Two properties dominate:
 *
 *  1. Platform routes are a separate authorization domain. Tenant
 *     membership grants nothing here, and platform_admin grants nothing
 *     in the tenant API.
 *  2. Invitation deletion never loses the only record of an R2 key
 *     before that object is confirmed gone.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SELF, env } from "cloudflare:test";

const ORIGIN = "https://app.example.com";
const PASSWORD = "correct horse battery";

function req(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (!headers.has("origin")) headers.set("origin", ORIGIN);
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

function body<T = any>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

function jpeg(extra = 64): Uint8Array {
  const bytes = new Uint8Array(20 + extra);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46]);
  bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x00, 0x64], 10);
  return bytes;
}

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    couple: { groom: { zh: "李" }, bride: { zh: "刘" } },
    date: { iso: "2027-10-09T11:00:00+08:00", durationHours: 4 },
    copy: { cover: { welcome: "WELCOME" } },
    venue: { tba: true },
    rsvp: { maxGuests: 12 },
    media: {},
    music: { assetId: null, enabled: false },
    motion: { driftPxPerSec: 46 },
    ...overrides,
  };
}

async function reset(): Promise<void> {
  for (const sql of [
    "DELETE FROM platform_audit_events",
    "DELETE FROM rsvp_answers",
    "DELETE FROM rsvp_submissions",
    "DELETE FROM rsvp_fields",
    "DELETE FROM rsvp_forms",
    "DELETE FROM preview_tokens",
    "DELETE FROM media_assets",
    "UPDATE invitations SET published_revision_id = NULL",
    "DELETE FROM invitation_revisions",
    "DELETE FROM invitations",
    "DELETE FROM sessions",
    "DELETE FROM tenant_members",
    "DELETE FROM tenants",
    "DELETE FROM users",
    "DELETE FROM rate_limits",
    "UPDATE platform_settings SET value_json = 'true' WHERE key = 'registration_enabled'",
  ]) {
    await env.DB.prepare(sql).run();
  }
  const listed = await env.MEDIA.list();
  for (const o of listed.objects) await env.MEDIA.delete(o.key);
}

interface Actor {
  cookie: string;
  userId: string;
  tenantId: string;
  invitationId: string;
  slug: string;
}

async function signUp(email: string, slug: string): Promise<Actor> {
  const res = await req("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const cookie = cookieFrom(res);
  const { userId } = await body(res);

  const session = await req("/api/v1/auth/session", { headers: { cookie } });
  const { tenants } = await body(session);
  const tenantId = tenants[0].id;

  const created = await req(`/api/v1/tenants/${tenantId}/invitations`, {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ title: `Invite ${slug}`, slug }),
  });
  const { invitationId } = await body(created);
  return { cookie, userId, tenantId, invitationId, slug };
}

/** Promote to operator and re-authenticate, so the session reflects it. */
async function makeOperator(actor: Actor): Promise<string> {
  await env.DB.prepare("UPDATE users SET is_platform_admin = 1 WHERE id = ?")
    .bind(actor.userId)
    .run();
  const res = await req("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: await emailOf(actor.userId), password: PASSWORD }),
  });
  return cookieFrom(res);
}

async function emailOf(userId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT email FROM users WHERE id = ?")
    .bind(userId)
    .first<{ email: string }>();
  return row!.email;
}

async function uploadAsset(actor: Actor, payload: Uint8Array, slot: string): Promise<string> {
  const res = await req(`/api/v1/invitations/${actor.invitationId}/media?slot=${slot}`, {
    method: "POST",
    headers: { cookie: actor.cookie, "content-type": "application/octet-stream" },
    body: payload,
  });
  const { asset } = await body(res);
  return asset.id;
}

async function publish(actor: Actor, config = baseConfig()): Promise<void> {
  await req(`/api/v1/invitations/${actor.invitationId}/draft`, {
    method: "PUT",
    headers: { cookie: actor.cookie },
    body: JSON.stringify({ config }),
  });
  await req(`/api/v1/invitations/${actor.invitationId}/publish`, {
    method: "POST",
    headers: { cookie: actor.cookie },
    body: JSON.stringify({}),
  });
}

let alice: Actor;
let bob: Actor;
let operator: string;

beforeEach(async () => {
  await reset();
  alice = await signUp("alice@example.com", "alice-wedding");
  bob = await signUp("bob@example.com", "bob-wedding");
  operator = await makeOperator(bob);
});

// ------------------------------------------------------------ authorization

describe("platform authorization", () => {
  const ROUTES = [
    "/api/v1/platform/overview",
    "/api/v1/platform/users",
    "/api/v1/platform/tenants",
    "/api/v1/platform/invitations",
    "/api/v1/platform/storage",
    "/api/v1/platform/system",
    "/api/v1/platform/audit",
  ];

  test("an operator may read every platform route", async () => {
    for (const path of ROUTES) {
      const res = await req(path, { headers: { cookie: operator } });
      expect(res.status).toBe(200);
    }
  });

  test("an ordinary tenant owner is refused everywhere", async () => {
    for (const path of ROUTES) {
      const res = await req(path, { headers: { cookie: alice.cookie } });
      // 404, not 403: a tenant should not learn the surface exists.
      expect(res.status).toBe(404);
    }
  });

  test("an unauthenticated caller is refused", async () => {
    for (const path of ROUTES) {
      expect((await req(path)).status).toBe(401);
    }
  });

  test("a tenant member is refused", async () => {
    const carol = await signUp("carol@example.com", "carol-wedding");
    await req(`/api/v1/tenants/${alice.tenantId}/members`, {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ email: "carol@example.com", role: "member" }),
    });

    expect(
      (await req("/api/v1/platform/overview", { headers: { cookie: carol.cookie } })).status
    ).toBe(404);
  });

  test("a disabled operator loses access immediately", async () => {
    expect((await req("/api/v1/platform/overview", { headers: { cookie: operator } })).status).toBe(
      200
    );

    await env.DB.prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
      .bind(bob.userId)
      .run();

    expect((await req("/api/v1/platform/overview", { headers: { cookie: operator } })).status).toBe(
      401
    );
  });

  test("a forged user id in the body grants nothing", async () => {
    const res = await req("/api/v1/platform/overview", {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ userId: bob.userId, isPlatformAdmin: true }),
    });
    expect(res.status).not.toBe(200);
  });

  test("platform mutations are CSRF-protected", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/platform/users/${alice.userId}/status`, {
      method: "POST",
      headers: {
        cookie: operator,
        origin: "https://evil.example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({ status: "disabled" }),
    });
    expect(res.status).toBe(403);
  });

  test("an operator gets no implicit tenant membership", async () => {
    // The architectural rule: operator power lives on platform routes,
    // not as a privileged branch inside the tenant API.
    expect(
      (await req(`/api/v1/tenants/${alice.tenantId}`, { headers: { cookie: operator } })).status
    ).toBe(404);
    expect(
      (await req(`/api/v1/invitations/${alice.invitationId}`, { headers: { cookie: operator } }))
        .status
    ).toBe(404);
  });
});

// ---------------------------------------------------------------- overview

describe("overview", () => {
  test("totals and storage reflect the database", async () => {
    await uploadAsset(alice, jpeg(100), "hero");
    await publish(alice);

    const data = await body(await req("/api/v1/platform/overview", { headers: { cookie: operator } }));

    expect(data.totals.users).toBe(2);
    expect(data.totals.tenants).toBe(2);
    expect(data.totals.invitations).toBe(2);
    expect(data.totals.published).toBe(1);
    expect(data.totals.mediaAssets).toBe(1);
    expect(data.storage.totalBytes).toBe(120);
    expect(data.storage.imageBytes).toBe(120);
  });

  test("status counts are grouped correctly", async () => {
    await publish(alice);
    const data = await body(await req("/api/v1/platform/overview", { headers: { cookie: operator } }));

    const byStatus = Object.fromEntries(data.statusCounts.map((s: any) => [s.status, s.count]));
    expect(byStatus.published).toBe(1);
    expect(byStatus.draft).toBe(1);
  });
});

// ------------------------------------------------------------------- users

describe("users", () => {
  test("lists users with counts, and never leaks credentials", async () => {
    await uploadAsset(alice, jpeg(200), "hero");

    const res = await req("/api/v1/platform/users", { headers: { cookie: operator } });
    const raw = await res.text();

    expect(raw).not.toContain("pbkdf2");
    expect(raw).not.toContain("password");

    const data = JSON.parse(raw);
    const row = data.users.find((u: any) => u.email === "alice@example.com");
    expect(row.tenantCount).toBe(1);
    expect(row.invitationCount).toBe(1);
    expect(row.storageBytes).toBe(220);
  });

  test("pagination bounds the result set", async () => {
    const data = await body(
      await req("/api/v1/platform/users?limit=1", { headers: { cookie: operator } })
    );
    expect(data.users).toHaveLength(1);
    expect(data.total).toBe(2);
  });

  test("disabling a user revokes their sessions immediately", async () => {
    expect((await req("/api/v1/auth/session", { headers: { cookie: alice.cookie } })).status).toBe(
      200
    );

    const res = await req(`/api/v1/platform/users/${alice.userId}/status`, {
      method: "POST",
      headers: { cookie: operator },
      body: JSON.stringify({ status: "disabled" }),
    });
    expect(res.status).toBe(200);

    expect((await req("/api/v1/auth/session", { headers: { cookie: alice.cookie } })).status).toBe(
      401
    );
  });

  test("an operator cannot disable themselves", async () => {
    const res = await req(`/api/v1/platform/users/${bob.userId}/status`, {
      method: "POST",
      headers: { cookie: operator },
      body: JSON.stringify({ status: "disabled" }),
    });
    expect(res.status).toBe(409);
  });

  test("session revocation signs the user out without disabling them", async () => {
    await req(`/api/v1/platform/users/${alice.userId}/revoke-sessions`, {
      method: "POST",
      headers: { cookie: operator },
    });

    expect((await req("/api/v1/auth/session", { headers: { cookie: alice.cookie } })).status).toBe(
      401
    );

    // Still able to sign back in: revocation is not a ban.
    const login = await req("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "alice@example.com", password: PASSWORD }),
    });
    expect(login.status).toBe(200);
  });
});

// ----------------------------------------------------------------- tenants

describe("tenants", () => {
  test("lists tenants with owner, counts and storage", async () => {
    await uploadAsset(alice, jpeg(300), "hero");
    await publish(alice);

    const data = await body(
      await req("/api/v1/platform/tenants", { headers: { cookie: operator } })
    );
    const row = data.tenants.find((t: any) => t.id === alice.tenantId);

    expect(row.ownerEmail).toBe("alice@example.com");
    expect(row.memberCount).toBe(1);
    expect(row.invitationCount).toBe(1);
    expect(row.publishedCount).toBe(1);
    expect(row.storageBytes).toBe(320);
  });

  test("sorting by storage puts the largest first", async () => {
    await uploadAsset(alice, jpeg(500), "hero");

    const data = await body(
      await req("/api/v1/platform/tenants?sort=storage", { headers: { cookie: operator } })
    );
    expect(data.tenants[0].id).toBe(alice.tenantId);
  });

  test("suspension blocks the tenant without deleting anything", async () => {
    const res = await req(`/api/v1/platform/tenants/${alice.tenantId}/status`, {
      method: "POST",
      headers: { cookie: operator },
      body: JSON.stringify({ status: "suspended" }),
    });
    expect(res.status).toBe(200);

    expect(
      (await req(`/api/v1/tenants/${alice.tenantId}`, { headers: { cookie: alice.cookie } })).status
    ).toBe(403);

    const still = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM invitations WHERE tenant_id = ?"
    )
      .bind(alice.tenantId)
      .first<{ c: number }>();
    expect(still?.c).toBe(1);

    // ...and it is reversible.
    await req(`/api/v1/platform/tenants/${alice.tenantId}/status`, {
      method: "POST",
      headers: { cookie: operator },
      body: JSON.stringify({ status: "active" }),
    });
    expect(
      (await req(`/api/v1/tenants/${alice.tenantId}`, { headers: { cookie: alice.cookie } })).status
    ).toBe(200);
  });

  test("quota overrides are validated against an allow-list", async () => {
    const bad = await req(`/api/v1/platform/tenants/${alice.tenantId}/quota`, {
      method: "PUT",
      headers: { cookie: operator },
      body: JSON.stringify({ isPlatformAdmin: true }),
    });
    expect(bad.status).toBe(422);

    const good = await req(`/api/v1/platform/tenants/${alice.tenantId}/quota`, {
      method: "PUT",
      headers: { cookie: operator },
      body: JSON.stringify({ maxInvitations: 5 }),
    });
    expect(good.status).toBe(200);
  });
});

// ------------------------------------------------------------- invitations

describe("invitation inventory", () => {
  beforeEach(async () => {
    await uploadAsset(alice, jpeg(400), "hero");
    await publish(alice);
  });

  test("returns platform-wide inventory with live counts", async () => {
    const data = await body(
      await req("/api/v1/platform/invitations", { headers: { cookie: operator } })
    );

    expect(data.total).toBe(2);
    const row = data.invitations.find((i: any) => i.id === alice.invitationId);
    expect(row.tenantName).toBeTruthy();
    expect(row.ownerEmail).toBe("alice@example.com");
    expect(row.revisionCount).toBe(1);
    expect(row.mediaCount).toBe(1);
    expect(row.storageBytes).toBe(420);
  });

  test("sorts oldest and newest by creation", async () => {
    const oldest = await body(
      await req("/api/v1/platform/invitations?sort=oldest", { headers: { cookie: operator } })
    );
    const newest = await body(
      await req("/api/v1/platform/invitations?sort=newest", { headers: { cookie: operator } })
    );
    expect(oldest.invitations[0].id).not.toBe(newest.invitations[0].id);
    expect(oldest.invitations[0].id).toBe(alice.invitationId);
  });

  test("sorts by storage and by media count", async () => {
    const byStorage = await body(
      await req("/api/v1/platform/invitations?sort=storage", { headers: { cookie: operator } })
    );
    expect(byStorage.invitations[0].id).toBe(alice.invitationId);

    const byMedia = await body(
      await req("/api/v1/platform/invitations?sort=media", { headers: { cookie: operator } })
    );
    expect(byMedia.invitations[0].id).toBe(alice.invitationId);
  });

  test("filters by status, tenant and zero responses", async () => {
    const published = await body(
      await req("/api/v1/platform/invitations?status=published", {
        headers: { cookie: operator },
      })
    );
    expect(published.invitations).toHaveLength(1);
    expect(published.invitations[0].id).toBe(alice.invitationId);

    const byTenant = await body(
      await req(`/api/v1/platform/invitations?tenantId=${bob.tenantId}`, {
        headers: { cookie: operator },
      })
    );
    expect(byTenant.invitations.every((i: any) => i.tenantId === bob.tenantId)).toBe(true);

    const noRsvp = await body(
      await req("/api/v1/platform/invitations?noRsvp=true", { headers: { cookie: operator } })
    );
    expect(noRsvp.total).toBe(2);
  });

  test("filters by created and updated dates", async () => {
    const future = Date.now() + 60_000;
    const all = await body(
      await req(`/api/v1/platform/invitations?createdBefore=${future}`, {
        headers: { cookie: operator },
      })
    );
    expect(all.total).toBe(2);

    const none = await body(
      await req("/api/v1/platform/invitations?createdBefore=1", { headers: { cookie: operator } })
    );
    expect(none.total).toBe(0);
  });

  test("pagination is server-side", async () => {
    const page = await body(
      await req("/api/v1/platform/invitations?limit=1", { headers: { cookie: operator } })
    );
    expect(page.invitations).toHaveLength(1);
    expect(page.total).toBe(2);
  });

  test("detail exposes metadata and media but no bearer tokens", async () => {
    await req(`/api/v1/invitations/${alice.invitationId}/preview`, {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({}),
    });

    const res = await req(`/api/v1/platform/invitations/${alice.invitationId}`, {
      headers: { cookie: operator },
    });
    const raw = await res.text();
    const data = JSON.parse(raw);

    expect(data.invitation.slug).toBe(alice.slug);
    expect(data.media).toHaveLength(1);
    expect(data.revisionCount).toBe(1);
    // A preview token must never be handed out by the operator view.
    expect(raw).not.toContain("token");
  });
});

// ----------------------------------------------------------------- storage

describe("storage reporting", () => {
  test("aggregates totals, tenants, invitations and largest assets", async () => {
    await uploadAsset(alice, jpeg(1000), "hero");
    await uploadAsset(alice, jpeg(100), "story");

    const data = await body(await req("/api/v1/platform/storage", { headers: { cookie: operator } }));

    expect(data.totals.assetCount).toBe(2);
    expect(data.totals.totalBytes).toBe(1140);
    expect(data.totals.imageCount).toBe(2);

    expect(data.byTenant[0].id).toBe(alice.tenantId);
    expect(data.byTenant[0].bytes).toBe(1140);
    expect(data.byInvitation[0].id).toBe(alice.invitationId);
    // Largest first.
    expect(data.largestAssets[0].byteSize).toBe(1020);
  });

  test("reporting does not enumerate the bucket", async () => {
    await uploadAsset(alice, jpeg(), "hero");

    const spy = vi.spyOn(env.MEDIA, "list");
    await req("/api/v1/platform/storage", { headers: { cookie: operator } });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test("counter drift is detected and repaired", async () => {
    await uploadAsset(alice, jpeg(500), "hero");

    // Corrupt the denormalized counter.
    await env.DB.prepare("UPDATE invitations SET media_bytes = 999999 WHERE id = ?")
      .bind(alice.invitationId)
      .run();

    const drift = await body(
      await req("/api/v1/platform/storage/consistency", { headers: { cookie: operator } })
    );
    expect(drift.count).toBe(1);
    expect(drift.drifted[0].counterBytes).toBe(999999);
    expect(drift.drifted[0].actualBytes).toBe(520);

    const repair = await body(
      await req("/api/v1/platform/storage/recalculate", {
        method: "POST",
        headers: { cookie: operator },
      })
    );
    expect(repair.count).toBe(1);
    expect(repair.repaired[0]).toMatchObject({ before: 999999, calculated: 520, after: 520 });

    const after = await body(
      await req("/api/v1/platform/storage/consistency", { headers: { cookie: operator } })
    );
    expect(after.count).toBe(0);
  });

  test("recalculation is a no-op when counters agree", async () => {
    await uploadAsset(alice, jpeg(), "hero");
    const res = await body(
      await req("/api/v1/platform/storage/recalculate", {
        method: "POST",
        headers: { cookie: operator },
      })
    );
    expect(res.count).toBe(0);
  });
});

// ------------------------------------------------------------------ system

describe("system", () => {
  test("reports mode, binding health and settings without secrets", async () => {
    const res = await req("/api/v1/platform/system", { headers: { cookie: operator } });
    const raw = await res.text();
    const data = JSON.parse(raw);

    expect(["hosted", "self_hosted"]).toContain(data.mode);
    expect(data.bindings.d1).toBe(true);
    expect(data.bindings.r2).toBe(true);
    expect(raw).not.toMatch(/secret|token|credential|ADMIN_KEY/i);
  });

  test("settings are validated against an allow-list", async () => {
    const bad = await req("/api/v1/platform/system/settings", {
      method: "PUT",
      headers: { cookie: operator },
      body: JSON.stringify({ arbitrary_key: "x" }),
    });
    expect(bad.status).toBe(422);

    const good = await req("/api/v1/platform/system/settings", {
      method: "PUT",
      headers: { cookie: operator },
      body: JSON.stringify({ registration_enabled: false }),
    });
    expect(good.status).toBe(200);
  });
});

// ------------------------------------------------- WS11 hardening findings

describe("suspension is effective everywhere", () => {
  test("a suspended tenant's published invitation stops serving", async () => {
    await publish(alice);
    expect((await SELF.fetch(`${ORIGIN}/i/${alice.slug}`)).status).toBe(200);

    await req(`/api/v1/platform/tenants/${alice.tenantId}/status`, {
      method: "POST",
      headers: { cookie: operator },
      body: JSON.stringify({ status: "suspended" }),
    });

    // Suspension must take the invitation offline, not merely lock the
    // tenant out of the admin.
    expect((await SELF.fetch(`${ORIGIN}/i/${alice.slug}`)).status).toBe(404);

    await req(`/api/v1/platform/tenants/${alice.tenantId}/status`, {
      method: "POST",
      headers: { cookie: operator },
      body: JSON.stringify({ status: "active" }),
    });
    expect((await SELF.fetch(`${ORIGIN}/i/${alice.slug}`)).status).toBe(200);
  });

  test("a member of a suspended tenant cannot pull draft media", async () => {
    const assetId = await uploadAsset(alice, jpeg(), "hero");

    // Draft media is visible to its own tenant while active...
    expect(
      (await SELF.fetch(`${ORIGIN}/media/${assetId}`, { headers: { cookie: alice.cookie } })).status
    ).toBe(200);

    await req(`/api/v1/platform/tenants/${alice.tenantId}/status`, {
      method: "POST",
      headers: { cookie: operator },
      body: JSON.stringify({ status: "suspended" }),
    });

    // ...and not after suspension. This path re-implemented its own
    // membership check once, which silently skipped the status gate.
    expect(
      (await SELF.fetch(`${ORIGIN}/media/${assetId}`, { headers: { cookie: alice.cookie } })).status
    ).toBe(404);
  });

  test("a preview link for a suspended tenant stops resolving", async () => {
    await req(`/api/v1/invitations/${alice.invitationId}/draft`, {
      method: "PUT",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ config: baseConfig() }),
    });
    const { token } = await body(
      await req(`/api/v1/invitations/${alice.invitationId}/preview`, {
        method: "POST",
        headers: { cookie: alice.cookie },
        body: JSON.stringify({}),
      })
    );
    expect((await SELF.fetch(`${ORIGIN}/preview/${token}`)).status).toBe(200);

    await req(`/api/v1/platform/tenants/${alice.tenantId}/status`, {
      method: "POST",
      headers: { cookie: operator },
      body: JSON.stringify({ status: "suspended" }),
    });
    expect((await SELF.fetch(`${ORIGIN}/preview/${token}`)).status).toBe(404);
  });
});

describe("allow-lists cannot be escaped via the prototype chain", () => {
  test("an inherited property is not accepted as a sort order", async () => {
    for (const sort of ["constructor", "toString", "valueOf", "__proto__"]) {
      const res = await req(`/api/v1/platform/invitations?sort=${sort}`, {
        headers: { cookie: operator },
      });
      // Falls back to the default ordering rather than splicing a
      // stringified function into ORDER BY.
      expect(res.status).toBe(200);

      const tenants = await req(`/api/v1/platform/tenants?sort=${sort}`, {
        headers: { cookie: operator },
      });
      expect(tenants.status).toBe(200);
    }
  });

  test("an inherited property is not accepted as a platform setting", async () => {
    for (const key of ["constructor", "toString", "hasOwnProperty"]) {
      const res = await req("/api/v1/platform/system/settings", {
        method: "PUT",
        headers: { cookie: operator },
        body: JSON.stringify({ [key]: "x" }),
      });
      expect(res.status).toBe(422);
    }
  });
});
