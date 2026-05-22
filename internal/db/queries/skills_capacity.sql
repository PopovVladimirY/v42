-- Skill capacity queries (read-only -- no inserts).
-- These power the capacity planning and growth metrics.

-- name: GetSkillCoverage :one
-- How many team members can cover a skill at competent+ level?
-- Used in sprint planning: if count = 1, bus factor alert.
SELECT COUNT(*) AS coverage_count
FROM member_skills ms
JOIN team_members tm ON tm.user_id = ms.user_id
WHERE tm.team_id = $1
  AND ms.skill_id = $2
  AND ms.level IN ('competent', 'proficient', 'expert');

-- name: GetTeamSkillMatrix :many
-- Full matrix: every member x every skill they have.
-- Frontend renders this as a grid or radar overlay.
SELECT
    ms.user_id,
    ms.skill_id,
    ms.level,
    ms.interest,
    ms.interest_note,
    CASE ms.level
        WHEN 'novice'     THEN 1
        WHEN 'beginner'   THEN 2
        WHEN 'competent'  THEN 3
        WHEN 'proficient' THEN 4
        WHEN 'expert'     THEN 5
    END AS level_rank,
    s.name AS skill_name,
    s.category
FROM member_skills ms
JOIN team_members tm ON tm.user_id = ms.user_id
JOIN skills s ON s.id = ms.skill_id
WHERE tm.team_id = $1
ORDER BY ms.user_id, s.name;

-- name: GetTandemOpportunities :many
-- Who wants to grow in a skill (interest=high, low level) and who can teach (proficient+)?
-- Returns pairs. Caller filters for the same skill_id.
SELECT
    learner.user_id  AS learner_id,
    learner.level    AS learner_level,
    learner.interest AS learner_interest,
    mentor.user_id   AS mentor_id,
    mentor.level     AS mentor_level,
    s.id             AS skill_id,
    s.name           AS skill_name
FROM member_skills learner
JOIN member_skills mentor ON mentor.skill_id = learner.skill_id
    AND mentor.level IN ('proficient', 'expert')
    AND mentor.user_id != learner.user_id
JOIN skills s ON s.id = learner.skill_id
JOIN team_members tm_l ON tm_l.user_id = learner.user_id AND tm_l.team_id = $1
JOIN team_members tm_m ON tm_m.user_id = mentor.user_id  AND tm_m.team_id = $1
WHERE learner.interest = 'high'
  AND learner.level IN ('novice', 'beginner', 'competent')
ORDER BY s.name, learner.user_id;

-- name: GetPersonalRadar :many
-- Spider chart data for a single user.
SELECT
    ms.skill_id,
    s.name AS skill_name,
    s.category,
    ms.level,
    ms.interest,
    ms.interest_note,
    CASE ms.level
        WHEN 'novice'     THEN 1
        WHEN 'beginner'   THEN 2
        WHEN 'competent'  THEN 3
        WHEN 'proficient' THEN 4
        WHEN 'expert'     THEN 5
    END AS level_rank
FROM member_skills ms
JOIN skills s ON s.id = ms.skill_id
WHERE ms.user_id = $1
ORDER BY s.name;

-- name: GetLearningAppetite :one
-- Engagement indicators: not a score, not a grade. Personal curiosity signal.
SELECT
    COUNT(*) FILTER (
        WHERE interest = 'high'
          AND level IN ('novice', 'beginner', 'competent')
    )::int                                        AS reaching_count,
    COUNT(*) FILTER (
        WHERE interest IN ('medium', 'high')
    )::int                                        AS curious_breadth,
    COUNT(DISTINCT skill_id)::int                 AS total_skills
FROM member_skills
WHERE user_id = $1;

-- name: GetLearningMomentum :one
-- Level-up events in the last 90 days. Growth velocity, not performance score.
SELECT COUNT(*)::int AS recent_level_ups
FROM member_skill_history
WHERE user_id = $1
  AND changed_at > now() - INTERVAL '90 days';

-- name: GetAuthenticEngagement :one
-- Calibration signal: declared vs grounded expertise.
SELECT
    COUNT(*) FILTER (
        WHERE interest = 'high' AND interest_note IS NOT NULL
    )::int                                        AS engaged_skills,
    COUNT(*) FILTER (
        WHERE level = 'expert'
    )::int                                        AS declared_expert_count,
    COUNT(*) FILTER (
        WHERE level = 'expert' AND interest_note IS NOT NULL
    )::int                                        AS grounded_expert_count
FROM member_skills
WHERE user_id = $1;

-- name: GetTeamLearningAppetite :many
-- Aggregate learning appetite per team member. Team engagement dashboard.
SELECT
    ms.user_id,
    COUNT(*) FILTER (
        WHERE ms.interest = 'high'
          AND ms.level IN ('novice', 'beginner', 'competent')
    )::int AS reaching_count,
    COUNT(*) FILTER (
        WHERE ms.interest IN ('medium', 'high')
    )::int AS curious_breadth
FROM member_skills ms
JOIN team_members tm ON tm.user_id = ms.user_id
WHERE tm.team_id = $1
GROUP BY ms.user_id;
