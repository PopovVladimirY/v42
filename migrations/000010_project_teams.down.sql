-- Rollback: restore projects.team_id from project_teams (first team per project, by added_at).
ALTER TABLE projects ADD COLUMN team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

UPDATE projects p
SET team_id = (
    SELECT team_id FROM project_teams pt
    WHERE pt.project_id = p.id
    ORDER BY pt.added_at
    LIMIT 1
);

DROP TABLE project_teams;
