-- name: ListRetroItems :many
-- All retro cards for a sprint with vote counts and caller's own vote status.
SELECT
    ri.id,
    ri.sprint_id,
    ri.author_id,
    u.display_name    AS author_name,
    ri.category,
    ri.content,
    ri.is_action,
    ri.is_resolved,
    ri.backlog_item_id,
    ri.created_at,
    ri.updated_at,
    COUNT(rv.user_id)::INT                                    AS votes,
    COALESCE(BOOL_OR(rv.user_id = $2), false)                 AS my_vote,
    (SELECT COUNT(*) FROM retrospective_votes rv2
     WHERE rv2.user_id = $2
       AND rv2.retro_item_id IN (
           SELECT id FROM retrospective_items ri2 WHERE ri2.sprint_id = $1
       )
    )::INT                                                    AS my_total_votes
FROM retrospective_items ri
JOIN users u ON u.id = ri.author_id
LEFT JOIN retrospective_votes rv ON rv.retro_item_id = ri.id
WHERE ri.sprint_id = $1
GROUP BY ri.id, u.display_name
ORDER BY votes DESC, ri.created_at;

-- name: CreateRetroItem :one
INSERT INTO retrospective_items
    (sprint_id, author_id, category, content, is_action)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateRetroItem :one
UPDATE retrospective_items
SET content    = $2,
    is_action  = $3,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ResolveRetroAction :one
UPDATE retrospective_items
SET is_resolved = $2,
    updated_at  = now()
WHERE id = $1
RETURNING *;

-- name: DeleteRetroItem :exec
DELETE FROM retrospective_items WHERE id = $1;

-- name: CastRetroVote :exec
INSERT INTO retrospective_votes (retro_item_id, user_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: RetractRetroVote :exec
DELETE FROM retrospective_votes WHERE retro_item_id = $1 AND user_id = $2;

-- name: CountUserRetroVotes :one
-- Total votes cast by a user across all cards in a sprint (for limit enforcement).
SELECT COUNT(*)::INT AS vote_count
FROM retrospective_votes rv
JOIN retrospective_items ri ON ri.id = rv.retro_item_id
WHERE ri.sprint_id = $1 AND rv.user_id = $2;

-- name: GetRetroItem :one
SELECT ri.*, u.display_name AS author_name
FROM retrospective_items ri
JOIN users u ON u.id = ri.author_id
WHERE ri.id = $1;

-- name: CloseRetro :exec
UPDATE sprints SET retro_closed = TRUE WHERE id = $1;
