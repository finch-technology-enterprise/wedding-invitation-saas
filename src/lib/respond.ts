/** Consistent API envelope: { ok: true, ... } or { ok: false, error }. */

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function fail(error: string, status = 400, extra?: Record<string, unknown>): Response {
  return json({ ok: false, error, ...extra }, status);
}

export function ok(data: Record<string, unknown> = {}): Response {
  return json({ ok: true, ...data });
}
