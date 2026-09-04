/**
 * RSVP: admin configuration, responses, export, and the public endpoint.
 *
 * Publication semantics matter most here. A guest submits against the
 * schema that was published, never against the admin's working draft —
 * otherwise a tenant editing their form would silently invalidate replies
 * to the version guests are still looking at.
 *
 * The form definition is therefore snapshotted into the revision config
 * at publish time, and the public submit path reads it from there.
 */

import { Hono } from "hono";
import { fail, ok } from "../lib/respond.js";
import { newId } from "../lib/ids.js";
import { nowMs } from "../lib/time.js";
import { deploymentMode } from "../lib/mode.js";
import { clientIpHash, isSameOrigin, rateLimit } from "../lib/guard.js";
import { requireInvitation } from "../lib/authz.js";
import { csvFilename, toCsv } from "../lib/csv.js";
import {
  defaultFormDefinition,
  validateFormDefinition,
  validateSubmission,
  type FormDefinition,
} from "../lib/rsvp.js";
import { limitsFor } from "./tenants.js";

export const rsvp = new Hono<{ Bindings: Env }>();

rsvp.use("/*", async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && !isSameOrigin(c.req.raw)) {
    return fail("csrf", 403);
  }
  await next();
});

/**
 * Load the working form definition, materializing the default on first
 * read so a new invitation already has the frozen cinematic schema.
 */
async function loadForm(env: Env, invitationId: string): Promise<FormDefinition> {
  const row = await env.DB.prepare(
    `SELECT id, enabled, deadline_at AS deadlineAt, guest_limit AS guestLimit,
            success_title AS successTitle, success_body AS successBody
     FROM rsvp_forms WHERE invitation_id = ?`
  )
    .bind(invitationId)
    .first<{
      id: string;
      enabled: number;
      deadlineAt: number | null;
      guestLimit: number | null;
      successTitle: string | null;
      successBody: string | null;
    }>();

  if (!row) return defaultFormDefinition();

  const { results } = await env.DB.prepare(
    `SELECT id, key, kind, label, required, options_json AS optionsJson, position
     FROM rsvp_fields WHERE form_id = ? ORDER BY position`
  )
    .bind(row.id)
    .all<{
      id: string;
      key: string;
      kind: string;
      label: string;
      required: number;
      optionsJson: string | null;
      position: number;
    }>();

  return {
    enabled: row.enabled === 1,
    deadlineAt: row.deadlineAt,
    guestLimit: row.guestLimit ?? 12,
    successTitle: row.successTitle,
    successBody: row.successBody,
    fields: results.map((f) => ({
      id: f.id,
      key: f.key,
      kind: f.kind as FormDefinition["fields"][number]["kind"],
      label: f.label,
      required: f.required === 1,
      enabled: true,
      position: f.position,
      builtIn: !["text", "textarea", "number", "select", "radio", "checkbox"].includes(f.kind),
      ...(f.optionsJson ? { options: JSON.parse(f.optionsJson) } : {}),
    })),
  };
}

// ------------------------------------------------------- admin: form config

rsvp.get("/:invitationId/rsvp", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));
  return ok({ form: await loadForm(c.env, access.invitationId) });
});

/**
 * Replace the form definition.
 *
 * Field rows are preserved by ID wherever the client sent one back, so
 * renaming a label leaves historical answers intact — answers reference
 * the field row, never its text.
 */
rsvp.put("/:invitationId/rsvp", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return fail("invalid_body");
  }

  const result = validateFormDefinition(body);
  if (!result.ok) return fail("invalid_form", 422, { errors: result.errors });
  const form = result.form!;

  const now = nowMs();
  const existing = await c.env.DB.prepare("SELECT id FROM rsvp_forms WHERE invitation_id = ?")
    .bind(access.invitationId)
    .first<{ id: string }>();
  const formId = existing?.id ?? newId();

  const statements = [
    existing
      ? c.env.DB.prepare(
          `UPDATE rsvp_forms SET enabled = ?, deadline_at = ?, guest_limit = ?,
             success_title = ?, success_body = ?, updated_at = ? WHERE id = ?`
        ).bind(
          form.enabled ? 1 : 0,
          form.deadlineAt,
          form.guestLimit,
          form.successTitle,
          form.successBody,
          now,
          formId
        )
      : c.env.DB.prepare(
          `INSERT INTO rsvp_forms
             (id, invitation_id, enabled, deadline_at, guest_limit, success_title,
              success_body, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          formId,
          access.invitationId,
          form.enabled ? 1 : 0,
          form.deadlineAt,
          form.guestLimit,
          form.successTitle,
          form.successBody,
          now,
          now
        ),
  ];

  // Keep rows that still exist so their answers stay attached; drop only
  // fields the tenant actually removed.
  const keptIds = form.fields.map((f) => f.id).filter(Boolean);
  if (keptIds.length) {
    const placeholders = keptIds.map(() => "?").join(", ");
    statements.push(
      c.env.DB.prepare(
        `DELETE FROM rsvp_fields WHERE form_id = ? AND id NOT IN (${placeholders})`
      ).bind(formId, ...keptIds)
    );
  } else {
    statements.push(
      c.env.DB.prepare("DELETE FROM rsvp_fields WHERE form_id = ?").bind(formId)
    );
  }

  form.fields.forEach((field, index) => {
    const id = field.id || newId();
    field.id = id;
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO rsvp_fields (id, form_id, key, kind, label, required, options_json, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           key = excluded.key, kind = excluded.kind, label = excluded.label,
           required = excluded.required, options_json = excluded.options_json,
           position = excluded.position`
      ).bind(
        id,
        formId,
        field.key,
        field.kind,
        field.label,
        field.required ? 1 : 0,
        field.options ? JSON.stringify(field.options) : null,
        index
      )
    );
  });

  await c.env.DB.batch(statements);
  return ok({ form: await loadForm(c.env, access.invitationId) });
});

// ---------------------------------------------------------- admin: responses

rsvp.get("/:invitationId/responses", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));

  const limit = Math.min(Number(c.req.query("limit") ?? 25) || 25, 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  const search = (c.req.query("q") ?? "").trim();
  const attendingFilter = c.req.query("attending");

  const where: string[] = ["s.invitation_id = ?"];
  const params: unknown[] = [access.invitationId];

  if (search) {
    where.push(
      "(s.contact_name LIKE ? OR s.contact_phone LIKE ? OR s.contact_email LIKE ? OR s.contact_instagram LIKE ?)"
    );
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (attendingFilter === "yes") where.push("s.attending = 1");
  if (attendingFilter === "no") where.push("s.attending = 0");

  const clause = where.join(" AND ");

  const [page, total, summary] = await c.env.DB.batch<any>([
    c.env.DB.prepare(
      `SELECT s.id, s.contact_name AS contactName, s.attending, s.guest_count AS guestCount,
              s.contact_phone AS contactPhone, s.contact_email AS contactEmail,
              s.contact_instagram AS contactInstagram, s.created_at AS createdAt
       FROM rsvp_submissions s WHERE ${clause}
       ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS c FROM rsvp_submissions s WHERE ${clause}`).bind(...params),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN attending = 1 THEN 1 ELSE 0 END), 0) AS attending,
              COALESCE(SUM(CASE WHEN attending = 0 THEN 1 ELSE 0 END), 0) AS declined,
              COALESCE(SUM(CASE WHEN attending = 1 THEN guest_count ELSE 0 END), 0) AS guests
       FROM rsvp_submissions WHERE invitation_id = ?`
    ).bind(access.invitationId),
  ]);

  const rows = page.results as Array<{ id: string }>;
  const answers = await loadAnswers(c.env, rows.map((r) => r.id));

  return ok({
    responses: rows.map((r) => ({ ...r, answers: answers.get(r.id) ?? [] })),
    total: (total.results[0] as { c: number }).c,
    summary: summary.results[0],
  });
});

/** Custom answers for a page of submissions, labelled for display. */
async function loadAnswers(
  env: Env,
  submissionIds: string[]
): Promise<Map<string, Array<{ label: string; value: string }>>> {
  const out = new Map<string, Array<{ label: string; value: string }>>();
  if (!submissionIds.length) return out;

  const placeholders = submissionIds.map(() => "?").join(", ");
  const { results } = await env.DB.prepare(
    `SELECT a.submission_id AS submissionId, f.label, f.options_json AS optionsJson, a.value_text AS value
     FROM rsvp_answers a JOIN rsvp_fields f ON f.id = a.field_id
     WHERE a.submission_id IN (${placeholders})
     ORDER BY f.position`
  )
    .bind(...submissionIds)
    .all<{ submissionId: string; label: string; optionsJson: string | null; value: string }>();

  for (const row of results) {
    // Show the option's label, not its stored machine value.
    let display = row.value;
    if (row.optionsJson) {
      try {
        const options = JSON.parse(row.optionsJson) as Array<{ value: string; label: string }>;
        display = options.find((o) => o.value === row.value)?.label ?? row.value;
      } catch {
        /* keep the raw value */
      }
    }
    const list = out.get(row.submissionId) ?? [];
    list.push({ label: row.label, value: display });
    out.set(row.submissionId, list);
  }
  return out;
}

// --------------------------------------------------------------- admin: CSV

rsvp.get("/:invitationId/responses.csv", async (c) => {
  const access = await requireInvitation(c.req.raw, c.env, c.req.param("invitationId"));

  const form = await loadForm(c.env, access.invitationId);
  const custom = form.fields.filter((f) => !f.builtIn);

  const { results: subs } = await c.env.DB.prepare(
    `SELECT id, contact_name AS contactName, attending, guest_count AS guestCount,
            contact_phone AS contactPhone, contact_email AS contactEmail,
            contact_instagram AS contactInstagram, created_at AS createdAt
     FROM rsvp_submissions WHERE invitation_id = ? ORDER BY created_at DESC`
  )
    .bind(access.invitationId)
    .all<{
      id: string;
      contactName: string;
      attending: number | null;
      guestCount: number;
      contactPhone: string | null;
      contactEmail: string | null;
      contactInstagram: string | null;
      createdAt: number;
    }>();

  const answers = await loadAnswers(c.env, subs.map((s) => s.id));

  const headers = [
    "Name",
    "Attending",
    "Guests",
    "Phone",
    "Email",
    "Instagram",
    "Replied at",
    ...custom.map((f) => f.label),
  ];

  const rows = subs.map((s) => {
    const byLabel = new Map<string, string[]>();
    for (const a of answers.get(s.id) ?? []) {
      byLabel.set(a.label, [...(byLabel.get(a.label) ?? []), a.value]);
    }
    return [
      s.contactName,
      s.attending === 1 ? "Yes" : s.attending === 0 ? "No" : "",
      s.guestCount,
      s.contactPhone ?? "",
      s.contactEmail ?? "",
      s.contactInstagram ?? "",
      new Date(s.createdAt).toISOString(),
      ...custom.map((f) => (byLabel.get(f.label) ?? []).join("; ")),
    ];
  });

  const invitation = await c.env.DB.prepare("SELECT slug FROM invitations WHERE id = ?")
    .bind(access.invitationId)
    .first<{ slug: string }>();

  return new Response(toCsv(headers, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${csvFilename(invitation?.slug ?? "responses")}"`,
      "cache-control": "no-store",
    },
  });
});

// ----------------------------------------------------------- public: submit

const SUBMIT_LIMIT = 6;
const SUBMIT_WINDOW_MS = 10 * 60 * 1000;

/**
 * POST /i/{slug}/rsvp
 *
 * Scoped by slug, so a submission can only ever land on the invitation
 * whose page produced it. Validated against the published form snapshot.
 */
export async function handlePublicRsvp(req: Request, env: Env, slug: string): Promise<Response> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return fail("invitation_not_found", 404);
  if (!isSameOrigin(req)) return fail("csrf", 403);

  const invitation = await env.DB.prepare(
    `SELECT i.id, i.tenant_id AS tenantId, i.rsvp_count AS rsvpCount,
            r.config_json AS configJson
     FROM invitations i
     JOIN invitation_revisions r ON r.id = i.published_revision_id
     WHERE i.slug = ? AND i.status = 'published'`
  )
    .bind(slug)
    .first<{ id: string; tenantId: string; rsvpCount: number; configJson: string }>();

  // An unpublished invitation has no public form to submit to.
  if (!invitation) return fail("invitation_not_found", 404);

  const ipHash = await clientIpHash(req);
  const limit = await rateLimit(env, `rsvp:${invitation.id}:${ipHash}`, SUBMIT_LIMIT, SUBMIT_WINDOW_MS);
  if (!limit.allowed) return fail("rate_limited", 429, { retryAfter: limit.retryAfterSec });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("invalid_body");
  }

  // Honeypot: a real guest never fills a field they cannot see. Answered
  // with success so a bot learns nothing from the response.
  if (typeof (body as Record<string, unknown>)?.website === "string" &&
      (body as Record<string, string>).website.length > 0) {
    return ok({});
  }

  // Idempotency (V2 §1.5): client-generated stable key per logical
  // submission. Retries return the original submission; a new RSVP uses a
  // new key. Legacy clients without a key keep the old behavior.
  // Protocol keys are stripped before form validation (which rejects
  // unknown fields) — they are transport, not answers.
  const record = (body ?? {}) as Record<string, unknown>;
  const rawKey = record.idempotencyKey;
  const idempotencyKey =
    typeof rawKey === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(rawKey) ? rawKey : null;
  const submissionBody: Record<string, unknown> = { ...record };
  delete submissionBody.idempotencyKey;
  delete submissionBody.partyToken;
  if (idempotencyKey) {
    const existing = await env.DB.prepare(
      "SELECT id FROM rsvp_submissions WHERE invitation_id = ? AND idempotency_key = ?"
    )
      .bind(invitation.id, idempotencyKey)
      .first<{ id: string }>();
    if (existing) return ok({ submissionId: existing.id, deduped: true });
  }

  // The published snapshot — not the admin's current draft.
  let form: FormDefinition;
  try {
    const config = JSON.parse(invitation.configJson) as { rsvpForm?: FormDefinition };
    form = config.rsvpForm ?? defaultFormDefinition();
  } catch {
    form = defaultFormDefinition();
  }

  const result = validateSubmission(submissionBody, form, nowMs());
  if (!result.ok) {
    const closed = result.errors.find((e) => e.code === "rsvp_closed" || e.code === "rsvp_disabled");
    if (closed) return fail(closed.code, 403);
    return fail("invalid_submission", 422, { errors: result.errors });
  }

  const limits = await limitsFor(env, invitation.tenantId);
  if (limits.maxRsvpResponses !== null && invitation.rsvpCount >= limits.maxRsvpResponses) {
    // Deliberately vague: a guest should not learn the couple's plan tier.
    return fail("rsvp_closed", 403);
  }

  const value = result.value!;
  const submissionId = newId();
  const now = nowMs();
  // Optional personalized RSVP: party token binds the reply to a guest
  // party without forcing restricted mode on every wedding.
  const rawParty = (body as Record<string, unknown>)?.partyToken;
  let partyId: string | null = null;
  if (typeof rawParty === "string" && rawParty.length >= 16 && rawParty.length <= 128) {
    const { resolvePartyByToken } = await import("../lib/guests.js");
    const party = await resolvePartyByToken(env, invitation.id, rawParty).catch(() => null);
    partyId = party?.id ?? null;
  }

  const formRow = await env.DB.prepare("SELECT id FROM rsvp_forms WHERE invitation_id = ?")
    .bind(invitation.id)
    .first<{ id: string }>();

  // Materialize the form on first submission so the FK is satisfiable
  // even when the tenant never opened the RSVP editor.
  let formId = formRow?.id;
  if (!formId) {
    formId = newId();
    await env.DB.prepare(
      `INSERT INTO rsvp_forms (id, invitation_id, enabled, guest_limit, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)`
    )
      .bind(formId, invitation.id, form.guestLimit, now, now)
      .run();
  }

  const statements = [
    env.DB.prepare(
      `INSERT INTO rsvp_submissions
         (id, invitation_id, form_id, attending, guest_count, contact_name,
          contact_phone, contact_email, contact_instagram, created_at, updated_at, ip_hash,
          idempotency_key, party_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      submissionId,
      invitation.id,
      formId,
      value.attending,
      value.guestCount,
      value.contactName,
      value.contactPhone,
      value.contactEmail,
      value.contactInstagram,
      now,
      now,
      ipHash,
      idempotencyKey,
      partyId
    ),
    // Counter in the same batch as the row it counts.
    env.DB.prepare("UPDATE invitations SET rsvp_count = rsvp_count + 1 WHERE id = ?").bind(
      invitation.id
    ),
  ];

  for (const answer of value.answers) {
    if (!answer.fieldId) continue;
    for (const single of answer.values) {
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO rsvp_answers (submission_id, field_id, value_text)
           VALUES (?, ?, ?)`
        ).bind(submissionId, answer.fieldId, single)
      );
    }
  }

  try {
    await env.DB.batch(statements);
  } catch (err) {
    // Idempotency race: another request with the same key won. Return it.
    if (idempotencyKey && String(err).includes("UNIQUE")) {
      const winner = await env.DB.prepare(
        "SELECT id FROM rsvp_submissions WHERE invitation_id = ? AND idempotency_key = ?"
      )
        .bind(invitation.id, idempotencyKey)
        .first<{ id: string }>();
      if (winner) return ok({ submissionId: winner.id, deduped: true });
    }
    // Never log the submission itself: it is guest personal data.
    console.error("rsvp_insert_failed", {
      invitationId: invitation.id,
      error: String(err).slice(0, 200),
    });
    return fail("server_error", 500);
  }

  return ok({ submissionId, deduped: false });
}

/**
 * Snapshot the form into the published revision. Called at publish time.
 *
 * Materializes the default form first if the tenant never opened the RSVP
 * editor. Without persisted rows the default fields have no IDs, and
 * answers — which reference a field row, not its label — would have
 * nothing to attach to, silently discarding what a guest wrote.
 */
export async function snapshotForm(env: Env, invitationId: string): Promise<FormDefinition> {
  const existing = await env.DB.prepare("SELECT id FROM rsvp_forms WHERE invitation_id = ?")
    .bind(invitationId)
    .first<{ id: string }>();

  if (!existing) {
    const form = defaultFormDefinition();
    const formId = newId();
    const now = nowMs();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO rsvp_forms (id, invitation_id, enabled, guest_limit, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?, ?)`
      ).bind(formId, invitationId, form.guestLimit, now, now),
      ...form.fields.map((field, index) => {
        field.id = newId();
        return env.DB.prepare(
          `INSERT INTO rsvp_fields (id, form_id, key, kind, label, required, position)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(field.id, formId, field.key, field.kind, field.label, field.required ? 1 : 0, index);
      }),
    ]);
  }

  return loadForm(env, invitationId);
}

export { deploymentMode };
