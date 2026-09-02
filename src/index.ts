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

/** Photography slots under /assets/photos/ — see the fetch handler. */
const PHOTO_SLOT_RE = /^\/assets\/photos\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|avif)$/;

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
function logFailure(route: string, err: unknown): void {
  const detail =
    err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack }
      : { name: "NonError", message: String(err) };
  console.error(`[${route}] unhandled failure`, detail);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handleRsvp(req: Request, env: Env): Promise<Response> {
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

async function handleList(req: Request, env: Env): Promise<Response> {
  if (!(await keysMatch(req.headers.get("x-admin-key"), env.ADMIN_KEY))) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const { results } = await env.DB.prepare(
    "SELECT id, name, attending, guests, phone, instagram, message, created_at FROM rsvps ORDER BY id DESC LIMIT 500"
  ).all();
  return json({ ok: true, rsvps: results });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api/rsvp") {
      if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
      try {
        return await handleRsvp(req, env);
      } catch (err) {
        logFailure("POST /api/rsvp", err);
        return json({ ok: false, error: "server_error" }, 500);
      }
    }

    if (path === "/api/rsvps") {
      if (req.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
      try {
        return await handleList(req, env);
      } catch (err) {
        logFailure("GET /api/rsvps", err);
        return json({ ok: false, error: "server_error" }, 500);
      }
    }

    // Photography slots are optional by design: the invitation renders a
    // composed placeholder until a file is supplied. Answer an unfilled
    // slot with 204 rather than 404 so an incomplete photo set is a
    // normal state instead of console/network noise for every visitor.
    if (PHOTO_SLOT_RE.test(path)) {
      const asset = await env.ASSETS.fetch(req);
      return asset.status === 404 ? new Response(null, { status: 204 }) : asset;
    }

    return json({ ok: false, error: "not_found" }, 404);
  },
};
