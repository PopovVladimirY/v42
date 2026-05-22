-- Phase 1: full application schema.
--
-- Creation order respects FK dependencies:
--   users -> skills -> teams -> team_members -> member_skills -> refresh_tokens
--   -> projects -> epics -> releases -> stages
--   -> backlog_items -> tasks -> sprints -> sprint_items
--   -> tests -> test_dependencies -> time_entries -> sprint_test_results -> comments
--   -> activity_log -> outbox

-- ----------------------------------------------------------------
-- ENUMs
-- ----------------------------------------------------------------

CREATE TYPE user_role AS ENUM (
    'admin',        -- full access, manages instance
    'maintainer',   -- manages projects, teams
    'developer',    -- works on tasks
    'tester',       -- works on tests
    'observer'      -- read-only (the "curious manager" type)
);

CREATE TYPE skill_level AS ENUM (
    'beginner',    -- learning, needs guidance
    'competent',   -- can do it independently
    'proficient',  -- does it well, can review others
    'expert'       -- deep knowledge, can mentor
);

CREATE TYPE interest_level AS ENUM ('low', 'medium', 'high');

CREATE TYPE project_status AS ENUM ('active', 'on_hold', 'archived');
CREATE TYPE epic_status    AS ENUM ('draft', 'active', 'done', 'cancelled');
CREATE TYPE release_status AS ENUM ('planning', 'active', 'released', 'cancelled');
CREATE TYPE stage_status   AS ENUM ('pending', 'active', 'completed', 'cancelled');
CREATE TYPE item_type      AS ENUM ('story', 'bug', 'feature', 'technical_debt');

-- 'done' is not a feeling. It means the acceptance test passed in the sprint.
CREATE TYPE item_status AS ENUM ('backlog', 'ready', 'in_progress', 'review', 'done', 'cancelled');

CREATE TYPE task_status    AS ENUM ('todo', 'in_progress', 'done', 'cancelled');
CREATE TYPE sprint_status  AS ENUM ('planning', 'active', 'completed', 'cancelled');
CREATE TYPE test_type      AS ENUM ('manual', 'acceptance', 'integration', 'unit');
CREATE TYPE test_run_status AS ENUM (
    'pass',
    'failed',
    'skipped',   -- auto-skipped: a dependency test failed
    'disabled',  -- manually excluded from this sprint run
    'on_hold'    -- functionality not implemented yet
);

-- ----------------------------------------------------------------
-- USERS
-- ----------------------------------------------------------------

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    role          user_role NOT NULL DEFAULT 'developer',
    is_active     BOOLEAN NOT NULL DEFAULT true,
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_email ON users(email);

-- ----------------------------------------------------------------
-- SKILLS
-- ----------------------------------------------------------------

CREATE TABLE skills (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL UNIQUE,  -- e.g. "TypeScript", "Go", "Python"
    category   TEXT,                  -- e.g. "Frontend", "Backend", "QA"
    is_builtin BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------
-- TEAMS
-- ----------------------------------------------------------------

CREATE TABLE teams (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
    team_id        UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- weekly capacity in hours (accounts for meetings, etc.)
    capacity_hours SMALLINT NOT NULL DEFAULT 32,
    joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);

-- ----------------------------------------------------------------
-- MEMBER SKILLS
-- ----------------------------------------------------------------

CREATE TABLE member_skills (
    user_id    UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    skill_id   UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    level      skill_level    NOT NULL DEFAULT 'beginner',
    interest   interest_level NOT NULL DEFAULT 'medium',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, skill_id)
);

-- ----------------------------------------------------------------
-- REFRESH TOKENS (JWT rotation + logout revocation)
-- ----------------------------------------------------------------

CREATE TABLE refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,  -- SHA-256 hex hash of the raw token, never plaintext
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ           -- NULL = active; set on logout or rotation
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- ----------------------------------------------------------------
-- PROJECTS
-- ----------------------------------------------------------------

CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    status      project_status NOT NULL DEFAULT 'active',
    team_id     UUID REFERENCES teams(id) ON DELETE SET NULL,
    owner_id    UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------
-- EPICS (independent dimension -- NOT inside releases)
-- ----------------------------------------------------------------

CREATE TABLE epics (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    status      epic_status NOT NULL DEFAULT 'draft',
    owner_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    -- optional: allows showing epics on timeline
    target_date DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_epics_project ON epics(project_id);

-- ----------------------------------------------------------------
-- RELEASES + STAGES (temporal dimension: WHEN we ship)
-- Must exist before backlog_items (FK dependency).
-- ----------------------------------------------------------------

CREATE TABLE releases (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    status      release_status NOT NULL DEFAULT 'planning',
    start_date  DATE,
    end_date    DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_releases_project ON releases(project_id);

CREATE TABLE stages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id  UUID NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    status      stage_status NOT NULL DEFAULT 'pending',
    start_date  DATE,
    end_date    DATE,
    -- FLOAT8: insert between two items = midpoint, no full renumber needed
    order_index FLOAT8 NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stages_release ON stages(release_id);

-- ----------------------------------------------------------------
-- BACKLOG ITEMS (heart of the system)
--
-- epic_id, release_id, stage_id are independent nullable FKs.
-- A backlog item can belong to any combination: epic only, stage only, both, neither.
--
-- ATDD MODEL: the backlog item IS the acceptance test.
--   description = WHY this exists (for humans).
--   ac_*        = HOW we prove it exists correctly (for testers and the system).
--   An item without ac_steps is a wish, not a commitment.
-- ----------------------------------------------------------------

CREATE TABLE backlog_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     UUID NOT NULL REFERENCES projects(id)  ON DELETE CASCADE,
    epic_id        UUID REFERENCES epics(id)              ON DELETE SET NULL,
    release_id     UUID REFERENCES releases(id)           ON DELETE SET NULL,
    stage_id       UUID REFERENCES stages(id)             ON DELETE SET NULL,
    title          TEXT NOT NULL,
    description    TEXT,
    type           item_type   NOT NULL DEFAULT 'story',
    status         item_status NOT NULL DEFAULT 'backlog',
    -- FLOAT8 priority: midpoint trick for drag-and-drop reorder
    priority       FLOAT8 NOT NULL DEFAULT 0,
    estimate       TEXT,  -- free-form: "3h", "5 points", "L", "half a day"
    assignee_id    UUID REFERENCES users(id)  ON DELETE SET NULL,
    skill_required UUID REFERENCES skills(id) ON DELETE SET NULL,
    -- acceptance criteria = definition of done (not optional documentation)
    ac_setup       TEXT,  -- preconditions: env, data, user state before the test
    ac_steps       TEXT,  -- step-by-step verification: exactly what to do
    ac_expected    TEXT,  -- expected outcome: what the world looks like when it passes
    created_by     UUID NOT NULL REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_backlog_project  ON backlog_items(project_id);
CREATE INDEX idx_backlog_epic     ON backlog_items(epic_id)     WHERE epic_id    IS NOT NULL;
CREATE INDEX idx_backlog_release  ON backlog_items(release_id)  WHERE release_id IS NOT NULL;
CREATE INDEX idx_backlog_stage    ON backlog_items(stage_id)    WHERE stage_id   IS NOT NULL;
CREATE INDEX idx_backlog_status   ON backlog_items(project_id, status);
CREATE INDEX idx_backlog_priority ON backlog_items(project_id, priority);

-- ----------------------------------------------------------------
-- TASKS (how we get to a green ac_* run)
-- ----------------------------------------------------------------

CREATE TABLE tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backlog_item_id UUID NOT NULL REFERENCES backlog_items(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT,
    status          task_status NOT NULL DEFAULT 'todo',
    estimate        TEXT,   -- same free-form convention as backlog_items.estimate
    -- actual hours = SUM(time_entries.hours) -- no dual source of truth
    order_index     FLOAT8 NOT NULL DEFAULT 0,
    assignee_id     UUID REFERENCES users(id)  ON DELETE SET NULL,
    skill_required  UUID REFERENCES skills(id) ON DELETE SET NULL,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_backlog_item ON tasks(backlog_item_id);
CREATE INDEX idx_tasks_assignee     ON tasks(assignee_id) WHERE assignee_id IS NOT NULL;

-- ----------------------------------------------------------------
-- SPRINTS
-- ----------------------------------------------------------------

CREATE TABLE sprints (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    team_id        UUID REFERENCES teams(id) ON DELETE SET NULL,
    name           TEXT NOT NULL,  -- e.g. "Sprint 1", "2026-Q2-S3"
    goal           TEXT,
    status         sprint_status NOT NULL DEFAULT 'planning',
    start_date     DATE,
    end_date       DATE,
    capacity_hours SMALLINT,       -- total planned team hours for this sprint
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sprints_project ON sprints(project_id);

-- Which backlog items are committed to a sprint
CREATE TABLE sprint_items (
    sprint_id       UUID NOT NULL REFERENCES sprints(id)       ON DELETE CASCADE,
    backlog_item_id UUID NOT NULL REFERENCES backlog_items(id) ON DELETE CASCADE,
    added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (sprint_id, backlog_item_id)
);

-- ----------------------------------------------------------------
-- TESTS (defined once, run per sprint)
-- Levels: backlog_item (acceptance), epic-level, project/regression
-- ----------------------------------------------------------------

CREATE TABLE tests (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES projects(id)     ON DELETE CASCADE,
    backlog_item_id  UUID REFERENCES backlog_items(id)         ON DELETE CASCADE,
    epic_id          UUID REFERENCES epics(id)                 ON DELETE CASCADE,
    -- if both above are null: project-level / regression test
    title            TEXT NOT NULL,
    description      TEXT,
    setup            TEXT,            -- preconditions: env, data, user state
    config           TEXT,            -- configuration parameters during the test
    steps            TEXT,            -- numbered step-by-step execution instructions
    expected_results TEXT,            -- what should happen when the test passes
    type             test_type NOT NULL DEFAULT 'manual',
    created_by       UUID NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tests_project      ON tests(project_id);
CREATE INDEX idx_tests_backlog_item ON tests(backlog_item_id) WHERE backlog_item_id IS NOT NULL;
CREATE INDEX idx_tests_epic         ON tests(epic_id)         WHERE epic_id IS NOT NULL;

-- If depends_on fails -> test is auto-skipped
CREATE TABLE test_dependencies (
    test_id       UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    depends_on_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    PRIMARY KEY (test_id, depends_on_id),
    CONSTRAINT no_self_dependency CHECK (test_id != depends_on_id)
);

-- ----------------------------------------------------------------
-- TIME ENTRIES (immutable audit trail)
-- To correct an error: add a negative entry + new correct entry.
-- ----------------------------------------------------------------

CREATE TABLE time_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hours       NUMERIC(5,1) NOT NULL CHECK (hours > 0),
    logged_date DATE NOT NULL DEFAULT CURRENT_DATE,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    -- no updated_at: immutable by design
);
CREATE INDEX idx_time_entries_task ON time_entries(task_id);
CREATE INDEX idx_time_entries_user ON time_entries(user_id);
CREATE INDEX idx_time_entries_date ON time_entries(logged_date);

-- ----------------------------------------------------------------
-- SPRINT TEST RESULTS
-- One row per subject (test or backlog_item acceptance criteria) per sprint.
-- Exactly one of (test_id, backlog_item_id) must be set.
-- ----------------------------------------------------------------

CREATE TABLE sprint_test_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sprint_id       UUID NOT NULL REFERENCES sprints(id)      ON DELETE CASCADE,
    test_id         UUID REFERENCES tests(id)                 ON DELETE CASCADE,
    backlog_item_id UUID REFERENCES backlog_items(id)         ON DELETE CASCADE,
    status          test_run_status NOT NULL DEFAULT 'skipped',
    skip_reason     TEXT,  -- "depends on test {id} which failed", etc.
    notes           TEXT,  -- tester observations, actual vs expected delta
    executed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    executed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- one result per subject per sprint
    UNIQUE (sprint_id, test_id),
    UNIQUE (sprint_id, backlog_item_id),
    CONSTRAINT spr_result_exactly_one_subject CHECK (
        (test_id IS NOT NULL)::int + (backlog_item_id IS NOT NULL)::int = 1
    )
);
CREATE INDEX idx_spr_results_sprint ON sprint_test_results(sprint_id);
CREATE INDEX idx_spr_results_test   ON sprint_test_results(test_id)         WHERE test_id         IS NOT NULL;
CREATE INDEX idx_spr_results_item   ON sprint_test_results(backlog_item_id) WHERE backlog_item_id  IS NOT NULL;
CREATE INDEX idx_spr_results_status ON sprint_test_results(sprint_id, status);

-- ----------------------------------------------------------------
-- COMMENTS (soft delete, one level of threading)
-- Same nullable-FK pattern as backlog_items: exactly one parent, rest null.
-- ----------------------------------------------------------------

CREATE TABLE comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- exactly one of these is set (the parent element)
    project_id      UUID REFERENCES projects(id)     ON DELETE CASCADE,
    epic_id         UUID REFERENCES epics(id)         ON DELETE CASCADE,
    release_id      UUID REFERENCES releases(id)      ON DELETE CASCADE,
    stage_id        UUID REFERENCES stages(id)        ON DELETE CASCADE,
    backlog_item_id UUID REFERENCES backlog_items(id) ON DELETE CASCADE,
    task_id         UUID REFERENCES tasks(id)         ON DELETE CASCADE,
    test_id         UUID REFERENCES tests(id)         ON DELETE CASCADE,
    -- body is nullable: set to NULL on soft delete (keeps thread structure intact)
    body            TEXT,
    author_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    -- threading: one level deep -- this is not Reddit, it is a work tool
    parent_id       UUID REFERENCES comments(id) ON DELETE CASCADE,
    -- soft delete: NULL = active
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT comments_exactly_one_parent CHECK (
        (
            (project_id      IS NOT NULL)::int +
            (epic_id         IS NOT NULL)::int +
            (release_id      IS NOT NULL)::int +
            (stage_id        IS NOT NULL)::int +
            (backlog_item_id IS NOT NULL)::int +
            (task_id         IS NOT NULL)::int +
            (test_id         IS NOT NULL)::int
        ) = 1
    )
);
CREATE INDEX idx_comments_project      ON comments(project_id)      WHERE project_id      IS NOT NULL;
CREATE INDEX idx_comments_epic         ON comments(epic_id)          WHERE epic_id          IS NOT NULL;
CREATE INDEX idx_comments_release      ON comments(release_id)       WHERE release_id       IS NOT NULL;
CREATE INDEX idx_comments_stage        ON comments(stage_id)         WHERE stage_id         IS NOT NULL;
CREATE INDEX idx_comments_backlog_item ON comments(backlog_item_id)  WHERE backlog_item_id  IS NOT NULL;
CREATE INDEX idx_comments_task         ON comments(task_id)          WHERE task_id          IS NOT NULL;
CREATE INDEX idx_comments_test         ON comments(test_id)          WHERE test_id          IS NOT NULL;
CREATE INDEX idx_comments_parent       ON comments(parent_id)        WHERE parent_id        IS NOT NULL;

-- ----------------------------------------------------------------
-- ACTIVITY LOG (event bus consumer writes here)
-- Human-readable audit trail. Populated by the event bus consumer,
-- not by application code directly. Read-only from the API.
-- ----------------------------------------------------------------

CREATE TABLE activity_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,  -- NULL = system/AI agent
    entity_type TEXT NOT NULL,   -- 'backlog_item' | 'sprint' | 'test' | 'comment' | ...
    entity_id   UUID NOT NULL,
    action      TEXT NOT NULL,   -- 'status_changed' | 'assigned' | 'commented' | ...
    payload     JSONB,           -- action-specific details (from, to, etc.)
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- activity_log is append-only: no updated_at, no soft delete.
CREATE INDEX idx_activity_project ON activity_log(project_id, occurred_at DESC);
CREATE INDEX idx_activity_entity  ON activity_log(entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_activity_actor   ON activity_log(actor_id) WHERE actor_id IS NOT NULL;

-- ----------------------------------------------------------------
-- OUTBOX (transactional outbox pattern)
-- Written in the same DB transaction as the entity change.
-- Background publisher goroutine reads unpublished rows and sends
-- them to the event bus. Guarantees no event loss even if the bus
-- is temporarily unavailable. published_at = NULL means "not yet sent".
-- ----------------------------------------------------------------

CREATE TABLE outbox (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic        TEXT NOT NULL,         -- e.g. 'v42.events.items'
    key          TEXT NOT NULL,         -- partition key, usually project_id
    payload      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ            -- NULL = pending; set when delivered to event bus
);
-- Partial index: only unpublished rows. Keeps the scan fast even at high volume.
CREATE INDEX idx_outbox_unpublished ON outbox(created_at) WHERE published_at IS NULL;
