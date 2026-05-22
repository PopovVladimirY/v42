-- Sprint test results: one row per test/AC subject per sprint.
-- Initialized when a sprint is started (status -> active).

-- name: InitSprintTestResults :exec
-- Bulk-insert result rows for all tests linked to backlog items in the sprint.
-- ON CONFLICT DO NOTHING: safe to call multiple times (idempotent).
INSERT INTO sprint_test_results (sprint_id, test_id)
SELECT @sprint_id::uuid, t.id
FROM tests t
JOIN sprint_items si ON si.backlog_item_id = t.backlog_item_id
WHERE si.sprint_id = @sprint_id
  AND t.backlog_item_id IS NOT NULL
ON CONFLICT (sprint_id, test_id) DO NOTHING;

-- name: InitSprintACResults :exec
-- Bulk-insert result rows for backlog items in the sprint (AC acceptance check).
INSERT INTO sprint_test_results (sprint_id, backlog_item_id)
SELECT @sprint_id::uuid, si.backlog_item_id
FROM sprint_items si
WHERE si.sprint_id = @sprint_id
ON CONFLICT (sprint_id, backlog_item_id) DO NOTHING;

-- name: ListSprintTestResults :many
SELECT spr.*,
       t.title  AS test_title,
       t.type   AS test_type,
       bi.title AS item_title
FROM sprint_test_results spr
LEFT JOIN tests         t  ON t.id  = spr.test_id
LEFT JOIN backlog_items bi ON bi.id = spr.backlog_item_id
WHERE spr.sprint_id = @sprint_id
ORDER BY spr.created_at;

-- name: UpdateSprintTestResult :one
UPDATE sprint_test_results
SET status      = COALESCE(sqlc.narg(status), status),
    skip_reason = COALESCE(sqlc.narg(skip_reason), skip_reason),
    notes       = COALESCE(sqlc.narg(notes), notes),
    executed_by = COALESCE(sqlc.narg(executed_by), executed_by),
    executed_at = COALESCE(sqlc.narg(executed_at), executed_at),
    updated_at  = now()
WHERE id = @id AND sprint_id = @sprint_id
RETURNING *;

-- name: GetFailedTestDependents :many
-- Find all tests that depend on the given failed test (for auto-skip).
SELECT td.test_id
FROM test_dependencies td
WHERE td.depends_on_id = @failed_test_id;

-- name: AutoSkipDependents :exec
-- Mark all tests that depend on a failed test as skipped in the current sprint.
UPDATE sprint_test_results
SET status      = 'skipped',
    skip_reason = @skip_reason,
    updated_at  = now()
WHERE sprint_id = @sprint_id
  AND test_id   = ANY(@test_ids::uuid[])
  AND status    NOT IN ('pass', 'failed');
