-- =============================================================================
-- Migration 029: Resurrect the legacy per-project `number` triggers
-- =============================================================================
-- Migration 018 introduced global `seq_number` columns and, in the process,
-- guillotined the old per-project numbering triggers (`trg_epic_number`,
-- `trg_backlog_item_number`). Trouble is: it left the legacy `number` columns
-- standing as NOT NULL with nobody left to feed them. Every epic/backlog INSERT
-- since then has walked straight into a 23502 not-null landmine.
--
-- We keep the `number` column (sqlc still SELECTs/RETURNs it as NOT NULL int64),
-- so the cleanest fix is to bring the executioners' victims back to life:
-- BEFORE INSERT triggers that assign a per-project sequential number again.
-- =============================================================================

-- epics.number -- per-project sequential, never reused
CREATE OR REPLACE FUNCTION _assign_epic_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.number IS NULL THEN
    NEW.number := COALESCE(
      (SELECT MAX(number) FROM epics WHERE project_id = NEW.project_id),
      0
    ) + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_epic_number ON epics;
CREATE TRIGGER trg_epic_number
  BEFORE INSERT ON epics
  FOR EACH ROW EXECUTE FUNCTION _assign_epic_number();

-- backlog_items.number -- per-project sequential, never reused
CREATE OR REPLACE FUNCTION _assign_backlog_item_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.number IS NULL THEN
    NEW.number := COALESCE(
      (SELECT MAX(number) FROM backlog_items WHERE project_id = NEW.project_id),
      0
    ) + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_backlog_item_number ON backlog_items;
CREATE TRIGGER trg_backlog_item_number
  BEFORE INSERT ON backlog_items
  FOR EACH ROW EXECUTE FUNCTION _assign_backlog_item_number();
