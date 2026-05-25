-- name: CreateSprint :one
INSERT INTO sprints (project_id, team_id, name, goal, status, start_date, end_date, capacity_hours, order_index)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id, sprint_number, project_id, team_id, name, goal, status,
          start_date, end_date, capacity_hours, order_index, created_at, updated_at;

-- name: GetSprintByID :one
SELECT id, sprint_number, project_id, team_id, name, goal, status,
       start_date, end_date, capacity_hours, order_index, created_at, updated_at
FROM sprints
WHERE id = $1;

-- name: GetSprintByNumber :one
SELECT id, sprint_number, project_id, team_id, name, goal, status,
       start_date, end_date, capacity_hours, order_index, created_at, updated_at
FROM sprints
WHERE sprint_number = $1;

-- name: ListSprintsByProject :many
SELECT id, sprint_number, project_id, team_id, name, goal, status,
       start_date, end_date, capacity_hours, order_index, created_at, updated_at
FROM sprints
WHERE project_id = $1
ORDER BY order_index ASC, created_at DESC;

-- name: UpdateSprint :one
UPDATE sprints
SET name           = coalesce(sqlc.narg('name'),           name),
    goal           = coalesce(sqlc.narg('goal'),           goal),
    status         = coalesce(sqlc.narg('status'),         status),
    start_date     = coalesce(sqlc.narg('start_date'),     start_date),
    end_date       = coalesce(sqlc.narg('end_date'),       end_date),
    capacity_hours = coalesce(sqlc.narg('capacity_hours'), capacity_hours),
    updated_at     = now()
WHERE id = $1
RETURNING id, sprint_number, project_id, team_id, name, goal, status,
          start_date, end_date, capacity_hours, order_index, created_at, updated_at;

-- name: DeleteSprint :exec
DELETE FROM sprints WHERE id = $1;

-- name: AddSprintItem :exec
INSERT INTO sprint_items (sprint_id, backlog_item_id)
VALUES ($1, $2);

-- name: RemoveSprintItem :one
DELETE FROM sprint_items WHERE sprint_id = $1 AND backlog_item_id = $2
RETURNING sprint_id;

-- name: ListSprintItems :many
-- Items committed to a sprint, ordered by priority.
SELECT
    bi.id, bi.title, bi.status, bi.type, bi.priority,
    bi.estimate, bi.assignee_id, bi.skill_required,
    bi.ac_steps, bi.ac_expected,
    si.added_at
FROM sprint_items si
JOIN backlog_items bi ON bi.id = si.backlog_item_id
WHERE si.sprint_id = $1
ORDER BY bi.priority ASC;

-- name: ListActiveSprintsByUser :many
-- GET /sprints: cross-project active sprints for teams the user belongs to.
-- Item counts are fetched separately by the store (avoids COUNT::INT inference issues with sqlc).
SELECT
    s.id,
    s.sprint_number,
    s.project_id,
    s.team_id,
    s.name,
    s.goal,
    s.status,
    s.start_date,
    s.end_date,
    s.capacity_hours,
    s.order_index,
    s.created_at,
    s.updated_at,
    p.name AS project_name,
    COALESCE(t.name, '') AS team_name
FROM sprints s
JOIN projects p ON p.id = s.project_id
LEFT JOIN teams t ON t.id = s.team_id
WHERE s.status = $1::sprint_status
  AND EXISTS (
      SELECT 1
      FROM project_teams pt
      JOIN team_members tm ON tm.team_id = pt.team_id
      WHERE pt.project_id = s.project_id AND tm.user_id = $2
  )
ORDER BY p.name ASC, s.sprint_number ASC;

-- name: ListAllActiveSprints :many
-- GET /sprints (admin): all sprints of given status across all projects.
SELECT
    s.id,
    s.sprint_number,
    s.project_id,
    s.team_id,
    s.name,
    s.goal,
    s.status,
    s.start_date,
    s.end_date,
    s.capacity_hours,
    s.order_index,
    s.created_at,
    s.updated_at,
    p.name AS project_name,
    COALESCE(t.name, '') AS team_name
FROM sprints s
JOIN projects p ON p.id = s.project_id
LEFT JOIN teams t ON t.id = s.team_id
WHERE s.status = $1::sprint_status
ORDER BY p.name ASC, s.sprint_number ASC;

-- name: CountSprintItems :one
-- For /sprints endpoint: total and done item counts for a sprint.
SELECT
    COUNT(*)                                                        AS total_items,
    COUNT(*) FILTER (WHERE bi.status = 'done'::item_status)        AS done_items
FROM sprint_items si
JOIN backlog_items bi ON bi.id = si.backlog_item_id
WHERE si.sprint_id = $1;
