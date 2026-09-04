/**
 * Guest parties / invitees (V2 Phase 5).
 *
 * Tenant-scoped under invitations. Parties group households; guests are
 * individuals with structured RSVP state, meal/dietary, and check-in.
 * CSV import previews before commit with duplicate detection.
 */

import { Hono } from "hono";
import { fail, ok } from "../lib/respond.js";
import { newId } from "../lib/ids.js";
import { nowMs } from "../lib/time.js";
import { isSameOrigin } from "../lib/guard.js";
import { requireInvitation } from "../lib/authz.js";
import {
  createGuest,
  createParty,
  mapGuestRow,
  parseGuestCsv,
  rotatePartyToken,
  validateGuestName,
  validatePartyTitle,
} from "../lib/guests.js";

export const guests = new Hono<{ Bindings: Env }>();

guests.use("/*", async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && !isSameOrigin(c.req.raw)) {
    return fail("csrf", 403);
  }
  await next();
});

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------- parties

guests.get("/:invitationId/parties", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.note, p.max_seats AS maxSeats, p.source,
            p.created_at AS createdAt, p.updated_at AS updatedAt,
            (p.token_hash IS NOT NULL) AS hasToken,
            (SELECT COUNT(*) FROM guests g WHERE g.party_id = p.id) AS guestCount,
            (SELECT COUNT(*) FROM guests g WHERE g.party_id = p.id AND g.rsvp_status = 'attending') AS attendingCount,
            (SELECT COUNT(*) FROM guests g WHERE g.party_id = p.id AND g.checked_in_at IS NOT NULL) AS checkedInCount
     FROM guest_parties p WHERE p.invitation_id = ? ORDER BY p.created_at`
  )
    .bind(access.invitationId)
    .all();
  return ok({ parties: results });
});

guests.post("/:invitationId/parties", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  const body = await readJson(c);
  if (!body) return fail("invalid_body");
  const title = validatePartyTitle(body.title);
  if (!title) return fail("invalid_title");
  try {
    const { id, token } = await createParty(c.env, access.invitationId, {
      title,
      note: typeof body.note === "string" ? body.note : null,
      maxSeats: typeof body.maxSeats === "number" ? body.maxSeats : null,
      source: "manual",
    });
    const origin = new URL(c.req.raw.url).origin;
    const row = await c.env.DB.prepare("SELECT id, title FROM guest_parties WHERE id = ?")
      .bind(id)
      .first<{ id: string; title: string }>();
    return ok({ party: row, token, url: token ? `/i/${(await slugFor(c.env, access.invitationId))}?party=${token}` : null, origin });
  } catch {
    return fail("invalid_title");
  }
});

async function slugFor(env: Env, invitationId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT slug FROM invitations WHERE id = ?")
    .bind(invitationId)
    .first<{ slug: string }>();
  return row?.slug ?? invitationId;
}

guests.patch("/:invitationId/parties/:partyId", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  const partyId = c.req.param("partyId");
  const body = await readJson(c);
  if (!body) return fail("invalid_body");
  const sets: string[] = [];
  const values: unknown[] = [];
  if (body.title !== undefined) {
    const title = validatePartyTitle(body.title);
    if (!title) return fail("invalid_title");
    sets.push("title = ?");
    values.push(title);
  }
  if (body.note !== undefined) {
    sets.push("note = ?");
    values.push(typeof body.note === "string" ? body.note.slice(0, 500) || null : null);
  }
  if (body.maxSeats !== undefined) {
    sets.push("max_seats = ?");
    values.push(typeof body.maxSeats === "number" && body.maxSeats > 0 ? Math.min(Math.floor(body.maxSeats), 50) : null);
  }
  if (!sets.length) return fail("nothing_to_update");
  sets.push("updated_at = ?");
  values.push(nowMs(), partyId, access.invitationId);
  const res = await c.env.DB.prepare(
    `UPDATE guest_parties SET ${sets.join(", ")} WHERE id = ? AND invitation_id = ?`
  )
    .bind(...values)
    .run();
  if (!res.meta.changes) return fail("not_found", 404);
  return ok({});
});

guests.delete("/:invitationId/parties/:partyId", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  const partyId = c.req.param("partyId");
  // Guests survive party deletion (party_id SET NULL); delete is safe.
  const res = await c.env.DB.prepare("DELETE FROM guest_parties WHERE id = ? AND invitation_id = ?")
    .bind(partyId, access.invitationId)
    .run();
  if (!res.meta.changes) return fail("not_found", 404);
  return ok({});
});

guests.post("/:invitationId/parties/:partyId/rotate-token", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  const partyId = c.req.param("partyId");
  const exists = await c.env.DB.prepare("SELECT id FROM guest_parties WHERE id = ? AND invitation_id = ?")
    .bind(partyId, access.invitationId)
    .first<{ id: string }>();
  if (!exists) return fail("not_found", 404);
  const token = await rotatePartyToken(c.env, partyId);
  const slug = await slugFor(c.env, access.invitationId);
  return ok({ token, url: `/i/${slug}?party=${token}` });
});

// ------------------------------------------------------------------ guests

guests.get("/:invitationId/guests", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  const search = (c.req.query("q") ?? "").trim();
  const status = c.req.query("status");
  const partyId = c.req.query("partyId");

  const where = ["g.invitation_id = ?"];
  const params: unknown[] = [access.invitationId];
  if (search) {
    where.push("(g.full_name LIKE ? OR g.phone LIKE ? OR g.email LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (status === "attending" || status === "declined" || status === "pending") {
    where.push("g.rsvp_status = ?");
    params.push(status);
  }
  if (partyId) {
    where.push("g.party_id = ?");
    params.push(partyId);
  }
  const clause = where.join(" AND ");
  const [page, total, summary] = await c.env.DB.batch<any>([
    c.env.DB.prepare(
      `SELECT g.id, g.full_name AS fullName, g.phone, g.email, g.meal, g.dietary,
              g.is_child AS isChild, g.rsvp_status AS rsvpStatus,
              g.checked_in_at AS checkedInAt, g.party_id AS partyId,
              g.source, g.created_at AS createdAt,
              p.title AS partyTitle
       FROM guests g LEFT JOIN guest_parties p ON p.id = g.party_id
       WHERE ${clause} ORDER BY g.created_at DESC LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS c FROM guests g WHERE ${clause}`).bind(...params),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN rsvp_status = 'attending' THEN 1 ELSE 0 END), 0) AS attending,
              COALESCE(SUM(CASE WHEN rsvp_status = 'declined' THEN 1 ELSE 0 END), 0) AS declined,
              COALESCE(SUM(CASE WHEN rsvp_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN checked_in_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS checkedIn
       FROM guests WHERE invitation_id = ?`
    ).bind(access.invitationId),
  ]);
  return ok({
    guests: page.results,
    total: (total.results[0] as { c: number }).c,
    summary: summary.results[0],
  });
});

guests.post("/:invitationId/guests", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  const body = await readJson(c);
  if (!body) return fail("invalid_body");
  if (!validateGuestName(body.fullName)) return fail("invalid_name");
  if (body.partyId) {
    const party = await c.env.DB.prepare("SELECT id FROM guest_parties WHERE id = ? AND invitation_id = ?")
      .bind(String(body.partyId), access.invitationId)
      .first<{ id: string }>();
    if (!party) return fail("unknown_party", 422);
  }
  try {
    const id = await createGuest(c.env, access.invitationId, {
      fullName: String(body.fullName),
      partyId: body.partyId ? String(body.partyId) : null,
      phone: typeof body.phone === "string" ? body.phone : null,
      email: typeof body.email === "string" ? body.email : null,
      meal: typeof body.meal === "string" ? body.meal : null,
      dietary: typeof body.dietary === "string" ? body.dietary : null,
      isChild: body.isChild === true,
      source: "manual",
    });
    return ok({ guestId: id });
  } catch {
    return fail("invalid_name");
  }
});

guests.patch("/:invitationId/guests/:guestId", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  const guestId = c.req.param("guestId");
  const body = await readJson(c);
  if (!body) return fail("invalid_body");
  const sets: string[] = [];
  const values: unknown[] = [];
  if (body.fullName !== undefined) {
    if (!validateGuestName(body.fullName)) return fail("invalid_name");
    sets.push("full_name = ?");
    values.push(String(body.fullName).trim().slice(0, 120));
  }
  for (const key of ["phone", "email", "meal", "dietary"] as const) {
    if (body[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(typeof body[key] === "string" ? (body[key] as string).slice(0, 200) || null : null);
    }
  }
  if (body.isChild !== undefined) {
    sets.push("is_child = ?");
    values.push(body.isChild === true ? 1 : 0);
  }
  if (body.rsvpStatus !== undefined) {
    if (!["pending", "attending", "declined"].includes(String(body.rsvpStatus))) {
      return fail("invalid_status", 422);
    }
    sets.push("rsvp_status = ?");
    values.push(String(body.rsvpStatus));
  }
  if (body.partyId !== undefined) {
    if (body.partyId !== null) {
      const party = await c.env.DB.prepare("SELECT id FROM guest_parties WHERE id = ? AND invitation_id = ?")
        .bind(String(body.partyId), access.invitationId)
        .first<{ id: string }>();
      if (!party) return fail("unknown_party", 422);
      sets.push("party_id = ?");
      values.push(String(body.partyId));
    } else {
      sets.push("party_id = ?");
      values.push(null);
    }
  }
  if (!sets.length) return fail("nothing_to_update");
  sets.push("updated_at = ?");
  values.push(nowMs(), guestId, access.invitationId);
  const res = await c.env.DB.prepare(`UPDATE guests SET ${sets.join(", ")} WHERE id = ? AND invitation_id = ?`)
    .bind(...values)
    .run();
  if (!res.meta.changes) return fail("not_found", 404);
  return ok({});
});

guests.delete("/:invitationId/guests/:guestId", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  const res = await c.env.DB.prepare("DELETE FROM guests WHERE id = ? AND invitation_id = ?")
    .bind(c.req.param("guestId"), access.invitationId)
    .run();
  if (!res.meta.changes) return fail("not_found", 404);
  return ok({});
});

// --------------------------------------------------------------- check-in

guests.post("/:invitationId/guests/:guestId/check-in", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  const now = nowMs();
  const res = await c.env.DB.prepare(
    "UPDATE guests SET checked_in_at = ?, updated_at = ? WHERE id = ? AND invitation_id = ? AND checked_in_at IS NULL"
  )
    .bind(now, now, c.req.param("guestId"), access.invitationId)
    .run();
  // Idempotent: already checked in is success with the existing timestamp.
  if (!res.meta.changes) {
    const existing = await c.env.DB.prepare(
      "SELECT checked_in_at AS checkedInAt FROM guests WHERE id = ? AND invitation_id = ?"
    )
      .bind(c.req.param("guestId"), access.invitationId)
      .first<{ checkedInAt: number | null }>();
    if (!existing) return fail("not_found", 404);
    return ok({ checkedInAt: existing.checkedInAt, deduped: true });
  }
  return ok({ checkedInAt: now, deduped: false });
});

guests.post("/:invitationId/guests/:guestId/check-out", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  const res = await c.env.DB.prepare(
    "UPDATE guests SET checked_in_at = NULL, updated_at = ? WHERE id = ? AND invitation_id = ?"
  )
    .bind(nowMs(), c.req.param("guestId"), access.invitationId)
    .run();
  if (!res.meta.changes) return fail("not_found", 404);
  return ok({});
});

// ------------------------------------------------------------- CSV import

guests.post("/:invitationId/guests/import/preview", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  let text: string;
  try {
    text = await c.req.raw.text();
  } catch {
    return fail("invalid_body");
  }
  if (!text || text.length > 512 * 1024) return fail("file_too_large", 413);
  const rows = parseGuestCsv(text).slice(0, 1000);
  const mapped = rows.map((r) => mapGuestRow(r));
  // Duplicate detection against existing guests (case-insensitive name).
  const { results: existing } = await c.env.DB.prepare(
    "SELECT LOWER(full_name) AS n FROM guests WHERE invitation_id = ?"
  )
    .bind(access.invitationId)
    .all<{ n: string }>();
  const known = new Set(existing.map((r) => r.n));
  const preview = mapped.map((m, i) => ({
    index: i,
    valid: m !== null,
    duplicate: m ? known.has(m.fullName.toLowerCase()) : false,
    name: m?.fullName ?? null,
  }));
  return ok({
    total: rows.length,
    valid: preview.filter((p) => p.valid && !p.duplicate).length,
    invalid: preview.filter((p) => !p.valid).length,
    duplicates: preview.filter((p) => p.duplicate).length,
    rows: preview.slice(0, 100),
  });
});

guests.post("/:invitationId/guests/import/commit", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  const body = await readJson(c);
  if (!body || typeof body.csv !== "string") return fail("invalid_body");
  if (body.csv.length > 512 * 1024) return fail("file_too_large", 413);
  const skipDuplicates = body.skipDuplicates !== false;
  const partyTitle = typeof body.partyTitle === "string" && body.partyTitle.trim() ? body.partyTitle.trim().slice(0, 120) : null;

  const rows = parseGuestCsv(body.csv).slice(0, 1000);
  const { results: existing } = await c.env.DB.prepare(
    "SELECT LOWER(full_name) AS n FROM guests WHERE invitation_id = ?"
  )
    .bind(access.invitationId)
    .all<{ n: string }>();
  const known = new Set(existing.map((r) => r.n));

  let partyId: string | null = null;
  if (partyTitle) {
    const { id } = await createParty(c.env, access.invitationId, { title: partyTitle, source: "csv" }, { withToken: true }).catch(() => ({ id: null as unknown as string }));
    partyId = id ?? null;
  }

  let imported = 0;
  let skipped = 0;
  const errors: Array<{ index: number; code: string }> = [];
  // Sequential to keep D1 batch sizes small; 1000 rows max.
  for (let i = 0; i < rows.length; i++) {
    const mapped = mapGuestRow(rows[i]!);
    if (!mapped) {
      errors.push({ index: i, code: "invalid_row" });
      continue;
    }
    if (skipDuplicates && known.has(mapped.fullName.toLowerCase())) {
      skipped++;
      continue;
    }
    try {
      await createGuest(c.env, access.invitationId, { ...mapped, partyId, source: "csv" });
      known.add(mapped.fullName.toLowerCase());
      imported++;
    } catch {
      errors.push({ index: i, code: "insert_failed" });
    }
  }
  return ok({ imported, skipped, errors: errors.slice(0, 50), partyId });
});
