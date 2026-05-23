-- Phase 3c: replace projects.team_id (1:1) with project_teams junction (M:M).
-- A project can now belong to multiple teams (dev, QA, DevOps, etc.).
-- A team can work on multiple projects simultaneously.
-- Zero data loss: existing team_id rows are migrated before the column is dropped.

-- Step 1: junction table
CREATE TABLE project_teams (
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    team_id     UUID NOT NULL REFERENCES teams(id)    ON DELETE CASCADE,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, team_id)
);
CREATE INDEX idx_project_teams_project ON project_teams(project_id);
CREATE INDEX idx_project_teams_team    ON project_teams(team_id);

-- Step 2: migrate existing associations
INSERT INTO project_teams (project_id, team_id)
    SELECT id, team_id FROM projects WHERE team_id IS NOT NULL;

-- Step 3: remove old FK column
ALTER TABLE projects DROP COLUMN team_id;
