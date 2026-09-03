/**
 * WS4 — R2 media.
 *
 * Covers upload validation, cross-tenant isolation, quotas, immutable
 * keys, byte accounting, draft protection on the public delivery path,
 * and the two partial-failure modes (R2 fails / D1 fails after R2).
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SELF, env } from "cloudflare:test";

const ORIGIN = "https://app.example.com";
const PASSWORD = "correct horse battery";

function req(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("origin")) headers.set("origin", ORIGIN);
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

function body<T = Record<string, unknown>>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

// --- fixture payloads: real magic bytes, minimal padding ---

function jpeg(extra = 64): Uint8Array {
  const bytes = new Uint8Array(20 + extra);
  // SOI + APP0 whose length (6) makes the next segment start at offset 10.
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46]);
  // SOF0 at offset 10, declaring height 200 x width 100.
  bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x00, 0x64], 10);
  return bytes;
}

function png(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  // IHDR width=300 height=150
  bytes.set([0x00, 0x00, 0x01, 0x2c], 16);
  bytes.set([0x00, 0x00, 0x00, 0x96], 20);
  return bytes;
}

function mp3(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x49, 0x44, 0x33, 0x03, 0x00]); // "ID3"
  return bytes;
}

function svg(): Uint8Array {
  return new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
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

  const listed = await env.MEDIA.list();
  for (const object of listed.objects) await env.MEDIA.delete(object.key);
}

interface Actor {
  cookie: string;
  userId: string;
  tenantId: string;
  invitationId: string;
}

async function signUp(email: string, slug: string): Promise<Actor> {
  const res = await req("/api/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const cookie = cookieFrom(res);
  const { userId } = await body<{ userId: string }>(res);

  // These suites test tenancy, not the verification gate: mark the
  // account verified as a completed verification would. Verification
  // itself is covered in tests/auth.test.ts.
  await env.DB.prepare("UPDATE users SET email_verified = 1 WHERE email = ?").bind(email).run();

  const session = await req("/api/v1/auth/session", { headers: { cookie } });
  const { tenants } = await body<{ tenants: Array<{ id: string }> }>(session);
  const tenantId = tenants[0]!.id;

  const created = await req(`/api/v1/tenants/${tenantId}/invitations`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ title: `Invite ${slug}`, slug }),
  });
  const { invitationId } = await body<{ invitationId: string }>(created);

  return { cookie, userId, tenantId, invitationId };
}

function upload(
  actor: Actor,
  payload: Uint8Array,
  opts: { slot?: string; filename?: string; invitationId?: string } = {}
): Promise<Response> {
  const params = new URLSearchParams();
  if (opts.slot) params.set("slot", opts.slot);
  if (opts.filename) params.set("filename", opts.filename);
  const qs = params.toString();
  const target = opts.invitationId ?? actor.invitationId;

  return req(`/api/v1/invitations/${target}/media${qs ? `?${qs}` : ""}`, {
    method: "POST",
    headers: { cookie: actor.cookie, "content-type": "application/octet-stream" },
    body: payload,
  });
}

/** Publish an asset by writing a revision that references it. */
async function publishWithAsset(actor: Actor, assetId: string): Promise<void> {
  const revisionId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO invitation_revisions (id, invitation_id, config_json, media_manifest_json, created_at)
       VALUES (?, ?, '{}', ?, ?)`
    ).bind(revisionId, actor.invitationId, JSON.stringify([assetId]), Date.now()),
    env.DB.prepare(
      "UPDATE invitations SET published_revision_id = ?, status = 'published' WHERE id = ?"
    ).bind(revisionId, actor.invitationId),
  ]);
}

let alice: Actor;
let bob: Actor;

beforeEach(async () => {
  await reset();
  alice = await signUp("alice@example.com", "alice-wedding");
  bob = await signUp("bob@example.com", "bob-wedding");
});

describe("upload validation", () => {
  test("accepts a JPEG and records sniffed type and dimensions", async () => {
    const res = await upload(alice, jpeg(), { slot: "hero", filename: "Hero Photo.jpg" });
    expect(res.status).toBe(200);

    const data = await body<{
      asset: { id: string; kind: string; mimeType: string; width: number; height: number; url: string };
    }>(res);
    expect(data.asset.kind).toBe("image");
    expect(data.asset.mimeType).toBe("image/jpeg");
    expect(data.asset.width).toBe(100);
    expect(data.asset.height).toBe(200);
    expect(data.asset.url).toBe(`/media/${data.asset.id}`);
  });

  test("parses PNG dimensions from IHDR", async () => {
    const res = await upload(alice, png());
    const data = await body<{ asset: { width: number; height: number } }>(res);
    expect(data.asset.width).toBe(300);
    expect(data.asset.height).toBe(150);
  });

  test("accepts audio for the music slot", async () => {
    const res = await upload(alice, mp3(), { slot: "background_music" });
    expect(res.status).toBe(200);
    const data = await body<{ asset: { kind: string; mimeType: string } }>(res);
    expect(data.asset.kind).toBe("audio");
    expect(data.asset.mimeType).toBe("audio/mpeg");
  });

  test("rejects SVG, which would be a stored-XSS vector", async () => {
    const res = await upload(alice, svg());
    expect(res.status).toBe(415);
    expect((await body<{ error: string }>(res)).error).toBe("unsupported_type");
  });

  test("rejects a file whose bytes do not match its claimed content type", async () => {
    // Content-Type says JPEG; the bytes are an HTML document.
    const res = await req(`/api/v1/invitations/${alice.invitationId}/media`, {
      method: "POST",
      headers: { cookie: alice.cookie, "content-type": "image/jpeg" },
      body: new TextEncoder().encode("<html><script>alert(1)</script></html>"),
    });
    expect(res.status).toBe(415);
  });

  test("rejects an executable disguised with an image extension", async () => {
    const res = await upload(alice, new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0]), {
      filename: "photo.jpg",
    });
    expect(res.status).toBe(415);
  });

  test("rejects an empty upload", async () => {
    const res = await upload(alice, new Uint8Array(0));
    expect(res.status).toBe(400);
    expect((await body<{ error: string }>(res)).error).toBe("empty_file");
  });

  test("rejects audio in a photo slot and images in the music slot", async () => {
    const audioInPhoto = await upload(alice, mp3(), { slot: "hero" });
    expect(audioInPhoto.status).toBe(400);
    expect((await body<{ error: string }>(audioInPhoto)).error).toBe("slot_kind_mismatch");

    const photoInAudio = await upload(alice, jpeg(), { slot: "background_music" });
    expect(photoInAudio.status).toBe(400);
  });

  test("rejects an unknown slot", async () => {
    const res = await upload(alice, jpeg(), { slot: "not_a_slot" });
    expect(res.status).toBe(400);
    expect((await body<{ error: string }>(res)).error).toBe("unknown_slot");
  });

  test("a hostile filename never reaches the storage key", async () => {
    const res = await upload(alice, jpeg(), { filename: "../../../etc/passwd" });
    expect(res.status).toBe(200);
    const { asset } = await body<{ asset: { id: string } }>(res);

    const row = await env.DB.prepare("SELECT storage_key AS k FROM media_assets WHERE id = ?")
      .bind(asset.id)
      .first<{ k: string }>();

    expect(row!.k).toBe(`t/${alice.tenantId}/i/${alice.invitationId}/a/${asset.id}/original.jpg`);
    expect(row!.k).not.toContain("..");
    expect(row!.k).not.toContain("passwd");
  });
});

describe("immutable keys", () => {
  test("re-uploading the same slot creates a new asset, never overwriting", async () => {
    const first = await body<{ asset: { id: string } }>(await upload(alice, jpeg(), { slot: "hero" }));
    const second = await body<{ asset: { id: string } }>(await upload(alice, jpeg(128), { slot: "hero" }));

    expect(second.asset.id).not.toBe(first.asset.id);

    // Both objects still exist: the published revision keeps its bytes.
    const listed = await env.MEDIA.list({ prefix: `t/${alice.tenantId}/` });
    expect(listed.objects).toHaveLength(2);
  });

  test("the key layout is tenant/invitation/asset scoped for the orphan scanner", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(alice, jpeg()));
    const listed = await env.MEDIA.list({ prefix: `t/${alice.tenantId}/i/${alice.invitationId}/a/` });

    expect(listed.objects).toHaveLength(1);
    expect(listed.objects[0]!.key).toContain(asset.id);
  });

  test("stored objects carry tenant and invitation metadata", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(alice, jpeg()));
    const row = await env.DB.prepare("SELECT storage_key AS k FROM media_assets WHERE id = ?")
      .bind(asset.id)
      .first<{ k: string }>();

    const object = await env.MEDIA.head(row!.k);
    expect(object?.customMetadata?.tenantId).toBe(alice.tenantId);
    expect(object?.customMetadata?.invitationId).toBe(alice.invitationId);
  });
});

describe("cross-tenant media isolation", () => {
  test("a user cannot upload into another tenant's invitation", async () => {
    const res = await upload(alice, jpeg(), { invitationId: bob.invitationId });
    expect(res.status).toBe(404);

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM media_assets WHERE invitation_id = ?"
    )
      .bind(bob.invitationId)
      .first<{ c: number }>();
    expect(row?.c).toBe(0);
  });

  test("a user cannot list another tenant's media", async () => {
    await upload(bob, jpeg());
    const res = await req(`/api/v1/invitations/${bob.invitationId}/media`, {
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(404);
  });

  test("a user cannot mutate another tenant's asset", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(bob, jpeg()));

    const res = await req(`/api/v1/invitations/${bob.invitationId}/media/${asset.id}`, {
      method: "PATCH",
      headers: { cookie: alice.cookie, "content-type": "application/json" },
      body: JSON.stringify({ slot: "hero" }),
    });
    expect(res.status).toBe(404);

    const row = await env.DB.prepare("SELECT slot FROM media_assets WHERE id = ?")
      .bind(asset.id)
      .first<{ slot: string | null }>();
    expect(row?.slot).toBeNull();
  });

  test("an asset ID cannot be smuggled through the caller's own invitation", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(bob, jpeg()));

    // Alice owns this invitation path, but the asset belongs to Bob.
    const res = await req(`/api/v1/invitations/${alice.invitationId}/media/${asset.id}`, {
      method: "PATCH",
      headers: { cookie: alice.cookie, "content-type": "application/json" },
      body: JSON.stringify({ slot: "hero" }),
    });
    expect(res.status).toBe(404);
  });

  test("a user cannot delete another tenant's asset", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(bob, jpeg()));

    const res = await req(`/api/v1/invitations/${bob.invitationId}/media/${asset.id}`, {
      method: "DELETE",
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(404);

    const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM media_assets WHERE id = ?")
      .bind(asset.id)
      .first<{ c: number }>();
    expect(row?.c).toBe(1);
  });

  test("uploading requires a session", async () => {
    const res = await req(`/api/v1/invitations/${alice.invitationId}/media`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: jpeg(),
    });
    expect(res.status).toBe(401);
  });

  test("uploading is CSRF-protected", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/invitations/${alice.invitationId}/media`, {
      method: "POST",
      headers: { cookie: alice.cookie, origin: "https://evil.example.com" },
      body: jpeg(),
    });
    expect(res.status).toBe(403);
  });
});

describe("public delivery and draft protection", () => {
  test("an unpublished asset is not publicly reachable", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(alice, jpeg()));

    const res = await SELF.fetch(`${ORIGIN}/media/${asset.id}`);
    expect(res.status).toBe(404);
  });

  test("a published asset is served with immutable caching", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(alice, jpeg()));
    await publishWithAsset(alice, asset.id);

    const res = await SELF.fetch(`${ORIGIN}/media/${asset.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("etag")).toBe(`"${asset.id}"`);
  });

  test("conditional requests get a 304", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(alice, jpeg()));
    await publishWithAsset(alice, asset.id);

    const res = await SELF.fetch(`${ORIGIN}/media/${asset.id}`, {
      headers: { "if-none-match": `"${asset.id}"` },
    });
    expect(res.status).toBe(304);
  });

  test("a tenant member can view their own draft asset", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(alice, jpeg()));

    const res = await SELF.fetch(`${ORIGIN}/media/${asset.id}`, {
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(200);
  });

  test("another tenant cannot view a draft asset even while signed in", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(alice, jpeg()));

    const res = await SELF.fetch(`${ORIGIN}/media/${asset.id}`, {
      headers: { cookie: bob.cookie },
    });
    expect(res.status).toBe(404);
  });

  test("a valid preview token unlocks that invitation's draft assets only", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(alice, jpeg()));
    const bobAsset = await body<{ asset: { id: string } }>(await upload(bob, jpeg()));

    // Preview access is scoped to assets the draft actually references
    // (WS5), so the draft must point at the asset for the token to help.
    await env.DB.prepare("UPDATE invitations SET draft_json = ? WHERE id = ?")
      .bind(JSON.stringify({ media: { hero: { assetId: asset.id } } }), alice.invitationId)
      .run();

    const token = "preview-token-value";
    const hash = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
      ),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    await env.DB.prepare(
      `INSERT INTO preview_tokens (id, invitation_id, token_hash, scope, expires_at, created_at)
       VALUES (?, ?, ?, 'draft', ?, ?)`
    )
      .bind(crypto.randomUUID(), alice.invitationId, hash, Date.now() + 60_000, Date.now())
      .run();

    expect((await SELF.fetch(`${ORIGIN}/media/${asset.id}?preview=${token}`)).status).toBe(200);
    // The same token must not unlock a different invitation's assets.
    expect(
      (await SELF.fetch(`${ORIGIN}/media/${bobAsset.asset.id}?preview=${token}`)).status
    ).toBe(404);
  });

  test("an expired preview token does not unlock anything", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(alice, jpeg()));
    await env.DB.prepare("UPDATE invitations SET draft_json = ? WHERE id = ?")
      .bind(JSON.stringify({ media: { hero: { assetId: asset.id } } }), alice.invitationId)
      .run();

    const token = "expired-token";
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    await env.DB.prepare(
      `INSERT INTO preview_tokens (id, invitation_id, token_hash, scope, expires_at, created_at)
       VALUES (?, ?, ?, 'draft', ?, ?)`
    )
      .bind(crypto.randomUUID(), alice.invitationId, hash, Date.now() - 1000, Date.now())
      .run();

    expect((await SELF.fetch(`${ORIGIN}/media/${asset.id}?preview=${token}`)).status).toBe(404);
  });

  test("the delivery path cannot address an arbitrary bucket object", async () => {
    await env.MEDIA.put("t/secret/private.txt", new TextEncoder().encode("secret"));

    for (const probe of [
      "t/secret/private.txt",
      "../t/secret/private.txt",
      "..%2Ft%2Fsecret%2Fprivate.txt",
    ]) {
      const res = await SELF.fetch(`${ORIGIN}/media/${probe}`);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("secret");
    }
  });

  test("an unpublished invitation's asset stops being public", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(alice, jpeg()));
    await publishWithAsset(alice, asset.id);
    expect((await SELF.fetch(`${ORIGIN}/media/${asset.id}`)).status).toBe(200);

    await req(`/api/v1/invitations/${alice.invitationId}/unpublish`, {
      method: "POST",
      headers: { cookie: alice.cookie },
    });

    expect((await SELF.fetch(`${ORIGIN}/media/${asset.id}`)).status).toBe(404);
  });
});

describe("storage accounting", () => {
  test("uploading increments the invitation's byte counter in the same batch", async () => {
    const payload = jpeg(500);
    await upload(alice, payload);

    const row = await env.DB.prepare("SELECT media_bytes AS b FROM invitations WHERE id = ?")
      .bind(alice.invitationId)
      .first<{ b: number }>();
    expect(row?.b).toBe(payload.byteLength);
  });

  test("the counter matches the sum of assets after several uploads", async () => {
    await upload(alice, jpeg(100));
    await upload(alice, jpeg(200));
    await upload(alice, mp3(300));

    const counter = await env.DB.prepare("SELECT media_bytes AS b FROM invitations WHERE id = ?")
      .bind(alice.invitationId)
      .first<{ b: number }>();
    const summed = await env.DB.prepare(
      "SELECT COALESCE(SUM(byte_size), 0) AS b FROM media_assets WHERE invitation_id = ?"
    )
      .bind(alice.invitationId)
      .first<{ b: number }>();

    expect(counter?.b).toBe(summed?.b);
  });

  test("deleting an asset decrements the counter and removes the object", async () => {
    const { asset } = await body<{ asset: { id: string; byteSize: number } }>(
      await upload(alice, jpeg(400))
    );

    const res = await req(`/api/v1/invitations/${alice.invitationId}/media/${asset.id}`, {
      method: "DELETE",
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT media_bytes AS b FROM invitations WHERE id = ?")
      .bind(alice.invitationId)
      .first<{ b: number }>();
    expect(row?.b).toBe(0);

    const listed = await env.MEDIA.list({ prefix: `t/${alice.tenantId}/` });
    expect(listed.objects).toHaveLength(0);
  });

  test("a published asset cannot be deleted", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(alice, jpeg()));
    await publishWithAsset(alice, asset.id);

    const res = await req(`/api/v1/invitations/${alice.invitationId}/media/${asset.id}`, {
      method: "DELETE",
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(409);
    expect((await body<{ error: string }>(res)).error).toBe("asset_published");

    const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM media_assets WHERE id = ?")
      .bind(asset.id)
      .first<{ c: number }>();
    expect(row?.c).toBe(1);
  });
});

describe("quotas", () => {
  test("a per-file image limit is enforced", async () => {
    await env.DB.prepare("UPDATE tenants SET quota_overrides_json = ? WHERE id = ?")
      .bind(JSON.stringify({ maxImageBytes: 100 }), alice.tenantId)
      .run();

    const res = await upload(alice, jpeg(500));
    expect(res.status).toBe(413);
    expect((await body<{ error: string }>(res)).error).toBe("file_too_large");
  });

  test("a per-invitation storage limit is enforced cumulatively", async () => {
    await env.DB.prepare("UPDATE tenants SET quota_overrides_json = ? WHERE id = ?")
      .bind(JSON.stringify({ maxMediaBytesPerInvitation: 200 }), alice.tenantId)
      .run();

    expect((await upload(alice, jpeg(80))).status).toBe(200); // 100 bytes
    const second = await upload(alice, jpeg(200)); // would exceed
    expect(second.status).toBe(403);
    expect((await body<{ error: string }>(second)).error).toBe("quota_invitation_storage");
  });

  test("a per-tenant storage limit spans invitations", async () => {
    await env.DB.prepare("UPDATE tenants SET quota_overrides_json = ? WHERE id = ?")
      .bind(JSON.stringify({ maxInvitations: null, maxMediaBytesPerTenant: 200 }), alice.tenantId)
      .run();

    const created = await req(`/api/v1/tenants/${alice.tenantId}/invitations`, {
      method: "POST",
      headers: { cookie: alice.cookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "Second", slug: "alice-second" }),
    });
    const { invitationId } = await body<{ invitationId: string }>(created);

    expect((await upload(alice, jpeg(80))).status).toBe(200);
    const res = await upload(alice, jpeg(200), { invitationId });
    expect(res.status).toBe(403);
    expect((await body<{ error: string }>(res)).error).toBe("quota_tenant_storage");
  });

  test("self-hosted deployments do not enforce quotas", async () => {
    // The hosted-free plan caps image bytes; a self-hosted plan does not.
    await env.DB.prepare("UPDATE tenants SET plan_id = 'plan_self_hosted' WHERE id = ?")
      .bind(alice.tenantId)
      .run();

    const res = await upload(alice, jpeg(5000));
    expect(res.status).toBe(200);
  });
});

describe("partial failure semantics", () => {
  test("an R2 write failure records nothing in D1", async () => {
    const spy = vi.spyOn(env.MEDIA, "put").mockRejectedValueOnce(new Error("R2 down"));

    const res = await upload(alice, jpeg());
    expect(res.status).toBe(503);
    expect((await body<{ error: string }>(res)).error).toBe("storage_unavailable");

    // The critical invariant: D1 must never claim an asset R2 does not have.
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM media_assets WHERE invitation_id = ?"
    )
      .bind(alice.invitationId)
      .first<{ c: number }>();
    expect(row?.c).toBe(0);

    const counter = await env.DB.prepare("SELECT media_bytes AS b FROM invitations WHERE id = ?")
      .bind(alice.invitationId)
      .first<{ b: number }>();
    expect(counter?.b).toBe(0);

    spy.mockRestore();
  });

  test("a D1 failure after a successful R2 write leaves a discoverable orphan", async () => {
    const spy = vi.spyOn(env.DB, "batch").mockRejectedValueOnce(new Error("D1 down"));

    const res = await upload(alice, jpeg());
    expect(res.status).toBe(500);

    const data = await body<{ error: string; orphanKey: string }>(res);
    expect(data.error).toBe("metadata_write_failed");

    // No metadata was written...
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM media_assets WHERE invitation_id = ?"
    )
      .bind(alice.invitationId)
      .first<{ c: number }>();
    expect(row?.c).toBe(0);

    // ...but the object exists, under a key that encodes tenant and
    // invitation, so the WS10 scanner can reclaim it.
    const object = await env.MEDIA.head(data.orphanKey);
    expect(object).not.toBeNull();
    expect(data.orphanKey).toContain(`t/${alice.tenantId}/i/${alice.invitationId}/`);

    spy.mockRestore();
  });

  test("orphans are discoverable by walking the tenant prefix", async () => {
    const spy = vi.spyOn(env.DB, "batch").mockRejectedValueOnce(new Error("D1 down"));
    await upload(alice, jpeg());
    spy.mockRestore();

    await upload(alice, jpeg(128)); // a healthy asset alongside the orphan

    const listed = await env.MEDIA.list({ prefix: "t/" });
    const { results } = await env.DB.prepare("SELECT storage_key AS k FROM media_assets").all<{
      k: string;
    }>();
    const known = new Set(results.map((r) => r.k));
    const orphans = listed.objects.filter((o) => !known.has(o.key));

    expect(listed.objects.length).toBe(2);
    expect(orphans).toHaveLength(1);
  });

  test("an R2 delete failure still removes the asset from the product", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(alice, jpeg()));
    const spy = vi.spyOn(env.MEDIA, "delete").mockRejectedValueOnce(new Error("R2 down"));

    const res = await req(`/api/v1/invitations/${alice.invitationId}/media/${asset.id}`, {
      method: "DELETE",
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(200);
    expect((await body<{ storageCleanupDeferred: boolean }>(res)).storageCleanupDeferred).toBe(true);

    // Metadata is gone; the bytes are an orphan for the scanner.
    const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM media_assets WHERE id = ?")
      .bind(asset.id)
      .first<{ c: number }>();
    expect(row?.c).toBe(0);

    spy.mockRestore();
  });

  test("a D1 row pointing at a missing object degrades to 404, not 500", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(alice, jpeg()));
    await publishWithAsset(alice, asset.id);

    const row = await env.DB.prepare("SELECT storage_key AS k FROM media_assets WHERE id = ?")
      .bind(asset.id)
      .first<{ k: string }>();
    await env.MEDIA.delete(row!.k);

    const res = await SELF.fetch(`${ORIGIN}/media/${asset.id}`);
    expect(res.status).toBe(404);
  });
});

describe("focal point", () => {
  test("a focal point is stored as simple portable percentages", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(alice, jpeg(), { slot: "hero" }));

    const res = await req(`/api/v1/invitations/${alice.invitationId}/media/${asset.id}`, {
      method: "PATCH",
      headers: { cookie: alice.cookie, "content-type": "application/json" },
      body: JSON.stringify({ focal: { x: 50, y: 32 } }),
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT draft_json AS d FROM invitations WHERE id = ?")
      .bind(alice.invitationId)
      .first<{ d: string }>();
    expect(JSON.parse(row!.d).focal[asset.id]).toEqual({ x: 50, y: 32 });
  });

  test("out-of-range focal values are rejected", async () => {
    const { asset } = await body<{ asset: { id: string } }>(await upload(alice, jpeg()));

    for (const focal of [{ x: -1, y: 0 }, { x: 0, y: 101 }, { x: "50", y: 50 }, null]) {
      const res = await req(`/api/v1/invitations/${alice.invitationId}/media/${asset.id}`, {
        method: "PATCH",
        headers: { cookie: alice.cookie, "content-type": "application/json" },
        body: JSON.stringify({ focal }),
      });
      expect(res.status).toBe(400);
    }
  });
});
