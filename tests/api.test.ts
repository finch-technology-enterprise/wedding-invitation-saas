import { describe, expect, test } from "vitest";
import { SELF, env } from "cloudflare:test";

async function countRows(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM rsvps").first<{ c: number }>();
  return row?.c ?? 0;
}

function post(body: unknown): Promise<Response> {
  return SELF.fetch("https://example.com/api/rsvp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  name: "John Doe",
  attending: true,
  guests: 2,
  phone: "+60123456789",
  message: "Congrats!",
};

describe("POST /api/rsvp", () => {
  test("inserts a valid RSVP and returns ok", async () => {
    const res = await post(validBody);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(true);

    const row = await env.DB.prepare(
      "SELECT name, attending, guests, phone, instagram, message FROM rsvps"
    ).first<{
      name: string;
      attending: number;
      guests: number;
      phone: string;
      instagram: string | null;
      message: string;
    }>();
    expect(row).toMatchObject({
      name: "John Doe",
      attending: 1,
      guests: 2,
      phone: "+60123456789",
      instagram: null,
      message: "Congrats!",
    });
  });

  test("accepts instagram instead of phone and normalizes handle", async () => {
    const res = await post({ name: "IG Guest", attending: false, instagram: "@SomeOne_99" });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT instagram, guests FROM rsvps WHERE name = 'IG Guest'"
    ).first<{ instagram: string; guests: number }>();
    expect(row?.instagram).toBe("someone_99");
    expect(row?.guests).toBe(1);
  });

  test("rejects when neither phone nor instagram provided", async () => {
    const before = await countRows();
    const res = await post({ name: "No Contact", attending: true });
    expect(res.status).toBe(400);
    expect(await countRows()).toBe(before);
  });

  test("rejects malformed phone", async () => {
    const res = await post({ ...validBody, name: "BadPhone", phone: "12ab" });
    expect(res.status).toBe(400);
  });

  test("rejects malformed instagram", async () => {
    const res = await post({ name: "BadIg", attending: true, instagram: "has space!" });
    expect(res.status).toBe(400);
  });

  test("rejects guests out of range", async () => {
    for (const guests of [0, 13, 2.5]) {
      const res = await post({ ...validBody, name: `G${guests}`, guests });
      expect(res.status).toBe(400);
    }
  });

  test("rejects missing or over-long name", async () => {
    expect((await post({ ...validBody, name: "" })).status).toBe(400);
    expect((await post({ ...validBody, name: "x".repeat(81) })).status).toBe(400);
  });

  test("honeypot filled returns fake ok but inserts nothing", async () => {
    const before = await countRows();
    const res = await post({ ...validBody, name: "Bot", website: "http://spam.example" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(true);
    expect(await countRows()).toBe(before);
  });

  test("rejects non-JSON body", async () => {
    const res = await SELF.fetch("https://example.com/api/rsvp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  test("404 on unknown api route", async () => {
    const res = await SELF.fetch("https://example.com/api/nope");
    expect(res.status).toBe(404);
  });
});
