-- Reverse of 000005_growth_mechanics.up.sql.
--
-- WARNING: ALTER TYPE ... ADD VALUE cannot be reversed directly.
-- PostgreSQL does not support DROP VALUE from an enum.
-- To reverse novice: recreate the type + all columns that use it.
-- In practice: this migration is one-way. Down = recreate schema from scratch.
-- For dev environments: drop and re-migrate from 000001.

-- 4. tasks.reviewer_id
DROP INDEX IF EXISTS idx_tasks_reviewer;
ALTER TABLE tasks DROP COLUMN IF EXISTS reviewer_id;

-- 3. member_skill_history
DROP TABLE IF EXISTS member_skill_history;

-- 2. member_skills.interest_note
ALTER TABLE member_skills DROP COLUMN IF EXISTS interest_note;

-- 1. skill_level enum: cannot remove 'novice' without recreating the type.
-- See comment above. If this matters: wipe dev DB and re-migrate.
-- In CI/CD: down migrations stop here and must be handled manually.
