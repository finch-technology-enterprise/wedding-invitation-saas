/**
 * Opaque public IDs.
 *
 * Externally exposed resources must not use sequential integers (no
 * enumeration/count oracle). UUIDv4 from WebCrypto is unguessable and
 * URL-safe unmodified; stored as TEXT primary keys.
 */

export function newId(): string {
  return crypto.randomUUID();
}

/** Short opaque token (sessions, preview tokens). 256 bits, base64url. */
export function newToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Validate an externally supplied opaque ID before touching D1 with it. */
export function isValidId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

/** Asset IDs served under /media/ — same charset, allows UUIDs. */
export function isValidAssetId(id: unknown): id is string {
  if (typeof id !== "string" || id.length > 128) return false;
  return /^[A-Za-z0-9_.-]+$/.test(id) && !id.includes("..");
}
