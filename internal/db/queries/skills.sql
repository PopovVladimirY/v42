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
INSERT INTO member_skills (user_id, skill_id, level, interest)
VALUES ($1, $2, $3, $4)
ON CONFLICT (user_id, skill_id) DO UPDATE
    SET level      = EXCLUDED.level,
        interest   = EXCLUDED.interest,
        updated_at = now()
RETURNING user_id, skill_id, level, interest, created_at, updated_at;

-- name: DeleteMemberSkill :exec
-- Remove a skill from a user's profile.
DELETE FROM member_skills
WHERE user_id = $1 AND skill_id = $2;
