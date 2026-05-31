DROP INDEX IF EXISTS idx_projects_milestone;
ALTER TABLE projects DROP COLUMN IF EXISTS milestone_id;
ALTER TABLE milestones DROP COLUMN IF EXISTS status;
DROP TYPE IF EXISTS milestone_status;
