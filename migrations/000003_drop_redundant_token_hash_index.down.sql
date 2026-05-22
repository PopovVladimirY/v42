-- Restore the (redundant) index that was dropped in the up migration.
-- This index duplicates the one created by the UNIQUE constraint on token_hash,
-- but is recreated here for reversibility.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
