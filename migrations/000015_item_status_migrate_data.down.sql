UPDATE backlog_items SET status = 'backlog' WHERE status = 'planned';
UPDATE backlog_items SET status = 'ready'   WHERE status = 'open';
UPDATE backlog_items SET status = 'review'  WHERE status = 'in_review';
ALTER TABLE backlog_items ALTER COLUMN status SET DEFAULT 'backlog';
