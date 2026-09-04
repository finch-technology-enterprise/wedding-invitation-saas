-- V2 foundation (Major Refactor, additive).
--
-- Preserves all v0.1 data. Fresh clones apply 0001 + 0002 + this file.
-- Existing published invitations keep working: revision_assets is
-- backfilled from media_manifest_json by application code on first
-- publish/read (see lib/revisionAssets.ts), and media_manifest_json is
-- retained as an immutable snapshot artifact (no longer authoritative).

-- ------------------------------------------------- draft versioning (1.4)
-- Optimistic concurrency for draft edits. Incremented on every accepted
-- draft write. Writers send expectedVersion; stale writes get 409.
ALTER TABLE invitations ADD COLUMN draft_version INTEGER NOT NULL DEFAULT 1;

-- ------------------------------------------------- revision assets (1.2)
-- Relational membership replacing LIKE '%"asset-id"%' lookups.
CREATE TABLE revision_assets (
  revision_id TEXT NOT NULL REFERENCES invitation_revisions (id) ON DELETE CASCADE,
  invitation_id TEXT NOT NULL REFERENCES invitations (id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES media_assets (id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (revision_id, asset_id)
);
CREATE INDEX idx_revision_assets_rev ON revision_assets (revision_id);
CREATE INDEX idx_revision_assets_asset ON revision_assets (asset_id);
CREATE INDEX idx_revision_assets_inv ON revision_assets (invitation_id);

-- ------------------------------------------------- RSVP idempotency (1.5)
-- Client-generated stable key per logical submission. Retries with the
-- same key return the same submission; a new RSVP uses a new key.
-- NULL keys (legacy clients) are unrestricted.
ALTER TABLE rsvp_submissions ADD COLUMN idempotency_key TEXT;
ALTER TABLE rsvp_submissions ADD COLUMN updated_at INTEGER;
ALTER TABLE rsvp_submissions ADD COLUMN party_id TEXT;
CREATE UNIQUE INDEX idx_sub_idempotency ON rsvp_submissions (invitation_id, idempotency_key);

-- ------------------------------------------------- guest domain (Phase 5)
-- Households/parties + individual invitees. Additive; anonymous
-- slug-scoped RSVP keeps working with party_id NULL.
CREATE TABLE guest_parties (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES invitations (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  note TEXT,
  token_hash TEXT UNIQUE,
  max_seats INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_parties_inv ON guest_parties (invitation_id);

CREATE TABLE guests (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES invitations (id) ON DELETE CASCADE,
  party_id TEXT REFERENCES guest_parties (id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  meal TEXT,
  dietary TEXT,
  is_child INTEGER NOT NULL DEFAULT 0,
  rsvp_status TEXT NOT NULL DEFAULT 'pending' CHECK (rsvp_status IN ('pending', 'attending', 'declined')),
  rsvp_submission_id TEXT REFERENCES rsvp_submissions (id) ON DELETE SET NULL,
  checked_in_at INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_guests_inv ON guests (invitation_id);
CREATE INDEX idx_guests_party ON guests (party_id);
CREATE INDEX idx_guests_status ON guests (invitation_id, rsvp_status);

-- ------------------------------------------------- entitlements (7.1)
-- Machine-readable capabilities layered on plans. NULL = inherit plan.
ALTER TABLE plans ADD COLUMN capabilities_json TEXT;

-- ------------------------------------------------- housekeeping runs (1.6)
CREATE TABLE housekeeping_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1,
  error TEXT
);
CREATE INDEX idx_housekeeping_kind ON housekeeping_runs (kind, started_at DESC);

-- ------------------------------------------------- invitation locale (3.4)
-- Guest-facing system locale. User content stays free-form.
ALTER TABLE invitations ADD COLUMN locale TEXT NOT NULL DEFAULT 'zh-CN';

-- ------------------------------------------------- share metadata (3.3)
ALTER TABLE invitations ADD COLUMN share_title TEXT;
ALTER TABLE invitations ADD COLUMN share_description TEXT;
ALTER TABLE invitations ADD COLUMN share_image_asset_id TEXT REFERENCES media_assets (id);
