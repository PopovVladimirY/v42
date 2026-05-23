-- Add sequential project-scoped number to epics (E-N) and backlog_items (B-N).
-- Numbers are assigned by trigger: unique within a project, never reused.

-- epics.number
ALTER TABLE epics ADD COLUMN number BIGINT;

-- backlog_items.number
ALTER TABLE backlog_items ADD COLUMN number BIGINT;

-- Trigger function for epics
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

-- Trigger function for backlog_items
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

-- Backfill existing rows using created_at order within each project
UPDATE epics e
SET    number = sub.rn
FROM   (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) AS rn
  FROM   epics
) sub
WHERE  e.id = sub.id;

UPDATE backlog_items b
SET    number = sub.rn
FROM   (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) AS rn
  FROM   backlog_items
) sub
WHERE  b.id = sub.id;

-- Now enforce NOT NULL and uniqueness
ALTER TABLE epics         ALTER COLUMN number SET NOT NULL;
ALTER TABLE backlog_items ALTER COLUMN number SET NOT NULL;

ALTER TABLE epics         ADD CONSTRAINT epics_project_number_uq         UNIQUE (project_id, number);
ALTER TABLE backlog_items ADD CONSTRAINT backlog_items_project_number_uq  UNIQUE (project_id, number);
