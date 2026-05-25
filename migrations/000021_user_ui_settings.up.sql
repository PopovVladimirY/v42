-- Migration 000021: per-user UI settings + last active timestamp
--
-- ui_settings: JSONB blob for client-side preferences that must survive
--   browser cache clears and device switches (default tabs, grouping, etc.)
-- last_active_at: lightweight online signal; updated at most once per minute
--   by the auth middleware (throttle is in the UPDATE WHERE clause).

ALTER TABLE users
    ADD COLUMN ui_settings    JSONB,
    ADD COLUMN last_active_at TIMESTAMPTZ;

-- Partial index: makes "who was active in the last N days?" cheap.
CREATE INDEX idx_users_last_active ON users (last_active_at)
    WHERE last_active_at IS NOT NULL;
