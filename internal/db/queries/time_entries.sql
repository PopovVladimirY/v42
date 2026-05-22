-- Time entries: immutable audit trail of hours logged against tasks.
-- Corrections are done by adding a negative entry + a new correct one.

-- name: CreateTimeEntry :one
INSERT INTO time_entries (task_id, user_id, hours, logged_date, note)
VALUES (@task_id, @user_id, @hours, @logged_date, @note)
RETURNING *;

-- name: ListTimeEntriesByTask :many
SELECT te.*, u.display_name AS user_name
FROM time_entries te
JOIN users u ON u.id = te.user_id
WHERE te.task_id = @task_id
ORDER BY te.logged_date DESC, te.created_at DESC;

-- name: GetTimeEntryTotalByTask :one
SELECT COALESCE(SUM(hours), 0)::numeric AS total_hours
FROM time_entries
WHERE task_id = @task_id;

-- name: ListTimeEntriesByUser :many
SELECT te.*, t.title AS task_title
FROM time_entries te
JOIN tasks t ON t.id = te.task_id
WHERE te.user_id = @user_id
  AND te.logged_date >= @from_date
  AND te.logged_date <= @to_date
ORDER BY te.logged_date DESC;

-- name: DeleteTimeEntry :exec
DELETE FROM time_entries WHERE id = @id AND user_id = @user_id;
