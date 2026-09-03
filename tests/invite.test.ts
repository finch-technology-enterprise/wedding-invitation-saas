/**
 * WS6 — public invitation route.
 *
 * Proves the real Worker path end to end: a published revision renders
 * the cinematic theme shell with inline bootstrap, media resolves through
 * R2, and nothing draft or admin leaks into a guest's page.
 *
 * This is the R2 *functional* fixture. The frozen visual fixture lives in
 * tests/e2e and deliberately supplies no media, because the accepted
 * baseline had none — introducing imagery there would change the pixels.
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

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    couple: {
      groom: { zh: "李天豪", en: "LEE THEAN HOW" },
      bride: { zh: "刘蔼蕴", en: "LAW HAI YEUN" },
    },
    date: { iso: "2027-10-09T11:00:00+08:00", lunar: "农历九月初十", timeLabel: "11:00", durationHours: 4 },
    copy: { cover: { bracket: "【婚礼邀请函】", welcome: "WELCOME TO OUR WEDDING" } },
    venue: { tba: true },
    rsvp: { deadlineISO: "2027-09-30T23:59:59+08:00", maxGuests: 12 },
    media: {},
    music: { assetId: null, enabled: false },
    motion: { driftPxPerSec: 46 },
    ...overrides,
  };
}

async function reset(): Promise<void> {
  for (const sql of [
    // Publishing materializes the RSVP form, so these must go first:
    // RESTRICT foreign keys make the order explicit rather than implied.
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
  // These suites test tenancy, not the verification gate: mark the
  // account verified as a completed verification would. Verification
  // itself is covered in tests/auth.test.ts.
  await env.DB.prepare("UPDATE users SET email_verified = 1 WHERE email = ?").bind(email).run();

  const session = await req("/api/v1/auth/session", { headers: { cookie } });
  const { tenants } = await body<{ tenants: Array<{ id: string }> }>(session);
  const tenantId = tenants[0]!.id;

  const created = await req(`/api/v1/tenants/${tenantId}/invitations`, {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ title: `Invite ${slug}`, slug }),
  });
  const { invitationId } = await body<{ invitationId: string }>(created);
  return { cookie, tenantId, invitationId, slug };
}

async function uploadAsset(actor: Actor, payload: Uint8Array, slot: string): Promise<string> {
  const res = await req(`/api/v1/invitations/${actor.invitationId}/media?slot=${slot}`, {
    method: "POST",
    headers: { cookie: actor.cookie, "content-type": "application/octet-stream" },
    body: payload,
  });
  const { asset } = await body<{ asset: { id: string } }>(res);
  return asset.id;
}

async function publishConfig(actor: Actor, config: Record<string, unknown>): Promise<string> {
  const save = await req(`/api/v1/invitations/${actor.invitationId}/draft`, {
    method: "PUT",
    headers: { cookie: actor.cookie },
    body: JSON.stringify({ config }),
  });
  expect(save.status).toBe(200);

  const res = await req(`/api/v1/invitations/${actor.invitationId}/publish`, {
    method: "POST",
    headers: { cookie: actor.cookie },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(200);
  return (await body<{ revisionId: string }>(res)).revisionId;
}

/** Parse the inlined bootstrap out of the rendered shell. */
function readBootstrap(html: string): Record<string, any> {
  const match = html.match(/window\.__INVITATION__=(\{.*?\})<\/script>/s);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!);
}

let alice: Actor;

beforeEach(async () => {
  await reset();
  alice = await signUp("alice@example.com", "alice-wedding");
});

describe("GET /i/{slug}", () => {
  test("an unpublished invitation is not found", async () => {
    const res = await SELF.fetch(`${ORIGIN}/i/${alice.slug}`);
    expect(res.status).toBe(404);
  });

  test("an unknown or malformed slug is not found", async () => {
    for (const slug of ["nope", "../../etc/passwd", "A_B", ""]) {
      const res = await SELF.fetch(`${ORIGIN}/i/${slug}`);
      expect(res.status).toBe(404);
    }
  });

  test("a published invitation renders the theme shell with inline bootstrap", async () => {
    const revisionId = await publishConfig(alice, baseConfig());

    const res = await SELF.fetch(`${ORIGIN}/i/${alice.slug}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain('id="stage"');
    expect(html).toContain("/themes/cinematic-classic/js/main.js");

    const bootstrap = readBootstrap(html);
    expect(bootstrap.slug).toBe(alice.slug);
    expect(bootstrap.revisionId).toBe(revisionId);
    expect(bootstrap.config.couple.groom.zh).toBe("李天豪");
  });

  test("the guest page makes no configuration request of its own", async () => {
    await publishConfig(alice, baseConfig());
    const html = await (await SELF.fetch(`${ORIGIN}/i/${alice.slug}`)).text();

    // Config is inline, so there is no second round trip before render.
    expect(html).toContain("window.__INVITATION__=");
    expect(html).not.toMatch(/fetch\(["'`]\/api\/v1/);
  });

  test("no admin or platform-admin bundle is referenced", async () => {
    await publishConfig(alice, baseConfig());
    const html = await (await SELF.fetch(`${ORIGIN}/i/${alice.slug}`)).text();

    for (const forbidden of ["/admin", "platform-admin", "react", "auth-client"]) {
      expect(html.toLowerCase()).not.toContain(forbidden);
    }

    // Exactly one module entry point, and it belongs to the theme.
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]!);
    expect(scripts).toEqual(["/themes/cinematic-classic/js/main.js"]);
  });

  test("nothing internal leaks into the bootstrap", async () => {
    await publishConfig(alice, baseConfig());
    const html = await (await SELF.fetch(`${ORIGIN}/i/${alice.slug}`)).text();

    expect(html).not.toContain(alice.tenantId);
    expect(html).not.toContain(alice.invitationId);
    expect(html).not.toContain("password");
  });

  test("the revision id is the cache validator and answers conditional requests", async () => {
    const revisionId = await publishConfig(alice, baseConfig());

    const first = await SELF.fetch(`${ORIGIN}/i/${alice.slug}`);
    expect(first.headers.get("etag")).toBe(`"${revisionId}"`);

    const second = await SELF.fetch(`${ORIGIN}/i/${alice.slug}`, {
      headers: { "if-none-match": `"${revisionId}"` },
    });
    expect(second.status).toBe(304);
  });

  test("publishing changes the validator, so guests get the new version", async () => {
    const first = await publishConfig(alice, baseConfig());
    const second = await publishConfig(
      alice,
      baseConfig({ copy: { cover: { welcome: "NEW COPY" } } })
    );
    expect(second).not.toBe(first);

    // The old validator no longer matches: no manual invalidation needed.
    const res = await SELF.fetch(`${ORIGIN}/i/${alice.slug}`, {
      headers: { "if-none-match": `"${first}"` },
    });
    expect(res.status).toBe(200);
    expect(readBootstrap(await res.text()).config.copy.cover.welcome).toBe("NEW COPY");
  });

  test("unpublishing removes the public page", async () => {
    await publishConfig(alice, baseConfig());
    expect((await SELF.fetch(`${ORIGIN}/i/${alice.slug}`)).status).toBe(200);

    await req(`/api/v1/invitations/${alice.invitationId}/unpublish`, {
      method: "POST",
      headers: { cookie: alice.cookie },
    });
    expect((await SELF.fetch(`${ORIGIN}/i/${alice.slug}`)).status).toBe(404);
  });

  test("a cold render costs one D1 query", async () => {
    await publishConfig(alice, baseConfig());

    const spy = vi.spyOn(env.DB, "prepare");
    await SELF.fetch(`${ORIGIN}/i/${alice.slug}`);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  test("bootstrap JSON cannot break out of the script element", async () => {
    await publishConfig(
      alice,
      baseConfig({ copy: { cover: { welcome: "</script><script>x" } } })
    );

    const html = await (await SELF.fetch(`${ORIGIN}/i/${alice.slug}`)).text();
    // The injected payload must not contain a literal closing tag.
    const payload = html.slice(html.indexOf("window.__INVITATION__="));
    expect(payload.slice(0, payload.indexOf("</script>"))).not.toContain("<script>");
    expect(html).toContain("\\u003c/script");
  });
});

describe("R2-backed media through the public route", () => {
  test("published media resolves to immutable URLs the guest can fetch", async () => {
    const hero = await uploadAsset(alice, jpeg(), "hero");
    const music = await uploadAsset(alice, mp3(), "background_music");

    await publishConfig(
      alice,
      baseConfig({
        media: { hero: { assetId: hero, focal: { x: 50, y: 32 } } },
        music: { assetId: music, enabled: true },
      })
    );

    const html = await (await SELF.fetch(`${ORIGIN}/i/${alice.slug}`)).text();
    const bootstrap = readBootstrap(html);

    expect(bootstrap.mediaUrls.hero).toBe(`/media/${hero}`);
    expect(bootstrap.mediaUrls.background_music).toBe(`/media/${music}`);
    expect(bootstrap.config.media.hero.focal).toEqual({ x: 50, y: 32 });

    // And those URLs actually serve, to an anonymous guest.
    const image = await SELF.fetch(`${ORIGIN}${bootstrap.mediaUrls.hero}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/jpeg");
    expect(image.headers.get("cache-control")).toContain("immutable");

    const audio = await SELF.fetch(`${ORIGIN}${bootstrap.mediaUrls.background_music}`);
    expect(audio.status).toBe(200);
    expect(audio.headers.get("content-type")).toBe("audio/mpeg");
  });

  test("an unsupplied slot yields no URL, reproducing the placeholder", async () => {
    await publishConfig(alice, baseConfig());

    const bootstrap = readBootstrap(await (await SELF.fetch(`${ORIGIN}/i/${alice.slug}`)).text());
    expect(bootstrap.mediaUrls).toEqual({});
  });

  test("a draft-only asset is not reachable from the published page", async () => {
    const published = await uploadAsset(alice, jpeg(), "hero");
    await publishConfig(alice, baseConfig({ media: { hero: { assetId: published } } }));

    // Upload a replacement and leave it in the draft.
    const draftOnly = await uploadAsset(alice, jpeg(128), "hero");
    await req(`/api/v1/invitations/${alice.invitationId}/draft`, {
      method: "PUT",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ config: baseConfig({ media: { hero: { assetId: draftOnly } } }) }),
    });

    const bootstrap = readBootstrap(await (await SELF.fetch(`${ORIGIN}/i/${alice.slug}`)).text());
    expect(bootstrap.mediaUrls.hero).toBe(`/media/${published}`);

    expect((await SELF.fetch(`${ORIGIN}/media/${draftOnly}`)).status).toBe(404);
  });
});

describe("GET /preview/{token}", () => {
  async function mintPreview(actor: Actor): Promise<string> {
    const res = await req(`/api/v1/invitations/${actor.invitationId}/preview`, {
      method: "POST",
      headers: { cookie: actor.cookie },
      body: JSON.stringify({}),
    });
    return (await body<{ token: string }>(res)).token;
  }

  test("a preview renders the draft for someone with no account", async () => {
    await req(`/api/v1/invitations/${alice.invitationId}/draft`, {
      method: "PUT",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ config: baseConfig({ copy: { cover: { welcome: "UNPUBLISHED" } } }) }),
    });
    const token = await mintPreview(alice);

    // No cookie: this is the partner opening a shared link.
    const res = await SELF.fetch(`${ORIGIN}/preview/${token}`);
    expect(res.status).toBe(200);

    const bootstrap = readBootstrap(await res.text());
    expect(bootstrap.isPreview).toBe(true);
    expect(bootstrap.config.copy.cover.welcome).toBe("UNPUBLISHED");
  });

  test("a preview is noindex and never cached", async () => {
    await req(`/api/v1/invitations/${alice.invitationId}/draft`, {
      method: "PUT",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ config: baseConfig() }),
    });
    const token = await mintPreview(alice);

    const res = await SELF.fetch(`${ORIGIN}/preview/${token}`);
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  test("an invalid, tampered or expired token is not found", async () => {
    await req(`/api/v1/invitations/${alice.invitationId}/draft`, {
      method: "PUT",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ config: baseConfig() }),
    });
    const token = await mintPreview(alice);

    expect((await SELF.fetch(`${ORIGIN}/preview/${token}x`)).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/preview/nonsense`)).status).toBe(404);

    await env.DB.prepare("UPDATE preview_tokens SET expires_at = 1").run();
    expect((await SELF.fetch(`${ORIGIN}/preview/${token}`)).status).toBe(404);
  });
});
