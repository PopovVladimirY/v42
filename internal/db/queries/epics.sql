-- name: CreateEpic :one
INSERT INTO epics (project_id, title, description, status, owner_id, target_date, order_index)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, seq_number, number, project_id, title, description, status, clarity,
          owner_id, target_date, order_index, created_at, updated_at;

-- name: GetEpicByID :one
SELECT id, seq_number, number, project_id, title, description, status, clarity,
       owner_id, target_date, order_index, created_at, updated_at
FROM epics
WHERE id = $1;

-- name: GetEpicBySeqNumber :one
SELECT id, seq_number, number, project_id, title, description, status, clarity,
       owner_id, target_date, order_index, created_at, updated_at
FROM epics
WHERE seq_number = $1;

-- name: ListEpicsByProject :many
SELECT id, seq_number, number, project_id, title, description, status, clarity,
       owner_id, target_date, order_index, created_at, updated_at
FROM epics
WHERE project_id = $1
ORDER BY order_index ASC, seq_number ASC;

-- name: UpdateEpic :one
UPDATE epics
SET title       = coalesce(sqlc.narg('title'),       title),
    description = coalesce(sqlc.narg('description'), description),
    status      = coalesce(sqlc.narg('status'),      status),
    clarity     = coalesce(sqlc.narg('clarity'),     clarity),
    owner_id    = coalesce(sqlc.narg('owner_id'),    owner_id),
    target_date = coalesce(sqlc.narg('target_date'), target_date),
    updated_at  = now()
WHERE id = $1
RETURNING id, seq_number, number, project_id, title, description, status, clarity,
          owner_id, target_date, order_index, created_at, updated_at;

-- name: ReorderEpic :exec
UPDATE epics SET order_index = $2, updated_at = now() WHERE id = $1;

-- name: DeleteEpic :exec
DELETE FROM epics WHERE id = $1;
