/**
 * WS10 — manual cleanup.
 *
 * The invariant under test: deletion never destroys the only record of an
 * R2 key before that object is confirmed gone, and every partial failure
 * leaves a state a retry can finish from.
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

  await env.DB.prepare("UPDATE tenants SET quota_overrides_json = ? WHERE id = ?")
    .bind(JSON.stringify({ maxInvitations: null }), tenantId)
    .run();

  const created = await req(`/api/v1/tenants/${tenantId}/invitations`, {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ title: `Invite ${slug}`, slug }),
  });
  const { invitationId } = await body(created);
  return { cookie, userId, tenantId, invitationId, slug };
}

async function makeOperator(actor: Actor, email: string): Promise<string> {
  await env.DB.prepare("UPDATE users SET is_platform_admin = 1 WHERE id = ?")
    .bind(actor.userId)
    .run();
  const res = await req("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return cookieFrom(res);
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

function deleteRequest(ids: string[], cookie: string, confirmOverride?: string) {
  const confirm = confirmOverride ?? `DELETE ${ids.length} INVITATION${ids.length === 1 ? "" : "S"}`;
  return req("/api/v1/platform/cleanup/delete", {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ invitationIds: ids, confirm }),
  });
}

let alice: Actor;
let bob: Actor;
let operator: string;

beforeEach(async () => {
  await reset();
  alice = await signUp("alice@example.com", "alice-wedding");
  bob = await signUp("bob@example.com", "bob-wedding");
  operator = await makeOperator(bob, "bob@example.com");
});

// ------------------------------------------------------------------ impact

describe("impact preview", () => {
  test("counts revisions, media, bytes, responses, fields and tokens exactly", async () => {
    await uploadAsset(alice, jpeg(100), "hero");
    await uploadAsset(alice, jpeg(200), "story");
    await publish(alice);
    await publish(alice, baseConfig({ copy: { cover: { welcome: "SECOND" } } }));

    await req(`/api/v1/invitations/${alice.invitationId}/preview`, {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({}),
    });

    await req(`/i/${alice.slug}/rsvp`, {
      method: "POST",
      body: JSON.stringify({ name: "Guest", attending: true, message: "Congrats" }),
    });

    const data = await body(
      await req("/api/v1/platform/cleanup/impact", {
        method: "POST",
        headers: { cookie: operator },
        body: JSON.stringify({ invitationIds: [alice.invitationId] }),
      })
    );

    const impact = data.impacts[0];
    expect(impact.revisionCount).toBe(2);
    expect(impact.mediaCount).toBe(2);
    expect(impact.storageBytes).toBe(120 + 220);
    expect(impact.rsvpSubmissionCount).toBe(1);
    expect(impact.rsvpAnswerCount).toBe(1);
    expect(impact.rsvpFieldCount).toBeGreaterThan(0);
    expect(impact.previewTokenCount).toBe(1);
  });

  test("bulk totals are the sum of the parts", async () => {
    await uploadAsset(alice, jpeg(100), "hero");
    await uploadAsset(bob, jpeg(300), "hero");

    const data = await body(
      await req("/api/v1/platform/cleanup/impact", {
        method: "POST",
        headers: { cookie: operator },
        body: JSON.stringify({ invitationIds: [alice.invitationId, bob.invitationId] }),
      })
    );

    expect(data.totals.invitations).toBe(2);
    expect(data.totals.media).toBe(2);
    expect(data.totals.bytes).toBe(120 + 320);
  });

  test("counts come from live data, not the denormalized counter", async () => {
    await uploadAsset(alice, jpeg(500), "hero");
    // Corrupt the counter; the impact must ignore it.
    await env.DB.prepare("UPDATE invitations SET media_bytes = 1 WHERE id = ?")
      .bind(alice.invitationId)
      .run();

    const data = await body(
      await req("/api/v1/platform/cleanup/impact", {
        method: "POST",
        headers: { cookie: operator },
        body: JSON.stringify({ invitationIds: [alice.invitationId] }),
      })
    );
    expect(data.impacts[0].storageBytes).toBe(520);
  });

  test("a tenant user cannot preview impact", async () => {
    const res = await req("/api/v1/platform/cleanup/impact", {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ invitationIds: [alice.invitationId] }),
    });
    expect(res.status).toBe(404);
  });
});

// ------------------------------------------------------------ single delete

describe("single deletion", () => {
  test("removes an invitation with no media", async () => {
    const res = await deleteRequest([alice.invitationId], operator);
    expect(res.status).toBe(200);

    const data = await body(res);
    expect(data.removed).toBe(1);

    const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM invitations WHERE id = ?")
      .bind(alice.invitationId)
      .first<{ c: number }>();
    expect(row?.c).toBe(0);
  });

  test("removes media, revisions, responses, fields and tokens together", async () => {
    await uploadAsset(alice, jpeg(100), "hero");
    await uploadAsset(alice, jpeg(200), "story");
    await publish(alice);
    await req(`/api/v1/invitations/${alice.invitationId}/preview`, {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({}),
    });
    await req(`/i/${alice.slug}/rsvp`, {
      method: "POST",
      body: JSON.stringify({ name: "Guest", attending: true, message: "Hi" }),
    });

    const data = await body(await deleteRequest([alice.invitationId], operator));
    expect(data.removed).toBe(1);
    expect(data.bytesFreed).toBe(120 + 220);

    // Every dependent record is gone.
    for (const [table, column] of [
      ["invitations", "id"],
      ["invitation_revisions", "invitation_id"],
      ["media_assets", "invitation_id"],
      ["rsvp_submissions", "invitation_id"],
      ["rsvp_forms", "invitation_id"],
      ["preview_tokens", "invitation_id"],
    ] as const) {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS c FROM ${table} WHERE ${column} = ?`
      )
        .bind(alice.invitationId)
        .first<{ c: number }>();
      expect(row?.c, table).toBe(0);
    }

    // And so are the objects.
    const listed = await env.MEDIA.list({ prefix: `t/${alice.tenantId}/i/${alice.invitationId}/` });
    expect(listed.objects).toHaveLength(0);
  });

  test("another tenant's data is untouched", async () => {
    await uploadAsset(bob, jpeg(), "hero");
    await deleteRequest([alice.invitationId], operator);

    const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM invitations WHERE id = ?")
      .bind(bob.invitationId)
      .first<{ c: number }>();
    expect(row?.c).toBe(1);
  });

  test("the typed confirmation is enforced server-side", async () => {
    const res = await deleteRequest([alice.invitationId], operator, "yes please");
    expect(res.status).toBe(422);
    expect((await body(res)).error).toBe("confirmation_mismatch");

    const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM invitations WHERE id = ?")
      .bind(alice.invitationId)
      .first<{ c: number }>();
    expect(row?.c).toBe(1);
  });

  test("a tenant owner cannot trigger deletion", async () => {
    const res = await deleteRequest([alice.invitationId], alice.cookie);
    expect(res.status).toBe(404);

    const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM invitations WHERE id = ?")
      .bind(alice.invitationId)
      .first<{ c: number }>();
    expect(row?.c).toBe(1);
  });

  test("deletion is CSRF-protected", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/platform/cleanup/delete`, {
      method: "POST",
      headers: {
        cookie: operator,
        origin: "https://evil.example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({ invitationIds: [alice.invitationId], confirm: "DELETE 1 INVITATION" }),
    });
    expect(res.status).toBe(403);
  });
});

// ------------------------------------------------------------- R2 failures

describe("partial and total R2 failure", () => {
  test("a failed object leaves delete_failed with its key still recorded", async () => {
    const keep = await uploadAsset(alice, jpeg(100), "hero");
    await uploadAsset(alice, jpeg(200), "story");

    const keepRow = await env.DB.prepare("SELECT storage_key AS k FROM media_assets WHERE id = ?")
      .bind(keep)
      .first<{ k: string }>();

    // Fail exactly the first asset's object.
    const spy = vi.spyOn(env.MEDIA, "delete").mockImplementation(async (key: any) => {
      if (key === keepRow!.k) throw new Error("R2 down");
    });

    const data = await body(await deleteRequest([alice.invitationId], operator));
    spy.mockRestore();

    expect(data.failed).toBe(1);
    expect(data.results[0].status).toBe("delete_failed");

    const inv = await env.DB.prepare("SELECT status FROM invitations WHERE id = ?")
      .bind(alice.invitationId)
      .first<{ status: string }>();
    expect(inv?.status).toBe("delete_failed");

    // The critical guarantee: the key of the object that survived is
    // still in D1, so a retry knows what to remove.
    const remaining = await env.DB.prepare(
      "SELECT storage_key AS k FROM media_assets WHERE invitation_id = ?"
    )
      .bind(alice.invitationId)
      .all<{ k: string }>();
    expect(remaining.results.map((r) => r.k)).toEqual([keepRow!.k]);
  });

  test("a retry completes after the failure clears, and is idempotent", async () => {
    const first = await uploadAsset(alice, jpeg(100), "hero");
    await uploadAsset(alice, jpeg(200), "story");

    const firstRow = await env.DB.prepare("SELECT storage_key AS k FROM media_assets WHERE id = ?")
      .bind(first)
      .first<{ k: string }>();

    const spy = vi.spyOn(env.MEDIA, "delete").mockImplementation(async (key: any) => {
      if (key === firstRow!.k) throw new Error("R2 down");
    });
    await deleteRequest([alice.invitationId], operator);
    spy.mockRestore();

    // Retry with R2 healthy. The already-deleted object is simply absent,
    // which must not be treated as a failure.
    const retry = await body(
      await req(`/api/v1/platform/cleanup/retry/${alice.invitationId}`, {
        method: "POST",
        headers: { cookie: operator },
      })
    );
    expect(retry.result.ok).toBe(true);

    const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM invitations WHERE id = ?")
      .bind(alice.invitationId)
      .first<{ c: number }>();
    expect(row?.c).toBe(0);
  });

  test("an object already missing from R2 does not block deletion", async () => {
    const assetId = await uploadAsset(alice, jpeg(), "hero");
    const row = await env.DB.prepare("SELECT storage_key AS k FROM media_assets WHERE id = ?")
      .bind(assetId)
      .first<{ k: string }>();

    // Remove the object behind the metadata's back.
    await env.MEDIA.delete(row!.k);

    const data = await body(await deleteRequest([alice.invitationId], operator));
    expect(data.removed).toBe(1);
  });

  test("every object failing still records all keys for retry", async () => {
    await uploadAsset(alice, jpeg(100), "hero");
    await uploadAsset(alice, jpeg(200), "story");

    const spy = vi.spyOn(env.MEDIA, "delete").mockRejectedValue(new Error("R2 down"));
    const data = await body(await deleteRequest([alice.invitationId], operator));
    spy.mockRestore();

    expect(data.results[0].failedObjects).toBe(2);

    const remaining = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM media_assets WHERE invitation_id = ?"
    )
      .bind(alice.invitationId)
      .first<{ c: number }>();
    expect(remaining?.c).toBe(2);
  });
});

describe("D1 finalization failure", () => {
  test("a failed final transaction leaves a retryable state", async () => {
    await uploadAsset(alice, jpeg(100), "hero");

    // R2 succeeds; the D1 batch does not.
    const spy = vi.spyOn(env.DB, "batch").mockRejectedValueOnce(new Error("D1 down"));
    const data = await body(await deleteRequest([alice.invitationId], operator));
    spy.mockRestore();

    expect(data.failed).toBe(1);

    const inv = await env.DB.prepare("SELECT status FROM invitations WHERE id = ?")
      .bind(alice.invitationId)
      .first<{ status: string }>();
    expect(inv?.status).toBe("delete_failed");

    // The objects are already gone, so the retry is pure D1 work and
    // must not treat their absence as an error.
    const retry = await body(
      await req(`/api/v1/platform/cleanup/retry/${alice.invitationId}`, {
        method: "POST",
        headers: { cookie: operator },
      })
    );
    expect(retry.result.ok).toBe(true);

    const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM invitations WHERE id = ?")
      .bind(alice.invitationId)
      .first<{ c: number }>();
    expect(row?.c).toBe(0);
  });

  test("retry is refused for an invitation that is not being deleted", async () => {
    const res = await req(`/api/v1/platform/cleanup/retry/${alice.invitationId}`, {
      method: "POST",
      headers: { cookie: operator },
    });
    expect(res.status).toBe(409);
  });
});

// --------------------------------------------------------------------- bulk

describe("bulk deletion", () => {
  test("deletes several invitations and reports each result", async () => {
    const data = await body(await deleteRequest([alice.invitationId, bob.invitationId], operator));

    expect(data.removed).toBe(2);
    expect(data.results).toHaveLength(2);
    expect(data.results.every((r: any) => r.ok)).toBe(true);
  });

  test("one failure does not obscure the successes", async () => {
    await uploadAsset(alice, jpeg(100), "hero");
    const aliceRow = await env.DB.prepare(
      "SELECT storage_key AS k FROM media_assets WHERE invitation_id = ?"
    )
      .bind(alice.invitationId)
      .first<{ k: string }>();

    const spy = vi.spyOn(env.MEDIA, "delete").mockImplementation(async (key: any) => {
      if (key === aliceRow!.k) throw new Error("R2 down");
    });
    const data = await body(await deleteRequest([alice.invitationId, bob.invitationId], operator));
    spy.mockRestore();

    expect(data.removed).toBe(1);
    expect(data.failed).toBe(1);

    // Bob's went through; Alice's is retryable.
    const bobRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM invitations WHERE id = ?")
      .bind(bob.invitationId)
      .first<{ c: number }>();
    expect(bobRow?.c).toBe(0);

    const aliceInv = await env.DB.prepare("SELECT status FROM invitations WHERE id = ?")
      .bind(alice.invitationId)
      .first<{ status: string }>();
    expect(aliceInv?.status).toBe("delete_failed");
  });

  test("batches are bounded", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `id-${i}`);
    const res = await req("/api/v1/platform/cleanup/delete", {
      method: "POST",
      headers: { cookie: operator },
      body: JSON.stringify({ invitationIds: ids, confirm: "DELETE 25 INVITATIONS" }),
    });
    expect(res.status).toBe(422);
    expect((await body(res)).limit).toBe(20);
  });
});

// ---------------------------------------------------------- orphan scanner

describe("orphan scanner", () => {
  test("finds an unreferenced object and excludes legitimate assets", async () => {
    await uploadAsset(alice, jpeg(), "hero");
    // An object with no D1 row: exactly the upload-succeeded/D1-failed case.
    await env.MEDIA.put(`t/${alice.tenantId}/i/${alice.invitationId}/a/ghost/original.jpg`, jpeg());

    const data = await body(
      await req("/api/v1/platform/cleanup/orphans", { headers: { cookie: operator } })
    );

    expect(data.candidates).toHaveLength(1);
    expect(data.candidates[0].key).toContain("ghost");
    expect(data.candidates[0].referencedInD1).toBe(false);
    // Ownership is resolved against D1, not merely parsed from the key.
    expect(data.candidates[0].invitationId).toBe(alice.invitationId);
    expect(data.candidates[0].invitationTitle).toBeTruthy();
  });

  test("an orphan created by a failed D1 write is detected", async () => {
    const spy = vi.spyOn(env.DB, "batch").mockRejectedValueOnce(new Error("D1 down"));
    await req(`/api/v1/invitations/${alice.invitationId}/media?slot=hero`, {
      method: "POST",
      headers: { cookie: alice.cookie, "content-type": "application/octet-stream" },
      body: jpeg(),
    });
    spy.mockRestore();

    const data = await body(
      await req("/api/v1/platform/cleanup/orphans", { headers: { cookie: operator } })
    );
    expect(data.candidates).toHaveLength(1);
  });

  test("scanning is cursor-paginated", async () => {
    for (let i = 0; i < 3; i++) {
      await env.MEDIA.put(`t/x/i/y/a/orphan-${i}/original.jpg`, jpeg());
    }

    const data = await body(
      await req("/api/v1/platform/cleanup/orphans", { headers: { cookie: operator } })
    );
    expect(data.scanned).toBe(3);
    expect(data.done).toBe(true);
    expect(data.cursor).toBeNull();
  });

  test("orphans are deleted only with confirmation, and never if now referenced", async () => {
    const assetId = await uploadAsset(alice, jpeg(), "hero");
    const live = await env.DB.prepare("SELECT storage_key AS k FROM media_assets WHERE id = ?")
      .bind(assetId)
      .first<{ k: string }>();

    const orphanKey = `t/${alice.tenantId}/i/${alice.invitationId}/a/ghost/original.jpg`;
    await env.MEDIA.put(orphanKey, jpeg());

    // Wrong phrase is refused.
    const bad = await req("/api/v1/platform/cleanup/orphans/delete", {
      method: "POST",
      headers: { cookie: operator },
      body: JSON.stringify({ keys: [orphanKey], confirm: "delete" }),
    });
    expect(bad.status).toBe(422);

    // A referenced key is skipped even if the operator asks for it,
    // because it would break a live invitation.
    const data = await body(
      await req("/api/v1/platform/cleanup/orphans/delete", {
        method: "POST",
        headers: { cookie: operator },
        body: JSON.stringify({
          keys: [orphanKey, live!.k],
          confirm: "DELETE 2 OBJECTS",
        }),
      })
    );
    expect(data.deleted).toBe(1);
    expect(data.skipped).toEqual([live!.k]);

    expect(await env.MEDIA.head(orphanKey)).toBeNull();
    expect(await env.MEDIA.head(live!.k)).not.toBeNull();
  });

  test("a tenant user cannot scan or delete orphans", async () => {
    expect(
      (await req("/api/v1/platform/cleanup/orphans", { headers: { cookie: alice.cookie } })).status
    ).toBe(404);

    const res = await req("/api/v1/platform/cleanup/orphans/delete", {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ keys: ["anything"], confirm: "DELETE 1 OBJECT" }),
    });
    expect(res.status).toBe(404);
  });
});

// -------------------------------------------------------------------- audit

describe("cleanup audit", () => {
  test("success and failure are recorded without personal content", async () => {
    await uploadAsset(alice, jpeg(100), "hero");
    await publish(alice);
    await req(`/i/${alice.slug}/rsvp`, {
      method: "POST",
      body: JSON.stringify({ name: "Sensitive Name", attending: true, message: "Private note" }),
    });

    await deleteRequest([alice.invitationId], operator);

    const events = await body(
      await req("/api/v1/platform/audit", { headers: { cookie: operator } })
    );
    const event = events.events.find((e: any) => e.action === "cleanup.invitation_removed");

    expect(event).toBeTruthy();
    expect(event.targetId).toBe(alice.invitationId);
    expect(event.ok).toBe(1);

    // Counts and bytes only — no guest data anywhere in the log.
    const raw = JSON.stringify(events);
    expect(raw).not.toContain("Sensitive Name");
    expect(raw).not.toContain("Private note");
  });

  test("a failed deletion is audited as a failure", async () => {
    await uploadAsset(alice, jpeg(), "hero");

    const spy = vi.spyOn(env.MEDIA, "delete").mockRejectedValue(new Error("R2 down"));
    await deleteRequest([alice.invitationId], operator);
    spy.mockRestore();

    const events = await body(
      await req("/api/v1/platform/audit", { headers: { cookie: operator } })
    );
    const event = events.events.find((e: any) => e.action === "cleanup.invitation_failed");
    expect(event.ok).toBe(0);
  });
});
