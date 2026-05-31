-- Migration 031: Milestone lifecycle status + project->milestone binding
-- "Веха -- точка отсчёта реальности." -- MILESTONES.md
--
-- Two independent axes (see MILESTONES.md):
--   - lifecycle (manual intent): future -> target -> closed  (this enum)
--   - health (derived, computed in Go): on_time / at_risk / delayed / missed
-- We store ONLY lifecycle. Health is never persisted -- it is a function of
-- dates and today, recomputed on the fly.

CREATE TYPE milestone_status AS ENUM ('future', 'target', 'closed');

ALTER TABLE milestones
  ADD COLUMN status milestone_status NOT NULL DEFAULT 'future';

-- A stage (project tree node) may aim at one milestone. NULL = unaligned.
ALTER TABLE projects
  ADD COLUMN milestone_id UUID REFERENCES milestones(id) ON DELETE SET NULL;

CREATE INDEX idx_projects_milestone ON projects(milestone_id) WHERE milestone_id IS NOT NULL;
