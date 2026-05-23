-- Phase 8.4.8: add per-user idle timeout preference.
-- 0 = never time out. Default: 30 minutes.
ALTER TABLE users
    ADD COLUMN idle_timeout_minutes integer NOT NULL DEFAULT 30
        CHECK (idle_timeout_minutes >= 0);
