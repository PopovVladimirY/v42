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
