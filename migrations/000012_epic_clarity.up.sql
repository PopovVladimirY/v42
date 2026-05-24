-- Add clarity quadrant to epics (same values as backlog_items).
-- Answers: "how well-defined is this epic before decomposition?"

ALTER TABLE epics
  ADD COLUMN clarity TEXT NOT NULL DEFAULT 'unknown'
    CHECK (clarity IN ('clear', 'scoped', 'tacit', 'foggy', 'unknown'));
