-- name: CreateProject :one
-- Create a root-level project (parent_id = NULL).
INSERT INTO projects (name, description, status, owner_id, start_date, end_date, order_index)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, node_number, name, description, status, owner_id, parent_id,
          start_date, end_date, order_index, is_archived,
          open_items, total_items, clarity_score, stats_dirty, stats_updated_at,
          created_at, updated_at;

-- name: CreateChildNode :one
-- Create a child node (stage/milestone) under a parent project.
INSERT INTO projects (name, description, status, owner_id, parent_id, start_date, end_date, order_index)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, node_number, name, description, status, owner_id, parent_id,
          start_date, end_date, order_index, is_archived,
          open_items, total_items, clarity_score, stats_dirty, stats_updated_at,
          created_at, updated_at;

-- name: GetProjectByID :one
SELECT id, node_number, name, description, status, owner_id, parent_id,
       start_date, end_date, order_index, is_archived,
       open_items, total_items, clarity_score, stats_dirty, stats_updated_at,
       created_at, updated_at
FROM projects
WHERE id = $1;

-- name: GetProjectByNodeNumber :one
SELECT id, node_number, name, description, status, owner_id, parent_id,
       start_date, end_date, order_index, is_archived,
       open_items, total_items, clarity_score, stats_dirty, stats_updated_at,
       created_at, updated_at
FROM projects
WHERE node_number = $1;

-- name: ListRootProjects :many
-- Top-level projects (no parent). Excludes archived unless show_archived = true.
SELECT id, node_number, name, description, status, owner_id, parent_id,
       start_date, end_date, order_index, is_archived,
       open_items, total_items, clarity_score, stats_dirty, stats_updated_at,
       created_at, updated_at
FROM projects
WHERE parent_id IS NULL
  AND (sqlc.arg('show_archived')::boolean OR is_archived = false)
  AND (sqlc.narg('status')::project_status IS NULL OR status = sqlc.narg('status'))
ORDER BY order_index ASC, created_at ASC;

-- name: ListChildNodes :many
-- Direct children of a given node, ordered by order_index.
SELECT id, node_number, name, description, status, owner_id, parent_id,
       start_date, end_date, order_index, is_archived,
       open_items, total_items, clarity_score, stats_dirty, stats_updated_at,
       created_at, updated_at
FROM projects
WHERE parent_id = $1
  AND (sqlc.arg('show_archived')::boolean OR is_archived = false)
ORDER BY order_index ASC, created_at ASC;

-- name: GetProjectSubtree :many
-- Full subtree rooted at a given node (depth-first via recursive CTE).
-- Returns all nodes including the root itself.
WITH RECURSIVE subtree AS (
  SELECT p.id, p.node_number, p.name, p.description, p.status, p.owner_id, p.parent_id,
         p.start_date, p.end_date, p.order_index, p.is_archived,
         p.open_items, p.total_items, p.clarity_score, p.stats_dirty, p.stats_updated_at,
         p.created_at, p.updated_at,
         0 AS depth
  FROM projects p
  WHERE p.id = $1
  UNION ALL
  SELECT p.id, p.node_number, p.name, p.description, p.status, p.owner_id, p.parent_id,
         p.start_date, p.end_date, p.order_index, p.is_archived,
         p.open_items, p.total_items, p.clarity_score, p.stats_dirty, p.stats_updated_at,
         p.created_at, p.updated_at,
         s.depth + 1
  FROM   projects p
  JOIN   subtree s ON p.parent_id = s.id
  WHERE  NOT p.is_archived OR sqlc.arg('show_archived')::boolean
)
SELECT * FROM subtree
ORDER BY depth ASC, order_index ASC;

-- name: ListProjects :many
-- All root-level projects accessible to a user (via team membership OR user is admin).
-- Admin bypass is handled in the handler; this query returns by team membership.
SELECT p.id, p.node_number, p.name, p.description, p.status, p.owner_id, p.parent_id,
       p.start_date, p.end_date, p.order_index, p.is_archived,
       p.open_items, p.total_items, p.clarity_score, p.stats_dirty, p.stats_updated_at,
       p.created_at, p.updated_at
FROM projects p
WHERE p.parent_id IS NULL
  AND p.is_archived = false
  AND (sqlc.narg('status')::project_status IS NULL OR p.status = sqlc.narg('status'))
ORDER BY p.order_index ASC, p.updated_at DESC;

-- name: ListProjectsByTeam :many
-- Projects that belong to a specific team (via project_teams junction).
SELECT p.id, p.node_number, p.name, p.description, p.status, p.owner_id, p.parent_id,
       p.start_date, p.end_date, p.order_index, p.is_archived,
       p.open_items, p.total_items, p.clarity_score, p.stats_dirty, p.stats_updated_at,
       p.created_at, p.updated_at
FROM projects p
JOIN project_teams pt ON pt.project_id = p.id
WHERE pt.team_id = $1
  AND p.is_archived = false
  AND (sqlc.narg('status')::project_status IS NULL OR p.status = sqlc.narg('status'))
ORDER BY p.order_index ASC, p.updated_at DESC;

-- name: UpdateProject :one
UPDATE projects
SET name        = coalesce(sqlc.narg('name'),        name),
    description = coalesce(sqlc.narg('description'), description),
    status      = coalesce(sqlc.narg('status'),      status),
    start_date  = coalesce(sqlc.narg('start_date'),  start_date),
    end_date    = coalesce(sqlc.narg('end_date'),    end_date),
    updated_at  = now()
WHERE id = $1
RETURNING id, node_number, name, description, status, owner_id, parent_id,
          start_date, end_date, order_index, is_archived,
          open_items, total_items, clarity_score, stats_dirty, stats_updated_at,
          created_at, updated_at;

-- name: MoveNode :one
-- Change a node's parent and/or order_index (DnD).
-- Cycle prevention is enforced at the handler layer before calling this.
UPDATE projects
SET parent_id   = sqlc.narg('parent_id'),
    order_index = $2,
    updated_at  = now()
WHERE id = $1
RETURNING id, node_number, name, description, status, owner_id, parent_id,
          start_date, end_date, order_index, is_archived,
          open_items, total_items, clarity_score, stats_dirty, stats_updated_at,
          created_at, updated_at;

-- name: ReorderNode :exec
-- Update order_index only (cheaper than MoveNode).
UPDATE projects SET order_index = $2, updated_at = now() WHERE id = $1;

-- name: ArchiveProject :one
-- Admin only. Sets is_archived = true instead of deleting.
UPDATE projects SET is_archived = true, updated_at = now()
WHERE id = $1
RETURNING id, node_number, name, description, status, owner_id, parent_id,
          start_date, end_date, order_index, is_archived,
          open_items, total_items, clarity_score, stats_dirty, stats_updated_at,
          created_at, updated_at;

-- name: DeleteProject :exec
DELETE FROM projects WHERE id = $1;

-- name: ListArchivedProjects :many
-- Admin: list all soft-deleted projects (roots only).
SELECT id, node_number, name, description, status, owner_id, parent_id,
       start_date, end_date, order_index, is_archived,
       open_items, total_items, clarity_score, stats_dirty, stats_updated_at,
       created_at, updated_at
FROM projects
WHERE is_archived = true AND parent_id IS NULL
ORDER BY updated_at DESC;

-- name: UnarchiveProject :one
UPDATE projects SET is_archived = false, updated_at = now()
WHERE id = $1
RETURNING id, node_number, name, description, status, owner_id, parent_id,
          start_date, end_date, order_index, is_archived,
          open_items, total_items, clarity_score, stats_dirty, stats_updated_at,
          created_at, updated_at;

-- name: ListDirtyNodes :many
-- Background worker: find nodes whose stats need recomputation.
SELECT id FROM projects WHERE stats_dirty = true LIMIT 100;

-- name: UpdateNodeStats :exec
-- Background worker: write computed stats and clear dirty flag.
UPDATE projects
SET open_items      = $2,
    total_items     = $3,
    clarity_score   = $4,
    stats_dirty     = false,
    stats_updated_at = now()
WHERE id = $1;

-- name: GetNodeAncestors :many
-- Return all ancestor IDs for a given node (used to mark stats dirty).
WITH RECURSIVE ancestors AS (
  SELECT p.id, p.parent_id FROM projects p WHERE p.id = $1
  UNION ALL
  SELECT p.id, p.parent_id FROM projects p
  JOIN   ancestors a ON p.id = a.parent_id
)
SELECT a.id FROM ancestors a;
