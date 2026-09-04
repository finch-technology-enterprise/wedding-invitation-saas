/**
 * Entitlements (V2 §7.1). Plans stay the seam; no `if (plan === "pro")`
 * scattered in handlers. Capability checks only.
 */

export interface Entitlements {
  maxInvitations: number | null;
  maxMediaBytesPerTenant: number | null;
  maxMediaBytesPerInvitation: number | null;
  maxImageBytes: number | null;
  maxAudioBytes: number | null;
  maxRsvpResponses: number | null;
  maxGuests: number | null;
  premiumThemes: string[];
  customDomain: boolean;
  analytics: boolean;
  brandingRemoval: boolean;
}

const UNLIMITED: Entitlements = {
  maxInvitations: null,
  maxMediaBytesPerTenant: null,
  maxMediaBytesPerInvitation: null,
  maxImageBytes: null,
  maxAudioBytes: null,
  maxRsvpResponses: null,
  maxGuests: null,
  premiumThemes: [],
  customDomain: false,
  analytics: false,
  brandingRemoval: false,
};

function parseJson(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    return typeof v === "object" && v !== null ? v : {};
  } catch {
    return {};
  }
}

export async function entitlementsFor(env: Env, tenantId: string): Promise<Entitlements> {
  const { deploymentMode } = await import("./mode.js");
  if (deploymentMode(env) !== "hosted") return { ...UNLIMITED };
  const row = await env.DB.prepare(
    `SELECT p.limits_json AS limitsJson, p.capabilities_json AS capsJson,
            t.quota_overrides_json AS overrides
     FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
     WHERE t.id = ?`
  )
    .bind(tenantId)
    .first<{ limitsJson: string | null; capsJson: string | null; overrides: string | null }>();
  const limits = parseJson(row?.limitsJson ?? null);
  const caps = parseJson(row?.capsJson ?? null);
  const overrides = parseJson(row?.overrides ?? null);
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
  const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const bool = (v: unknown): boolean => v === true;
  return {
    maxInvitations: (overrides.maxInvitations ?? limits.maxInvitations ?? null) as number | null !== undefined
      ? (num(overrides.maxInvitations ?? limits.maxInvitations) ?? null)
      : null,
    maxMediaBytesPerTenant: num(overrides.maxMediaBytesPerTenant ?? limits.maxMediaBytesPerTenant) ?? null,
    maxMediaBytesPerInvitation: num(overrides.maxMediaBytesPerInvitation ?? limits.maxMediaBytesPerInvitation) ?? null,
    maxImageBytes: num(overrides.maxImageBytes ?? limits.maxImageBytes) ?? null,
    maxAudioBytes: num(overrides.maxAudioBytes ?? limits.maxAudioBytes) ?? null,
    maxRsvpResponses: num(overrides.maxRsvpResponses ?? limits.maxRsvpResponses) ?? null,
    maxGuests: num(overrides.maxGuests ?? limits.maxGuests ?? caps.maxGuests) ?? null,
    premiumThemes: strList(caps.premiumThemes),
    customDomain: bool(caps.customDomain),
    analytics: bool(caps.analytics),
    brandingRemoval: bool(caps.brandingRemoval),
  };
}

export function canUseTheme(e: Entitlements, themeId: string, isPremium: (id: string) => boolean): boolean {
  if (!isPremium(themeId)) return true;
  return e.premiumThemes.includes(themeId) || e.premiumThemes.includes("*");
}
