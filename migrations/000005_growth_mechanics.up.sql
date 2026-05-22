-- Phase 4: growth mechanics.
--
-- 1. Dreyfus model: add novice level (the "I know nothing" honest start).
-- 2. interest_note: narrative alongside the enum. Machine reads interest_level;
--    humans read the note. Both matter.
-- 3. member_skill_history: immutable audit trail of level changes.
--    Turns "where are we" into "how fast are we moving".
-- 4. tasks.reviewer_id: novice on a task without a reviewer is a risk.
--    Now the system can see it.

-- ----------------------------------------------------------------
-- 1. skill_level: novice before beginner (irreversible -- see down.sql)
-- ----------------------------------------------------------------

ALTER TYPE skill_level ADD VALUE 'novice' BEFORE 'beginner';

-- ----------------------------------------------------------------
-- 2. member_skills: interest_note (narrative, not score)
-- ----------------------------------------------------------------

ALTER TABLE member_skills
    ADD COLUMN interest_note TEXT CHECK (length(interest_note) <= 500);

-- ----------------------------------------------------------------
-- 3. member_skill_history (immutable -- no update_at by design)
-- ----------------------------------------------------------------

CREATE TABLE member_skill_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    skill_id   UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    level_from skill_level,        -- NULL = first entry (baseline)
    level_to   skill_level NOT NULL,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,  -- who confirmed the growth
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_skill_history_user  ON member_skill_history(user_id,  changed_at DESC);
CREATE INDEX idx_skill_history_skill ON member_skill_history(skill_id, changed_at DESC);

-- ----------------------------------------------------------------
-- 4. tasks.reviewer_id (tandem / mentoring signal)
-- ----------------------------------------------------------------

ALTER TABLE tasks
    ADD COLUMN reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_tasks_reviewer ON tasks(reviewer_id) WHERE reviewer_id IS NOT NULL;
