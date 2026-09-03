/**
 * API client.
 *
 * Authentication is the WS2 session cookie — HttpOnly, so this code
 * cannot read it and does not try. Nothing is kept in localStorage,
 * sessionStorage or the URL; the server session is the only source of
 * truth and the UI derives its state from /auth/session.
 */

const BASE = "/api/v1";

export interface ApiErrorShape {
  error: string;
  errors?: Array<{ path: string; code: string; limit?: number; actual?: number }>;
  retryAfter?: number;
  limit?: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: ApiErrorShape
  ) {
    super(payload.error);
  }

  /** Field-level validation problems, keyed by config path. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.payload.errors ?? []) {
      out[e.path] = describeFieldError(e);
    }
    return out;
  }
}

function describeFieldError(e: NonNullable<ApiErrorShape["errors"]>[number]): string {
  switch (e.code) {
    case "too_long":
      return `Too long — ${e.actual} of ${e.limit} characters`;
    case "too_many_items":
      return `Too many items — limit is ${e.limit}`;
    case "unknown_property":
      return "Not supported by this theme";
    case "no_newlines":
      return "Line breaks are not allowed here";
    case "focal_out_of_range":
      return "Focal point must be between 0 and 100";
    case "invalid_datetime":
      return "Not a valid date and time";
    case "asset_not_found":
      return "That file is no longer available";
    case "asset_kind_mismatch":
      return "Wrong kind of file for this slot";
    case "invalid_url":
      return "Must be a valid http(s) link";
    case "out_of_range":
      return "Outside the supported range";
    default:
      return e.code.replace(/_/g, " ");
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  // Marks the request as a scripted same-origin call. The Worker's CSRF
  // check accepts Origin/Referer too; this covers the case where a
  // browser sends neither.
  headers.set("x-requested-with", "fetch");

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = { error: "server_error" };
  }

  if (!res.ok) throw new ApiError(res.status, payload as ApiErrorShape);
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),

  /**
   * Raw upload. The body is the file itself — slot and filename travel as
   * query parameters, so the Worker never parses multipart and the
   * filename cannot influence the storage key.
   */
  async upload(
    invitationId: string,
    file: File,
    opts: { slot?: string; onProgress?: (pct: number) => void } = {}
  ): Promise<{ ok: true; asset: MediaAsset }> {
    const params = new URLSearchParams();
    if (opts.slot) params.set("slot", opts.slot);
    params.set("filename", file.name);

    // XHR rather than fetch: upload progress still has no standard
    // fetch equivalent, and progress is the entire point here.
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}/invitations/${invitationId}/media?${params}`);
      xhr.withCredentials = true;
      xhr.setRequestHeader("content-type", "application/octet-stream");
      xhr.setRequestHeader("x-requested-with", "fetch");

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
      });

      xhr.addEventListener("load", () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(xhr.responseText);
        } catch {
          parsed = { error: "server_error" };
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(parsed as { ok: true; asset: MediaAsset });
        } else {
          reject(new ApiError(xhr.status, parsed as ApiErrorShape));
        }
      });
      xhr.addEventListener("error", () => reject(new ApiError(0, { error: "network_error" })));
      xhr.send(file);
    });
  },
};

// ------------------------------------------------------------------ types

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
  isPlatformAdmin: boolean;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  role: "owner" | "member";
  invitationCount?: number;
}

export interface InvitationSummary {
  id: string;
  title: string;
  slug: string;
  themeId: string;
  status: "draft" | "published" | "unpublished" | "disabled" | "deleting" | "delete_failed";
  mediaBytes: number;
  rsvpCount: number;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
}

export interface MediaAsset {
  id: string;
  kind: "image" | "audio";
  slot: string | null;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  originalFilename: string;
  createdAt: number;
  url?: string;
}

export interface PlanLimits {
  maxInvitations: number | null;
  maxMediaBytesPerTenant: number | null;
  maxMediaBytesPerInvitation: number | null;
  maxImageBytes: number | null;
  maxAudioBytes: number | null;
  maxRsvpResponses: number | null;
}

export interface ThemeManifest {
  id: string;
  version: number;
  scenes: string[];
  mediaSlots: Record<
    string,
    { kind: "image" | "audio"; ratio: string | null; focal: boolean; scene: string | null }
  >;
  fieldLimits: Record<string, { max: number; accepted: number; multiline?: boolean }>;
  listLimits: Record<string, { max: number; accepted: number }>;
  focal: { min: number; max: number; default: { x: number; y: number } };
  motion: { driftPxPerSec: { min: number; max: number; default: number } };
}
