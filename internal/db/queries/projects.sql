-- name: CreateProject :one
INSERT INTO projects (name, description, status, team_id, owner_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, name, description, status, team_id, owner_id, created_at, updated_at;

-- name: GetProjectByID :one
SELECT id, name, description, status, team_id, owner_id, created_at, updated_at
FROM projects
WHERE id = $1;

-- name: ListProjects :many
-- All projects visible to the caller. Filtered by team or status if provided.
SELECT id, name, description, status, team_id, owner_id, created_at, updated_at
FROM projects
WHERE (sqlc.narg('team_id')::uuid IS NULL OR team_id = sqlc.narg('team_id'))
  AND (sqlc.narg('status')::project_status IS NULL OR status = sqlc.narg('status'))
ORDER BY updated_at DESC;

-- name: UpdateProject :one
UPDATE projects
SET name        = coalesce(sqlc.narg('name'),        name),
    description = coalesce(sqlc.narg('description'), description),
    status      = coalesce(sqlc.narg('status'),      status),
    team_id     = coalesce(sqlc.narg('team_id'),     team_id),
    updated_at  = now()
WHERE id = $1
RETURNING id, name, description, status, team_id, owner_id, created_at, updated_at;

-- name: DeleteProject :exec
DELETE FROM projects WHERE id = $1;
