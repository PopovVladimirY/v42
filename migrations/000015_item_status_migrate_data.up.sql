-- Migrate existing rows to aligned status names (new values committed in 000014).
UPDATE backlog_items SET status = 'planned'   WHERE status = 'backlog';
UPDATE backlog_items SET status = 'open'      WHERE status = 'ready';
UPDATE backlog_items SET status = 'in_review' WHERE status = 'review';
ALTER TABLE backlog_items ALTER COLUMN status SET DEFAULT 'planned';
