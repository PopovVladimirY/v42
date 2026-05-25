-- name: ListSprintCapacity :many
-- All capacity rows for a sprint, joined with user display name.
SELECT
    sc.sprint_id,
    sc.user_id,
    u.display_name AS user_name,
    sc.planned_hours,
    sc.actual_hours,
    sc.notes,
    sc.created_at,
    sc.updated_at
FROM sprint_capacity sc
JOIN users u ON u.id = sc.user_id
WHERE sc.sprint_id = $1
ORDER BY u.display_name;

-- name: UpsertSprintCapacity :one
-- Insert or update a capacity row (used during Sprint Planning bulk PUT).
INSERT INTO sprint_capacity (sprint_id, user_id, planned_hours, notes, updated_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (sprint_id, user_id) DO UPDATE
    SET planned_hours = EXCLUDED.planned_hours,
        notes         = EXCLUDED.notes,
        updated_at    = now()
RETURNING *;

-- name: PatchSprintCapacityActual :one
-- Update only the actual_hours for a single member (Sprint Review PATCH).
UPDATE sprint_capacity
SET actual_hours = $3,
    notes        = COALESCE($4, notes),
    updated_at   = now()
WHERE sprint_id = $1 AND user_id = $2
RETURNING *;

-- name: DeleteSprintCapacity :exec
-- Remove all capacity rows for a sprint (used by /init re-seed logic).
DELETE FROM sprint_capacity WHERE sprint_id = $1 AND user_id = $2;

-- name: GetSkillCapacityBySprint :many
-- Aggregate planned hours per skill for a sprint (skill coverage breakdown).
SELECT
    sk.id   AS skill_id,
    sk.name AS skill_name,
    SUM(sc.planned_hours)::NUMERIC(5,1) AS planned_hours
FROM sprint_capacity sc
JOIN member_skills ms ON ms.user_id = sc.user_id
JOIN skills sk         ON sk.id = ms.skill_id
WHERE sc.sprint_id = $1
GROUP BY sk.id, sk.name
ORDER BY planned_hours DESC;

-- name: GetVelocityHistory :many
-- Normalized velocity per completed sprint for a project.
SELECT
    s.id,
    s.name,
    s.start_date,
    s.end_date,
    COUNT(si.backlog_item_id)                                        AS total_items,
    COUNT(si.backlog_item_id) FILTER (WHERE bi.status = 'done')      AS done_items,
    COALESCE(SUM(sc.planned_hours), 0)::NUMERIC(7,1)                 AS planned_hours,
    COALESCE(SUM(sc.actual_hours), 0)::NUMERIC(7,1)                  AS actual_hours,
    CASE
        WHEN COALESCE(SUM(sc.actual_hours), 0) > 0
        THEN ROUND(
            COUNT(si.backlog_item_id) FILTER (WHERE bi.status = 'done')::NUMERIC
            / SUM(sc.actual_hours) * 100, 2)
        ELSE NULL
    END AS velocity_normalized
FROM sprints s
LEFT JOIN sprint_items si       ON si.sprint_id = s.id
LEFT JOIN backlog_items bi      ON bi.id = si.backlog_item_id
LEFT JOIN sprint_capacity sc    ON sc.sprint_id = s.id
WHERE s.project_id = $1 AND s.status = 'completed'
GROUP BY s.id, s.name, s.start_date, s.end_date
ORDER BY s.start_date;
