/**
 * Guest parties / invitees (V2 Phase 5).
 *
 * Tokens are high-entropy opaque values; only SHA-256 is stored.
 * Party tokens scope personalized views + RSVP; per-guest check-in is an
 * authenticated staff action (token in QR is a lookup aid, not auth).
 */

import { newId, newToken } from "./ids.js";
import { nowMs } from "./time.js";
import { hashToken } from "./session.js";

export interface PartyInput {
  title: string;
  note?: string | null;
  maxSeats?: number | null;
  source?: string;
}

export function validatePartyTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/\s+/g, " ").slice(0, 120);
  return t ? t : null;
}

export async function createParty(
  env: Env,
  invitationId: string,
  input: PartyInput,
  opts: { withToken?: boolean } = {}
): Promise<{ id: string; token?: string }> {
  const title = validatePartyTitle(input.title);
  if (!title) throw new Error("invalid_title");
  const id = newId();
  const now = nowMs();
  let token: string | undefined;
  let tokenHash: string | null = null;
  if (opts.withToken !== false) {
    token = newToken(24);
    tokenHash = await hashToken(token);
  }
  await env.DB.prepare(
    `INSERT INTO guest_parties (id, invitation_id, title, note, token_hash, max_seats, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      invitationId,
      title,
      (input.note ?? "").toString().slice(0, 500) || null,
      tokenHash,
      typeof input.maxSeats === "number" && input.maxSeats > 0 ? Math.min(Math.floor(input.maxSeats), 50) : null,
      (input.source ?? "manual").slice(0, 24),
      now,
      now
    )
    .run();
  return token ? { id, token } : { id };
}

export async function rotatePartyToken(env: Env, partyId: string): Promise<string> {
  const token = newToken(24);
  await env.DB.prepare("UPDATE guest_parties SET token_hash = ?, updated_at = ? WHERE id = ?")
    .bind(await hashToken(token), nowMs(), partyId)
    .run();
  return token;
}

export async function resolvePartyByToken(
  env: Env,
  invitationId: string,
  token: string
): Promise<{ id: string; title: string } | null> {
  if (!token || token.length < 16 || token.length > 128) return null;
  return env.DB.prepare(
    "SELECT id, title FROM guest_parties WHERE invitation_id = ? AND token_hash = ?"
  )
    .bind(invitationId, await hashToken(token))
    .first<{ id: string; title: string }>();
}

export interface GuestInput {
  fullName: string;
  partyId?: string | null;
  phone?: string | null;
  email?: string | null;
  meal?: string | null;
  dietary?: string | null;
  isChild?: boolean;
  source?: string;
}

export function validateGuestName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/\s+/g, " ").slice(0, 120);
  return v ? v : null;
}

export async function createGuest(
  env: Env,
  invitationId: string,
  input: GuestInput
): Promise<string> {
  const name = validateGuestName(input.fullName);
  if (!name) throw new Error("invalid_name");
  const id = newId();
  const now = nowMs();
  await env.DB.prepare(
    `INSERT INTO guests (id, invitation_id, party_id, full_name, phone, email, meal, dietary,
      is_child, rsvp_status, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  )
    .bind(
      id,
      invitationId,
      input.partyId ?? null,
      name,
      (input.phone ?? "").toString().slice(0, 40) || null,
      (input.email ?? "").toString().slice(0, 254) || null,
      (input.meal ?? "").toString().slice(0, 80) || null,
      (input.dietary ?? "").toString().slice(0, 200) || null,
      input.isChild ? 1 : 0,
      (input.source ?? "manual").slice(0, 24),
      now,
      now
    )
    .run();
  return id;
}

/** Minimal RFC-4180 CSV parser (quotes, commas, CRLF). Deterministic, tested. */
export function parseGuestCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const push = () => {
    row.push(field);
    field = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      push();
    } else if (ch === "\n") {
      push();
      rows.push(row);
      row = [];
    } else if (ch === "\r") {
      /* skip; \n handles it */
    } else {
      field += ch;
    }
  }
  push();
  rows.push(row);
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0]!.map((h) => h.trim().toLowerCase());
  return nonEmpty.slice(1).map((r) => {
    const out: Record<string, string> = {};
    header.forEach((h, i) => {
      out[h] = (r[i] ?? "").trim();
    });
    return out;
  });
}

export function mapGuestRow(row: Record<string, string>): GuestInput | null {
  const name =
    row["name"] ?? row["full_name"] ?? row["fullname"] ?? row["nama"] ?? row["姓名"] ?? "";
  const validated = validateGuestName(name);
  if (!validated) return null;
  return {
    fullName: validated,
    phone: row["phone"] ?? row["tel"] ?? row["telefon"] ?? row["电话"] ?? null,
    email: row["email"] ?? row["e-mail"] ?? null,
    meal: row["meal"] ?? row["diet"] ?? null,
    dietary: row["dietary"] ?? row["allergies"] ?? row["notes"] ?? null,
  };
}
