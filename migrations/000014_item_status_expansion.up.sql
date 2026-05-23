-- Add new item_status enum values. Must be a separate transaction from any
-- UPDATE using the new values (PostgreSQL requirement for ADD VALUE).
ALTER TYPE item_status ADD VALUE IF NOT EXISTS 'planned';
ALTER TYPE item_status ADD VALUE IF NOT EXISTS 'open';
ALTER TYPE item_status ADD VALUE IF NOT EXISTS 'in_review';
ALTER TYPE item_status ADD VALUE IF NOT EXISTS 'request';
ALTER TYPE item_status ADD VALUE IF NOT EXISTS 'on_hold';
ALTER TYPE item_status ADD VALUE IF NOT EXISTS 'rejected';
