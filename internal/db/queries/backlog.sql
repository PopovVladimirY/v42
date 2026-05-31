-- name: CreateBacklogItem :one
INSERT INTO backlog_items (
    project_id, epic_id, release_id, stage_id,
    title, description, type, status, priority,
    estimate, assignee_id, skill_required,
    ac_setup, ac_steps, ac_expected,
    created_by, parent_item_id
) VALUES (
    $1, $2, $3, $4,
    $5, $6, $7, $8, $9,
    $10, $11, $12,
    $13, $14, $15,
    $16, $17
)
RETURNING id, project_id, number, epic_id, release_id, stage_id, node_id,
          title, description, type, status, clarity, priority,
          estimate, assignee_id, skill_required,
          ac_setup, ac_steps, ac_expected, parent_item_id,
          created_by, created_at, updated_at;

-- name: GetBacklogItemByID :one
SELECT id, project_id, number, epic_id, release_id, stage_id, node_id,
       title, description, type, status, clarity, priority,
       estimate, assignee_id, skill_required,
       ac_setup, ac_steps, ac_expected, parent_item_id,
       created_by, created_at, updated_at
FROM backlog_items
WHERE id = $1;

-- name: ListBacklogItems :many
-- Ordered by priority ascending (lower float = higher up).
-- Decomposed items are always excluded from working views; use ListBacklogItemChildren for history.
-- Items live on tree nodes via node_id (project_id is always the tree root).
-- A node shows the backlog of its whole subtree: items attached to the node
-- itself plus every nested descendant stage (recursive walk down parent_id).
-- Legacy unattached items (node_id IS NULL) surface only at the root view.
WITH RECURSIVE subtree AS (
    SELECT id FROM projects WHERE id = sqlc.arg('project_id')::uuid
    UNION ALL
    SELECT p.id FROM projects p JOIN subtree s ON p.parent_id = s.id
)
SELECT id, project_id, number, epic_id, release_id, stage_id, node_id,
       title, description, type, status, clarity, priority,
       estimate, assignee_id, skill_required,
       ac_setup, ac_steps, ac_expected, parent_item_id,
       created_by, created_at, updated_at
FROM backlog_items
WHERE (node_id IN (SELECT id FROM subtree)
       OR (node_id IS NULL AND project_id = sqlc.arg('project_id')::uuid))
  AND status != 'decomposed'
  AND (sqlc.narg('epic_id')::uuid IS NULL   OR epic_id    = sqlc.narg('epic_id'))
  AND (sqlc.narg('status')::item_status IS NULL OR status = sqlc.narg('status'))
  AND (sqlc.narg('clarity')::text IS NULL   OR clarity   = sqlc.narg('clarity'))
ORDER BY priority ASC, created_at ASC;

-- name: ListBacklogItemChildren :many
-- Returns direct children of a decomposed item for Life Tree history view.
-- Ordered by creation time so the breakdown order is preserved.
SELECT id, project_id, number, epic_id, release_id, stage_id, node_id,
       title, description, type, status, clarity, priority,
       estimate, assignee_id, skill_required,
       ac_setup, ac_steps, ac_expected, parent_item_id,
       created_by, created_at, updated_at
FROM backlog_items
WHERE parent_item_id = $1
ORDER BY created_at ASC;

-- name: UpdateBacklogItem :one
UPDATE backlog_items
SET title          = coalesce(sqlc.narg('title'),          title),
    description    = coalesce(sqlc.narg('description'),    description),
    type           = coalesce(sqlc.narg('type'),           type),
    status         = coalesce(sqlc.narg('status'),         status),
    clarity        = coalesce(sqlc.narg('clarity'),        clarity),
    estimate       = coalesce(sqlc.narg('estimate'),       estimate),
    assignee_id    = coalesce(sqlc.narg('assignee_id'),    assignee_id),
    skill_required = coalesce(sqlc.narg('skill_required'), skill_required),
    epic_id        = coalesce(sqlc.narg('epic_id'),        epic_id),
    release_id     = coalesce(sqlc.narg('release_id'),     release_id),
    stage_id       = coalesce(sqlc.narg('stage_id'),       stage_id),
    node_id        = coalesce(sqlc.narg('node_id'),        node_id),
    ac_setup       = coalesce(sqlc.narg('ac_setup'),       ac_setup),
    ac_steps       = coalesce(sqlc.narg('ac_steps'),       ac_steps),
    ac_expected    = coalesce(sqlc.narg('ac_expected'),    ac_expected),
    updated_at     = now()
WHERE id = $1
RETURNING id, project_id, number, epic_id, release_id, stage_id, node_id,
          title, description, type, status, clarity, priority,
          estimate, assignee_id, skill_required,
          ac_setup, ac_steps, ac_expected, parent_item_id,
          created_by, created_at, updated_at;

-- name: UpdateBacklogItemPriority :exec
-- Single-item priority update used by reorder logic.
UPDATE backlog_items SET priority = $2, updated_at = now() WHERE id = $1;

-- name: ListBacklogItemsByProject :many
-- All items for renormalization: returns id + priority ordered by priority.
SELECT id, priority FROM backlog_items
WHERE project_id = $1
ORDER BY priority ASC;

-- name: DeleteBacklogItem :exec
DELETE FROM backlog_items WHERE id = $1;

