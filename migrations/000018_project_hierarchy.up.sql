-- =============================================================================
-- Migration 018: Project hierarchy, global sequential IDs, milestones
-- =============================================================================
-- "A project is not a day's work and not one team's work." -- TODO.md
--
-- Key changes:
--   1. projects becomes a self-referencing tree (parent_id)
--   2. Global sequential IDs for ALL entities (no more per-project counters)
--   3. milestones table -- temporal markers (like git tags)
--   4. node_skill_requirements -- skill map per tree node
--   5. backlog_items gets node_id + milestone_id
--   6. order_index added to epics and sprints
--   7. stats dirty-flag columns on projects (for rollup background worker)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Project tree: parent_id, dates, ordering, human-readable ID
-- -----------------------------------------------------------------------------

ALTER TABLE projects
  ADD COLUMN parent_id    UUID REFERENCES projects(id) ON DELETE RESTRICT,
  ADD COLUMN start_date   DATE,
  ADD COLUMN end_date     DATE,
  ADD COLUMN order_index  FLOAT8 NOT NULL DEFAULT 0,
  ADD COLUMN node_number  BIGINT;

-- Prevent a node from being its own parent (direct cycle check; deep cycles
-- are prevented at the application layer during DnD move validation).
ALTER TABLE projects
  ADD CONSTRAINT projects_no_self_parent CHECK (id != parent_id);

CREATE INDEX idx_projects_parent     ON projects(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_projects_order      ON projects(parent_id, order_index);

-- Unique constraint on node_number (will be populated by sequence + trigger below).
ALTER TABLE projects ADD CONSTRAINT projects_node_number_unique UNIQUE (node_number);


-- -----------------------------------------------------------------------------
-- 2. Global sequential IDs
-- All sequences start at "solid" numbers so IDs look professional from day one.
-- Format in API/UI: '<prefix>-' || seq_number  (formatting in Go, not stored)
-- -----------------------------------------------------------------------------

-- R-XXXXX  project nodes (projects + milestones in the tree)
CREATE SEQUENCE project_node_seq START 10001 INCREMENT 1;

CREATE OR REPLACE FUNCTION _assign_project_node_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.node_number IS NULL THEN
    NEW.node_number := nextval('project_node_seq');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_project_node_number
  BEFORE INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION _assign_project_node_number();

-- Backfill existing projects
UPDATE projects SET node_number = nextval('project_node_seq') WHERE node_number IS NULL;

-- Make node_number NOT NULL now that all rows are populated
ALTER TABLE projects ALTER COLUMN node_number SET NOT NULL;


-- I-XXX  sprints
ALTER TABLE sprints ADD COLUMN sprint_number BIGINT;
ALTER TABLE sprints ADD CONSTRAINT sprints_sprint_number_unique UNIQUE (sprint_number);

CREATE SEQUENCE sprint_seq START 288 INCREMENT 1;

CREATE OR REPLACE FUNCTION _assign_sprint_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sprint_number IS NULL THEN
    NEW.sprint_number := nextval('sprint_seq');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sprint_number
  BEFORE INSERT ON sprints
  FOR EACH ROW EXECUTE FUNCTION _assign_sprint_number();

UPDATE sprints SET sprint_number = nextval('sprint_seq') WHERE sprint_number IS NULL;
ALTER TABLE sprints ALTER COLUMN sprint_number SET NOT NULL;


-- E-XXXXX  epics (global, replacing per-project trigger from migration 011)
-- Keep old .number column for backward compat; add new .seq_number (global)
DROP TRIGGER IF EXISTS trg_epic_number ON epics;
DROP FUNCTION IF EXISTS _assign_epic_number();

ALTER TABLE epics ADD COLUMN seq_number BIGINT;
ALTER TABLE epics ADD CONSTRAINT epics_seq_number_unique UNIQUE (seq_number);

CREATE SEQUENCE epic_seq START 1001 INCREMENT 1;

CREATE OR REPLACE FUNCTION _assign_epic_seq_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.seq_number IS NULL THEN
    NEW.seq_number := nextval('epic_seq');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_epic_seq_number
  BEFORE INSERT ON epics
  FOR EACH ROW EXECUTE FUNCTION _assign_epic_seq_number();

UPDATE epics SET seq_number = nextval('epic_seq') WHERE seq_number IS NULL;
ALTER TABLE epics ALTER COLUMN seq_number SET NOT NULL;


-- B-XXXXX  backlog items (global, replacing per-project trigger from migration 011)
DROP TRIGGER IF EXISTS trg_backlog_item_number ON backlog_items;
DROP FUNCTION IF EXISTS _assign_backlog_item_number();

ALTER TABLE backlog_items ADD COLUMN seq_number BIGINT;
ALTER TABLE backlog_items ADD CONSTRAINT backlog_items_seq_number_unique UNIQUE (seq_number);

CREATE SEQUENCE backlog_seq START 5001 INCREMENT 1;

CREATE OR REPLACE FUNCTION _assign_backlog_seq_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.seq_number IS NULL THEN
    NEW.seq_number := nextval('backlog_seq');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_backlog_seq_number
  BEFORE INSERT ON backlog_items
  FOR EACH ROW EXECUTE FUNCTION _assign_backlog_seq_number();

UPDATE backlog_items SET seq_number = nextval('backlog_seq') WHERE seq_number IS NULL;
ALTER TABLE backlog_items ALTER COLUMN seq_number SET NOT NULL;


-- Z-XXXXX  tasks
ALTER TABLE tasks ADD COLUMN seq_number BIGINT;
ALTER TABLE tasks ADD CONSTRAINT tasks_seq_number_unique UNIQUE (seq_number);

CREATE SEQUENCE task_seq START 10001 INCREMENT 1;

CREATE OR REPLACE FUNCTION _assign_task_seq_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.seq_number IS NULL THEN
    NEW.seq_number := nextval('task_seq');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_task_seq_number
  BEFORE INSERT ON tasks
  FOR EACH ROW EXECUTE FUNCTION _assign_task_seq_number();

UPDATE tasks SET seq_number = nextval('task_seq') WHERE seq_number IS NULL;
ALTER TABLE tasks ALTER COLUMN seq_number SET NOT NULL;


-- T-XXXXX  tests
ALTER TABLE tests ADD COLUMN seq_number BIGINT;
ALTER TABLE tests ADD CONSTRAINT tests_seq_number_unique UNIQUE (seq_number);

CREATE SEQUENCE test_seq START 3001 INCREMENT 1;

CREATE OR REPLACE FUNCTION _assign_test_seq_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.seq_number IS NULL THEN
    NEW.seq_number := nextval('test_seq');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_test_seq_number
  BEFORE INSERT ON tests
  FOR EACH ROW EXECUTE FUNCTION _assign_test_seq_number();

UPDATE tests SET seq_number = nextval('test_seq') WHERE seq_number IS NULL;
ALTER TABLE tests ALTER COLUMN seq_number SET NOT NULL;


-- -----------------------------------------------------------------------------
-- 3. Milestones: temporal markers (M-XXX) -- like git tags
-- Multiple tree nodes can target the same milestone (delivery checkpoint).
-- -----------------------------------------------------------------------------

CREATE SEQUENCE milestone_seq START 101 INCREMENT 1;

CREATE TABLE milestones (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  target_date DATE        NOT NULL,
  seq_number  BIGINT      NOT NULL UNIQUE DEFAULT nextval('milestone_seq'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_milestones_project ON milestones(project_id);
CREATE INDEX idx_milestones_date    ON milestones(target_date);


-- -----------------------------------------------------------------------------
-- 4. Skill requirements per tree node
-- "2 Go proficients + 1 embedded Linux expert" per milestone.
-- -----------------------------------------------------------------------------

CREATE TABLE node_skill_requirements (
  node_id    UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  skill_id   UUID        NOT NULL REFERENCES skills(id)  ON DELETE CASCADE,
  min_level  skill_level NOT NULL DEFAULT 'competent',
  headcount  SMALLINT    NOT NULL DEFAULT 1 CHECK (headcount > 0),
  notes      TEXT,
  PRIMARY KEY (node_id, skill_id)
);

CREATE INDEX idx_node_skill_req ON node_skill_requirements(node_id);


-- -----------------------------------------------------------------------------
-- 5. backlog_items: node attachment + milestone targeting
-- node_id    -> which tree node (stage/milestone) owns this work
-- milestone_id -> which delivery checkpoint this work targets
-- Both are nullable: existing items are unattached until migrated via UI.
-- -----------------------------------------------------------------------------

ALTER TABLE backlog_items
  ADD COLUMN node_id      UUID REFERENCES projects(id)  ON DELETE SET NULL,
  ADD COLUMN milestone_id UUID REFERENCES milestones(id) ON DELETE SET NULL;

CREATE INDEX idx_backlog_node      ON backlog_items(node_id)      WHERE node_id IS NOT NULL;
CREATE INDEX idx_backlog_milestone ON backlog_items(milestone_id) WHERE milestone_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 6. order_index: everywhere DnD sorting is needed
-- -----------------------------------------------------------------------------

ALTER TABLE epics   ADD COLUMN order_index FLOAT8 NOT NULL DEFAULT 0;
ALTER TABLE sprints ADD COLUMN order_index FLOAT8 NOT NULL DEFAULT 0;

CREATE INDEX idx_epics_order   ON epics(project_id, order_index);
CREATE INDEX idx_sprints_order ON sprints(project_id, order_index);


-- -----------------------------------------------------------------------------
-- 7. Stats dirty-flag on projects (rollup background worker cache)
-- clarity_score: 0.00-100.00 aggregate clarity index across subtree
-- stats_dirty:   set by trigger on any backlog_item change in subtree
-- -----------------------------------------------------------------------------

ALTER TABLE projects
  ADD COLUMN open_items      INT      NOT NULL DEFAULT 0,
  ADD COLUMN total_items     INT      NOT NULL DEFAULT 0,
  ADD COLUMN clarity_score   NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN stats_dirty     BOOLEAN  NOT NULL DEFAULT true,
  ADD COLUMN stats_updated_at TIMESTAMPTZ;

-- Trigger: mark node dirty when any backlog_item is inserted/updated/deleted.
-- Also marks ALL ancestors dirty in one recursive CTE update.
CREATE OR REPLACE FUNCTION _mark_node_stats_dirty()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_node_id UUID;
BEGIN
  -- Determine the affected node_id (project_id is always the root, node_id is the stage)
  v_node_id := COALESCE(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.node_id ELSE NEW.node_id END,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.project_id ELSE NEW.project_id END
  );

  -- Mark the node and all its ancestors dirty in one shot
  WITH RECURSIVE ancestors AS (
    SELECT id, parent_id FROM projects WHERE id = v_node_id
    UNION ALL
    SELECT p.id, p.parent_id
    FROM   projects p
    JOIN   ancestors a ON p.id = a.parent_id
  )
  UPDATE projects SET stats_dirty = true
  WHERE  id IN (SELECT id FROM ancestors);

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_backlog_stats_dirty
  AFTER INSERT OR UPDATE OR DELETE ON backlog_items
  FOR EACH ROW EXECUTE FUNCTION _mark_node_stats_dirty();


-- -----------------------------------------------------------------------------
-- 8. Full-text search index on project nodes
-- -----------------------------------------------------------------------------

CREATE INDEX idx_projects_fts ON projects
  USING gin(to_tsvector('english', name || ' ' || COALESCE(description, '')));
