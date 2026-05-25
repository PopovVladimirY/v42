-- Migration 000024: backlog breakdown support.
-- Adds parent_item_id for Life Tree history and 'decomposed' status.
-- Decomposed items are kept forever for history; hidden from working views by default.

-- 'decomposed' = this item was split into children; archived, not deleted.
ALTER TYPE item_status ADD VALUE IF NOT EXISTS 'decomposed' AFTER 'rejected';

-- Self-referencing: children point to the item they were broken out of.
ALTER TABLE backlog_items
    ADD COLUMN IF NOT EXISTS parent_item_id UUID REFERENCES backlog_items(id) ON DELETE SET NULL;

-- Fast lookup: "give me all children of item X" for Life Tree.
CREATE INDEX IF NOT EXISTS idx_backlog_items_parent
    ON backlog_items(parent_item_id)
    WHERE parent_item_id IS NOT NULL;
