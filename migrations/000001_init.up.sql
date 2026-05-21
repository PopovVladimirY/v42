-- Phase 0: extensions only.
-- The full schema (all 20+ tables) arrives in Phase 1 migration.
--
-- The coin under the first stone. May the tests be green and the deploys be boring.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
