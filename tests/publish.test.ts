/**
 * WS5 — draft, validation, revisions, publishing and preview.
 *
 * The property under test throughout: a guest only ever sees one coherent
 * published revision. Partial saves, foreign assets, failed publishes and
 * stale pointers must all be impossible rather than merely unlikely.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SELF, env } from "cloudflare:test";
import { resolvePublishedInvitation, resolvePreviewInvitation } from "../src/lib/resolve.js";
import { validateConfig } from "../src/themes/cinematic-classic.js";

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

function jpeg(extra = 64): Uint8Array {
  const bytes = new Uint8Array(20 + extra);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46]);
  bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x00, 0x64], 10);
  return bytes;
}

function mp3(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x49, 0x44, 0x33, 0x03, 0x00]);
  return bytes;
}

/** A minimal config that satisfies the cinematic theme contract. */
function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    couple: {
      groom: { zh: "李天豪", en: "LEE THEAN HOW" },
      bride: { zh: "刘蔼蕴", en: "LAW HAI YEUN" },
    },
    date: { iso: "2027-10-09T11:00:00+08:00", lunar: "农历九月初十", timeLabel: "11:00", durationHours: 4 },
    copy: { cover: { bracket: "【婚礼邀请函】", welcome: "WELCOME TO OUR WEDDING" } },
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
  slug: string;
}

async function signUp(email: string, slug: string): Promise<Actor> {
  const res = await req("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const cookie = cookieFrom(res);
  const { userId } = await body<{ userId: string }>(res);

  const session = await req("/api/v1/auth/session", { headers: { cookie } });
  const { tenants } = await body<{ tenants: Array<{ id: string }> }>(session);
  const tenantId = tenants[0]!.id;

  const created = await req(`/api/v1/tenants/${tenantId}/invitations`, {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ title: `Invite ${slug}`, slug }),
  });
  const { invitationId } = await body<{ invitationId: string }>(created);

  return { cookie, userId, tenantId, invitationId, slug };
}

function saveDraft(actor: Actor, config: Record<string, unknown>): Promise<Response> {
  return req(`/api/v1/invitations/${actor.invitationId}/draft`, {
    method: "PUT",
    headers: { cookie: actor.cookie },
    body: JSON.stringify({ config }),
  });
}

function doPublish(actor: Actor, note?: string): Promise<Response> {
  return req(`/api/v1/invitations/${actor.invitationId}/publish`, {
    method: "POST",
    headers: { cookie: actor.cookie },
    body: JSON.stringify(note ? { note } : {}),
  });
}

async function uploadAsset(actor: Actor, payload: Uint8Array, slot?: string): Promise<string> {
  const qs = slot ? `?slot=${slot}` : "";
  const res = await req(`/api/v1/invitations/${actor.invitationId}/media${qs}`, {
    method: "POST",
    headers: { cookie: actor.cookie, "content-type": "application/octet-stream" },
    body: payload,
  });
  const { asset } = await body<{ asset: { id: string } }>(res);
  return asset.id;
}

let alice: Actor;
let bob: Actor;

beforeEach(async () => {
  await reset();
  alice = await signUp("alice@example.com", "alice-wedding");
  bob = await signUp("bob@example.com", "bob-wedding");
});

// ------------------------------------------------------------------- draft

describe("draft validation", () => {
  test("a valid draft saves", async () => {
    const res = await saveDraft(alice, baseConfig());
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT draft_json AS d FROM invitations WHERE id = ?")
      .bind(alice.invitationId)
      .first<{ d: string }>();
    expect(JSON.parse(row!.d).couple.groom.zh).toBe("李天豪");
  });

  test("unsupported properties are dropped, not published", async () => {
    await saveDraft(alice, baseConfig({ evilKey: "payload", copy: { cover: { welcome: "OK" } } }));

    const row = await env.DB.prepare("SELECT draft_json AS d FROM invitations WHERE id = ?")
      .bind(alice.invitationId)
      .first<{ d: string }>();
    const saved = JSON.parse(row!.d);
    expect(saved.evilKey).toBeUndefined();
    expect(saved.themeId).toBe("cinematic-classic");
  });

  test("text over the frozen theme's limit is rejected with a structured error", async () => {
    const res = await saveDraft(
      alice,
      baseConfig({ copy: { cover: { welcome: "W".repeat(200) } } })
    );
    expect(res.status).toBe(422);

    const data = await body<{ error: string; errors: Array<{ path: string; code: string; limit: number; actual: number }> }>(res);
    expect(data.error).toBe("invalid_config");
    const err = data.errors.find((e) => e.path === "copy.cover.welcome");
    expect(err?.code).toBe("too_long");
    expect(err?.limit).toBe(48);
    expect(err?.actual).toBe(200);
  });

  test("a value exactly at the limit is accepted", async () => {
    const res = await saveDraft(alice, baseConfig({ copy: { cover: { welcome: "W".repeat(48) } } }));
    expect(res.status).toBe(200);
  });

  test("names are bounded", async () => {
    const res = await saveDraft(
      alice,
      baseConfig({
        couple: { groom: { zh: "李".repeat(50) }, bride: { zh: "刘" } },
      })
    );
    expect(res.status).toBe(422);
    const data = await body<{ errors: Array<{ path: string }> }>(res);
    expect(data.errors[0]!.path).toBe("couple.groom.zh");
  });

  test("an invalid date is rejected", async () => {
    for (const iso of ["not-a-date", "2027-13-45T99:00:00+08:00", "2027-10-09", 12345]) {
      const res = await saveDraft(alice, baseConfig({ date: { iso, durationHours: 4 } }));
      expect(res.status).toBe(422);
    }
  });

  test("focal coordinates outside 0-100 are rejected", async () => {
    const assetId = await uploadAsset(alice, jpeg(), "hero");

    for (const focal of [{ x: -5, y: 50 }, { x: 50, y: 140 }, { x: "50", y: 50 }]) {
      const res = await saveDraft(
        alice,
        baseConfig({ media: { hero: { assetId, focal } } })
      );
      expect(res.status).toBe(422);
      const data = await body<{ errors: Array<{ code: string }> }>(res);
      expect(data.errors.some((e) => e.code === "focal_out_of_range" || e.code === "invalid_focal")).toBe(true);
    }
  });

  test("a focal point inside range is accepted and preserved", async () => {
    const assetId = await uploadAsset(alice, jpeg(), "hero");
    const res = await saveDraft(alice, baseConfig({ media: { hero: { assetId, focal: { x: 50, y: 32 } } } }));
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT draft_json AS d FROM invitations WHERE id = ?")
      .bind(alice.invitationId)
      .first<{ d: string }>();
    expect(JSON.parse(row!.d).media.hero.focal).toEqual({ x: 50, y: 32 });
  });

  test("motion outside the theme's range is rejected", async () => {
    expect((await saveDraft(alice, baseConfig({ motion: { driftPxPerSec: 500 } }))).status).toBe(422);
    expect((await saveDraft(alice, baseConfig({ motion: { driftPxPerSec: 1 } }))).status).toBe(422);
    expect((await saveDraft(alice, baseConfig({ motion: { driftPxPerSec: 46 } }))).status).toBe(200);
  });

  test("an unknown media slot is rejected", async () => {
    const res = await saveDraft(alice, baseConfig({ media: { banner: { assetId: null } } }));
    expect(res.status).toBe(422);
    const data = await body<{ errors: Array<{ code: string }> }>(res);
    expect(data.errors.some((e) => e.code === "unknown_slot")).toBe(true);
  });

  test("a javascript: maps URL is rejected", async () => {
    const res = await saveDraft(
      alice,
      baseConfig({ venue: { tba: false, name: "X", mapsUrl: "javascript:alert(1)" } })
    );
    expect(res.status).toBe(422);
  });

  test("too many list items are rejected", async () => {
    const res = await saveDraft(
      alice,
      baseConfig({ copy: { poem: { lines: ["a", "b", "c", "d", "e", "f", "g"] } } })
    );
    expect(res.status).toBe(422);
    const data = await body<{ errors: Array<{ code: string }> }>(res);
    expect(data.errors.some((e) => e.code === "too_many_items")).toBe(true);
  });
});

describe("media reference validation", () => {
  test("a foreign tenant's asset cannot be referenced", async () => {
    const bobAsset = await uploadAsset(bob, jpeg(), "hero");

    const res = await saveDraft(alice, baseConfig({ media: { hero: { assetId: bobAsset } } }));
    expect(res.status).toBe(422);
    const data = await body<{ errors: Array<{ path: string; code: string }> }>(res);
    expect(data.errors[0]!.code).toBe("asset_not_found");
  });

  test("a nonexistent asset cannot be referenced", async () => {
    const res = await saveDraft(
      alice,
      baseConfig({ media: { hero: { assetId: "00000000-0000-4000-8000-000000000000" } } })
    );
    expect(res.status).toBe(422);
  });

  test("an audio asset cannot fill an image slot", async () => {
    const audioId = await uploadAsset(alice, mp3(), "background_music");

    const res = await saveDraft(alice, baseConfig({ media: { hero: { assetId: audioId } } }));
    expect(res.status).toBe(422);
    const data = await body<{ errors: Array<{ code: string }> }>(res);
    expect(data.errors[0]!.code).toBe("asset_kind_mismatch");
  });

  test("an image cannot be used as the soundtrack", async () => {
    const imageId = await uploadAsset(alice, jpeg(), "hero");

    const res = await saveDraft(alice, baseConfig({ music: { assetId: imageId, enabled: true } }));
    expect(res.status).toBe(422);
    const data = await body<{ errors: Array<{ code: string }> }>(res);
    expect(data.errors[0]!.code).toBe("asset_kind_mismatch");
  });

  test("an asset from another invitation in the same tenant is rejected", async () => {
    await env.DB.prepare("UPDATE tenants SET quota_overrides_json = ? WHERE id = ?")
      .bind(JSON.stringify({ maxInvitations: null }), alice.tenantId)
      .run();

    const created = await req(`/api/v1/tenants/${alice.tenantId}/invitations`, {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ title: "Second", slug: "alice-second" }),
    });
    const { invitationId: otherId } = await body<{ invitationId: string }>(created);

    const otherAsset = await uploadAsset({ ...alice, invitationId: otherId }, jpeg(), "hero");

    const res = await saveDraft(alice, baseConfig({ media: { hero: { assetId: otherAsset } } }));
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------- publish

describe("publishing", () => {
  test("publishing an empty draft is refused", async () => {
    const res = await doPublish(alice);
    expect(res.status).toBe(409);
    expect((await body<{ error: string }>(res)).error).toBe("nothing_to_publish");
  });

  test("initial publish creates a revision and flips the pointer atomically", async () => {
    await saveDraft(alice, baseConfig());
    const res = await doPublish(alice, "first");
    expect(res.status).toBe(200);

    const { revisionId } = await body<{ revisionId: string }>(res);

    const row = await env.DB.prepare(
      `SELECT status, published_revision_id AS rev, published_at AS at FROM invitations WHERE id = ?`
    )
      .bind(alice.invitationId)
      .first<{ status: string; rev: string; at: number }>();

    expect(row?.status).toBe("published");
    expect(row?.rev).toBe(revisionId);
    expect(row?.at).toBeGreaterThan(0);
  });

  test("a second publish creates a new revision and leaves the first untouched", async () => {
    await saveDraft(alice, baseConfig());
    const first = await body<{ revisionId: string }>(await doPublish(alice));

    const before = await env.DB.prepare(
      "SELECT config_json AS c, created_at AS t FROM invitation_revisions WHERE id = ?"
    )
      .bind(first.revisionId)
      .first<{ c: string; t: number }>();

    await saveDraft(alice, baseConfig({ copy: { cover: { welcome: "CHANGED" } } }));
    const second = await body<{ revisionId: string }>(await doPublish(alice));

    expect(second.revisionId).not.toBe(first.revisionId);

    // Revision A is immutable.
    const after = await env.DB.prepare(
      "SELECT config_json AS c, created_at AS t FROM invitation_revisions WHERE id = ?"
    )
      .bind(first.revisionId)
      .first<{ c: string; t: number }>();
    expect(after).toEqual(before);

    // ...and the live pointer moved to B.
    const live = await env.DB.prepare(
      "SELECT published_revision_id AS rev FROM invitations WHERE id = ?"
    )
      .bind(alice.invitationId)
      .first<{ rev: string }>();
    expect(live?.rev).toBe(second.revisionId);
  });

  test("uploading a replacement does not change the live invitation", async () => {
    const heroA = await uploadAsset(alice, jpeg(), "hero");
    await saveDraft(alice, baseConfig({ media: { hero: { assetId: heroA } } }));
    await doPublish(alice);

    // Upload Hero B and point the draft at it, without publishing.
    const heroB = await uploadAsset(alice, jpeg(128), "hero");
    await saveDraft(alice, baseConfig({ media: { hero: { assetId: heroB } } }));

    const live = await resolvePublishedInvitation(env, alice.slug);
    // Still Hero A: uploading and re-pointing the draft changed nothing public.
    expect((live!.config.media as any).hero).toEqual({ assetId: heroA });
    expect(live!.mediaUrls.hero).toBe(`/media/${heroA}`);
    expect(live!.assetIds).toEqual([heroA]);

    // Publishing promotes B.
    await doPublish(alice);
    const after = await resolvePublishedInvitation(env, alice.slug);
    expect(after!.mediaUrls.hero).toBe(`/media/${heroB}`);
  });

  test("a draft that became invalid is refused at publish time", async () => {
    const assetId = await uploadAsset(alice, jpeg(), "hero");
    await saveDraft(alice, baseConfig({ media: { hero: { assetId } } }));

    // The asset disappears behind the draft's back.
    await env.DB.prepare("DELETE FROM media_assets WHERE id = ?").bind(assetId).run();

    const res = await doPublish(alice);
    expect(res.status).toBe(422);
    const data = await body<{ errors: Array<{ code: string }> }>(res);
    expect(data.errors[0]!.code).toBe("asset_not_found");
  });

  test("a failed publish batch leaves the previous revision live", async () => {
    await saveDraft(alice, baseConfig());
    const first = await body<{ revisionId: string }>(await doPublish(alice));

    await saveDraft(alice, baseConfig({ copy: { cover: { welcome: "SECOND" } } }));

    const spy = vi.spyOn(env.DB, "batch").mockRejectedValueOnce(new Error("D1 down"));
    const res = await doPublish(alice);
    expect(res.status).toBe(500);
    spy.mockRestore();

    // The pointer never moved, and no orphan revision became live.
    const row = await env.DB.prepare(
      "SELECT published_revision_id AS rev, status FROM invitations WHERE id = ?"
    )
      .bind(alice.invitationId)
      .first<{ rev: string; status: string }>();
    expect(row?.rev).toBe(first.revisionId);
    expect(row?.status).toBe("published");

    const live = await resolvePublishedInvitation(env, alice.slug);
    expect((live!.config as any).copy.cover.welcome).toBe("WELCOME TO OUR WEDDING");
  });

  test("a validation failure writes no revision at all", async () => {
    await saveDraft(alice, baseConfig());
    await doPublish(alice);

    // Corrupt the stored draft directly, bypassing save-time validation.
    await env.DB.prepare("UPDATE invitations SET draft_json = ? WHERE id = ?")
      .bind(JSON.stringify({ date: { iso: "broken" } }), alice.invitationId)
      .run();

    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM invitation_revisions WHERE invitation_id = ?"
    )
      .bind(alice.invitationId)
      .first<{ c: number }>();

    expect((await doPublish(alice)).status).toBe(422);

    const after = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM invitation_revisions WHERE invitation_id = ?"
    )
      .bind(alice.invitationId)
      .first<{ c: number }>();
    expect(after?.c).toBe(before?.c);
  });

  test("the revision manifest lists exactly the referenced assets", async () => {
    const hero = await uploadAsset(alice, jpeg(), "hero");
    const music = await uploadAsset(alice, mp3(), "background_music");
    await uploadAsset(alice, jpeg(200), "story"); // uploaded but unreferenced

    await saveDraft(
      alice,
      baseConfig({ media: { hero: { assetId: hero } }, music: { assetId: music, enabled: true } })
    );
    const { revisionId } = await body<{ revisionId: string }>(await doPublish(alice));

    const row = await env.DB.prepare(
      "SELECT media_manifest_json AS m FROM invitation_revisions WHERE id = ?"
    )
      .bind(revisionId)
      .first<{ m: string }>();

    const manifest = JSON.parse(row!.m) as string[];
    expect(manifest.sort()).toEqual([hero, music].sort());
  });

  test("publishing across a tenant boundary is refused", async () => {
    await saveDraft(bob, baseConfig());
    const res = await req(`/api/v1/invitations/${bob.invitationId}/publish`, {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  test("saving a draft across a tenant boundary is refused", async () => {
    const res = await req(`/api/v1/invitations/${bob.invitationId}/draft`, {
      method: "PUT",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ config: baseConfig() }),
    });
    expect(res.status).toBe(404);
  });
});

describe("unpublish and republish", () => {
  test("unpublishing hides the public invitation but destroys nothing", async () => {
    await saveDraft(alice, baseConfig());
    const { revisionId } = await body<{ revisionId: string }>(await doPublish(alice));

    expect(await resolvePublishedInvitation(env, alice.slug)).not.toBeNull();

    const res = await req(`/api/v1/invitations/${alice.invitationId}/unpublish`, {
      method: "POST",
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(200);

    expect(await resolvePublishedInvitation(env, alice.slug)).toBeNull();

    // Pointer, revision and draft all survive.
    const row = await env.DB.prepare(
      `SELECT published_revision_id AS rev, draft_json AS d, status FROM invitations WHERE id = ?`
    )
      .bind(alice.invitationId)
      .first<{ rev: string; d: string; status: string }>();
    expect(row?.rev).toBe(revisionId);
    expect(row?.d).toBeTruthy();
    expect(row?.status).toBe("unpublished");

    const rev = await env.DB.prepare("SELECT COUNT(*) AS c FROM invitation_revisions WHERE id = ?")
      .bind(revisionId)
      .first<{ c: number }>();
    expect(rev?.c).toBe(1);
  });

  test("republishing mints a NEW revision rather than reactivating the old one", async () => {
    await saveDraft(alice, baseConfig());
    const first = await body<{ revisionId: string }>(await doPublish(alice));

    await req(`/api/v1/invitations/${alice.invitationId}/unpublish`, {
      method: "POST",
      headers: { cookie: alice.cookie },
    });

    // Deliberately unchanged draft: a new revision is still created, so
    // "what is live" always names the moment it was published rather than
    // silently resurrecting state that may predate other edits.
    const second = await body<{ revisionId: string }>(await doPublish(alice));
    expect(second.revisionId).not.toBe(first.revisionId);

    const live = await resolvePublishedInvitation(env, alice.slug);
    expect(live!.revisionId).toBe(second.revisionId);

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM invitation_revisions WHERE invitation_id = ?"
    )
      .bind(alice.invitationId)
      .first<{ c: number }>();
    expect(count?.c).toBe(2);
  });
});

describe("diff", () => {
  test("reports everything changed before the first publish", async () => {
    await saveDraft(alice, baseConfig());
    const data = await body<{ changed: string[]; hasChanges: boolean }>(
      await req(`/api/v1/invitations/${alice.invitationId}/diff`, { headers: { cookie: alice.cookie } })
    );
    expect(data.hasChanges).toBe(true);
    expect(data.changed).toContain("everything");
  });

  test("reports no changes immediately after publishing", async () => {
    await saveDraft(alice, baseConfig());
    await doPublish(alice);

    const data = await body<{ hasChanges: boolean }>(
      await req(`/api/v1/invitations/${alice.invitationId}/diff`, { headers: { cookie: alice.cookie } })
    );
    expect(data.hasChanges).toBe(false);
  });

  test("identifies changed sections and media slots", async () => {
    const heroA = await uploadAsset(alice, jpeg(), "hero");
    await saveDraft(alice, baseConfig({ media: { hero: { assetId: heroA } } }));
    await doPublish(alice);

    const heroB = await uploadAsset(alice, jpeg(128), "hero");
    await saveDraft(
      alice,
      baseConfig({
        media: { hero: { assetId: heroB } },
        venue: { tba: false, name: "Grand Hall" },
      })
    );

    const data = await body<{ changed: string[]; mediaChanged: string[] }>(
      await req(`/api/v1/invitations/${alice.invitationId}/diff`, { headers: { cookie: alice.cookie } })
    );
    expect(data.changed).toContain("venue");
    expect(data.mediaChanged).toContain("hero");
  });
});

// ---------------------------------------------------------------- preview

describe("preview tokens", () => {
  async function mintPreview(actor: Actor): Promise<{ token: string; id: string }> {
    const res = await req(`/api/v1/invitations/${actor.invitationId}/preview`, {
      method: "POST",
      headers: { cookie: actor.cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    return body<{ token: string; id: string }>(res);
  }

  test("only the hash is stored, never the bearer token", async () => {
    await saveDraft(alice, baseConfig());
    const { token } = await mintPreview(alice);

    const row = await env.DB.prepare("SELECT token_hash AS h FROM preview_tokens").first<{ h: string }>();
    expect(row!.h).not.toBe(token);
    expect(row!.h).toHaveLength(64);

    // Listing tokens must not hand them back out.
    const list = await req(`/api/v1/invitations/${alice.invitationId}/preview`, {
      headers: { cookie: alice.cookie },
    });
    expect(await list.text()).not.toContain(token);
  });

  test("a valid token resolves the draft without any account", async () => {
    await saveDraft(alice, baseConfig({ copy: { cover: { welcome: "DRAFT ONLY" } } }));
    const { token } = await mintPreview(alice);

    const resolved = await resolvePreviewInvitation(env, token);
    expect(resolved).not.toBeNull();
    expect(resolved!.isPreview).toBe(true);
    expect((resolved!.config as any).copy.cover.welcome).toBe("DRAFT ONLY");
  });

  test("a tampered or unknown token resolves nothing", async () => {
    await saveDraft(alice, baseConfig());
    const { token } = await mintPreview(alice);

    expect(await resolvePreviewInvitation(env, `${token}x`)).toBeNull();
    expect(await resolvePreviewInvitation(env, "completely-made-up")).toBeNull();
  });

  test("an expired token resolves nothing", async () => {
    await saveDraft(alice, baseConfig());
    const { token } = await mintPreview(alice);

    await env.DB.prepare("UPDATE preview_tokens SET expires_at = 1").run();
    expect(await resolvePreviewInvitation(env, token)).toBeNull();
  });

  test("a revoked token stops working", async () => {
    await saveDraft(alice, baseConfig());
    const { token, id } = await mintPreview(alice);

    const res = await req(`/api/v1/invitations/${alice.invitationId}/preview/${id}`, {
      method: "DELETE",
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(200);
    expect(await resolvePreviewInvitation(env, token)).toBeNull();
  });

  test("a token cannot be issued for another tenant's invitation", async () => {
    const res = await req(`/api/v1/invitations/${bob.invitationId}/preview`, {
      method: "POST",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);

    const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM preview_tokens").first<{ c: number }>();
    expect(count?.c).toBe(0);
  });

  test("a token cannot be revoked across the tenant boundary", async () => {
    await saveDraft(bob, baseConfig());
    const bobToken = await mintPreview(bob);

    const res = await req(`/api/v1/invitations/${alice.invitationId}/preview/${bobToken.id}`, {
      method: "DELETE",
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(404);
    expect(await resolvePreviewInvitation(env, bobToken.token)).not.toBeNull();
  });

  test("a preview bearer cannot reach tenant or platform APIs", async () => {
    await saveDraft(alice, baseConfig());
    const { token } = await mintPreview(alice);

    // The token is not a session; presenting it anywhere else is inert.
    for (const path of [
      `/api/v1/invitations/${alice.invitationId}`,
      `/api/v1/tenants/${alice.tenantId}`,
      `/api/v1/invitations/${alice.invitationId}/draft`,
      "/api/v1/platform/overview",
    ]) {
      const res = await req(`${path}?preview=${token}`);
      expect([401, 404, 501]).toContain(res.status);
      expect(res.status).not.toBe(200);
    }
  });
});

describe("preview media authorization", () => {
  async function mintPreview(actor: Actor): Promise<string> {
    const res = await req(`/api/v1/invitations/${actor.invitationId}/preview`, {
      method: "POST",
      headers: { cookie: actor.cookie },
      body: JSON.stringify({}),
    });
    return (await body<{ token: string }>(res)).token;
  }

  test("a preview reaches the draft assets it references", async () => {
    const hero = await uploadAsset(alice, jpeg(), "hero");
    await saveDraft(alice, baseConfig({ media: { hero: { assetId: hero } } }));
    const token = await mintPreview(alice);

    expect((await SELF.fetch(`${ORIGIN}/media/${hero}?preview=${token}`)).status).toBe(200);
    // ...and the same asset stays private without the token.
    expect((await SELF.fetch(`${ORIGIN}/media/${hero}`)).status).toBe(404);
  });

  test("a preview cannot reach an unreferenced asset of the same invitation", async () => {
    const hero = await uploadAsset(alice, jpeg(), "hero");
    const unused = await uploadAsset(alice, jpeg(128), "story");
    await saveDraft(alice, baseConfig({ media: { hero: { assetId: hero } } }));
    const token = await mintPreview(alice);

    // Holding a token is not blanket access to everything ever uploaded.
    expect((await SELF.fetch(`${ORIGIN}/media/${unused}?preview=${token}`)).status).toBe(404);
  });

  test("a preview token cannot reach another invitation's assets", async () => {
    const aliceHero = await uploadAsset(alice, jpeg(), "hero");
    await saveDraft(alice, baseConfig({ media: { hero: { assetId: aliceHero } } }));
    const token = await mintPreview(alice);

    const bobHero = await uploadAsset(bob, jpeg(), "hero");
    await saveDraft(bob, baseConfig({ media: { hero: { assetId: bobHero } } }));

    expect((await SELF.fetch(`${ORIGIN}/media/${bobHero}?preview=${token}`)).status).toBe(404);
  });

  test("a revoked token loses media access", async () => {
    const hero = await uploadAsset(alice, jpeg(), "hero");
    await saveDraft(alice, baseConfig({ media: { hero: { assetId: hero } } }));
    const token = await mintPreview(alice);

    expect((await SELF.fetch(`${ORIGIN}/media/${hero}?preview=${token}`)).status).toBe(200);

    await env.DB.prepare("DELETE FROM preview_tokens").run();
    expect((await SELF.fetch(`${ORIGIN}/media/${hero}?preview=${token}`)).status).toBe(404);
  });
});

describe("historical asset protection", () => {
  test("an asset in the live revision cannot be deleted", async () => {
    const hero = await uploadAsset(alice, jpeg(), "hero");
    await saveDraft(alice, baseConfig({ media: { hero: { assetId: hero } } }));
    await doPublish(alice);

    const res = await req(`/api/v1/invitations/${alice.invitationId}/media/${hero}`, {
      method: "DELETE",
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(409);
  });

  test("an asset in a superseded revision stays protected", async () => {
    const heroA = await uploadAsset(alice, jpeg(), "hero");
    await saveDraft(alice, baseConfig({ media: { hero: { assetId: heroA } } }));
    await doPublish(alice);

    const heroB = await uploadAsset(alice, jpeg(128), "hero");
    await saveDraft(alice, baseConfig({ media: { hero: { assetId: heroB } } }));
    await doPublish(alice);

    // Hero A is no longer live, but revision 1 still needs it to be
    // reproducible, so tenant-side deletion must refuse.
    const res = await req(`/api/v1/invitations/${alice.invitationId}/media/${heroA}`, {
      method: "DELETE",
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(409);

    const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM media_assets WHERE id = ?")
      .bind(heroA)
      .first<{ c: number }>();
    expect(row?.c).toBe(1);
  });

  test("an asset that was never published can still be deleted", async () => {
    const unused = await uploadAsset(alice, jpeg(), "story");
    await saveDraft(alice, baseConfig());
    await doPublish(alice);

    const res = await req(`/api/v1/invitations/${alice.invitationId}/media/${unused}`, {
      method: "DELETE",
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(200);
  });
});

// -------------------------------------------------------- public resolver

describe("public resolution", () => {
  test("an unpublished invitation resolves to nothing", async () => {
    await saveDraft(alice, baseConfig());
    expect(await resolvePublishedInvitation(env, alice.slug)).toBeNull();
  });

  test("resolution returns one coherent revision with pre-resolved media URLs", async () => {
    const hero = await uploadAsset(alice, jpeg(), "hero");
    const music = await uploadAsset(alice, mp3(), "background_music");
    await saveDraft(
      alice,
      baseConfig({ media: { hero: { assetId: hero } }, music: { assetId: music, enabled: true } })
    );
    const { revisionId } = await body<{ revisionId: string }>(await doPublish(alice));

    const resolved = await resolvePublishedInvitation(env, alice.slug);
    expect(resolved!.revisionId).toBe(revisionId);
    expect(resolved!.themeId).toBe("cinematic-classic");
    expect(resolved!.mediaUrls.hero).toBe(`/media/${hero}`);
    expect(resolved!.mediaUrls.background_music).toBe(`/media/${music}`);
    expect(resolved!.assetIds.sort()).toEqual([hero, music].sort());
  });

  test("a slot referencing an unmanifested asset yields no URL", async () => {
    const hero = await uploadAsset(alice, jpeg(), "hero");
    await saveDraft(alice, baseConfig({ media: { hero: { assetId: hero } } }));
    const { revisionId } = await body<{ revisionId: string }>(await doPublish(alice));

    // Strip the manifest, leaving the config pointing at an asset the
    // revision no longer authorizes.
    await env.DB.prepare("UPDATE invitation_revisions SET media_manifest_json = '[]' WHERE id = ?")
      .bind(revisionId)
      .run();

    const resolved = await resolvePublishedInvitation(env, alice.slug);
    expect(resolved!.mediaUrls.hero).toBeUndefined();
  });

  test("resolution costs a single indexed query", async () => {
    await saveDraft(alice, baseConfig());
    await doPublish(alice);

    const spy = vi.spyOn(env.DB, "prepare");
    await resolvePublishedInvitation(env, alice.slug);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  test("the published revision ID is the cache identity and changes on publish", async () => {
    await saveDraft(alice, baseConfig());
    await doPublish(alice);
    const first = await resolvePublishedInvitation(env, alice.slug);

    await saveDraft(alice, baseConfig({ copy: { cover: { welcome: "NEW" } } }));
    await doPublish(alice);
    const second = await resolvePublishedInvitation(env, alice.slug);

    expect(second!.revisionId).not.toBe(first!.revisionId);
  });
});

describe("theme schema unit behaviour", () => {
  test("a config missing required date fails", () => {
    const result = validateConfig({ couple: {} });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "date.iso")).toBe(true);
  });

  test("validation stamps the theme id and version for reproducibility", () => {
    const result = validateConfig(baseConfig());
    expect(result.ok).toBe(true);
    expect(result.config!.themeId).toBe("cinematic-classic");
    expect(result.config!.themeVersion).toBe(1);
  });

  test("newlines are rejected in single-line fields", () => {
    const result = validateConfig(baseConfig({ copy: { cover: { welcome: "A\nB" } } }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "no_newlines")).toBe(true);
  });

  test("multiline fields accept newlines", () => {
    const result = validateConfig(
      baseConfig({ copy: { story: { heading: "一场崭新的旅程\n即将开启" } } })
    );
    expect(result.ok).toBe(true);
  });
});
