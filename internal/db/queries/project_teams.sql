-- name: ListTeamsByProject :many
-- Teams associated with a project via project_teams junction.
SELECT t.id, t.name, t.description, t.created_at, t.updated_at, pt.added_at
FROM teams t
JOIN project_teams pt ON pt.team_id = t.id
WHERE pt.project_id = $1
ORDER BY pt.added_at;

-- name: AddTeamToProject :exec
INSERT INTO project_teams (project_id, team_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: RemoveTeamFromProject :exec
DELETE FROM project_teams
WHERE project_id = $1 AND team_id = $2;

-- name: ProjectTeamExists :one
-- Check that a (project, team) pair exists (used for access checks).
SELECT EXISTS (
    SELECT 1 FROM project_teams WHERE project_id = $1 AND team_id = $2
) AS exists;

-- name: UserCanAccessProject :one
-- True when the user is a member of at least one team on the project.
SELECT EXISTS (
    SELECT 1
    FROM project_teams pt
    JOIN team_members tm ON tm.team_id = pt.team_id
    WHERE pt.project_id = $1 AND tm.user_id = $2
) AS exists;
