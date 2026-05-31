-- name: CreateMilestone :one
INSERT INTO milestones (project_id, name, description, target_date, status)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, seq_number, project_id, name, description, target_date, status, created_at, updated_at;

-- name: GetMilestoneByID :one
SELECT id, seq_number, project_id, name, description, target_date, status, created_at, updated_at
FROM milestones
WHERE id = $1;

-- name: GetMilestoneBySeqNumber :one
SELECT id, seq_number, project_id, name, description, target_date, status, created_at, updated_at
FROM milestones
WHERE seq_number = $1;

-- name: ListMilestonesByProject :many
SELECT id, seq_number, project_id, name, description, target_date, status, created_at, updated_at
FROM milestones
WHERE project_id = $1
ORDER BY target_date ASC, seq_number ASC;

-- name: UpdateMilestone :one
UPDATE milestones
SET name        = coalesce(sqlc.narg('name'),        name),
    description = coalesce(sqlc.narg('description'), description),
    target_date = coalesce(sqlc.narg('target_date'), target_date),
    status      = coalesce(sqlc.narg('status'),      status),
    updated_at  = now()
WHERE id = $1
RETURNING id, seq_number, project_id, name, description, target_date, status, created_at, updated_at;

-- name: DeleteMilestone :exec
DELETE FROM milestones WHERE id = $1;

-- name: SetNodeMilestone :one
-- Bind (or unbind, when milestone_id is NULL) a project tree node to a milestone.
UPDATE projects
SET milestone_id = sqlc.narg('milestone_id'),
    updated_at   = now()
WHERE id = $1
RETURNING id, milestone_id;

-- name: ListTimelineNodes :many
-- Purpose-built feed for the Gantt: every node in a project subtree with the
-- handful of columns the timeline needs (dates + milestone binding), nothing more.
-- Kept separate from the heavy project SELECTs so buildProject stays untouched.
WITH RECURSIVE subtree AS (
  SELECT p.id, p.node_number, p.name, p.parent_id, p.status,
         p.start_date, p.end_date, p.milestone_id, p.is_archived, 0 AS depth
  FROM projects p
  WHERE p.id = $1
  UNION ALL
  SELECT p.id, p.node_number, p.name, p.parent_id, p.status,
         p.start_date, p.end_date, p.milestone_id, p.is_archived, s.depth + 1
  FROM projects p
  JOIN subtree s ON p.parent_id = s.id
  WHERE NOT p.is_archived OR sqlc.arg('show_archived')::boolean
)
SELECT id, node_number, name, parent_id, status, start_date, end_date, milestone_id, depth
FROM subtree
ORDER BY depth ASC, start_date ASC NULLS LAST, node_number ASC;
