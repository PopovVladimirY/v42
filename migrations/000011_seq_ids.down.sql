ALTER TABLE backlog_items DROP CONSTRAINT IF EXISTS backlog_items_project_number_uq;
ALTER TABLE epics         DROP CONSTRAINT IF EXISTS epics_project_number_uq;

DROP TRIGGER IF EXISTS trg_backlog_item_number ON backlog_items;
DROP FUNCTION IF EXISTS _assign_backlog_item_number();

DROP TRIGGER IF EXISTS trg_epic_number ON epics;
DROP FUNCTION IF EXISTS _assign_epic_number();

ALTER TABLE backlog_items DROP COLUMN IF EXISTS number;
ALTER TABLE epics         DROP COLUMN IF EXISTS number;
