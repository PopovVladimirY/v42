-- Roll back the resurrected legacy `number` triggers.
DROP TRIGGER IF EXISTS trg_epic_number ON epics;
DROP FUNCTION IF EXISTS _assign_epic_number();

DROP TRIGGER IF EXISTS trg_backlog_item_number ON backlog_items;
DROP FUNCTION IF EXISTS _assign_backlog_item_number();
