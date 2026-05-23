-- Add clarity quadrant to backlog_items.
-- Mirrors the same check as epics.clarity.

ALTER TABLE backlog_items
  ADD COLUMN clarity TEXT NOT NULL DEFAULT 'unknown'
    CHECK (clarity IN ('clear', 'scoped', 'tacit', 'foggy', 'unknown'));
