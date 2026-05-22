-- name: ListSkills :many
-- Returns all skills ordered by name. Builtin first, then custom alphabetically.
SELECT id, name, category, is_builtin, created_at
FROM skills
ORDER BY is_builtin DESC, name;

-- name: GetSkillByID :one
SELECT id, name, category, is_builtin, created_at
FROM skills
WHERE id = $1;

-- name: CreateSkill :one
-- Admin-only: create a custom (non-builtin) skill.
INSERT INTO skills (name, category, is_builtin)
VALUES ($1, $2, false)
RETURNING id, name, category, is_builtin, created_at;

-- name: ListMemberSkills :many
-- Returns skill profile for a user with full skill details via JOIN.
SELECT
    ms.user_id,
    ms.skill_id,
    ms.level,
    ms.interest,
    ms.interest_note,
    ms.created_at,
    ms.updated_at,
    s.name        AS skill_name,
    s.category    AS skill_category,
    s.is_builtin  AS skill_is_builtin
FROM member_skills ms
JOIN skills s ON s.id = ms.skill_id
WHERE ms.user_id = $1
ORDER BY s.name;

-- name: UpsertMemberSkill :one
-- Add or update a skill in a user's profile.
INSERT INTO member_skills (user_id, skill_id, level, interest, interest_note)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id, skill_id) DO UPDATE
    SET level         = EXCLUDED.level,
        interest      = EXCLUDED.interest,
        interest_note = EXCLUDED.interest_note,
        updated_at    = now()
RETURNING user_id, skill_id, level, interest, interest_note, created_at, updated_at;

-- name: DeleteMemberSkill :exec
-- Remove a skill from a user's profile.
DELETE FROM member_skills
WHERE user_id = $1 AND skill_id = $2;

-- name: CreateSkillHistoryEntry :one
-- Record a level change. Called from PUT /users/{id}/skills whenever level changes.
INSERT INTO member_skill_history (user_id, skill_id, level_from, level_to, changed_by)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, user_id, skill_id, level_from, level_to, changed_by, changed_at;

-- name: ListSkillHistory :many
-- Growth timeline for a user. Newest first.
SELECT
    h.id,
    h.skill_id,
    h.level_from,
    h.level_to,
    h.changed_by,
    h.changed_at,
    s.name AS skill_name
FROM member_skill_history h
JOIN skills s ON s.id = h.skill_id
WHERE h.user_id = $1
ORDER BY h.changed_at DESC;
