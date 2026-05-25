-- Add 'closed' to item_status enum before 'cancelled'.
-- Represents a permanently closed backlog item (not worked on, not rejected).
ALTER TYPE item_status ADD VALUE IF NOT EXISTS 'closed' BEFORE 'cancelled';
