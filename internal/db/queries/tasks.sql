-- name: CreateTask :one
INSERT INTO tasks (backlog_item_id, title, description, status, estimate, order_index, assignee_id, skill_required, reviewer_id, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING id, backlog_item_id, title, description, status, estimate, order_index, assignee_id, skill_required, reviewer_id, created_by, created_at, updated_at;

-- name: GetTaskByID :one
SELECT id, backlog_item_id, title, description, status, estimate, order_index, assignee_id, skill_required, reviewer_id, created_by, created_at, updated_at
FROM tasks
WHERE id = $1;

-- name: ListTasksByBacklogItem :many
SELECT id, backlog_item_id, title, description, status, estimate, order_index, assignee_id, skill_required, reviewer_id, created_by, created_at, updated_at
FROM tasks
WHERE backlog_item_id = $1
ORDER BY order_index ASC, created_at ASC;

-- name: UpdateTask :one
UPDATE tasks
SET title          = coalesce(sqlc.narg('title'),          title),
    description    = coalesce(sqlc.narg('description'),    description),
    status         = coalesce(sqlc.narg('status'),         status),
    estimate       = coalesce(sqlc.narg('estimate'),       estimate),
    assignee_id    = coalesce(sqlc.narg('assignee_id'),    assignee_id),
    skill_required = coalesce(sqlc.narg('skill_required'), skill_required),
    reviewer_id    = coalesce(sqlc.narg('reviewer_id'),    reviewer_id),
    updated_at     = now()
WHERE id = $1
RETURNING id, backlog_item_id, title, description, status, estimate, order_index, assignee_id, skill_required, reviewer_id, created_by, created_at, updated_at;

-- name: MoveTask :one
UPDATE tasks
SET backlog_item_id = $2,
    updated_at      = now()
WHERE id = $1
RETURNING id, backlog_item_id, title, description, status, estimate, order_index, assignee_id, skill_required, reviewer_id, created_by, created_at, updated_at;

-- name: DeleteTask :exec
DELETE FROM tasks WHERE id = $1;
