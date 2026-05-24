-- Rollback migration 018: Project hierarchy
-- Order matters: remove dependent objects before dropping columns/tables.

-- 8. FTS index
DROP INDEX IF EXISTS idx_projects_fts;

-- 7. Stats dirty-flag
DROP TRIGGER IF EXISTS trg_backlog_stats_dirty ON backlog_items;
DROP FUNCTION IF EXISTS _mark_node_stats_dirty();
ALTER TABLE projects
  DROP COLUMN IF EXISTS open_items,
  DROP COLUMN IF EXISTS total_items,
  DROP COLUMN IF EXISTS clarity_score,
  DROP COLUMN IF EXISTS stats_dirty,
  DROP COLUMN IF EXISTS stats_updated_at;

-- 6. order_index on epics/sprints
DROP INDEX IF EXISTS idx_sprints_order;
DROP INDEX IF EXISTS idx_epics_order;
ALTER TABLE sprints DROP COLUMN IF EXISTS order_index;
ALTER TABLE epics   DROP COLUMN IF EXISTS order_index;

-- 5. backlog_items node/milestone columns
DROP INDEX IF EXISTS idx_backlog_milestone;
DROP INDEX IF EXISTS idx_backlog_node;
ALTER TABLE backlog_items
  DROP COLUMN IF EXISTS milestone_id,
  DROP COLUMN IF EXISTS node_id;

-- 4. node_skill_requirements
DROP TABLE IF EXISTS node_skill_requirements;

-- 3. milestones
DROP TABLE IF EXISTS milestones;
DROP SEQUENCE IF EXISTS milestone_seq;

-- 2g. tests seq
DROP TRIGGER IF EXISTS trg_test_seq_number ON tests;
DROP FUNCTION IF EXISTS _assign_test_seq_number();
ALTER TABLE tests DROP CONSTRAINT IF EXISTS tests_seq_number_unique;
ALTER TABLE tests DROP COLUMN IF EXISTS seq_number;
DROP SEQUENCE IF EXISTS test_seq;

-- 2f. tasks seq
DROP TRIGGER IF EXISTS trg_task_seq_number ON tasks;
DROP FUNCTION IF EXISTS _assign_task_seq_number();
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_seq_number_unique;
ALTER TABLE tasks DROP COLUMN IF EXISTS seq_number;
DROP SEQUENCE IF EXISTS task_seq;

-- 2e. backlog_items global seq
DROP TRIGGER IF EXISTS trg_backlog_seq_number ON backlog_items;
DROP FUNCTION IF EXISTS _assign_backlog_seq_number();
ALTER TABLE backlog_items DROP CONSTRAINT IF EXISTS backlog_items_seq_number_unique;
ALTER TABLE backlog_items DROP COLUMN IF EXISTS seq_number;
DROP SEQUENCE IF EXISTS backlog_seq;

-- Restore per-project trigger for backlog_items (migration 011)
CREATE OR REPLACE FUNCTION _assign_backlog_item_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.number := COALESCE(
    (SELECT MAX(number) FROM backlog_items WHERE project_id = NEW.project_id),
    0
  ) + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_backlog_item_number
  BEFORE INSERT ON backlog_items
  FOR EACH ROW EXECUTE FUNCTION _assign_backlog_item_number();

-- 2d. epics global seq
DROP TRIGGER IF EXISTS trg_epic_seq_number ON epics;
DROP FUNCTION IF EXISTS _assign_epic_seq_number();
ALTER TABLE epics DROP CONSTRAINT IF EXISTS epics_seq_number_unique;
ALTER TABLE epics DROP COLUMN IF EXISTS seq_number;
DROP SEQUENCE IF EXISTS epic_seq;

-- Restore per-project trigger for epics (migration 011)
CREATE OR REPLACE FUNCTION _assign_epic_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.number := COALESCE(
    (SELECT MAX(number) FROM epics WHERE project_id = NEW.project_id),
    0
  ) + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_epic_number
  BEFORE INSERT ON epics
  FOR EACH ROW EXECUTE FUNCTION _assign_epic_number();

-- 2c. sprints seq
DROP TRIGGER IF EXISTS trg_sprint_number ON sprints;
DROP FUNCTION IF EXISTS _assign_sprint_number();
ALTER TABLE sprints DROP CONSTRAINT IF EXISTS sprints_sprint_number_unique;
ALTER TABLE sprints DROP COLUMN IF EXISTS sprint_number;
DROP SEQUENCE IF EXISTS sprint_seq;

-- 2a. project node number + sequence
DROP TRIGGER IF EXISTS trg_project_node_number ON projects;
DROP FUNCTION IF EXISTS _assign_project_node_number();
DROP SEQUENCE IF EXISTS project_node_seq;

-- 1. Project tree columns
DROP INDEX IF EXISTS idx_projects_fts;
DROP INDEX IF EXISTS idx_projects_order;
DROP INDEX IF EXISTS idx_projects_parent;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_node_number_unique;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_no_self_parent;
ALTER TABLE projects
  DROP COLUMN IF EXISTS node_number,
  DROP COLUMN IF EXISTS order_index,
  DROP COLUMN IF EXISTS end_date,
  DROP COLUMN IF EXISTS start_date,
  DROP COLUMN IF EXISTS parent_id;
