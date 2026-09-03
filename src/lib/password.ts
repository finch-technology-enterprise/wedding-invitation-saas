/**
 * Password hashing — PBKDF2-HMAC-SHA256 via WebCrypto.
 *
 * Why not a package: the mature options (better-auth, lucia, bcrypt/argon2
 * bindings) either require `nodejs_compat` plus an ORM and own their own
 * `user`/`session` tables — which collide with the tenant-owned schema in
 * WS1 — or ship native code that does not run on workerd. PBKDF2 is the
 * one OWASP-approved KDF implemented natively by workerd's WebCrypto, so
 * it needs no dependency, no polyfill and no compatibility flag.
 *
 * Argon2id/scrypt would be preferable on CPU-hardness grounds; neither is
 * available in WebCrypto. PBKDF2-SHA256 with a high iteration count is the
 * documented OWASP fallback for exactly this situation.
 *
 * Stored format is self-describing so the cost can be raised later without
 * invalidating existing hashes:
 *
 *   pbkdf2$sha256$<iterations>$<salt-b64>$<hash-b64>
 */

const ALGO = "pbkdf2";
const DIGEST = "sha256";
const SALT_BYTES = 16;
const KEY_BITS = 256;

/**
 * Iteration count. OWASP's floor for PBKDF2-HMAC-SHA256 is 600k, which
 * measures ~72ms of CPU. That is safe on a paid Workers plan (30s CPU
 * budget) but exceeds the free plan's 10ms budget, which would make the
 * project unusable for self-hosters on free accounts — a stated goal.
 *
 * 210k is the floor used by widely deployed frameworks, costs ~25ms, and
 * is overridable so an operator can raise it for their own deployment.
 */
export const DEFAULT_ITERATIONS = 210_000;

function iterationsFor(env: Env): number {
  const raw = Number(env.PASSWORD_ITERATIONS);
  if (!Number.isFinite(raw) || raw < 10_000 || raw > 5_000_000) return DEFAULT_ITERATIONS;
  return Math.floor(raw);
}

function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    KEY_BITS
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, env: Env): Promise<string> {
  const iterations = iterationsFor(env);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return `${ALGO}$${DIGEST}$${iterations}$${toB64(salt)}$${toB64(hash)}`;
}

/** Constant-time compare so verification leaks no byte-position timing. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 5) return false;
  const [algo, digest, itersRaw, saltB64, hashB64] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (algo !== ALGO || digest !== DIGEST) return false;

  const iterations = Number(itersRaw);
  if (!Number.isFinite(iterations) || iterations < 1) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromB64(saltB64);
    expected = fromB64(hashB64);
  } catch {
    return false;
  }

  const actual = await derive(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

/**
 * A dummy verification used on the "user does not exist" path so that a
 * missing account costs the same wall time as a wrong password. Without
 * this, response timing is a reliable account-enumeration oracle.
 */
export async function dummyVerify(env: Env): Promise<void> {
  const salt = new Uint8Array(SALT_BYTES);
  await derive("dummy-password-for-constant-time", salt, iterationsFor(env));
}

/** Minimum viable policy: length beats composition rules. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string") return "password_required";
  if (password.length < 10) return "password_too_short";
  if (password.length > 512) return "password_too_long";
  return null;
}
