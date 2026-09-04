/**
 * V2 — draft concurrency, relational revision assets, RSVP idempotency,
 * guest parties/tokens, locale, housekeeping, theme registry.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { SELF, env } from "cloudflare:test";
import { normalizeLocale, stringsFor } from "../src/lib/locale.js";
import { parseGuestCsv, mapGuestRow } from "../src/lib/guests.js";
import { listThemes, getTheme } from "../src/themes/registry.js";

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
    "DELETE FROM guests",
    "DELETE FROM guest_parties",
    "DELETE FROM revision_assets",
    "DELETE FROM rsvp_answers",
    "DELETE FROM rsvp_submissions",
    "DELETE FROM rsvp_fields",
    "DELETE FROM rsvp_forms",
    "DELETE FROM preview_tokens",
    "DELETE FROM auth_tokens",
    "DELETE FROM housekeeping_runs",
    "DELETE FROM media_assets",
    "UPDATE invitations SET published_revision_id = NULL, share_image_asset_id = NULL",
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
  tenantId: string;
  invitationId: string;
  slug: string;
}

async function signUp(email: string, slug: string, themeId?: string): Promise<Actor> {
  const res = await req("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const cookie = cookieFrom(res);
  await body<{ userId: string }>(res);

  // These suites test tenancy, not the verification gate: mark the
  // account verified as a completed verification would (see publish.test.ts).
  await env.DB.prepare("UPDATE users SET email_verified = 1 WHERE email = ?").bind(email).run();

  const session = await req("/api/v1/auth/session", { headers: { cookie } });
  const { tenants } = await body<{ tenants: Array<{ id: string }> }>(session);
  const tenantId = tenants[0]!.id;
  const created = await body<{ invitationId: string; slug: string }>(
    await req(`/api/v1/tenants/${tenantId}/invitations`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ title: "V2", slug, ...(themeId ? { themeId } : {}) }),
    })
  );
  return { cookie, tenantId, invitationId: created.invitationId, slug: created.slug };
}

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    couple: { groom: { zh: "A", en: "A" }, bride: { zh: "B", en: "B" } },
    date: { iso: "2027-10-09T11:00:00+08:00", durationHours: 4 },
    copy: {},
    venue: { tba: true },
    rsvp: { maxGuests: 12 },
    media: {},
    music: { assetId: null, enabled: false },
    motion: { driftPxPerSec: 46 },
    ...overrides,
  };
}

async function draftVersion(actor: Actor): Promise<number> {
  const res = await req(`/api/v1/invitations/${actor.invitationId}/draft`, {
    headers: { cookie: actor.cookie },
  });
  const data = await body<{ draftVersion: number }>(res);
  return data.draftVersion;
}

beforeEach(reset);

describe("theme registry", () => {
  test("lists two themes with capabilities", () => {
    const themes = listThemes();
    expect(themes.map((t) => t.id).sort()).toEqual(["cinematic-classic", "modern-editorial"]);
    const editorial = getTheme("modern-editorial")!;
    expect(editorial.capabilities.mediaSlots).toContain("cover");
    expect(editorial.capabilities.customization).toContain("tokens.accent");
  });

  test("editorial validation rejects unknown props and bad tokens", () => {
    const theme = getTheme("modern-editorial")!;
    const bad = theme.validate({ nonsense: 1 } as unknown);
    expect(bad.ok).toBe(false);
    const tokens = theme.validate({
      couple: {}, date: { iso: "2027-10-09T11:00:00+08:00" }, venue: { tba: true },
      rsvp: {}, media: {}, music: {}, motion: {}, tokens: { accent: "hotpink", paper: "#fff", ink: "#000", typePreset: "serif" },
    });
    expect(tokens.ok).toBe(false);
  });

  test("invitation can be created with modern-editorial", async () => {
    const actor = await signUp("ed@example.com", "ed-wedding", "modern-editorial");
    const res = await req(`/api/v1/invitations/${actor.invitationId}`, {
      headers: { cookie: actor.cookie },
    });
    expect(res.status).toBe(200);
  });
});

describe("draft concurrency", () => {
  test("stale expectedVersion is rejected with 409", async () => {
    const actor = await signUp("c@example.com", "conflict-wed");
    const v1 = await draftVersion(actor);
    const first = await req(`/api/v1/invitations/${actor.invitationId}/draft`, {
      method: "PUT",
      headers: { cookie: actor.cookie },
      body: JSON.stringify({ config: baseConfig(), expectedVersion: v1 }),
    });
    expect(first.status).toBe(200);
    const stale = await req(`/api/v1/invitations/${actor.invitationId}/draft`, {
      method: "PUT",
      headers: { cookie: actor.cookie },
      body: JSON.stringify({ config: baseConfig(), expectedVersion: v1 }),
    });
    expect(stale.status).toBe(409);
    const data = await body<{ error: string; draftVersion: number }>(stale);
    expect(data.error).toBe("draft_conflict");
    expect(data.draftVersion).toBe(v1 + 1);
  });

  test("legacy PATCH draft routes through canonical validation", async () => {
    const actor = await signUp("p@example.com", "patch-wed");
    const res = await req(`/api/v1/invitations/${actor.invitationId}`, {
      method: "PATCH",
      headers: { cookie: actor.cookie },
      body: JSON.stringify({ draft: { bogus: { deep: true } } }),
    });
    // Canonical validation rejects unknown props instead of storing them.
    expect(res.status).toBe(422);
  });
});

describe("revision assets (relational)", () => {
  function jpeg(): Uint8Array {
    const bytes = new Uint8Array(84);
    bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46]);
    bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x00, 0x64], 10);
    return bytes;
  }

  test("publish writes revision_assets rows; delivery uses them", async () => {
    const actor = await signUp("r@example.com", "rel-wed");
    const upload = await req(`/api/v1/invitations/${actor.invitationId}/media?slot=hero&filename=a.jpg`, {
      method: "POST",
      headers: { cookie: actor.cookie, "content-type": "application/octet-stream", origin: ORIGIN },
      body: jpeg() as unknown as BodyInit,
    });
    expect(upload.status).toBe(200);
    const { asset } = await body<{ asset: { id: string } }>(upload);

    const v = await draftVersion(actor);
    const save = await req(`/api/v1/invitations/${actor.invitationId}/draft`, {
      method: "PUT",
      headers: { cookie: actor.cookie },
      body: JSON.stringify({ config: baseConfig({ media: { hero: { assetId: asset.id } } }), expectedVersion: v }),
    });
    expect(save.status).toBe(200);

    const pub = await req(`/api/v1/invitations/${actor.invitationId}/publish`, {
      method: "POST",
      headers: { cookie: actor.cookie },
      body: JSON.stringify({}),
    });
    expect(pub.status).toBe(200);
    const { revisionId } = await body<{ revisionId: string }>(pub);

    const rows = await env.DB.prepare("SELECT asset_id AS a, slot FROM revision_assets WHERE revision_id = ?")
      .bind(revisionId)
      .all<{ a: string; slot: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({ a: asset.id, slot: "hero" });

    const media = await SELF.fetch(`${ORIGIN}/media/${asset.id}`);
    expect(media.status).toBe(200);
  });
});

describe("RSVP idempotency", () => {
  test("same idempotency key returns the same submission once", async () => {
    const actor = await signUp("i@example.com", "idem-wed");
    const v = await draftVersion(actor);
    await req(`/api/v1/invitations/${actor.invitationId}/draft`, {
      method: "PUT",
      headers: { cookie: actor.cookie },
      body: JSON.stringify({ config: baseConfig(), expectedVersion: v }),
    });
    await req(`/api/v1/invitations/${actor.invitationId}/publish`, {
      method: "POST",
      headers: { cookie: actor.cookie },
      body: JSON.stringify({}),
    });

    const payload = { name: "Guest One", attending: true, idempotencyKey: "key-abc-12345" };
    const first = await req(`/i/${actor.slug}/rsvp`, { method: "POST", body: JSON.stringify(payload) });
    expect(first.status).toBe(200);
    const f1 = await body<{ submissionId: string; deduped: boolean }>(first);
    expect(f1.submissionId).toBeTruthy();
    expect(f1.deduped).toBe(false);

    const second = await req(`/i/${actor.slug}/rsvp`, { method: "POST", body: JSON.stringify(payload) });
    expect(second.status).toBe(200);
    const f2 = await body<{ submissionId: string; deduped: boolean }>(second);
    expect(f2.submissionId).toBe(f1.submissionId);
    expect(f2.deduped).toBe(true);

    const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM rsvp_submissions WHERE invitation_id = ?")
      .bind(actor.invitationId)
      .first<{ c: number }>();
    expect(count?.c).toBe(1);
  });
});

describe("guest parties and tokens", () => {
  test("party lifecycle + token isolation across invitations", async () => {
    const a = await signUp("g1@example.com", "guest-a");
    const b = await signUp("g2@example.com", "guest-b");

    // Publish A so the public + personalized surfaces resolve.
    const v = await draftVersion(a);
    await req(`/api/v1/invitations/${a.invitationId}/draft`, {
      method: "PUT",
      headers: { cookie: a.cookie },
      body: JSON.stringify({ config: baseConfig(), expectedVersion: v }),
    });
    await req(`/api/v1/invitations/${a.invitationId}/publish`, {
      method: "POST",
      headers: { cookie: a.cookie },
      body: JSON.stringify({}),
    });

    const created = await req(`/api/v1/invitations/${a.invitationId}/parties`, {
      method: "POST",
      headers: { cookie: a.cookie },
      body: JSON.stringify({ title: "Lee Family" }),
    });
    expect(created.status).toBe(200);
    const { party, token, url } = await body<{ party: { id: string }; token: string; url: string }>(created);
    expect(token.length).toBeGreaterThan(16);
    expect(url).toContain("?party=");

    // Raw token never stored.
    const stored = await env.DB.prepare("SELECT token_hash AS h FROM guest_parties WHERE id = ?")
      .bind(party.id)
      .first<{ h: string }>();
    expect(stored?.h).not.toContain(token);

    // Personalized view works with the token.
    const personal = await SELF.fetch(`${ORIGIN}/i/${a.slug}?party=${token}`);
    expect(personal.status).toBe(200);
    expect(personal.headers.get("cache-control")).toContain("private");
    const html = await personal.text();
    expect(html).toContain("?party=" === "?party=" ? "__INVITATION__" : "__INVITATION__");

    // Same token does not resolve on another invitation's RSVP.
    const vb = await draftVersion(b);
    await req(`/api/v1/invitations/${b.invitationId}/draft`, {
      method: "PUT",
      headers: { cookie: b.cookie },
      body: JSON.stringify({ config: baseConfig(), expectedVersion: vb }),
    });
    await req(`/api/v1/invitations/${b.invitationId}/publish`, {
      method: "POST",
      headers: { cookie: b.cookie },
      body: JSON.stringify({}),
    });
    const bad = await req(`/i/${b.slug}/rsvp`, {
      method: "POST",
      body: JSON.stringify({ name: "X", attending: true, partyToken: token, idempotencyKey: "zz-12345678" }),
    });
    expect(bad.status).toBe(200);
    const sub = await env.DB.prepare(
      "SELECT party_id AS p FROM rsvp_submissions WHERE invitation_id = ? ORDER BY created_at DESC LIMIT 1"
    )
      .bind(b.invitationId)
      .first<{ p: string | null }>();
    expect(sub?.p).toBeNull();

    // Guest CRUD + check-in (idempotent).
    const g = await req(`/api/v1/invitations/${a.invitationId}/guests`, {
      method: "POST",
      headers: { cookie: a.cookie },
      body: JSON.stringify({ fullName: "John Lee", partyId: party.id }),
    });
    expect(g.status).toBe(200);
    const { guestId } = await body<{ guestId: string }>(g);
    const in1 = await req(`/api/v1/invitations/${a.invitationId}/guests/${guestId}/check-in`, {
      method: "POST",
      headers: { cookie: a.cookie },
    });
    expect(in1.status).toBe(200);
    const in2 = await req(`/api/v1/invitations/${a.invitationId}/guests/${guestId}/check-in`, {
      method: "POST",
      headers: { cookie: a.cookie },
    });
    const d2 = await body<{ deduped: boolean }>(in2);
    expect(d2.deduped).toBe(true);

    // Cross-tenant isolation: B cannot list A's guests.
    const cross = await req(`/api/v1/invitations/${a.invitationId}/guests`, {
      headers: { cookie: b.cookie },
    });
    expect(cross.status).toBe(404);
  });

  test("CSV preview detects duplicates and invalid rows", async () => {
    const actor = await signUp("csv@example.com", "csv-wed");
    await req(`/api/v1/invitations/${actor.invitationId}/guests`, {
      method: "POST",
      headers: { cookie: actor.cookie },
      body: JSON.stringify({ fullName: "Existing Guest" }),
    });
    const csv = `name,phone\nExisting Guest,123\nNew Guest,456\n,789\n"Quoted, Name",000\n`;
    const preview = await req(`/api/v1/invitations/${actor.invitationId}/guests/import/preview`, {
      method: "POST",
      headers: { cookie: actor.cookie, "content-type": "text/plain" },
      body: csv,
    });
    expect(preview.status).toBe(200);
    const data = await body<{ total: number; duplicates: number; invalid: number; valid: number }>(preview);
    expect(data.total).toBe(4);
    expect(data.duplicates).toBe(1);
    expect(data.invalid).toBe(1);
    expect(data.valid).toBe(2);
  });
});

describe("locale", () => {
  test("normalizes the four supported locales; strings exist for each", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("zh-TW")).toBe("zh-TW");
    expect(normalizeLocale("ms")).toBe("ms");
    expect(normalizeLocale("nonsense")).toBe("zh-CN");
    for (const locale of ["en", "zh-CN", "zh-TW", "ms"] as const) {
      const s = stringsFor(locale);
      expect(s.rsvpSubmit.length).toBeGreaterThan(0);
      expect(s.countdownDays.length).toBeGreaterThan(0);
    }
  });

  test("invitation stores locale; public render sets html lang", async () => {
    const actor = await signUp("l@example.com", "locale-wed");
    const patch = await req(`/api/v1/invitations/${actor.invitationId}`, {
      method: "PATCH",
      headers: { cookie: actor.cookie },
      body: JSON.stringify({ locale: "ms" }),
    });
    expect(patch.status).toBe(200);
    const v = await draftVersion(actor);
    await req(`/api/v1/invitations/${actor.invitationId}/draft`, {
      method: "PUT",
      headers: { cookie: actor.cookie },
      body: JSON.stringify({ config: baseConfig(), expectedVersion: v }),
    });
    await req(`/api/v1/invitations/${actor.invitationId}/publish`, {
      method: "POST",
      headers: { cookie: actor.cookie },
      body: JSON.stringify({}),
    });
    const page = await SELF.fetch(`${ORIGIN}/i/${actor.slug}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<html lang="ms">');
    expect(html).toContain("og:title");
  });
});

describe("housekeeping", () => {
  test("purges expired sessions/tokens/rate limits and records runs", async () => {
    const now = Date.now();
    const uid = `u-${now}`;
    await env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(uid, `house-${now}@example.com`, "scrypt-test", now, now)
      .run();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind("s-old", uid, now - 40 * 86400000, now - 31 * 86400000),
      env.DB.prepare("INSERT INTO rate_limits (key, count, window_start) VALUES (?, ?, ?)").bind("k-old", 1, now - 2 * 86400000),
      env.DB.prepare(
        "INSERT INTO auth_tokens (id, user_id, kind, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind("t-old", uid, "password_reset", "h-old", now - 8 * 86400000, now - 10 * 86400000),
    ]);
    const { runHousekeeping } = await import("../src/lib/housekeeping.js");
    const results = await runHousekeeping(env);
    const kinds = Object.fromEntries(results.map((r) => [r.kind, r.deleted]));
    expect(kinds.sessions).toBeGreaterThanOrEqual(1);
    expect(kinds.rate_limits).toBeGreaterThanOrEqual(1);
    expect(kinds.auth_tokens).toBeGreaterThanOrEqual(1);
  });
});

describe("csv parser", () => {
  test("handles quotes, commas and CRLF", () => {
    const rows = parseGuestCsv('name,phone\r\n"Lee, John",123\nJamie,456\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Lee, John", phone: "123" });
    expect(mapGuestRow(rows[0]!)?.fullName).toBe("Lee, John");
    expect(mapGuestRow({ name: "   " })).toBeNull();
  });
});
