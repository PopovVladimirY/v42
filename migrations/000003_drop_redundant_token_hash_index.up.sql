-- idx_refresh_tokens_hash is redundant: the UNIQUE constraint on token_hash already
-- creates an implicit B-tree index that the planner uses for all lookups.
-- Having both means every INSERT pays double the index write cost for zero benefit.
DROP INDEX IF EXISTS idx_refresh_tokens_hash;
