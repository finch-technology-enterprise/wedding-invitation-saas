-- Platform schema baseline (WS1).
--
-- Clean reset: replaces the pre-platform single-table RSVP schema. The old
-- `rsvps` table (one invitation, shared admin key, no ownership) cannot
-- support tenants, revisions, or R2 media, and there is no production data
-- worth migrating — so it is dropped here rather than incrementally altered.
-- Fresh clones apply exactly this file as their entire history.
--
-- Conventions (entire schema):
--   plural table names · id TEXT PRIMARY KEY (opaque UUID, never sequential)
--   FKs named {singular}_id · timestamps INTEGER unix-ms
--   booleans INTEGER 0/1 · statuses TEXT + CHECK · RESTRICT deletes
--   (application-ordered deletion; the retry-safe cleanup engine in WS10
--   needs explicit control, not cascades)

DROP TABLE IF EXISTS rsvps;

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  is_platform_admin INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_ip_hash TEXT,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expiry ON sessions (expires_at);

-- ------------------------------------------------------------------ tenancy
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  limits_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  plan_id TEXT REFERENCES plans (id),
  quota_overrides_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE tenant_members (
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  user_id TEXT NOT NULL REFERENCES users (id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX idx_members_user ON tenant_members (user_id);

-- -------------------------------------------------------------- invitations
CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  theme_id TEXT NOT NULL DEFAULT 'cinematic-classic',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'unpublished', 'disabled', 'deleting', 'delete_failed')),
  draft_json TEXT,
  draft_updated_at INTEGER,
  draft_updated_by TEXT REFERENCES users (id),
  published_revision_id TEXT REFERENCES invitation_revisions (id),
  media_bytes INTEGER NOT NULL DEFAULT 0,
  rsvp_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER,
  created_by TEXT REFERENCES users (id)
);
CREATE INDEX idx_inv_tenant ON invitations (tenant_id, updated_at DESC);
CREATE INDEX idx_inv_slug ON invitations (slug);
CREATE INDEX idx_inv_status_created ON invitations (status, created_at);
CREATE INDEX idx_inv_updated ON invitations (updated_at);

-- Immutable published snapshots. Append-only: never updated by normal flows.
-- Drafts live on invitations.draft_json (autosave-safe, no table bloat).
CREATE TABLE invitation_revisions (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES invitations (id),
  config_json TEXT NOT NULL,
  media_manifest_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT REFERENCES users (id),
  created_at INTEGER NOT NULL,
  note TEXT
);
CREATE INDEX idx_rev_inv ON invitation_revisions (invitation_id, created_at DESC);

-- -------------------------------------------------------------------- media
CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  invitation_id TEXT NOT NULL REFERENCES invitations (id),
  kind TEXT NOT NULL CHECK (kind IN ('image', 'audio')),
  slot TEXT,
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  checksum_sha256 TEXT,
  created_by TEXT REFERENCES users (id),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_media_inv ON media_assets (invitation_id, created_at DESC);
CREATE INDEX idx_media_tenant ON media_assets (tenant_id);
CREATE INDEX idx_media_size ON media_assets (invitation_id, byte_size DESC);

-- --------------------------------------------------------------------- RSVP
-- Hybrid: queryable core columns on submissions + normalized custom answers.
CREATE TABLE rsvp_forms (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL UNIQUE REFERENCES invitations (id),
  enabled INTEGER NOT NULL DEFAULT 1,
  deadline_at INTEGER,
  guest_limit INTEGER,
  success_title TEXT,
  success_body TEXT,
  settings_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE rsvp_fields (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES rsvp_forms (id),
  key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'name', 'attending', 'guests', 'phone', 'email', 'instagram', 'message',
    'text', 'textarea', 'number', 'select', 'radio', 'checkbox'
  )),
  label TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0,
  options_json TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (form_id, key)
);
CREATE INDEX idx_fields_form ON rsvp_fields (form_id, position);

CREATE TABLE rsvp_submissions (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES invitations (id),
  form_id TEXT NOT NULL REFERENCES rsvp_forms (id),
  attending INTEGER,
  guest_count INTEGER NOT NULL DEFAULT 1,
  contact_name TEXT NOT NULL,
  contact_phone TEXT,
  contact_email TEXT,
  contact_instagram TEXT,
  created_at INTEGER NOT NULL,
  ip_hash TEXT
);
CREATE INDEX idx_sub_inv_time ON rsvp_submissions (invitation_id, created_at DESC);
CREATE INDEX idx_sub_inv_att ON rsvp_submissions (invitation_id, attending);

CREATE TABLE rsvp_answers (
  submission_id TEXT NOT NULL REFERENCES rsvp_submissions (id),
  field_id TEXT NOT NULL REFERENCES rsvp_fields (id),
  value_text TEXT NOT NULL,
  PRIMARY KEY (submission_id, field_id, value_text)
);

-- ------------------------------------------------------------------ preview
CREATE TABLE preview_tokens (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES invitations (id),
  token_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users (id),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_preview_inv ON preview_tokens (invitation_id);

-- ----------------------------------------------------------------- platform
CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE platform_audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users (id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  meta_json TEXT,
  ok INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_time ON platform_audit_events (created_at DESC);
CREATE INDEX idx_audit_actor ON platform_audit_events (actor_user_id, created_at DESC);

-- D1-backed token buckets for login/register/RSVP/upload limits (WS2).
-- No KV/Redis: at this scale one indexed row per bucket is fine.
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- ------------------------------------------------------------- seed: plans
-- limits_json keys: maxInvitations, maxMediaBytesPerTenant,
-- maxMediaBytesPerInvitation, maxImageBytes, maxAudioBytes,
-- maxRsvpResponses. null = unlimited.
INSERT OR IGNORE INTO plans (id, name, limits_json, created_at) VALUES
  ('plan_self_hosted', 'self-hosted',
   '{"maxInvitations":null,"maxMediaBytesPerTenant":null,"maxMediaBytesPerInvitation":null,"maxImageBytes":null,"maxAudioBytes":null,"maxRsvpResponses":null}',
   0),
  ('plan_hosted_free', 'hosted-free',
   '{"maxInvitations":1,"maxMediaBytesPerTenant":209715200,"maxMediaBytesPerInvitation":104857600,"maxImageBytes":8388608,"maxAudioBytes":15728640,"maxRsvpResponses":500}',
   0);

-- ---------------------------------------------------------- seed: settings
INSERT OR IGNORE INTO platform_settings (key, value_json) VALUES
  ('site_name', '"Invitation Platform"'),
  ('registration_enabled', 'true');
