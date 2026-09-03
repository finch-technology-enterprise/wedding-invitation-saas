/**
 * WS1 — platform schema contract tests.
 *
 * These assert the guarantees the application layer is allowed to rely on:
 * foreign keys actually reject orphans, uniqueness actually prevents
 * duplicate slugs/emails, CHECKs actually reject bad statuses, and the
 * indexes the platform-admin inventory sorts on actually exist. If a future
 * migration weakens one of these, a test fails rather than a production
 * query silently going O(n) or a cross-tenant orphan becoming possible.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { env } from "cloudflare:test";

const now = 1_800_000_000_000;

/** D1 enforces FKs by default; make the assumption explicit and verified. */
async function foreignKeysOn(): Promise<boolean> {
  const row = await env.DB.prepare("PRAGMA foreign_keys").first<{ foreign_keys: number }>();
  return row?.foreign_keys === 1;
}

async function seedTenant(suffix: string) {
  const userId = `u_${suffix}`;
  const tenantId = `t_${suffix}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, is_platform_admin, created_at, updated_at)
       VALUES (?, ?, 'x', 0, ?, ?)`
    ).bind(userId, `${suffix}@example.com`, now, now),
    env.DB.prepare(
      `INSERT INTO tenants (id, name, slug, plan_id, created_at, updated_at)
       VALUES (?, ?, ?, 'plan_hosted_free', ?, ?)`
    ).bind(tenantId, `Tenant ${suffix}`, `tenant-${suffix}`, now, now),
    env.DB.prepare(
      `INSERT INTO tenant_members (tenant_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`
    ).bind(tenantId, userId, now),
  ]);
  return { userId, tenantId };
}

async function seedInvitation(tenantId: string, suffix: string) {
  const id = `i_${suffix}`;
  await env.DB.prepare(
    `INSERT INTO invitations (id, tenant_id, title, slug, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, tenantId, `Invite ${suffix}`, `invite-${suffix}`, now, now)
    .run();
  return id;
}

/**
 * Tests share one database, so each case uses a unique suffix instead of
 * truncating between tests (cheaper, and it also proves rows coexist).
 */
let n = 0;
beforeEach(() => {
  n += 1;
});

describe("schema baseline", () => {
  test("foreign key enforcement is on", async () => {
    expect(await foreignKeysOn()).toBe(true);
  });

  test("every expected table exists and no legacy table survives", async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
    ).all<{ name: string }>();
    const names = results.map((r) => r.name);

    for (const t of [
      "users",
      "sessions",
      "plans",
      "tenants",
      "tenant_members",
      "invitations",
      "invitation_revisions",
      "media_assets",
      "rsvp_forms",
      "rsvp_fields",
      "rsvp_submissions",
      "rsvp_answers",
      "preview_tokens",
      "platform_settings",
      "platform_audit_events",
      "rate_limits",
    ]) {
      expect(names).toContain(t);
    }
  });

  test("seeded plans and settings are present", async () => {
    const plans = await env.DB.prepare("SELECT id, limits_json FROM plans ORDER BY id").all<{
      id: string;
      limits_json: string;
    }>();
    expect(plans.results.map((p) => p.id)).toEqual(["plan_hosted_free", "plan_self_hosted"]);

    // Self-hosted must be unlimited: quota enforcement is hosted-only.
    const selfHosted = plans.results.find((p) => p.id === "plan_self_hosted")!;
    const limits = JSON.parse(selfHosted.limits_json) as Record<string, number | null>;
    expect(Object.values(limits).every((v) => v === null)).toBe(true);

    const setting = await env.DB.prepare(
      "SELECT value_json FROM platform_settings WHERE key = 'registration_enabled'"
    ).first<{ value_json: string }>();
    expect(setting?.value_json).toBe("true");
  });

  test("platform-admin inventory sort columns are indexed", async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index'`
    ).all<{ name: string }>();
    const names = results.map((r) => r.name);

    // Each backs a documented /platform-admin sort or a hot lookup.
    for (const idx of [
      "idx_inv_tenant",
      "idx_inv_slug",
      "idx_inv_status_created",
      "idx_inv_updated",
      "idx_media_inv",
      "idx_media_size",
      "idx_sub_inv_time",
      "idx_sessions_user",
      "idx_rev_inv",
    ]) {
      expect(names).toContain(idx);
    }
  });

  test("slug lookup for a public render uses the slug index, not a scan", async () => {
    const plan = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT id FROM invitations WHERE slug = ?"
    )
      .bind("anything")
      .all<{ detail: string }>();
    const detail = plan.results.map((r) => r.detail).join(" ");
    expect(detail).toMatch(/USING (COVERING )?INDEX/i);
    expect(detail).not.toMatch(/SCAN invitations(?! USING)/i);
  });
});

describe("identity constraints", () => {
  test("email is unique", async () => {
    const { userId } = await seedTenant(`dup${n}`);
    expect(userId).toBeTruthy();
    await expect(
      env.DB.prepare(
        `INSERT INTO users (id, email, password_hash, created_at, updated_at)
         VALUES (?, ?, 'x', ?, ?)`
      )
        .bind(`u_other_${n}`, `dup${n}@example.com`, now, now)
        .run()
    ).rejects.toThrow(/UNIQUE/i);
  });

  test("user status is constrained to known values", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO users (id, email, password_hash, status, created_at, updated_at)
         VALUES (?, ?, 'x', 'banana', ?, ?)`
      )
        .bind(`u_bad_${n}`, `bad${n}@example.com`, now, now)
        .run()
    ).rejects.toThrow(/CHECK/i);
  });

  test("a session cannot reference a missing user", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, 'ghost', ?, ?)`
      )
        .bind(`s_${n}`, now, now + 1000)
        .run()
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  test("deleting a user with a live session is blocked", async () => {
    const { userId } = await seedTenant(`sess${n}`);
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
    )
      .bind(`s_live_${n}`, userId, now, now + 1000)
      .run();

    // RESTRICT, not CASCADE: deletion order is the application's decision.
    await expect(
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run()
    ).rejects.toThrow(/FOREIGN KEY/i);
  });
});

describe("tenancy constraints", () => {
  test("tenant slug is unique", async () => {
    await seedTenant(`slug${n}`);
    await expect(
      env.DB.prepare(
        `INSERT INTO tenants (id, name, slug, created_at, updated_at) VALUES (?, 'Other', ?, ?, ?)`
      )
        .bind(`t_other_${n}`, `tenant-slug${n}`, now, now)
        .run()
    ).rejects.toThrow(/UNIQUE/i);
  });

  test("membership is unique per (tenant, user) and role is constrained", async () => {
    const { tenantId, userId } = await seedTenant(`mem${n}`);

    await expect(
      env.DB.prepare(
        `INSERT INTO tenant_members (tenant_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)`
      )
        .bind(tenantId, userId, now)
        .run()
    ).rejects.toThrow(/UNIQUE|PRIMARY KEY/i);

    await expect(
      env.DB.prepare(
        `INSERT INTO tenant_members (tenant_id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)`
      )
        .bind(tenantId, `u_ghost_${n}`, now)
        .run()
    ).rejects.toThrow(/CHECK|FOREIGN KEY/i);
  });

  test("a tenant may hold multiple invitations from day one", async () => {
    const { tenantId } = await seedTenant(`multi${n}`);
    await seedInvitation(tenantId, `m1_${n}`);
    await seedInvitation(tenantId, `m2_${n}`);
    await seedInvitation(tenantId, `m3_${n}`);

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM invitations WHERE tenant_id = ?"
    )
      .bind(tenantId)
      .first<{ c: number }>();
    expect(row?.c).toBe(3);
  });
});

describe("invitation constraints", () => {
  test("invitation slug is globally unique", async () => {
    const { tenantId } = await seedTenant(`islug${n}`);
    await seedInvitation(tenantId, `dup_${n}`);

    const other = await seedTenant(`islug2_${n}`);
    await expect(
      env.DB.prepare(
        `INSERT INTO invitations (id, tenant_id, title, slug, created_at, updated_at)
         VALUES (?, ?, 'X', ?, ?, ?)`
      )
        .bind(`i_clash_${n}`, other.tenantId, `invite-dup_${n}`, now, now)
        .run()
    ).rejects.toThrow(/UNIQUE/i);
  });

  test("invitation status is constrained, including cleanup states", async () => {
    const { tenantId } = await seedTenant(`st${n}`);
    const id = await seedInvitation(tenantId, `st_${n}`);

    // Cleanup lifecycle states must be representable (WS10 retry safety).
    for (const status of ["published", "unpublished", "disabled", "deleting", "delete_failed"]) {
      await env.DB.prepare("UPDATE invitations SET status = ? WHERE id = ?").bind(status, id).run();
    }

    await expect(
      env.DB.prepare("UPDATE invitations SET status = 'exploded' WHERE id = ?").bind(id).run()
    ).rejects.toThrow(/CHECK/i);
  });

  test("an invitation cannot belong to a missing tenant", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO invitations (id, tenant_id, title, slug, created_at, updated_at)
         VALUES (?, 'ghost', 'X', ?, ?, ?)`
      )
        .bind(`i_ghost_${n}`, `ghost-${n}`, now, now)
        .run()
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  test("published_revision_id must reference a real revision", async () => {
    const { tenantId } = await seedTenant(`rev${n}`);
    const id = await seedInvitation(tenantId, `rev_${n}`);

    await expect(
      env.DB.prepare("UPDATE invitations SET published_revision_id = 'ghost' WHERE id = ?")
        .bind(id)
        .run()
    ).rejects.toThrow(/FOREIGN KEY/i);

    const revId = `r_${n}`;
    await env.DB.prepare(
      `INSERT INTO invitation_revisions (id, invitation_id, config_json, created_at)
       VALUES (?, ?, '{}', ?)`
    )
      .bind(revId, id, now)
      .run();
    await env.DB.prepare(
      "UPDATE invitations SET published_revision_id = ?, status = 'published' WHERE id = ?"
    )
      .bind(revId, id)
      .run();

    const row = await env.DB.prepare(
      "SELECT published_revision_id AS r FROM invitations WHERE id = ?"
    )
      .bind(id)
      .first<{ r: string }>();
    expect(row?.r).toBe(revId);
  });

  test("counters default to zero so accounting never starts NULL", async () => {
    const { tenantId } = await seedTenant(`cnt${n}`);
    const id = await seedInvitation(tenantId, `cnt_${n}`);
    const row = await env.DB.prepare(
      "SELECT media_bytes AS b, rsvp_count AS c, theme_id AS t, status AS s FROM invitations WHERE id = ?"
    )
      .bind(id)
      .first<{ b: number; c: number; t: string; s: string }>();

    expect(row?.b).toBe(0);
    expect(row?.c).toBe(0);
    expect(row?.t).toBe("cinematic-classic");
    expect(row?.s).toBe("draft");
  });
});

describe("media constraints", () => {
  test("storage keys are unique so an object is never double-registered", async () => {
    const { tenantId } = await seedTenant(`mk${n}`);
    const invId = await seedInvitation(tenantId, `mk_${n}`);
    const key = `t/${tenantId}/i/${invId}/a/a1/hero.jpg`;

    const insert = (assetId: string) =>
      env.DB.prepare(
        `INSERT INTO media_assets
           (id, tenant_id, invitation_id, kind, slot, storage_key, original_filename,
            mime_type, byte_size, created_at)
         VALUES (?, ?, ?, 'image', 'hero', ?, 'hero.jpg', 'image/jpeg', 1234, ?)`
      )
        .bind(assetId, tenantId, invId, key, now)
        .run();

    await insert(`a_${n}`);
    await expect(insert(`a_dupe_${n}`)).rejects.toThrow(/UNIQUE/i);
  });

  test("media kind is constrained to image/audio", async () => {
    const { tenantId } = await seedTenant(`mkind${n}`);
    const invId = await seedInvitation(tenantId, `mkind_${n}`);
    await expect(
      env.DB.prepare(
        `INSERT INTO media_assets
           (id, tenant_id, invitation_id, kind, storage_key, original_filename,
            mime_type, byte_size, created_at)
         VALUES (?, ?, ?, 'video', ?, 'x.mp4', 'video/mp4', 1, ?)`
      )
        .bind(`a_bad_${n}`, tenantId, invId, `k_${n}`, now)
        .run()
    ).rejects.toThrow(/CHECK/i);
  });

  test("deleting an invitation with media is blocked (R2 must be cleaned first)", async () => {
    const { tenantId } = await seedTenant(`mdel${n}`);
    const invId = await seedInvitation(tenantId, `mdel_${n}`);
    await env.DB.prepare(
      `INSERT INTO media_assets
         (id, tenant_id, invitation_id, kind, storage_key, original_filename,
          mime_type, byte_size, created_at)
       VALUES (?, ?, ?, 'image', ?, 'h.jpg', 'image/jpeg', 10, ?)`
    )
      .bind(`a_keep_${n}`, tenantId, invId, `k_keep_${n}`, now)
      .run();

    // This is the WS10 guarantee: D1 metadata cannot vanish before R2 cleanup.
    await expect(
      env.DB.prepare("DELETE FROM invitations WHERE id = ?").bind(invId).run()
    ).rejects.toThrow(/FOREIGN KEY/i);
  });
});

describe("RSVP constraints", () => {
  test("one form per invitation", async () => {
    const { tenantId } = await seedTenant(`rf${n}`);
    const invId = await seedInvitation(tenantId, `rf_${n}`);
    const insert = (id: string) =>
      env.DB.prepare(
        `INSERT INTO rsvp_forms (id, invitation_id, created_at, updated_at) VALUES (?, ?, ?, ?)`
      )
        .bind(id, invId, now, now)
        .run();

    await insert(`f_${n}`);
    await expect(insert(`f_dupe_${n}`)).rejects.toThrow(/UNIQUE/i);
  });

  test("field keys are unique per form and kinds are constrained", async () => {
    const { tenantId } = await seedTenant(`rk${n}`);
    const invId = await seedInvitation(tenantId, `rk_${n}`);
    const formId = `f_k_${n}`;
    await env.DB.prepare(
      `INSERT INTO rsvp_forms (id, invitation_id, created_at, updated_at) VALUES (?, ?, ?, ?)`
    )
      .bind(formId, invId, now, now)
      .run();

    const field = (id: string, key: string, kind: string) =>
      env.DB.prepare(
        `INSERT INTO rsvp_fields (id, form_id, key, kind, label, position)
         VALUES (?, ?, ?, ?, 'Label', 0)`
      )
        .bind(id, formId, key, kind)
        .run();

    await field(`fd_${n}`, "name", "name");
    await expect(field(`fd_dupe_${n}`, "name", "text")).rejects.toThrow(/UNIQUE/i);
    await expect(field(`fd_bad_${n}`, "weird", "signature")).rejects.toThrow(/CHECK/i);

    // Custom field kinds from the spec must all be accepted.
    let i = 0;
    for (const kind of ["text", "textarea", "number", "select", "radio", "checkbox"]) {
      await field(`fd_${kind}_${n}`, `custom_${i++}`, kind);
    }
  });

  test("submissions and answers require real parents", async () => {
    const { tenantId } = await seedTenant(`rs${n}`);
    const invId = await seedInvitation(tenantId, `rs_${n}`);
    const formId = `f_s_${n}`;
    await env.DB.prepare(
      `INSERT INTO rsvp_forms (id, invitation_id, created_at, updated_at) VALUES (?, ?, ?, ?)`
    )
      .bind(formId, invId, now, now)
      .run();

    await expect(
      env.DB.prepare(
        `INSERT INTO rsvp_submissions (id, invitation_id, form_id, contact_name, created_at)
         VALUES (?, ?, 'ghost', 'X', ?)`
      )
        .bind(`sub_bad_${n}`, invId, now)
        .run()
    ).rejects.toThrow(/FOREIGN KEY/i);

    await env.DB.prepare(
      `INSERT INTO rsvp_submissions
         (id, invitation_id, form_id, attending, guest_count, contact_name, created_at)
       VALUES (?, ?, ?, 1, 2, 'Guest', ?)`
    )
      .bind(`sub_${n}`, invId, formId, now)
      .run();

    await expect(
      env.DB.prepare(
        `INSERT INTO rsvp_answers (submission_id, field_id, value_text) VALUES (?, 'ghost', 'v')`
      )
        .bind(`sub_${n}`)
        .run()
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  test("a checkbox field can store multiple answers per submission", async () => {
    const { tenantId } = await seedTenant(`ra${n}`);
    const invId = await seedInvitation(tenantId, `ra_${n}`);
    const formId = `f_a_${n}`;
    const fieldId = `fd_a_${n}`;
    const subId = `sub_a_${n}`;

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO rsvp_forms (id, invitation_id, created_at, updated_at) VALUES (?, ?, ?, ?)`
      ).bind(formId, invId, now, now),
      env.DB.prepare(
        `INSERT INTO rsvp_fields (id, form_id, key, kind, label, position)
         VALUES (?, ?, 'meals', 'checkbox', 'Meals', 1)`
      ).bind(fieldId, formId),
      env.DB.prepare(
        `INSERT INTO rsvp_submissions (id, invitation_id, form_id, contact_name, created_at)
         VALUES (?, ?, ?, 'Guest', ?)`
      ).bind(subId, invId, formId, now),
    ]);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO rsvp_answers (submission_id, field_id, value_text) VALUES (?, ?, 'veg')`
      ).bind(subId, fieldId),
      env.DB.prepare(
        `INSERT INTO rsvp_answers (submission_id, field_id, value_text) VALUES (?, ?, 'halal')`
      ).bind(subId, fieldId),
    ]);

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM rsvp_answers WHERE submission_id = ?"
    )
      .bind(subId)
      .first<{ c: number }>();
    expect(row?.c).toBe(2);

    // ...but the exact same value cannot be recorded twice.
    await expect(
      env.DB.prepare(
        `INSERT INTO rsvp_answers (submission_id, field_id, value_text) VALUES (?, ?, 'veg')`
      )
        .bind(subId, fieldId)
        .run()
    ).rejects.toThrow(/UNIQUE|PRIMARY KEY/i);
  });
});

describe("preview and platform tables", () => {
  test("preview token hashes are unique and bound to an invitation", async () => {
    const { tenantId } = await seedTenant(`pv${n}`);
    const invId = await seedInvitation(tenantId, `pv_${n}`);
    const insert = (id: string) =>
      env.DB.prepare(
        `INSERT INTO preview_tokens (id, invitation_id, token_hash, scope, expires_at, created_at)
         VALUES (?, ?, ?, 'draft', ?, ?)`
      )
        .bind(id, invId, `hash_${n}`, now + 3600_000, now)
        .run();

    await insert(`pt_${n}`);
    await expect(insert(`pt_dupe_${n}`)).rejects.toThrow(/UNIQUE/i);
  });

  test("audit events survive without an actor (system actions)", async () => {
    await env.DB.prepare(
      `INSERT INTO platform_audit_events
         (id, actor_user_id, action, target_type, target_id, ok, created_at)
       VALUES (?, NULL, 'system.recalc', 'platform', 'global', 1, ?)`
    )
      .bind(`ev_${n}`, now)
      .run();

    const row = await env.DB.prepare(
      "SELECT actor_user_id AS a FROM platform_audit_events WHERE id = ?"
    )
      .bind(`ev_${n}`)
      .first<{ a: string | null }>();
    expect(row?.a).toBeNull();
  });

  test("rate limit buckets are keyed and overwritable", async () => {
    await env.DB.prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT (key) DO UPDATE SET count = count + 1`
    )
      .bind(`login:1.2.3.4:${n}`, now)
      .run();
    await env.DB.prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT (key) DO UPDATE SET count = count + 1`
    )
      .bind(`login:1.2.3.4:${n}`, now)
      .run();

    const row = await env.DB.prepare("SELECT count AS c FROM rate_limits WHERE key = ?")
      .bind(`login:1.2.3.4:${n}`)
      .first<{ c: number }>();
    expect(row?.c).toBe(2);
  });
});
