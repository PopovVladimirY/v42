-- Runs once when the postgres container is first initialized.
-- Extensions available instance-wide before any migrations run.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
