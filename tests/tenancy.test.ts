/**
 * WS3 — tenancy and cross-tenant isolation.
 *
 * The centrepiece is the IDOR matrix: for every tenant-scoped resource,
 * a user from tenant A is pointed at a real, existing resource in tenant
 * B and must be refused. The IDs used are genuine — a test that probes a
 * made-up ID proves only that unknown IDs 404.
 *
 * Foreign resources must be indistinguishable from nonexistent ones, so
 * the assertions compare against the not-found response rather than
 * merely checking "not 200".
 */
import { beforeEach, describe, expect, test } from "vitest";
import { SELF, env } from "cloudflare:test";

const ORIGIN = "https://app.example.com";
const PASSWORD = "correct horse battery";

function req(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (!headers.has("origin")) headers.set("origin", ORIGIN);
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

function body<T = Record<string, unknown>>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function reset(): Promise<void> {
  for (const sql of [
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
}

interface Actor {
  cookie: string;
  userId: string;
  tenantId: string;
}

async function signUp(email: string): Promise<Actor> {
  const res = await req("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  const cookie = cookieFrom(res);
  const { userId } = await body<{ userId: string }>(res);

  // These suites test tenancy, not the verification gate: mark the
  // account verified as a completed verification would. Verification
  // itself is covered in tests/auth.test.ts.
  await env.DB.prepare("UPDATE users SET email_verified = 1 WHERE email = ?").bind(email).run();

  const session = await req("/api/v1/auth/session", { headers: { cookie } });
  const data = await body<{ tenants: Array<{ id: string }> }>(session);
  return { cookie, userId, tenantId: data.tenants[0]!.id };
}

async function createInvitation(actor: Actor, slug: string): Promise<string> {
  const res = await req(`/api/v1/tenants/${actor.tenantId}/invitations`, {
    method: "POST",
    headers: { cookie: actor.cookie },
    body: JSON.stringify({ title: `Invite ${slug}`, slug }),
  });
  expect(res.status).toBe(200);
  const { invitationId } = await body<{ invitationId: string }>(res);
  return invitationId;
}

let alice: Actor;
let bob: Actor;
let aliceInvitation: string;
let bobInvitation: string;

beforeEach(async () => {
  await reset();
  alice = await signUp("alice@example.com");
  bob = await signUp("bob@example.com");
  aliceInvitation = await createInvitation(alice, "alice-wedding");
  bobInvitation = await createInvitation(bob, "bob-wedding");
});

describe("tenant provisioning", () => {
  test("each signup owns exactly one tenant, and tenants are distinct", async () => {
    expect(alice.tenantId).not.toBe(bob.tenantId);

    const res = await req("/api/v1/tenants", { headers: { cookie: alice.cookie } });
    const data = await body<{ tenants: Array<{ id: string; role: string }> }>(res);
    expect(data.tenants).toHaveLength(1);
    expect(data.tenants[0]!.id).toBe(alice.tenantId);
    expect(data.tenants[0]!.role).toBe("owner");
  });

  test("listing tenants never leaks another tenant", async () => {
    const res = await req("/api/v1/tenants", { headers: { cookie: alice.cookie } });
    const raw = await res.text();
    expect(raw).not.toContain(bob.tenantId);
  });

  test("tenant slugs are not guessable from the email alone", async () => {
    const row = await env.DB.prepare("SELECT slug FROM tenants WHERE id = ?")
      .bind(alice.tenantId)
      .first<{ slug: string }>();
    expect(row?.slug).toMatch(/^alice-[a-z0-9]{8}$/);
  });
});

describe("multiple invitations per tenant", () => {
  /**
   * The seeded hosted-free plan caps invitations at one. That is a policy
   * choice, not an architectural limit, so these tests lift the cap to
   * prove the data model and routes carry no single-invitation assumption.
   */
  async function liftCap(actor: Actor): Promise<void> {
    await env.DB.prepare("UPDATE tenants SET quota_overrides_json = ? WHERE id = ?")
      .bind(JSON.stringify({ maxInvitations: null }), actor.tenantId)
      .run();
  }

  test("a tenant may hold several invitations", async () => {
    await liftCap(alice);
    await createInvitation(alice, "alice-second");
    await createInvitation(alice, "alice-third");

    const res = await req(`/api/v1/tenants/${alice.tenantId}/invitations`, {
      headers: { cookie: alice.cookie },
    });
    const data = await body<{ invitations: unknown[] }>(res);
    expect(data.invitations).toHaveLength(3);
  });

  test("the invitation list is scoped to the tenant", async () => {
    const res = await req(`/api/v1/tenants/${alice.tenantId}/invitations`, {
      headers: { cookie: alice.cookie },
    });
    const raw = await res.text();
    expect(raw).toContain(aliceInvitation);
    expect(raw).not.toContain(bobInvitation);
  });

  test("slugs are globally unique, without revealing the holder", async () => {
    await liftCap(bob);
    const res = await req(`/api/v1/tenants/${bob.tenantId}/invitations`, {
      method: "POST",
      headers: { cookie: bob.cookie },
      body: JSON.stringify({ title: "Clash", slug: "alice-wedding" }),
    });
    expect(res.status).toBe(409);
    const data = await body<{ error: string }>(res);
    expect(data.error).toBe("slug_taken");
    expect(JSON.stringify(data)).not.toContain(alice.tenantId);
  });

  test("reserved and malformed slugs are rejected", async () => {
    for (const [slug, expected] of [
      ["admin", "slug_reserved"],
      ["api", "slug_reserved"],
      ["Bad Slug", "invalid_slug"],
      ["-leading", "invalid_slug"],
      ["ab", "invalid_slug_length"],
      ["../escape", "invalid_slug"],
    ] as const) {
      const res = await req(`/api/v1/tenants/${alice.tenantId}/invitations`, {
        method: "POST",
        headers: { cookie: alice.cookie },
        body: JSON.stringify({ title: "X", slug }),
      });
      expect(res.status).toBe(400);
      expect((await body<{ error: string }>(res)).error).toBe(expected);
    }
  });
});

// ------------------------------------------------------------- IDOR matrix

describe("IDOR: cross-tenant reads", () => {
  test("tenant A user cannot read tenant B", async () => {
    const res = await req(`/api/v1/tenants/${bob.tenantId}`, {
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(404);
  });

  test("a foreign tenant is indistinguishable from a nonexistent one", async () => {
    const foreign = await req(`/api/v1/tenants/${bob.tenantId}`, {
      headers: { cookie: alice.cookie },
    });
    const missing = await req("/api/v1/tenants/00000000-0000-4000-8000-000000000000", {
      headers: { cookie: alice.cookie },
    });

    expect(foreign.status).toBe(missing.status);
    expect(await body(foreign)).toEqual(await body(missing));
  });

  test("tenant A user cannot list tenant B's invitations", async () => {
    const res = await req(`/api/v1/tenants/${bob.tenantId}/invitations`, {
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(404);
  });

  test("tenant A user cannot list tenant B's members", async () => {
    const res = await req(`/api/v1/tenants/${bob.tenantId}/members`, {
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(404);
  });

  test("invitation read across the tenant boundary is refused", async () => {
    const res = await req(`/api/v1/invitations/${bobInvitation}`, {
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(404);
  });

  test("a foreign invitation looks exactly like a missing one", async () => {
    const foreign = await req(`/api/v1/invitations/${bobInvitation}`, {
      headers: { cookie: alice.cookie },
    });
    const missing = await req("/api/v1/invitations/11111111-1111-4111-8111-111111111111", {
      headers: { cookie: alice.cookie },
    });

    expect(foreign.status).toBe(missing.status);
    expect(await body(foreign)).toEqual(await body(missing));
  });
});

describe("IDOR: cross-tenant writes", () => {
  test("tenant A user cannot rename tenant B", async () => {
    const res = await req(`/api/v1/tenants/${bob.tenantId}`, {
      method: "PATCH",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ name: "Stolen" }),
    });
    expect(res.status).toBe(404);

    const row = await env.DB.prepare("SELECT name FROM tenants WHERE id = ?")
      .bind(bob.tenantId)
      .first<{ name: string }>();
    expect(row?.name).not.toBe("Stolen");
  });

  test("tenant A user cannot create an invitation inside tenant B", async () => {
    const res = await req(`/api/v1/tenants/${bob.tenantId}/invitations`, {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ title: "Trespass", slug: "trespass" }),
    });
    expect(res.status).toBe(404);

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM invitations WHERE tenant_id = ?"
    )
      .bind(bob.tenantId)
      .first<{ c: number }>();
    expect(row?.c).toBe(1);
  });

  test("invitation update across the tenant boundary is refused and changes nothing", async () => {
    const res = await req(`/api/v1/invitations/${bobInvitation}`, {
      method: "PATCH",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ title: "Hijacked" }),
    });
    expect(res.status).toBe(404);

    const row = await env.DB.prepare("SELECT title FROM invitations WHERE id = ?")
      .bind(bobInvitation)
      .first<{ title: string }>();
    expect(row?.title).toBe("Invite bob-wedding");
  });

  test("draft content cannot be written across the tenant boundary", async () => {
    const res = await req(`/api/v1/invitations/${bobInvitation}`, {
      method: "PATCH",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ draft: { names: "Injected" } }),
    });
    expect(res.status).toBe(404);

    // A new invitation is seeded with neutral starter content, so the
    // check is that the foreign write did not land — not that the draft
    // is empty.
    const row = await env.DB.prepare("SELECT draft_json AS d FROM invitations WHERE id = ?")
      .bind(bobInvitation)
      .first<{ d: string }>();
    expect(row!.d).not.toContain("Injected");
  });

  test("publish across the tenant boundary is refused", async () => {
    const res = await req(`/api/v1/invitations/${bobInvitation}/publish`, {
      method: "POST",
      headers: { cookie: alice.cookie },
    });
    // 404, not the 501 an authorized caller currently receives: the
    // boundary is enforced before the unimplemented handler is reached.
    expect(res.status).toBe(404);
  });

  test("unpublish across the tenant boundary is refused and does not change status", async () => {
    await env.DB.prepare("UPDATE invitations SET status = 'published' WHERE id = ?")
      .bind(bobInvitation)
      .run();

    const res = await req(`/api/v1/invitations/${bobInvitation}/unpublish`, {
      method: "POST",
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(404);

    const row = await env.DB.prepare("SELECT status FROM invitations WHERE id = ?")
      .bind(bobInvitation)
      .first<{ status: string }>();
    expect(row?.status).toBe("published");
  });

  test("the owner can still publish/unpublish their own invitation", async () => {
    await env.DB.prepare("UPDATE invitations SET status = 'published' WHERE id = ?")
      .bind(bobInvitation)
      .run();

    const res = await req(`/api/v1/invitations/${bobInvitation}/unpublish`, {
      method: "POST",
      headers: { cookie: bob.cookie },
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT status FROM invitations WHERE id = ?")
      .bind(bobInvitation)
      .first<{ status: string }>();
    expect(row?.status).toBe("unpublished");
  });
});

describe("IDOR: membership mutation", () => {
  test("a member cannot add members; only an owner can", async () => {
    const carol = await signUp("carol@example.com");

    // Alice invites Carol as a plain member of Alice's tenant.
    await req(`/api/v1/tenants/${alice.tenantId}/members`, {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ email: "carol@example.com", role: "member" }),
    });

    const dave = await signUp("dave@example.com");
    expect(dave.userId).toBeTruthy();

    const res = await req(`/api/v1/tenants/${alice.tenantId}/members`, {
      method: "POST",
      headers: { cookie: carol.cookie },
      body: JSON.stringify({ email: "dave@example.com", role: "member" }),
    });
    expect(res.status).toBe(403);

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM tenant_members WHERE tenant_id = ?"
    )
      .bind(alice.tenantId)
      .first<{ c: number }>();
    expect(row?.c).toBe(2); // alice + carol, dave was not added
  });

  test("a member can administer invitations in their tenant", async () => {
    const carol = await signUp("carol2@example.com");
    await req(`/api/v1/tenants/${alice.tenantId}/members`, {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ email: "carol2@example.com", role: "member" }),
    });

    const res = await req(`/api/v1/invitations/${aliceInvitation}`, {
      method: "PATCH",
      headers: { cookie: carol.cookie },
      body: JSON.stringify({ title: "Updated by member" }),
    });
    expect(res.status).toBe(200);
  });

  test("an outsider cannot add themselves to a tenant", async () => {
    const res = await req(`/api/v1/tenants/${bob.tenantId}/members`, {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ email: "alice@example.com", role: "owner" }),
    });
    expect(res.status).toBe(404);

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM tenant_members WHERE tenant_id = ? AND user_id = ?"
    )
      .bind(bob.tenantId, alice.userId)
      .first<{ c: number }>();
    expect(row?.c).toBe(0);
  });

  test("adding a member does not reveal whether the email is registered", async () => {
    const known = await req(`/api/v1/tenants/${alice.tenantId}/members`, {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ email: "bob@example.com" }),
    });
    const unknown = await req(`/api/v1/tenants/${alice.tenantId}/members`, {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ email: "nobody@example.com" }),
    });

    expect(known.status).toBe(unknown.status);
    expect(await body(known)).toEqual(await body(unknown));
  });

  test("a member cannot be removed across the tenant boundary", async () => {
    const res = await req(`/api/v1/tenants/${bob.tenantId}/members/${bob.userId}`, {
      method: "DELETE",
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(404);

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM tenant_members WHERE tenant_id = ?"
    )
      .bind(bob.tenantId)
      .first<{ c: number }>();
    expect(row?.c).toBe(1);
  });

  test("the last owner cannot be removed", async () => {
    const res = await req(`/api/v1/tenants/${alice.tenantId}/members/${alice.userId}`, {
      method: "DELETE",
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(409);
    expect((await body<{ error: string }>(res)).error).toBe("last_owner");
  });
});

describe("IDOR: platform APIs and privilege", () => {
  test("an ordinary tenant user cannot reach platform-admin APIs", async () => {
    const res = await req("/api/v1/platform/overview", { headers: { cookie: alice.cookie } });
    // Not 403: a plain user should not learn that the surface exists.
    expect([404, 501]).toContain(res.status);
    expect(res.status).not.toBe(200);
  });

  test("a user cannot promote themselves to platform admin via the tenant API", async () => {
    const res = await req(`/api/v1/tenants/${alice.tenantId}`, {
      method: "PATCH",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ name: "Fine", isPlatformAdmin: true, role: "owner" }),
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT is_platform_admin AS a FROM users WHERE id = ?")
      .bind(alice.userId)
      .first<{ a: number }>();
    expect(row?.a).toBe(0);
  });

  test("a platform admin gets no implicit membership in a tenant", async () => {
    // Operator power is exercised through /platform-admin, not by
    // silently acting as a tenant through the ordinary admin API.
    await env.DB.prepare("UPDATE users SET is_platform_admin = 1 WHERE id = ?")
      .bind(alice.userId)
      .run();

    const res = await req(`/api/v1/tenants/${bob.tenantId}`, {
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(404);

    const inv = await req(`/api/v1/invitations/${bobInvitation}`, {
      headers: { cookie: alice.cookie },
    });
    expect(inv.status).toBe(404);
  });
});

describe("IDOR: unauthenticated and disabled callers", () => {
  test("every tenant route requires a session", async () => {
    for (const path of [
      "/api/v1/tenants",
      `/api/v1/tenants/${alice.tenantId}`,
      `/api/v1/tenants/${alice.tenantId}/invitations`,
      `/api/v1/tenants/${alice.tenantId}/members`,
      `/api/v1/invitations/${aliceInvitation}`,
    ]) {
      const res = await req(path);
      expect(res.status).toBe(401);
    }
  });

  test("a disabled user loses tenant access immediately", async () => {
    expect(
      (await req(`/api/v1/tenants/${alice.tenantId}`, { headers: { cookie: alice.cookie } })).status
    ).toBe(200);

    await env.DB.prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
      .bind(alice.userId)
      .run();

    const res = await req(`/api/v1/tenants/${alice.tenantId}`, {
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(401);
  });

  test("a suspended tenant is readable-refused for its own members", async () => {
    await env.DB.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?")
      .bind(alice.tenantId)
      .run();

    const res = await req(`/api/v1/tenants/${alice.tenantId}`, {
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(403);
    expect((await body<{ error: string }>(res)).error).toBe("tenant_suspended");
  });

  test("a suspended tenant's invitations cannot be edited", async () => {
    await env.DB.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?")
      .bind(alice.tenantId)
      .run();

    const res = await req(`/api/v1/invitations/${aliceInvitation}`, {
      method: "PATCH",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ title: "Nope" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("CSRF on tenant mutations", () => {
  test("a cross-origin invitation write is rejected before authorization", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/invitations/${aliceInvitation}`, {
      method: "PATCH",
      headers: {
        cookie: alice.cookie,
        origin: "https://evil.example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "CSRF" }),
    });
    expect(res.status).toBe(403);

    const row = await env.DB.prepare("SELECT title FROM invitations WHERE id = ?")
      .bind(aliceInvitation)
      .first<{ title: string }>();
    expect(row?.title).toBe("Invite alice-wedding");
  });

  test("cross-origin reads are still allowed (no state change)", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/tenants`, {
      headers: { cookie: alice.cookie, origin: "https://evil.example.com" },
    });
    // The session cookie is SameSite=Lax, so a real cross-site browser
    // read never carries credentials; this only proves reads are not
    // blocked by the CSRF middleware itself.
    expect(res.status).toBe(200);
  });
});

describe("quotas", () => {
  test("hosted plan limits cap invitation creation", async () => {
    // The seeded hosted-free plan allows one invitation; Alice has one.
    const res = await req(`/api/v1/tenants/${alice.tenantId}/invitations`, {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ title: "Second", slug: "alice-second" }),
    });
    expect(res.status).toBe(403);
    expect((await body<{ error: string }>(res)).error).toBe("quota_invitations");
  });

  test("a per-tenant override raises the cap without changing the plan", async () => {
    await env.DB.prepare("UPDATE tenants SET quota_overrides_json = ? WHERE id = ?")
      .bind(JSON.stringify({ maxInvitations: 5 }), alice.tenantId)
      .run();

    const res = await req(`/api/v1/tenants/${alice.tenantId}/invitations`, {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ title: "Second", slug: "alice-second" }),
    });
    expect(res.status).toBe(200);
  });
});
