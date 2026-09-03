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

/**
 * Structured failure logging.
 *
 * Records the error *type* and origin frame, not its message. V8 embeds a
 * snippet of the offending input in JSON.parse errors, so logging
 * messages verbatim would put invitation copy — and potentially guest
 * replies — into operational logs on a corrupt row.
 */
export function logFailure(scope: string, err: unknown): void {
  if (err instanceof Error) {
    console.error(scope, err.name, err.stack?.split("\n")[1]?.trim() ?? "");
  } else {
    console.error(scope, "non_error_thrown");
  }
}
