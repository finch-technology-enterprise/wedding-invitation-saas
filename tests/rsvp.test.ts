/**
 * WS8 — configurable RSVP.
 *
 * The property that matters throughout: a guest is validated against the
 * schema that was PUBLISHED, never the admin's working draft. Editing a
 * form must not retroactively invalidate replies to the version guests
 * are still looking at.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { SELF, env } from "cloudflare:test";
import { toCsv } from "../src/lib/csv.js";
import { validateFormDefinition, validateSubmission, defaultFormDefinition } from "../src/lib/rsvp.js";

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

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    couple: { groom: { zh: "李天豪" }, bride: { zh: "刘蔼蕴" } },
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
  const { tenants } = await body(session);
  const tenantId = tenants[0].id;

  const created = await req(`/api/v1/tenants/${tenantId}/invitations`, {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ title: `Invite ${slug}`, slug }),
  });
  const { invitationId } = await body(created);
  return { cookie, tenantId, invitationId, slug };
}

async function saveForm(actor: Actor, form: unknown): Promise<Response> {
  return req(`/api/v1/invitations/${actor.invitationId}/rsvp`, {
    method: "PUT",
    headers: { cookie: actor.cookie },
    body: JSON.stringify(form),
  });
}

async function publish(actor: Actor, config = baseConfig()): Promise<void> {
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
}

function submit(slug: string, payload: unknown, init: RequestInit = {}): Promise<Response> {
  return req(`/i/${slug}/rsvp`, {
    method: "POST",
    body: JSON.stringify(payload),
    ...init,
  });
}

const DEFAULT_FIELDS = [
  { kind: "name", label: "Name" },
  { kind: "attending", label: "Attending" },
  { kind: "guests", label: "Guests" },
  { kind: "phone", label: "Phone" },
  { kind: "message", label: "Message" },
];

let alice: Actor;
let bob: Actor;

beforeEach(async () => {
  await reset();
  alice = await signUp("alice@example.com", "alice-wedding");
  bob = await signUp("bob@example.com", "bob-wedding");
});

// ------------------------------------------------------ form configuration

describe("form configuration", () => {
  test("a new invitation starts with the frozen default schema", async () => {
    const res = await req(`/api/v1/invitations/${alice.invitationId}/rsvp`, {
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(200);

    const { form } = await body(res);
    expect(form.enabled).toBe(true);
    expect(form.fields.map((f: any) => f.kind)).toEqual([
      "name",
      "attending",
      "guests",
      "phone",
      "instagram",
      "message",
    ]);
  });

  test("custom fields of every supported kind are accepted", async () => {
    const res = await saveForm(alice, {
      enabled: true,
      guestLimit: 8,
      fields: [
        ...DEFAULT_FIELDS,
        { kind: "text", key: "song", label: "Song request" },
        { kind: "textarea", key: "notes", label: "Notes" },
        { kind: "number", key: "children", label: "Children" },
        { kind: "select", key: "meal", label: "Meal", options: ["Beef", "Fish"] },
        { kind: "radio", key: "bus", label: "Coach", options: ["Yes", "No"] },
        { kind: "checkbox", key: "diet", label: "Dietary", options: ["Vegan", "Halal"] },
      ],
    });
    expect(res.status).toBe(200);

    const { form } = await body(res);
    expect(form.fields).toHaveLength(11);
    // Every custom field is assigned a stable opaque ID.
    for (const f of form.fields) expect(f.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("an unknown field kind is rejected", async () => {
    const res = await saveForm(alice, {
      fields: [...DEFAULT_FIELDS, { kind: "signature", key: "sig", label: "Sign" }],
    });
    expect(res.status).toBe(422);
    expect((await body(res)).errors[0].code).toBe("unknown_field_kind");
  });

  test("choice fields require valid, non-empty, unique options", async () => {
    const empty = await saveForm(alice, {
      fields: [...DEFAULT_FIELDS, { kind: "select", key: "meal", label: "Meal", options: [] }],
    });
    expect((await body(empty)).errors[0].code).toBe("options_required");

    const blank = await saveForm(alice, {
      fields: [...DEFAULT_FIELDS, { kind: "select", key: "meal", label: "Meal", options: ["  "] }],
    });
    expect((await body(blank)).errors[0].code).toBe("option_empty");

    const dupe = await saveForm(alice, {
      fields: [
        ...DEFAULT_FIELDS,
        { kind: "radio", key: "bus", label: "Coach", options: ["Yes", "Yes"] },
      ],
    });
    expect((await body(dupe)).errors[0].code).toBe("duplicate_option");
  });

  test("the theme's custom-field cap is enforced", async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      kind: "text",
      key: `q${i}`,
      label: `Question ${i}`,
    }));
    const res = await saveForm(alice, { fields: [...DEFAULT_FIELDS, ...many] });
    expect(res.status).toBe(422);

    const err = (await body(res)).errors.find((e: any) => e.code === "too_many_fields");
    expect(err.limit).toBe(6);
  });

  test("name and attendance cannot be removed", async () => {
    const res = await saveForm(alice, { fields: [{ kind: "guests", label: "Guests" }] });
    expect(res.status).toBe(422);

    const codes = (await body(res)).errors.map((e: any) => e.code);
    expect(codes).toContain("field_required");
  });

  test("field order is preserved", async () => {
    await saveForm(alice, {
      fields: [
        { kind: "name", label: "Name" },
        { kind: "attending", label: "Attending" },
        { kind: "text", key: "b", label: "Second" },
        { kind: "text", key: "a", label: "First" },
      ],
    });
    const res = await req(`/api/v1/invitations/${alice.invitationId}/rsvp`, {
      headers: { cookie: alice.cookie },
    });
    const { form } = await body(res);
    expect(form.fields.map((f: any) => f.key)).toEqual(["name", "attending", "b", "a"]);
  });

  test("renaming a label keeps the field identity and its answers", async () => {
    const first = await saveForm(alice, {
      fields: [...DEFAULT_FIELDS, { kind: "text", key: "diet", label: "Your dietary requirements" }],
    });
    const created = (await body(first)).form.fields.find((f: any) => f.key === "diet");

    await publish(alice);
    await submit(alice.slug, { name: "Guest", attending: true, diet: "None" });

    // Rename, sending the ID back exactly as an editor would.
    const renamed = await saveForm(alice, {
      fields: [
        ...DEFAULT_FIELDS,
        { id: created.id, kind: "text", key: "diet", label: "Any dietary requirements?" },
      ],
    });
    expect(renamed.status).toBe(200);
    expect((await body(renamed)).form.fields.find((f: any) => f.key === "diet").id).toBe(created.id);

    // The historical answer survives the rename.
    const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM rsvp_answers WHERE field_id = ?")
      .bind(created.id)
      .first<{ c: number }>();
    expect(row?.c).toBe(1);
  });

  test("configuring another tenant's form is refused", async () => {
    const res = await req(`/api/v1/invitations/${bob.invitationId}/rsvp`, {
      method: "PUT",
      headers: { cookie: alice.cookie },
      body: JSON.stringify({ fields: DEFAULT_FIELDS }),
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------- publication

describe("schema publication", () => {
  test("editing the form does not change what live guests are validated against", async () => {
    await saveForm(alice, {
      fields: [...DEFAULT_FIELDS, { kind: "text", key: "song", label: "Song" }],
    });
    await publish(alice);

    // Now add a field to the DRAFT form, without publishing.
    await saveForm(alice, {
      fields: [
        ...DEFAULT_FIELDS,
        { kind: "text", key: "song", label: "Song" },
        { kind: "text", key: "hotel", label: "Hotel" },
      ],
    });

    // A guest on the live page cannot use the unpublished field.
    const res = await submit(alice.slug, {
      name: "Guest",
      attending: true,
      song: "Ok",
      hotel: "Smuggled",
    });
    expect(res.status).toBe(422);
    expect((await body(res)).errors[0].code).toBe("unknown_field");
  });

  test("publishing pins the new schema", async () => {
    await publish(alice);
    await saveForm(alice, {
      fields: [...DEFAULT_FIELDS, { kind: "text", key: "hotel", label: "Hotel" }],
    });
    await publish(alice);

    const res = await submit(alice.slug, { name: "Guest", attending: true, hotel: "Grand" });
    expect(res.status).toBe(200);
  });

  test("the published revision carries its own form snapshot", async () => {
    await saveForm(alice, {
      fields: [...DEFAULT_FIELDS, { kind: "text", key: "song", label: "Song" }],
    });
    await publish(alice);

    const row = await env.DB.prepare(
      `SELECT r.config_json AS c FROM invitations i
       JOIN invitation_revisions r ON r.id = i.published_revision_id WHERE i.id = ?`
    )
      .bind(alice.invitationId)
      .first<{ c: string }>();

    const config = JSON.parse(row!.c);
    expect(config.rsvpForm.fields.some((f: any) => f.key === "song")).toBe(true);
  });
});

// ------------------------------------------------------------- submission

describe("public submission", () => {
  beforeEach(async () => {
    await publish(alice);
  });

  test("accepts an attending reply and records it", async () => {
    const res = await submit(alice.slug, {
      name: "李明",
      attending: true,
      guests: 3,
      phone: "+60123456789",
      message: "Congratulations!",
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT contact_name AS name, attending, guest_count AS guests, contact_phone AS phone
       FROM rsvp_submissions WHERE invitation_id = ?`
    )
      .bind(alice.invitationId)
      .first<any>();

    expect(row.name).toBe("李明");
    expect(row.attending).toBe(1);
    expect(row.guests).toBe(3);
    expect(row.phone).toBe("+60123456789");
  });

  test("a decline is recorded as one person regardless of guest count", async () => {
    await submit(alice.slug, { name: "Guest", attending: false, guests: 6 });

    const row = await env.DB.prepare(
      "SELECT attending, guest_count AS guests FROM rsvp_submissions WHERE invitation_id = ?"
    )
      .bind(alice.invitationId)
      .first<any>();
    expect(row.attending).toBe(0);
    expect(row.guests).toBe(1);
  });

  test("the invitation's response counter increments in the same batch", async () => {
    await submit(alice.slug, { name: "A", attending: true });
    await submit(alice.slug, { name: "B", attending: true });

    const row = await env.DB.prepare("SELECT rsvp_count AS c FROM invitations WHERE id = ?")
      .bind(alice.invitationId)
      .first<{ c: number }>();
    expect(row?.c).toBe(2);
  });

  test("a missing name is refused", async () => {
    const res = await submit(alice.slug, { attending: true });
    expect(res.status).toBe(422);
    expect((await body(res)).errors.some((e: any) => e.path === "name")).toBe(true);
  });

  test("guest count beyond the configured limit is refused", async () => {
    const res = await submit(alice.slug, { name: "Guest", attending: true, guests: 99 });
    expect(res.status).toBe(422);
    expect((await body(res)).errors[0].code).toBe("over_limit");
  });

  test("an over-long field is refused", async () => {
    const res = await submit(alice.slug, {
      name: "Guest",
      attending: true,
      message: "x".repeat(900),
    });
    expect(res.status).toBe(422);
    expect((await body(res)).errors[0].code).toBe("too_long");
  });

  test("an unknown field is refused rather than ignored", async () => {
    const res = await submit(alice.slug, { name: "Guest", attending: true, isAdmin: true });
    expect(res.status).toBe(422);
    expect((await body(res)).errors[0].code).toBe("unknown_field");
  });

  test("the honeypot answers success but records nothing", async () => {
    const res = await submit(alice.slug, {
      name: "Bot",
      attending: true,
      website: "http://spam.example",
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM rsvp_submissions WHERE invitation_id = ?"
    )
      .bind(alice.invitationId)
      .first<{ c: number }>();
    expect(row?.c).toBe(0);
  });

  test("submissions are rate limited per invitation and client", async () => {
    let limited = false;
    for (let i = 0; i < 10; i++) {
      const res = await submit(alice.slug, { name: `Guest ${i}`, attending: true });
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });

  test("a reply cannot be aimed at another invitation", async () => {
    await publish(bob);
    await submit(bob.slug, { name: "For Bob", attending: true });

    const aliceRows = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM rsvp_submissions WHERE invitation_id = ?"
    )
      .bind(alice.invitationId)
      .first<{ c: number }>();
    expect(aliceRows?.c).toBe(0);
  });

  test("an unpublished invitation accepts nothing", async () => {
    await req(`/api/v1/invitations/${alice.invitationId}/unpublish`, {
      method: "POST",
      headers: { cookie: alice.cookie },
    });

    const res = await submit(alice.slug, { name: "Guest", attending: true });
    expect(res.status).toBe(404);
  });

  test("a cross-origin submission is refused", async () => {
    const res = await SELF.fetch(`${ORIGIN}/i/${alice.slug}/rsvp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example.com" },
      body: JSON.stringify({ name: "CSRF", attending: true }),
    });
    expect(res.status).toBe(403);
  });

  test("the deadline closes replies server-side", async () => {
    await saveForm(alice, { fields: DEFAULT_FIELDS, deadlineAt: Date.now() - 1000 });
    await publish(alice);

    const res = await submit(alice.slug, { name: "Late", attending: true });
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("rsvp_closed");
  });

  test("a disabled form refuses replies", async () => {
    await saveForm(alice, { fields: DEFAULT_FIELDS, enabled: false });
    await publish(alice);

    const res = await submit(alice.slug, { name: "Guest", attending: true });
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("rsvp_disabled");
  });

  test("a response quota closes replies without naming the plan", async () => {
    await env.DB.prepare("UPDATE tenants SET quota_overrides_json = ? WHERE id = ?")
      .bind(JSON.stringify({ maxRsvpResponses: 1 }), alice.tenantId)
      .run();

    expect((await submit(alice.slug, { name: "First", attending: true })).status).toBe(200);

    const res = await submit(alice.slug, { name: "Second", attending: true });
    expect(res.status).toBe(403);
    const payload = await body(res);
    expect(payload.error).toBe("rsvp_closed");
    // A guest must not learn the couple's plan tier.
    expect(JSON.stringify(payload)).not.toMatch(/quota|plan|limit/i);
  });

  test("two guests may share a name — no accidental uniqueness rule", async () => {
    // Families and repeat corrections are legitimate; identity is never
    // inferred from a name.
    expect((await submit(alice.slug, { name: "陈伟", attending: true })).status).toBe(200);
    expect((await submit(alice.slug, { name: "陈伟", attending: false })).status).toBe(200);

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM rsvp_submissions WHERE contact_name = ?"
    )
      .bind("陈伟")
      .first<{ c: number }>();
    expect(row?.c).toBe(2);
  });
});

// ---------------------------------------------------------- custom answers

describe("custom answers", () => {
  test("choice and checkbox answers persist against their field", async () => {
    const saved = await saveForm(alice, {
      fields: [
        ...DEFAULT_FIELDS,
        { kind: "select", key: "meal", label: "Meal", options: ["Beef", "Fish"] },
        { kind: "checkbox", key: "diet", label: "Dietary", options: ["Vegan", "Halal"] },
      ],
    });
    const fields = (await body(saved)).form.fields;
    await publish(alice);

    const res = await submit(alice.slug, {
      name: "Guest",
      attending: true,
      meal: "Fish",
      diet: ["Vegan", "Halal"],
    });
    expect(res.status).toBe(200);

    const mealId = fields.find((f: any) => f.key === "meal").id;
    const dietId = fields.find((f: any) => f.key === "diet").id;

    const meal = await env.DB.prepare(
      "SELECT value_text AS v FROM rsvp_answers WHERE field_id = ?"
    )
      .bind(mealId)
      .first<{ v: string }>();
    expect(meal?.v).toBe("Fish");

    // A checkbox yields several rows, which the relational model handles
    // without a JSON blob.
    const diet = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM rsvp_answers WHERE field_id = ?"
    )
      .bind(dietId)
      .first<{ c: number }>();
    expect(diet?.c).toBe(2);
  });

  test("an option outside the published set is refused", async () => {
    await saveForm(alice, {
      fields: [
        ...DEFAULT_FIELDS,
        { kind: "select", key: "meal", label: "Meal", options: ["Beef", "Fish"] },
      ],
    });
    await publish(alice);

    const res = await submit(alice.slug, { name: "Guest", attending: true, meal: "Lobster" });
    expect(res.status).toBe(422);
    expect((await body(res)).errors[0].code).toBe("invalid_option");
  });

  test("a required custom field is enforced", async () => {
    await saveForm(alice, {
      fields: [...DEFAULT_FIELDS, { kind: "text", key: "song", label: "Song", required: true }],
    });
    await publish(alice);

    const res = await submit(alice.slug, { name: "Guest", attending: true });
    expect(res.status).toBe(422);
    expect((await body(res)).errors[0].path).toBe("song");
  });
});

// ------------------------------------------------------------- responses

describe("responses admin", () => {
  beforeEach(async () => {
    await saveForm(alice, {
      fields: [
        ...DEFAULT_FIELDS,
        { kind: "select", key: "meal", label: "Meal", options: ["Beef", "Fish"] },
      ],
    });
    await publish(alice);
  });

  async function seed(count: number): Promise<void> {
    // Insert directly to bypass the per-client rate limit, which exists
    // for guests rather than for fixtures.
    const form = await env.DB.prepare("SELECT id FROM rsvp_forms WHERE invitation_id = ?")
      .bind(alice.invitationId)
      .first<{ id: string }>();

    for (let i = 0; i < count; i++) {
      await env.DB.prepare(
        `INSERT INTO rsvp_submissions
           (id, invitation_id, form_id, attending, guest_count, contact_name, contact_phone, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          crypto.randomUUID(),
          alice.invitationId,
          form!.id,
          i % 3 === 0 ? 0 : 1,
          i % 3 === 0 ? 1 : 2,
          `Guest ${i}`,
          `+601234${String(i).padStart(5, "0")}`,
          Date.now() - i * 1000
        )
        .run();
    }
  }

  test("responses are paginated server-side with totals", async () => {
    await seed(30);

    const res = await req(`/api/v1/invitations/${alice.invitationId}/responses?limit=10`, {
      headers: { cookie: alice.cookie },
    });
    const data = await body(res);

    expect(data.responses).toHaveLength(10);
    expect(data.total).toBe(30);
    expect(data.summary.total).toBe(30);
    expect(data.summary.attending + data.summary.declined).toBe(30);
    expect(data.summary.guests).toBeGreaterThan(0);
  });

  test("the second page returns different rows", async () => {
    await seed(30);

    const first = await body(
      await req(`/api/v1/invitations/${alice.invitationId}/responses?limit=5&offset=0`, {
        headers: { cookie: alice.cookie },
      })
    );
    const second = await body(
      await req(`/api/v1/invitations/${alice.invitationId}/responses?limit=5&offset=5`, {
        headers: { cookie: alice.cookie },
      })
    );

    const firstIds = first.responses.map((r: any) => r.id);
    expect(second.responses.every((r: any) => !firstIds.includes(r.id))).toBe(true);
  });

  test("search and attendance filters apply", async () => {
    await seed(12);

    const search = await body(
      await req(`/api/v1/invitations/${alice.invitationId}/responses?q=Guest%201`, {
        headers: { cookie: alice.cookie },
      })
    );
    expect(search.responses.length).toBeGreaterThan(0);
    expect(search.responses.every((r: any) => r.contactName.includes("Guest 1"))).toBe(true);

    const declined = await body(
      await req(`/api/v1/invitations/${alice.invitationId}/responses?attending=no`, {
        headers: { cookie: alice.cookie },
      })
    );
    expect(declined.responses.every((r: any) => r.attending === 0)).toBe(true);
  });

  test("custom answers are expanded with their option labels", async () => {
    await submit(alice.slug, { name: "Diner", attending: true, meal: "Fish" });

    const data = await body(
      await req(`/api/v1/invitations/${alice.invitationId}/responses`, {
        headers: { cookie: alice.cookie },
      })
    );
    const row = data.responses.find((r: any) => r.contactName === "Diner");
    expect(row.answers).toContainEqual({ label: "Meal", value: "Fish" });
  });

  test("responses cannot be read across a tenant boundary", async () => {
    const res = await req(`/api/v1/invitations/${bob.invitationId}/responses`, {
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(404);
  });
});

// ------------------------------------------------------------------- CSV

describe("CSV export", () => {
  test("neutralizes formulas so a spreadsheet cannot execute guest input", () => {
    const csv = toCsv(
      ["Name", "Message"],
      [
        ["=HYPERLINK(\"http://evil\",\"click\")", "ok"],
        ["+1234", "ok"],
        ["-1+2", "ok"],
        ["@SUM(A1)", "ok"],
      ]
    );

    // Quoting alone is not protection: the value itself must be altered.
    expect(csv).toContain("\"'=HYPERLINK");
    expect(csv).toContain("'+1234");
    expect(csv).toContain("'-1+2");
    expect(csv).toContain("'@SUM(A1)");

    // No cell begins with a live formula character.
    for (const line of csv.replace(/^\uFEFF/, "").trim().split("\r\n").slice(1)) {
      for (const cell of line.split(",")) {
        expect(/^"?[=+\-@]/.test(cell)).toBe(false);
      }
    }
  });

  test("escapes commas, quotes and newlines per RFC 4180", () => {
    const csv = toCsv(["A"], [['He said "hi", then left'], ["line1\nline2"]]);
    expect(csv).toContain('"He said ""hi"", then left"');
    expect(csv).toContain('"line1\nline2"');
  });

  test("carries a BOM so Excel reads Unicode names correctly", () => {
    const csv = toCsv(["Name"], [["李天豪"]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("李天豪");
  });

  test("exports rows including custom fields", async () => {
    await saveForm(alice, {
      fields: [
        ...DEFAULT_FIELDS,
        { kind: "select", key: "meal", label: "Meal", options: ["Beef", "Fish"] },
      ],
    });
    await publish(alice);
    await submit(alice.slug, { name: "李明", attending: true, guests: 2, meal: "Fish" });

    const res = await req(`/api/v1/invitations/${alice.invitationId}/responses.csv`, {
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("attachment");

    const text = await res.text();
    expect(text).toContain("Name,Attending,Guests");
    expect(text).toContain("Meal");
    expect(text).toContain("李明");
    expect(text).toContain("Fish");
  });

  test("CSV cannot be exported across a tenant boundary", async () => {
    const res = await req(`/api/v1/invitations/${bob.invitationId}/responses.csv`, {
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(404);
  });
});

// ----------------------------------------------------------- unit checks

describe("schema unit behaviour", () => {
  test("the default definition matches the frozen cinematic form", () => {
    const form = defaultFormDefinition();
    expect(form.fields.map((f) => f.key)).toEqual([
      "name",
      "attending",
      "guests",
      "phone",
      "instagram",
      "message",
    ]);
    expect(form.enabled).toBe(true);
  });

  test("validation rejects a duplicate custom key", () => {
    const result = validateFormDefinition({
      fields: [
        { kind: "name", label: "Name" },
        { kind: "attending", label: "Attending" },
        { kind: "text", key: "song", label: "One" },
        { kind: "text", key: "song", label: "Two" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.code).toBe("duplicate_key");
  });

  test("a submission is judged against the supplied schema, not a global one", () => {
    const form = defaultFormDefinition();
    form.fields = form.fields.filter((f) => f.key !== "message");

    const result = validateSubmission(
      { name: "Guest", attending: true, message: "hello" },
      form,
      Date.now()
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.code).toBe("unknown_field");
  });
});
