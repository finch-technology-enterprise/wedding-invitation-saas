/**
 * Legacy single-invitation RSVP routes (pre-platform).
 *
 * Moved verbatim from the original src/index.ts during WS0 so the new
 * router can take shape around them. The frozen public invitation at /
 * still posts here. WS6/WS8 retire these in favour of
 * /api/v1 + POST /i/{slug}/rsvp; until then behaviour must not change.
 *
 * KNOWN TEMPORARY LOCAL LIMITATION
 * --------------------------------
 * The WS1 platform migration drops the pre-platform `rsvps` table, so a
 * local `POST /api/rsvp` returns HTTP 500 against a freshly migrated local
 * D1. This is accepted and deliberate: adding a compatibility table or
 * shim now would only be deleted again at WS6/WS8.
 *
 * It affects local browser clicking only — not correctness of the suites:
 *   - Worker tests create the table in tests/setup.ts
 *   - the e2e suite posts to its own stub server (tests/e2e/server.mjs)
 *   - production still runs the pre-platform schema and is unaffected
 *
 * Resolution: delete this file when the new RSVP stack becomes
 * authoritative. See README "Known limitations".
 */

import { json } from "../lib/respond.js";

export interface RsvpInput {
  name: string;
  attending: boolean;
  guests: number;
  phone: string | null;
  instagram: string | null;
  message: string | null;
}

type ParseResult = { ok: true; value: RsvpInput } | { ok: false; error: string };

const PHONE_RE = /^\+?[0-9]{8,15}$/;
const IG_RE = /^[A-Za-z0-9._]{1,30}$/;

export function parseRsvp(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_body" };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.website === "string" && b.website.length > 0) {
    return { ok: false, error: "honeypot" };
  }

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 80) return { ok: false, error: "invalid_name" };

  if (typeof b.attending !== "boolean") return { ok: false, error: "invalid_attending" };

  let guests = 1;
  if (b.guests !== undefined && b.guests !== null) {
    if (typeof b.guests !== "number" || !Number.isInteger(b.guests)) {
      return { ok: false, error: "invalid_guests" };
    }
    guests = b.guests;
  }
  if (guests < 1 || guests > 12) return { ok: false, error: "invalid_guests" };

  let phone: string | null = null;
  if (b.phone !== undefined && b.phone !== null && b.phone !== "") {
    if (typeof b.phone !== "string") return { ok: false, error: "invalid_phone" };
    phone = b.phone.replace(/[\s-]/g, "");
    if (!PHONE_RE.test(phone)) return { ok: false, error: "invalid_phone" };
  }

  let instagram: string | null = null;
  if (b.instagram !== undefined && b.instagram !== null && b.instagram !== "") {
    if (typeof b.instagram !== "string") return { ok: false, error: "invalid_instagram" };
    instagram = b.instagram.trim().replace(/^@/, "").toLowerCase();
    if (!IG_RE.test(instagram)) return { ok: false, error: "invalid_instagram" };
  }

  if (!phone && !instagram) return { ok: false, error: "contact_required" };

  let message: string | null = null;
  if (b.message !== undefined && b.message !== null && b.message !== "") {
    if (typeof b.message !== "string") return { ok: false, error: "invalid_message" };
    message = b.message.trim();
    if (message.length > 500) return { ok: false, error: "invalid_message" };
  }

  return {
    ok: true,
    value: { name, attending: b.attending as boolean, guests, phone, instagram, message },
  };
}

/**
 * Surface the real cause of a 500 in Workers logs without leaking it to the
 * client. Only the error name/message/stack is logged — never request bodies,
 * headers or env values, so secrets cannot end up in observability output.
 */
export function logFailure(route: string, err: unknown): void {
  const detail =
    err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack }
      : { name: "NonError", message: String(err) };
  console.error(`[${route}] unhandled failure`, detail);
}

export async function handleLegacyRsvp(req: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const parsed = parseRsvp(body);
  if (!parsed.ok) {
    // Honeypot hits get a fake success so bots think they landed one.
    if (parsed.error === "honeypot") return json({ ok: true });
    return json({ ok: false, error: parsed.error }, 400);
  }

  const v = parsed.value;
  await env.DB.prepare(
    "INSERT INTO rsvps (name, attending, guests, phone, instagram, message) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
  )
    .bind(v.name, v.attending ? 1 : 0, v.guests, v.phone, v.instagram, v.message)
    .run();

  return json({ ok: true });
}

async function keysMatch(candidate: string | null, secret: string): Promise<boolean> {
  if (!candidate) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(candidate)),
    crypto.subtle.digest("SHA-256", enc.encode(secret)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export async function handleLegacyList(req: Request, env: Env): Promise<Response> {
  if (!(await keysMatch(req.headers.get("x-admin-key"), env.ADMIN_KEY))) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const { results } = await env.DB.prepare(
    "SELECT id, name, attending, guests, phone, instagram, message, created_at FROM rsvps ORDER BY id DESC LIMIT 500"
  ).all();
  return json({ ok: true, rsvps: results });
}
