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

-- name: GetProjectSkillDemand :many
-- What skills does this project's backlog ask for? The radar's "demand" side.
-- Walks the project subtree (node_id) like ListBacklogItems, counts how many
-- backlog items and how many tasks point at each skill. Decomposed items skip.
WITH RECURSIVE subtree AS (
    SELECT id FROM projects WHERE id = sqlc.arg('project_id')::uuid
    UNION ALL
    SELECT p.id FROM projects p JOIN subtree s ON p.parent_id = s.id
),
items AS (
    SELECT id, skill_required
    FROM backlog_items
    WHERE (node_id IN (SELECT id FROM subtree)
           OR (node_id IS NULL AND project_id = sqlc.arg('project_id')::uuid))
      AND status != 'decomposed'
),
item_demand AS (
    SELECT skill_required AS skill_id, COUNT(*) AS cnt
    FROM items
    WHERE skill_required IS NOT NULL
    GROUP BY skill_required
),
task_demand AS (
    SELECT t.skill_required AS skill_id, COUNT(*) AS cnt
    FROM tasks t
    WHERE t.backlog_item_id IN (SELECT id FROM items)
      AND t.skill_required IS NOT NULL
    GROUP BY t.skill_required
)
SELECT
    s.id   AS skill_id,
    s.name AS skill_name,
    s.category,
    COALESCE(i.cnt, 0)::bigint  AS item_count,
    COALESCE(td.cnt, 0)::bigint AS task_count
FROM skills s
JOIN (
    SELECT skill_id FROM item_demand
    UNION
    SELECT skill_id FROM task_demand
) used ON used.skill_id = s.id
LEFT JOIN item_demand i  ON i.skill_id  = s.id
LEFT JOIN task_demand td ON td.skill_id = s.id
ORDER BY (COALESCE(i.cnt, 0) + COALESCE(td.cnt, 0)) DESC, s.name ASC;
