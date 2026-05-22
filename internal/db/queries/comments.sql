-- name: CreateComment :one
-- parent columns: exactly one non-null enforced by DB constraint.
INSERT INTO comments (project_id, epic_id, backlog_item_id, task_id, test_id, body, author_id, parent_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, project_id, epic_id, backlog_item_id, task_id, test_id, body, author_id, parent_id, deleted_at, created_at, updated_at;

-- name: GetCommentByID :one
SELECT id, project_id, epic_id, backlog_item_id, task_id, test_id, body, author_id, parent_id, deleted_at, created_at, updated_at
FROM comments
WHERE id = $1;

-- name: ListCommentsByBacklogItem :many
-- Thread for a backlog item. Soft-deleted entries: body is NULL but row stays (keeps thread).
SELECT id, body, author_id, parent_id, deleted_at, created_at, updated_at
FROM comments
WHERE backlog_item_id = $1
ORDER BY created_at ASC;

-- name: ListCommentsByTask :many
SELECT id, body, author_id, parent_id, deleted_at, created_at, updated_at
FROM comments
WHERE task_id = $1
ORDER BY created_at ASC;

-- name: UpdateComment :one
-- Only the author can update body.
UPDATE comments
SET body = $2, updated_at = now()
WHERE id = $1
RETURNING id, body, author_id, parent_id, deleted_at, created_at, updated_at;

-- name: SoftDeleteComment :exec
-- Preserve thread structure: set body to NULL, stamp deleted_at.
UPDATE comments
SET body = NULL, deleted_at = now(), updated_at = now()
WHERE id = $1;
