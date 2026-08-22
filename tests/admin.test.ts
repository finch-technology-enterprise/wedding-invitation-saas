import { describe, expect, test } from "vitest";
import { SELF } from "cloudflare:test";

const KEY = "dev-admin-key"; // matches .dev.vars

function list(key?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (key !== undefined) headers["x-admin-key"] = key;
  return SELF.fetch("https://example.com/api/rsvps", { headers });
}

async function seedRsvp(name: string): Promise<void> {
  const res = await SELF.fetch("https://example.com/api/rsvp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, attending: true, instagram: name.toLowerCase() }),
  });
  expect(res.status).toBe(200);
}

describe("GET /api/rsvps", () => {
  test("401 without key", async () => {
    expect((await list()).status).toBe(401);
  });

  test("401 with wrong key", async () => {
    expect((await list("nope")).status).toBe(401);
  });

  test("returns rows newest-first with correct key", async () => {
    await seedRsvp("Alice");
    await seedRsvp("Bob");

    const res = await list(KEY);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      rsvps: Array<{ id: number; name: string; phone: string | null; instagram: string | null }>;
    };
    expect(data.ok).toBe(true);

    const names = data.rsvps.map((r) => r.name);
    expect(names.indexOf("Bob")).toBeLessThan(names.indexOf("Alice"));
    const bob = data.rsvps.find((r) => r.name === "Bob");
    expect(bob?.instagram).toBe("bob");
  });

  test("405 for non-GET methods", async () => {
    const res = await SELF.fetch("https://example.com/api/rsvps", {
      method: "POST",
      headers: { "x-admin-key": KEY },
    });
    expect(res.status).toBe(405);
  });

  test("405 for non-POST methods on /api/rsvp", async () => {
    const res = await SELF.fetch("https://example.com/api/rsvp");
    expect(res.status).toBe(405);
  });
});
