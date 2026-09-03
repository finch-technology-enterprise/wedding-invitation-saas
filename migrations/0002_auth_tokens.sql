-- Password reset and email verification (WS13).
--
-- Forward migration: production is live, so 0001_platform.sql is not
-- edited. Existing rows keep working.

-- Verification state is persisted explicitly rather than inferred from
-- created_at, which would be ambiguous and would silently change meaning
-- if rows were ever backfilled.
--
-- DEFAULT 1 is deliberate: every user that exists at migration time is
-- treated as verified, so nobody — including the production operator —
-- is locked out by a feature that did not exist when they signed up.
-- The registration handler writes 0 explicitly for new hosted signups.
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;

-- Purpose-specific rather than overloading preview_tokens: that table
-- belongs to invitations, has different lifetime and revocation rules,
-- and sharing it would couple two unrelated security domains.
CREATE TABLE auth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  -- 'password_reset' | 'email_verification'
  kind TEXT NOT NULL CHECK (kind IN ('password_reset', 'email_verification')),
  -- SHA-256 of the opaque token. The raw value exists only in the email.
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  -- Set on redemption; a token is single-use.
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Redemption looks up by hash; the UNIQUE constraint already indexes it.
-- This one supports "supersede outstanding tokens for this user".
CREATE INDEX idx_auth_tokens_user ON auth_tokens (user_id, kind, created_at DESC);
CREATE INDEX idx_auth_tokens_expiry ON auth_tokens (expires_at);
