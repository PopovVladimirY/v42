-- name: CreateEpic :one
INSERT INTO epics (project_id, title, description, status, owner_id, target_date)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, project_id, title, description, status, owner_id, target_date, created_at, updated_at;

-- name: GetEpicByID :one
SELECT id, project_id, title, description, status, owner_id, target_date, created_at, updated_at
FROM epics
WHERE id = $1;

-- name: ListEpicsByProject :many
SELECT id, project_id, title, description, status, owner_id, target_date, created_at, updated_at
FROM epics
WHERE project_id = $1
ORDER BY created_at ASC;

-- name: UpdateEpic :one
UPDATE epics
SET title       = coalesce(sqlc.narg('title'),       title),
    description = coalesce(sqlc.narg('description'), description),
    status      = coalesce(sqlc.narg('status'),      status),
    owner_id    = coalesce(sqlc.narg('owner_id'),    owner_id),
    target_date = coalesce(sqlc.narg('target_date'), target_date),
    updated_at  = now()
WHERE id = $1
RETURNING id, project_id, title, description, status, owner_id, target_date, created_at, updated_at;

-- name: DeleteEpic :exec
DELETE FROM epics WHERE id = $1;
