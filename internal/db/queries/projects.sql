-- name: CreateProject :one
INSERT INTO projects (name, description, status, owner_id)
VALUES ($1, $2, $3, $4)
RETURNING id, name, description, status, owner_id, created_at, updated_at;

-- name: GetProjectByID :one
SELECT id, name, description, status, owner_id, created_at, updated_at
FROM projects
WHERE id = $1;

-- name: ListProjects :many
-- All projects, optionally filtered by status.
SELECT id, name, description, status, owner_id, created_at, updated_at
FROM projects
WHERE (sqlc.narg('status')::project_status IS NULL OR status = sqlc.narg('status'))
ORDER BY updated_at DESC;

-- name: ListProjectsByTeam :many
-- Projects that belong to a specific team (via project_teams junction).
SELECT p.id, p.name, p.description, p.status, p.owner_id, p.created_at, p.updated_at
FROM projects p
JOIN project_teams pt ON pt.project_id = p.id
WHERE pt.team_id = $1
  AND (sqlc.narg('status')::project_status IS NULL OR p.status = sqlc.narg('status'))
ORDER BY p.updated_at DESC;

-- name: UpdateProject :one
UPDATE projects
SET name        = coalesce(sqlc.narg('name'),        name),
    description = coalesce(sqlc.narg('description'), description),
    status      = coalesce(sqlc.narg('status'),      status),
    updated_at  = now()
WHERE id = $1
RETURNING id, name, description, status, owner_id, created_at, updated_at;

-- name: DeleteProject :exec
DELETE FROM projects WHERE id = $1;
