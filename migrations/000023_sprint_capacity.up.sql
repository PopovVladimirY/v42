-- Sprint Capacity: per-member planned vs actual hours for each sprint.
-- Planned is set at Sprint Planning, actual at Sprint Review.
-- sprints.capacity_hours stays as a denormalized SUM cache (existing contract unchanged).

CREATE TABLE sprint_capacity (
    sprint_id     UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,

    planned_hours NUMERIC(5,1) NOT NULL DEFAULT 0,   -- set at planning; step 0.5h
    actual_hours  NUMERIC(5,1) NULL,                  -- NULL until review is finalized
    notes         TEXT,                               -- "on vacation days 3-5", etc.

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (sprint_id, user_id)
);

CREATE INDEX idx_sprint_capacity_sprint ON sprint_capacity (sprint_id);
CREATE INDEX idx_sprint_capacity_user   ON sprint_capacity (user_id);
