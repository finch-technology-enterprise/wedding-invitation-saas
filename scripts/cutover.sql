-- One-time cutover from the pre-platform schema to the platform baseline.
--
-- Only needed for the original deployment, which recorded a migration
-- named `0001_init.sql` that no longer exists in the repository. A fresh
-- clone never runs this: it applies migrations/0001_platform.sql directly.
--
-- The problem this solves is migration *bookkeeping*, not data. Running
-- `wrangler d1 migrations apply` against the old database would work, but
-- would leave d1_migrations claiming both `0001_init.sql` (a file nobody
-- has) and `0001_platform.sql`. That is a database whose recorded history
-- cannot be reproduced from the repository — which is exactly the
-- confusion a migration table exists to prevent.
--
-- So the legacy record is removed along with the legacy table, and the
-- clean baseline is then applied normally by wrangler, which writes its
-- own row. The result is indistinguishable from a fresh install.
--
-- Preserving the old RSVP data is explicitly not required; export it
-- first if you want a copy.
--
-- Usage:
--   npx wrangler d1 execute <db> --remote --file scripts/cutover.sql
--   npx wrangler d1 migrations apply <db> --remote

DROP TABLE IF EXISTS rsvps;

DELETE FROM d1_migrations WHERE name = '0001_init.sql';
