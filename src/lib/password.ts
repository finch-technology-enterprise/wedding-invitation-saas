/**
 * Password hashing — scrypt, with transparent upgrade from PBKDF2.
 *
 * ## Why scrypt now
 *
 * The original implementation used PBKDF2-HMAC-SHA256 via WebCrypto,
 * because it was the only OWASP-approved KDF workerd implemented. That
 * carried a hard ceiling: workerd rejects PBKDF2 above 100,000
 * iterations, well under OWASP's recommended 600,000.
 *
 *     NotSupportedError: Pbkdf2 failed: iteration counts above 100000
 *     are not supported (requested 210000).
 *
 * `node:crypto` is now available in Workers and provides `scryptSync`,
 * which has no such cap and is memory-hard — a materially better
 * primitive against GPU and ASIC cracking. Argon2 remains unsupported on
 * workerd, so scrypt is the strongest option actually available.
 *
 * ## Parameters
 *
 * OWASP's scrypt guidance lists several acceptable configurations of
 * equivalent strength. We use the last of them:
 *
 *     N=2^14 (16 MiB), r=8, p=5
 *
 * rather than the first (N=2^17, r=8, p=1, 128 MiB). Both are sanctioned;
 * they trade memory for parallelism. The low-memory variant is chosen
 * deliberately: a Worker isolate has a 128 MiB memory limit, and a
 * 128 MiB scratch buffer would sit on that boundary and risk OOM under
 * concurrent logins. 16 MiB leaves ample headroom.
 *
 * Measured on deployed Workers, this costs roughly 170 ms of wall time
 * per hash and comfortably fits the paid plan's CPU budget. It exceeds
 * the free plan's 10 ms CPU allowance — but so did the PBKDF2
 * configuration it replaces (production bootstrap measured 32 ms), so
 * this is not a new constraint. See SECURITY.md.
 *
 * ## Storage format
 *
 * Hashes are stored in PHC string format via the maintained `@phc/format`
 * package, so the algorithm and its parameters travel with every hash:
 *
 *     $scrypt$ln=14,r=8,p=5$<salt>$<hash>
 *     $pbkdf2-sha256$i=100000$<salt>$<hash>     (legacy, still verified)
 *
 * That is what makes the upgrade path below possible without ever
 * knowing anyone's password.
 */

import { Buffer } from "node:buffer";
import { scryptSync, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import { deserialize, serialize } from "@phc/format";

const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** OWASP scrypt parameters; see the note above on why this variant. */
export const SCRYPT_PARAMS = { ln: 14, r: 8, p: 5 } as const;

/**
 * scrypt needs 128 * N * r bytes of scratch space. node refuses to
 * allocate beyond `maxmem`, whose default (32 MiB) is below what p>1
 * requests, so it is raised explicitly rather than left to fail at
 * runtime the way the PBKDF2 ceiling did.
 */
const MAXMEM = 192 * 1024 * 1024;

/** workerd's hard cap on PBKDF2. Only relevant to legacy verification. */
export const LEGACY_PBKDF2_MAX_ITERATIONS = 100_000;

function scryptHash(password: string, salt: Uint8Array): Uint8Array {
  return new Uint8Array(
    scryptSync(password, Buffer.from(salt), KEY_BYTES, {
      N: 2 ** SCRYPT_PARAMS.ln,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      maxmem: MAXMEM,
    })
  );
}

/** Hash a password using the current preferred algorithm. */
export async function hashPassword(password: string, _env?: Env): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = scryptHash(password, salt);

  return serialize({
    id: "scrypt",
    params: { ...SCRYPT_PARAMS },
    salt: Buffer.from(salt),
    hash: Buffer.from(hash),
  });
}

// ------------------------------------------------------------ legacy PBKDF2

/** Derive with PBKDF2 for verifying hashes written before the migration. */
async function pbkdf2Derive(
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
    KEY_BYTES * 8
  );
  return new Uint8Array(bits);
}

/**
 * The pre-PHC format this project shipped with:
 *
 *     pbkdf2$sha256$<iterations>$<salt-b64>$<hash-b64>
 *
 * Still verified so deployed users keep logging in; never written.
 */
function parseLegacyFormat(
  stored: string
): { salt: Uint8Array; hash: Uint8Array; iterations: number } | null {
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return null;

  const iterations = Number(parts[2]);
  if (!Number.isFinite(iterations) || iterations < 1) return null;

  try {
    const fromB64 = (s: string) => {
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    };
    return { salt: fromB64(parts[3]!), hash: fromB64(parts[4]!), iterations };
  } catch {
    return null;
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return nodeTimingSafeEqual(a, b);
}

export interface VerifyResult {
  valid: boolean;
  /**
   * True when the password was correct but the stored hash uses an older
   * algorithm or weaker parameters. The caller re-hashes and updates.
   */
  needsUpgrade: boolean;
}

/**
 * Verify a password against any supported stored format.
 *
 * Returns `needsUpgrade` rather than upgrading here, because rewriting
 * the row is the caller's concern — this function stays free of I/O and
 * therefore trivially testable.
 */
export async function verifyPasswordDetailed(
  password: string,
  stored: string
): Promise<VerifyResult> {
  // Legacy pre-PHC PBKDF2.
  const legacy = parseLegacyFormat(stored);
  if (legacy) {
    const actual = await pbkdf2Derive(password, legacy.salt, legacy.iterations);
    return { valid: constantTimeEqual(actual, legacy.hash), needsUpgrade: true };
  }

  let parsed: ReturnType<typeof deserialize>;
  try {
    parsed = deserialize(stored);
  } catch {
    // Corrupt or unrecognised: never throws, never authenticates.
    return { valid: false, needsUpgrade: false };
  }

  // A PHC string is well-formed but may legitimately omit salt or hash
  // (the format allows it); such a value can never authenticate anyone.
  if (!parsed.salt || !parsed.hash) return { valid: false, needsUpgrade: false };

  const salt = new Uint8Array(parsed.salt);
  const expected = new Uint8Array(parsed.hash);

  if (parsed.id === "scrypt") {
    const { ln, r, p } = parsed.params as Record<string, number>;
    if (![ln, r, p].every((v) => Number.isInteger(v) && v > 0)) {
      return { valid: false, needsUpgrade: false };
    }
    // Refuse absurd work factors from a tampered row rather than
    // attempting a multi-gigabyte allocation.
    if (ln > 20 || r > 32 || p > 16) return { valid: false, needsUpgrade: false };

    const actual = new Uint8Array(
      scryptSync(password, Buffer.from(salt), expected.length, {
        N: 2 ** ln,
        r,
        p,
        maxmem: MAXMEM,
      })
    );
    const valid = constantTimeEqual(actual, expected);

    // Parameters weaker than current policy earn a rehash on next login.
    const stale = ln < SCRYPT_PARAMS.ln || r < SCRYPT_PARAMS.r || p < SCRYPT_PARAMS.p;
    return { valid, needsUpgrade: valid && stale };
  }

  if (parsed.id === "pbkdf2-sha256") {
    const iterations = Number((parsed.params as Record<string, unknown>).i);
    if (!Number.isFinite(iterations) || iterations < 1) {
      return { valid: false, needsUpgrade: false };
    }
    const actual = await pbkdf2Derive(password, salt, iterations);
    return { valid: constantTimeEqual(actual, expected), needsUpgrade: true };
  }

  // A hash written by a future version this build does not understand.
  // Failing closed is correct: authenticating against an algorithm we
  // cannot evaluate would be worse than refusing the login.
  return { valid: false, needsUpgrade: false };
}

/** Boolean-only verification, for callers with nothing to upgrade. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  return (await verifyPasswordDetailed(password, stored)).valid;
}

/**
 * Dummy verification for the unknown-account path, so a missing user
 * costs the same wall time as a wrong password. Without it, response
 * timing is a reliable account-enumeration oracle.
 */
export async function dummyVerify(_env?: Env): Promise<void> {
  scryptHash("dummy-password-for-constant-time", new Uint8Array(SALT_BYTES));
}

/** Minimum viable policy: length beats composition rules. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string") return "password_required";
  if (password.length < 10) return "password_too_short";
  if (password.length > 512) return "password_too_long";
  return null;
}
