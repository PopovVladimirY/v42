-- name: CreateMilestone :one
INSERT INTO milestones (project_id, name, description, target_date)
VALUES ($1, $2, $3, $4)
RETURNING id, seq_number, project_id, name, description, target_date, created_at, updated_at;

-- name: GetMilestoneByID :one
SELECT id, seq_number, project_id, name, description, target_date, created_at, updated_at
FROM milestones
WHERE id = $1;

-- name: GetMilestoneBySeqNumber :one
SELECT id, seq_number, project_id, name, description, target_date, created_at, updated_at
FROM milestones
WHERE seq_number = $1;

-- name: ListMilestonesByProject :many
SELECT id, seq_number, project_id, name, description, target_date, created_at, updated_at
FROM milestones
WHERE project_id = $1
ORDER BY target_date ASC, seq_number ASC;

-- name: UpdateMilestone :one
UPDATE milestones
SET name        = coalesce(sqlc.narg('name'),        name),
    description = coalesce(sqlc.narg('description'), description),
    target_date = coalesce(sqlc.narg('target_date'), target_date),
    updated_at  = now()
WHERE id = $1
RETURNING id, seq_number, project_id, name, description, target_date, created_at, updated_at;

-- name: DeleteMilestone :exec
DELETE FROM milestones WHERE id = $1;
