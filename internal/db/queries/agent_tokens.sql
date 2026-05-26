-- name: CreateAgentToken :one
INSERT INTO agent_tokens (user_id, created_by, name, token_hash, project_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, user_id, created_by, name, token_hash, project_id, last_used_at, created_at, revoked_at;

-- name: GetAgentTokenByHash :one
-- Used by the auth middleware on every request. Returns only active (non-revoked) tokens.
SELECT id, user_id, created_by, name, token_hash, project_id, last_used_at, created_at, revoked_at
FROM agent_tokens
WHERE token_hash = $1 AND revoked_at IS NULL;

-- name: ListAgentTokens :many
SELECT id, user_id, created_by, name, token_hash, project_id, last_used_at, created_at, revoked_at
FROM agent_tokens
ORDER BY created_at DESC;

-- name: RevokeAgentToken :exec
UPDATE agent_tokens
SET revoked_at = now()
WHERE id = $1 AND revoked_at IS NULL;

-- name: TouchAgentToken :exec
-- Updates last_used_at to track when the token was last seen. Best-effort, fire-and-forget.
UPDATE agent_tokens
SET last_used_at = now()
WHERE id = $1;
