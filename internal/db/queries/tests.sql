-- Tests (test specs at project / epic / backlog_item level).
-- Level is determined by which FK is non-null:
--   backlog_item_id set -> item-level
--   epic_id set (backlog_item_id null) -> epic-level
--   both null -> project-level (regression suite)

-- name: CreateTest :one
INSERT INTO tests (
    project_id, backlog_item_id, epic_id,
    title, description, setup, config, steps, expected_results,
    type, created_by
) VALUES (
    @project_id, @backlog_item_id, @epic_id,
    @title, @description, @setup, @config, @steps, @expected_results,
    @type, @created_by
)
RETURNING *;

-- name: GetTest :one
SELECT * FROM tests
WHERE id = @id AND project_id = @project_id;

-- name: ListTestsByProject :many
SELECT * FROM tests
WHERE project_id = @project_id
  AND backlog_item_id IS NULL
  AND epic_id IS NULL
ORDER BY created_at DESC;

-- name: ListTestsByEpic :many
SELECT * FROM tests
WHERE project_id = @project_id
  AND epic_id = @epic_id
  AND backlog_item_id IS NULL
ORDER BY created_at DESC;

-- name: ListTestsByBacklogItem :many
SELECT * FROM tests
WHERE project_id = @project_id
  AND backlog_item_id = @backlog_item_id
ORDER BY created_at DESC;

-- name: UpdateTest :one
UPDATE tests
SET title            = COALESCE(sqlc.narg(title), title),
    description      = COALESCE(sqlc.narg(description), description),
    setup            = COALESCE(sqlc.narg(setup), setup),
    config           = COALESCE(sqlc.narg(config), config),
    steps            = COALESCE(sqlc.narg(steps), steps),
    expected_results = COALESCE(sqlc.narg(expected_results), expected_results),
    type             = COALESCE(sqlc.narg(type), type),
    updated_at       = now()
WHERE id = @id AND project_id = @project_id
RETURNING *;

-- name: DeleteTest :exec
DELETE FROM tests WHERE id = @id AND project_id = @project_id;

-- name: MoveTest :one
UPDATE tests
SET backlog_item_id = $2,
    updated_at      = now()
WHERE id = $1
RETURNING *;

-- name: ListTestsByIDs :many
SELECT * FROM tests WHERE id = ANY(@ids::uuid[]);
