-- Rollback: remove parent_item_id column.
-- NOTE: cannot remove ENUM value in Postgres; 'decomposed' stays in type.
ALTER TABLE backlog_items DROP COLUMN IF EXISTS parent_item_id;
DROP INDEX IF EXISTS idx_backlog_items_parent;
