-- name: CreateSprint :one
INSERT INTO sprints (project_id, team_id, name, goal, status, start_date, end_date, capacity_hours)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, project_id, team_id, name, goal, status, start_date, end_date, capacity_hours, created_at, updated_at;

-- name: GetSprintByID :one
SELECT id, project_id, team_id, name, goal, status, start_date, end_date, capacity_hours, created_at, updated_at
FROM sprints
WHERE id = $1;

-- name: ListSprintsByProject :many
SELECT id, project_id, team_id, name, goal, status, start_date, end_date, capacity_hours, created_at, updated_at
FROM sprints
WHERE project_id = $1
ORDER BY created_at DESC;

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
RETURNING id, project_id, team_id, name, goal, status, start_date, end_date, capacity_hours, created_at, updated_at;

-- name: DeleteSprint :exec
DELETE FROM sprints WHERE id = $1;

-- name: AddSprintItem :exec
INSERT INTO sprint_items (sprint_id, backlog_item_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: RemoveSprintItem :exec
DELETE FROM sprint_items WHERE sprint_id = $1 AND backlog_item_id = $2;

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
