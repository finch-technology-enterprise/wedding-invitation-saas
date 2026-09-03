/**
 * Centralized authorization.
 *
 * Every admin-facing read or write resolves access through this module.
 * The rule that prevents IDOR is structural: a caller never supplies a
 * tenant that is then trusted — ownership is always re-derived from the
 * session against the database, and resource lookups are scoped by the
 * verified tenant in the same SQL statement rather than checked afterwards.
 */

import type { AuthContext } from "./session.js";
import { resolveSession } from "./session.js";
import { verificationRequired } from "./email.js";

export type Role = "owner" | "member";

export class AccessError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code);
  }
}

export const UNAUTHORIZED = new AccessError("unauthorized", 401);
/**
 * Missing and forbidden both surface as 404 for tenant-scoped resources.
 * A 403 would confirm that an ID exists in someone else's tenant, which is
 * itself an information leak.
 */
export const NOT_FOUND = new AccessError("not_found", 404);

export async function requireUser(req: Request, env: Env): Promise<AuthContext> {
  const ctx = await resolveSession(req, env);
  if (!ctx) throw UNAUTHORIZED;
  return ctx;
}

export async function requirePlatformAdmin(req: Request, env: Env): Promise<AuthContext> {
  const ctx = await requireUser(req, env);
  if (!ctx.user.isPlatformAdmin) throw NOT_FOUND;
  return ctx;
}

/**
 * Unverified-account policy, in one place.
 *
 * An unverified hosted user may sign in, see their state, resend the
 * email and sign out — enough to recover — but may not create or change
 * anything. Enforcing it inside requireTenant/requireInvitation means
 * every tenant mutation inherits it; no handler can forget.
 *
 * Self-hosted deployments without a mail provider are unaffected:
 * verificationRequired() is false there, and existing users were
 * migrated as verified.
 */
function requireVerifiedEmail(ctx: AuthContext, env: Env): void {
  if (!verificationRequired(env)) return;
  if (ctx.user.emailVerified) return;
  throw new AccessError("email_not_verified", 403);
}

export interface TenantAccess {
  auth: AuthContext;
  tenantId: string;
  role: Role;
}

/**
 * Verify the caller belongs to `tenantId`. Platform admins are NOT granted
 * implicit tenant membership: operator tooling lives under /platform-admin
 * with its own audited routes, so a stolen operator session cannot silently
 * act as a tenant through the ordinary admin API.
 */
export async function requireTenant(
  req: Request,
  env: Env,
  tenantId: string
): Promise<TenantAccess> {
  const auth = await requireUser(req, env);

  const row = await env.DB.prepare(
    `SELECT m.role, t.status
     FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id
     WHERE m.tenant_id = ? AND m.user_id = ?`
  )
    .bind(tenantId, auth.user.id)
    .first<{ role: Role; status: string }>();

  if (!row) throw NOT_FOUND;
  if (row.status !== "active") throw new AccessError("tenant_suspended", 403);
  requireVerifiedEmail(auth, env);

  return { auth, tenantId, role: row.role };
}

export async function requireTenantOwner(
  req: Request,
  env: Env,
  tenantId: string
): Promise<TenantAccess> {
  const access = await requireTenant(req, env, tenantId);
  if (access.role !== "owner") throw new AccessError("forbidden", 403);
  return access;
}

export interface InvitationAccess extends TenantAccess {
  invitationId: string;
}

/**
 * Resolve an invitation the caller may administer.
 *
 * The membership join is part of the lookup, so an invitation belonging to
 * another tenant is indistinguishable from one that does not exist — there
 * is no window in which the row is fetched and then checked.
 */
export async function requireInvitation(
  req: Request,
  env: Env,
  invitationId: string
): Promise<InvitationAccess> {
  const auth = await requireUser(req, env);

  const row = await env.DB.prepare(
    `SELECT i.id AS invitationId, i.tenant_id AS tenantId, m.role, t.status
     FROM invitations i
     JOIN tenant_members m ON m.tenant_id = i.tenant_id AND m.user_id = ?
     JOIN tenants t ON t.id = i.tenant_id
     WHERE i.id = ?`
  )
    .bind(auth.user.id, invitationId)
    .first<{ invitationId: string; tenantId: string; role: Role; status: string }>();

  if (!row) throw NOT_FOUND;
  if (row.status !== "active") throw new AccessError("tenant_suspended", 403);
  requireVerifiedEmail(auth, env);

  return { auth, tenantId: row.tenantId, role: row.role, invitationId: row.invitationId };
}
