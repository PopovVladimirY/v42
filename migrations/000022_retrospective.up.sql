-- Retrospective: cards + dot voting per sprint.
-- Three categories: went_well / didnt_go_well / to_improve; optional kudos.
-- Dot voting: 5 votes per user per sprint, enforced on backend.

CREATE TYPE retro_category AS ENUM ('went_well', 'didnt_go_well', 'to_improve', 'kudos');

CREATE TABLE retrospective_items (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    sprint_id       UUID        NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    author_id       UUID        NOT NULL REFERENCES users(id),

    category        retro_category NOT NULL,
    content         TEXT        NOT NULL,

    is_action       BOOLEAN     NOT NULL DEFAULT FALSE,  -- action item (shown separately)
    is_resolved     BOOLEAN     NOT NULL DEFAULT FALSE,  -- action item closed

    -- optional: action item linked to a backlog item
    backlog_item_id UUID        REFERENCES backlog_items(id) ON DELETE SET NULL,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_retro_sprint ON retrospective_items (sprint_id);

-- Dot voting: one vote per user per retro card. Ensures uniqueness at DB level.
CREATE TABLE retrospective_votes (
    retro_item_id UUID NOT NULL REFERENCES retrospective_items(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (retro_item_id, user_id)
);

-- retro_closed flag: once closed, cards and voting are frozen.
ALTER TABLE sprints ADD COLUMN retro_closed BOOLEAN NOT NULL DEFAULT FALSE;
