-- Long-lived opaque tokens for AI agents (MCP server, automation bots).
-- Unlike JWT access tokens (15min), these tokens have no built-in expiry
-- and are revocable at any time from the admin UI.
-- Raw token is returned once at creation; only the SHA-256 hash is stored here.

CREATE TABLE agent_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- token acts as this user
    created_by   UUID NOT NULL REFERENCES users(id),                     -- admin who created it
    name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 128),
    token_hash   TEXT NOT NULL UNIQUE,  -- SHA-256 hex of raw token; raw token never stored
    project_id   UUID REFERENCES projects(id) ON DELETE CASCADE,         -- optional scope; NULL = all projects
    last_used_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at   TIMESTAMPTZ  -- NULL = active
);

CREATE INDEX idx_agent_tokens_user ON agent_tokens(user_id);
CREATE INDEX idx_agent_tokens_hash ON agent_tokens(token_hash);
