# V.42 -- Design Document

> "Закладываем краеугольный камень. Всё что здесь -- живёт. Всё что не здесь -- ждёт своей очереди."

---

## Стек (финальный, без пересмотра)

| Слой        | Технология                              | Почему                                      |
|-------------|------------------------------------------|---------------------------------------------|
| Backend     | Go 1.22+                                | Стабильность, один бинарник, нет node_modules |
| Router      | [chi v5](DETAILS.md#chi----http-роутер) | Минималистичный, idiomatic, без магии        |
| SQL         | [sqlc](DETAILS.md#sqlc----типизированный-sql-без-orm) + [golang-migrate](DETAILS.md#golang-migrate----миграции-схемы) | Типизированный SQL без ORM |
| Database    | [PostgreSQL 16](DETAILS.md#postgresql----база-данных) | Стандарт, надёжность, JSONB когда надо |
| Auth        | [JWT](DETAILS.md#jwt----авторизация-без-состояния) (golang-jwt/jwt/v5) | Прозрачно, без фреймворк-магии |
| Frontend    | React 19 + TypeScript + Vite            | Лучший экосистем для board UI                |
| Drag&Drop   | dnd-kit                                 | Зрелый, a11y, гибкий                         |
| Real-time   | [SSE](DETAILS.md#sse----server-sent-events-real-time) (Server-Sent Events) | Проще WebSocket, встроено в Go |
| Deployment  | [Docker Compose](DETAILS.md#docker-compose----запускаем-всё-вместе) | `docker compose up` -- и всё работает |

> Подробное объяснение каждого инструмента: зачем, как работает, почему именно он -- в [DETAILS.md](DETAILS.md).

---

## Структура проекта

```
v42/
  cmd/
    api/
      main.go              -- точка входа, wire-up всего
  internal/
    api/
      handler/             -- HTTP handlers (один файл на домен)
        projects.go
        epics.go
        backlog.go
        tasks.go
        tests.go
        releases.go
        stages.go
        sprints.go         -- sprint planning + sprint board
        teams.go
        users.go
        auth.go
        comments.go        -- comments for all entity types
        stats.go
        events.go          -- SSE endpoint
      middleware/
        auth.go            -- JWT validation
        roles.go           -- role-based access
        logger.go          -- request logging
        cors.go            -- CORS headers
        ratelimit.go       -- rate limiting (auth endpoints)
      router.go            -- chi router setup, all routes registered here
    domain/                -- pure business logic, no HTTP, no SQL
      project.go
      epic.go
      backlog.go
      sprint.go
      team.go
      skill.go
      capacity.go          -- load planning calculations
      stats.go             -- statistics normalization
      testrun.go           -- test result aggregation logic
    db/
      queries/             -- .sql files (sqlc reads these)
        projects.sql
        epics.sql
        backlog.sql
        tasks.sql
        tests.sql
        releases.sql
        stages.sql
        sprints.sql
        teams.sql
        users.sql
        skills.sql
        comments.sql
        stats.sql
      sqlc.yaml            -- sqlc config
      db.go                -- connection setup
    config/
      config.go            -- env vars, validated at startup
    auth/
      jwt.go               -- token generation and validation
      password.go          -- bcrypt helpers
  migrations/              -- golang-migrate SQL files
    000001_init_schema.up.sql
    000001_init_schema.down.sql
    000002_skills.up.sql
    000002_skills.down.sql
  web/                     -- React app (built to web/dist/)
    src/
      api/                 -- typed API client (fetch wrappers)
      components/
      pages/
      store/               -- Zustand or similar lightweight state
    index.html
    vite.config.ts
    tsconfig.json
  docker/
    postgres/
      init.sql             -- initial DB setup (extensions etc.)
  Dockerfile               -- multi-stage: build -> minimal runtime image
  docker-compose.yml
  docker-compose.dev.yml   -- with hot-reload volumes
  Makefile
  .env.example
  go.mod
  go.sum
```

---

## Схема базы данных

> Порядок CREATE TABLE в миграции строго соблюдает зависимости:
> users -> skills -> teams -> team_members -> member_skills -> refresh_tokens
> -> projects -> epics -> releases -> stages
> -> backlog_items -> tasks -> sprints -> sprint_items
> -> tests -> test_dependencies -> time_entries -> sprint_test_results -> comments

### Ядро: пользователи и права

```sql
-- Roles: system-wide
CREATE TYPE user_role AS ENUM (
    'admin',        -- full access, manages instance
    'maintainer',   -- manages projects, teams
    'developer',    -- works on tasks
    'tester',       -- works on tests
    'observer'      -- read-only (the "curious manager" type)
);

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
```

### Компетенции и команды

```sql
CREATE TYPE skill_level AS ENUM (
    'beginner',    -- learning, needs guidance
    'competent',   -- can do it independently
    'proficient',  -- does it well, can review others
    'expert'       -- deep knowledge, can mentor
);

CREATE TYPE interest_level AS ENUM ('low', 'medium', 'high');

-- Skill catalog (predefined + custom per instance)
CREATE TABLE skills (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,  -- e.g., "TypeScript", "Go", "Python"
    category    TEXT,                  -- e.g., "Frontend", "Backend", "QA"
    is_builtin  BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Member skill profile
CREATE TABLE member_skills (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_id   UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    level      skill_level NOT NULL DEFAULT 'beginner',
    interest   interest_level NOT NULL DEFAULT 'medium',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when did they acquire the skill
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, skill_id)
);

-- Refresh tokens for JWT rotation and logout revocation
CREATE TABLE refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,  -- stored as bcrypt hash, never plaintext
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ           -- NULL = active; set on logout or rotation
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);

CREATE TABLE teams (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
    team_id          UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- weekly capacity in hours (accounts for meetings, etc.)
    capacity_hours   SMALLINT NOT NULL DEFAULT 32,
    joined_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);
```

### Рабочие элементы

```sql
CREATE TYPE project_status AS ENUM ('active', 'on_hold', 'archived');
CREATE TYPE epic_status    AS ENUM ('draft', 'active', 'done', 'cancelled');
CREATE TYPE item_type      AS ENUM ('story', 'bug', 'feature', 'technical_debt');
-- 'done' is not a feeling. It means the acceptance test passed in the sprint.
CREATE TYPE item_status    AS ENUM ('backlog', 'ready', 'in_progress', 'review', 'done', 'cancelled');
CREATE TYPE task_status    AS ENUM ('todo', 'in_progress', 'done', 'cancelled');
-- test_status removed: tests have no global status. Results are tracked per-sprint
-- in sprint_test_results. A test is only meaningful in the context of a sprint run.
CREATE TYPE test_type      AS ENUM ('manual', 'acceptance', 'integration', 'unit');

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

CREATE TABLE epics (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    status      epic_status NOT NULL DEFAULT 'draft',
    owner_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    -- epics are NOT inside releases -- they are an independent dimension
    -- target_date is optional: allows showing epics on timeline
    target_date DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_epics_project ON epics(project_id);

-- Releases and stages must be created BEFORE backlog_items (FK dependency).
CREATE TYPE release_status AS ENUM ('planning', 'active', 'released', 'cancelled');
CREATE TYPE stage_status   AS ENUM ('pending', 'active', 'completed', 'cancelled');

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
    order_index FLOAT8 NOT NULL DEFAULT 0,  -- float for drag-and-drop reorder without renumbering
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stages_release ON stages(release_id);

-- The heart of the system.
-- epic_id, release_id, stage_id are ALL independent nullable foreign keys.
-- A backlog item can belong to any combination: epic only, stage only, both, neither.
--
-- ATDD MODEL: the backlog item IS the acceptance test.
-- description = why this exists (for humans).
-- ac_* fields  = how we prove it exists correctly (for testers and the system).
-- Tasks are the path to a green ac_* run. Status 'done' = acceptance test passed.
CREATE TABLE backlog_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    epic_id         UUID REFERENCES epics(id) ON DELETE SET NULL,      -- dimension 1
    release_id      UUID REFERENCES releases(id) ON DELETE SET NULL,   -- dimension 2
    stage_id        UUID REFERENCES stages(id) ON DELETE SET NULL,     -- dimension 3
    title           TEXT NOT NULL,
    description     TEXT,                  -- WHY: context, value, user story
    type            item_type NOT NULL DEFAULT 'story',
    status          item_status NOT NULL DEFAULT 'backlog',
    -- FLOAT8 priority: insert between two items = midpoint, no full renumber needed
    priority        FLOAT8 NOT NULL DEFAULT 0,
    estimate        TEXT,   -- free-form: "3h", "5 points", "L", "half a day" -- no holy wars
    assignee_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    skill_required  UUID REFERENCES skills(id) ON DELETE SET NULL,
    -- HOW WE KNOW WE ARE DONE: acceptance criteria = the acceptance test.
    -- These fields are not optional documentation -- they define what 'done' means.
    -- An item without ac_steps is a wish, not a commitment.
    ac_setup        TEXT,  -- preconditions: env, data, user state before the test
    ac_steps        TEXT,  -- step-by-step verification: exactly what to do and click
    ac_expected     TEXT,  -- expected outcome: what the world looks like when it passes
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_backlog_project   ON backlog_items(project_id);
CREATE INDEX idx_backlog_epic      ON backlog_items(epic_id) WHERE epic_id IS NOT NULL;
CREATE INDEX idx_backlog_release   ON backlog_items(release_id) WHERE release_id IS NOT NULL;
CREATE INDEX idx_backlog_stage     ON backlog_items(stage_id) WHERE stage_id IS NOT NULL;
CREATE INDEX idx_backlog_status    ON backlog_items(project_id, status);
CREATE INDEX idx_backlog_priority  ON backlog_items(project_id, priority);

CREATE TABLE tasks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backlog_item_id  UUID NOT NULL REFERENCES backlog_items(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    description      TEXT,
    status           task_status NOT NULL DEFAULT 'todo',
    estimate        TEXT,   -- free-form, same convention as backlog_item.estimate
    -- actual_hours removed: computed from SUM(time_entries.hours) to avoid dual source of truth
    order_index      FLOAT8 NOT NULL DEFAULT 0,  -- ordering within backlog item
    assignee_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    skill_required   UUID REFERENCES skills(id) ON DELETE SET NULL,
    created_by       UUID NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_backlog_item ON tasks(backlog_item_id);
CREATE INDEX idx_tasks_assignee     ON tasks(assignee_id) WHERE assignee_id IS NOT NULL;

-- Sprints: time-boxed iterations (Scrum)
CREATE TYPE sprint_status AS ENUM ('planning', 'active', 'completed', 'cancelled');

CREATE TABLE sprints (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    team_id        UUID REFERENCES teams(id) ON DELETE SET NULL,
    name           TEXT NOT NULL,  -- e.g., "Sprint 1", "2026-Q2-S3"
    goal           TEXT,           -- what this sprint aims to achieve
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
    sprint_id       UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    backlog_item_id UUID NOT NULL REFERENCES backlog_items(id) ON DELETE CASCADE,
    added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (sprint_id, backlog_item_id)
);

-- Tests: defined once, run many times (once per sprint)
-- Live at multiple levels: backlog_item, epic, or project-level
CREATE TABLE tests (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    backlog_item_id  UUID REFERENCES backlog_items(id) ON DELETE CASCADE,  -- acceptance tests
    epic_id          UUID REFERENCES epics(id) ON DELETE CASCADE,          -- epic-level tests
    -- if both are null: project-level / regression test
    title            TEXT NOT NULL,
    description      TEXT,
    -- Structured test definition
    setup            TEXT,            -- preconditions: environment, data, user state
    config           TEXT,            -- configuration parameters used during the test
    steps            TEXT,            -- numbered step-by-step execution instructions
    expected_results TEXT,            -- what should happen if the test passes
    type             test_type NOT NULL DEFAULT 'manual',
    created_by       UUID NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tests_backlog_item ON tests(backlog_item_id) WHERE backlog_item_id IS NOT NULL;
CREATE INDEX idx_tests_epic         ON tests(epic_id) WHERE epic_id IS NOT NULL;
CREATE INDEX idx_tests_project      ON tests(project_id);

-- Test dependencies: if depends_on fails, test is auto-skipped
CREATE TABLE test_dependencies (
    test_id       UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    depends_on_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    PRIMARY KEY (test_id, depends_on_id),
    CONSTRAINT no_self_dependency CHECK (test_id != depends_on_id)
);
```

### Таймлайн

```sql
-- Releases and stages are defined earlier in the schema (before backlog_items).
-- Repeated here for readability.

-- Releases are the temporal dimension: WHEN we ship something.
-- They are NOT a container for epics -- they co-exist independently.
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
    -- see definition above in Рабочие элементы section
);
```

### Время и статистика

```sql
-- Time tracking: actual hours logged against tasks
CREATE TABLE time_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hours       NUMERIC(5,1) NOT NULL CHECK (hours > 0),
    logged_date DATE NOT NULL DEFAULT CURRENT_DATE,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_time_entries_task   ON time_entries(task_id);
CREATE INDEX idx_time_entries_user   ON time_entries(user_id);
CREATE INDEX idx_time_entries_date   ON time_entries(logged_date);
-- time_entries are immutable (audit trail). No updated_at by design.
-- To correct an error: add a negative entry + new correct entry.
```

### Результаты тестирования по спринтам

```sql
CREATE TYPE test_run_status AS ENUM (
    'pass',
    'failed',
    'skipped',   -- auto-skipped: a dependency test failed, no point running this one
    'disabled',  -- manually excluded from this sprint run
    'on_hold'    -- functionality not implemented yet, test cannot run
);

-- One result row per subject per sprint.
-- Subject is either a regression test OR a backlog item's acceptance criteria.
-- Exactly one of (test_id, backlog_item_id) must be set -- same pattern as comments.
CREATE TABLE sprint_test_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sprint_id       UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    -- exactly one of these:
    test_id         UUID REFERENCES tests(id) ON DELETE CASCADE,          -- regression/integration test
    backlog_item_id UUID REFERENCES backlog_items(id) ON DELETE CASCADE,  -- acceptance criteria run
    status          test_run_status NOT NULL DEFAULT 'skipped',
    -- why skipped: "depends on test X which failed", "environment not ready", etc.
    skip_reason TEXT,
    notes       TEXT,            -- tester observations, actual vs expected delta
    executed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    executed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- one result per subject per sprint
    UNIQUE (sprint_id, test_id),
    UNIQUE (sprint_id, backlog_item_id),
    CONSTRAINT spr_result_exactly_one_subject CHECK (
        (test_id IS NOT NULL)::int + (backlog_item_id IS NOT NULL)::int = 1
    )
);
CREATE INDEX idx_sprint_test_results_sprint  ON sprint_test_results(sprint_id);
CREATE INDEX idx_sprint_test_results_test    ON sprint_test_results(test_id) WHERE test_id IS NOT NULL;
CREATE INDEX idx_sprint_test_results_item    ON sprint_test_results(backlog_item_id) WHERE backlog_item_id IS NOT NULL;
CREATE INDEX idx_sprint_test_results_status  ON sprint_test_results(sprint_id, status);
```

**Логика auto-skip:**
При старте спринта: создаём строки для всех `test_id` (регрессия) и всех `backlog_item_id`
(приёмочные критерии) со статусом `skipped`.
При выполнении: обновляем статус.
Если тест `failed` -- все тесты у которых он в `test_dependencies` остаются `skipped`
с `skip_reason = 'dependency test {id} failed'`.
Если `backlog_item` завершён со статусом `pass` -- статус item меняется на `done`.
`done` без записи `pass` в `sprint_test_results` -- невозможен (правило в `domain/backlog.go`).
Эта логика в `domain/testrun.go`.

### Комментарии и обсуждения

```sql
-- Comments are available on EVERY planning element.
-- Same nullable-FK pattern as backlog_items: set exactly one parent, rest are null.
-- This keeps queries simple and avoids polymorphic type gymnastics.
CREATE TABLE comments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- exactly one of these is set (the parent element)
    project_id       UUID REFERENCES projects(id)      ON DELETE CASCADE,
    epic_id          UUID REFERENCES epics(id)          ON DELETE CASCADE,
    release_id       UUID REFERENCES releases(id)       ON DELETE CASCADE,
    stage_id         UUID REFERENCES stages(id)         ON DELETE CASCADE,
    backlog_item_id  UUID REFERENCES backlog_items(id)  ON DELETE CASCADE,
    task_id          UUID REFERENCES tasks(id)          ON DELETE CASCADE,
    test_id          UUID REFERENCES tests(id)          ON DELETE CASCADE,

    -- body is nullable: set to NULL on soft delete (keeps thread structure intact)
    body        TEXT,
    author_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- threading: reply to a comment (one level deep -- no rabbit holes)
    parent_id   UUID REFERENCES comments(id) ON DELETE CASCADE,

    -- soft delete: NULL = active, set to now() when deleted (body also nulled)
    deleted_at  TIMESTAMPTZ,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- exactly one parent must be set -- no orphan comments, no multi-parent comments
    CONSTRAINT comments_exactly_one_parent CHECK (
        (
            (project_id IS NOT NULL)::int +
            (epic_id IS NOT NULL)::int +
            (release_id IS NOT NULL)::int +
            (stage_id IS NOT NULL)::int +
            (backlog_item_id IS NOT NULL)::int +
            (task_id IS NOT NULL)::int +
            (test_id IS NOT NULL)::int
        ) = 1
    )
);
CREATE INDEX idx_comments_project      ON comments(project_id)      WHERE project_id IS NOT NULL;
CREATE INDEX idx_comments_epic         ON comments(epic_id)          WHERE epic_id IS NOT NULL;
CREATE INDEX idx_comments_release      ON comments(release_id)       WHERE release_id IS NOT NULL;
CREATE INDEX idx_comments_stage        ON comments(stage_id)         WHERE stage_id IS NOT NULL;
CREATE INDEX idx_comments_backlog_item ON comments(backlog_item_id)  WHERE backlog_item_id IS NOT NULL;
CREATE INDEX idx_comments_task         ON comments(task_id)          WHERE task_id IS NOT NULL;
CREATE INDEX idx_comments_test         ON comments(test_id)          WHERE test_id IS NOT NULL;
CREATE INDEX idx_comments_parent       ON comments(parent_id)        WHERE parent_id IS NOT NULL;
```

**Правила для комментариев:**
- Удаление -- только soft delete (`deleted_at = now()`). Тред не рассыпается.
- Редактирование -- только автором, в течение 24 часов (бизнес-правило в domain layer).
- Threading -- один уровень вглубь (ответ на комментарий). Ответы на ответы -- нет.
  Это не Реддит, это рабочий инструмент.
- Observer может читать, но не писать (role check в middleware).

---

## API -- структура эндпоинтов v1

Все эндпоинты под `/api/v1/`. Авторизация -- Bearer JWT в заголовке.
Ответ всегда в формате `{ "data": ..., "meta": ..., "error": ... }`.

```
AUTH
  POST   /api/v1/auth/login              -- { email, password } -> { token, refresh_token, user }
  POST   /api/v1/auth/refresh            -- { refresh_token } -> { token }
  POST   /api/v1/auth/logout             -- invalidate refresh token
  GET    /api/v1/auth/me                 -- current user profile

USERS  [admin only for write]
  GET    /api/v1/users                   -- list users (filterable)
  POST   /api/v1/users                   -- create user
  GET    /api/v1/users/{id}              -- get user
  PATCH  /api/v1/users/{id}             -- update user
  GET    /api/v1/users/{id}/skills       -- user skill profile
  PUT    /api/v1/users/{id}/skills       -- replace full skill profile (intentional PUT:
                                         --   partial PATCH would silently drop unlisted skills)

SKILLS
  GET    /api/v1/skills                  -- skill catalog
  POST   /api/v1/skills                  -- create custom skill [admin]

TEAMS
  GET    /api/v1/teams                   -- list teams
  POST   /api/v1/teams                   -- create team [admin/maintainer]
  GET    /api/v1/teams/{id}              -- team details + members
  PATCH  /api/v1/teams/{id}             -- update team
  POST   /api/v1/teams/{id}/members     -- add member { user_id, capacity_hours }
  DELETE /api/v1/teams/{id}/members/{user_id}

PROJECTS
  GET    /api/v1/projects                -- list projects (role-filtered)
  POST   /api/v1/projects                -- create project
  GET    /api/v1/projects/{id}           -- project details
  PATCH  /api/v1/projects/{id}          -- update project
  PATCH  /api/v1/projects/{id}          -- archive: { "status": "archived" } [admin/maintainer]
                                         -- no DELETE: projects are archived, not destroyed

EPICS
  GET    /api/v1/projects/{id}/epics     -- list epics
  POST   /api/v1/projects/{id}/epics     -- create epic
  GET    /api/v1/epics/{id}              -- epic details + progress
  PATCH  /api/v1/epics/{id}             -- update epic
  DELETE /api/v1/epics/{id}

RELEASES
  GET    /api/v1/projects/{id}/releases  -- list releases
  POST   /api/v1/projects/{id}/releases  -- create release
  GET    /api/v1/releases/{id}           -- release + stages
  PATCH  /api/v1/releases/{id}          -- update release
  GET    /api/v1/releases/{id}/stages    -- list stages
  POST   /api/v1/releases/{id}/stages    -- create stage
  GET    /api/v1/stages/{id}             -- stage details
  PATCH  /api/v1/stages/{id}            -- update stage

BACKLOG
  GET    /api/v1/projects/{id}/backlog   -- list items, query params:
                                         --   ?epic={id}  ?release={id}  ?stage={id}
                                         --   ?status=backlog,in_progress
                                         --   ?assignee={id}  ?unplanned=true
                                         --   ?sort=priority&order=asc
                                         --   ?page=1&per_page=50
  POST   /api/v1/projects/{id}/backlog   -- create item
  GET    /api/v1/backlog/{id}            -- item details + tasks + tests
  PATCH  /api/v1/backlog/{id}           -- update item (status, epic, stage, release, priority...)
  DELETE /api/v1/backlog/{id}
  GET    /api/v1/backlog/{id}/tasks      -- tasks for item
  POST   /api/v1/backlog/{id}/tasks      -- create task

TASKS
  GET    /api/v1/tasks/{id}              -- task details
  PATCH  /api/v1/tasks/{id}            -- update task
  DELETE /api/v1/tasks/{id}
  POST   /api/v1/tasks/{id}/time         -- log time { hours, date, note }
  GET    /api/v1/tasks/{id}/time         -- time entries for task

TESTS
  GET    /api/v1/projects/{id}/tests     -- all project tests (filterable)
  POST   /api/v1/projects/{id}/tests     -- create test (body includes backlog_item_id or epic_id)
  GET    /api/v1/tests/{id}              -- test details
  PATCH  /api/v1/tests/{id}            -- update test (status, steps, etc.)
  DELETE /api/v1/tests/{id}

SPRINTS
  GET    /api/v1/projects/{id}/sprints           -- list sprints (with status filter)
  POST   /api/v1/projects/{id}/sprints           -- create sprint
  GET    /api/v1/sprints/{id}                    -- sprint details
  PATCH  /api/v1/sprints/{id}                    -- update sprint (name, goal, dates, status)
  POST   /api/v1/sprints/{id}/items              -- add backlog item to sprint { backlog_item_id }
  DELETE /api/v1/sprints/{id}/items/{item_id}    -- remove item from sprint
  GET    /api/v1/sprints/{id}/board              -- board view: items grouped by status
  GET    /api/v1/sprints/{id}/tests              -- all tests for sprint's backlog items
  GET    /api/v1/sprints/{id}/test-results       -- sprint test result summary
  POST   /api/v1/sprints/{id}/test-results       -- record test result { test_id, status, notes }
  PATCH  /api/v1/test-results/{id}               -- update result (status, notes, skip_reason)

STATS
  GET    /api/v1/projects/{id}/stats/overview    -- summary: items by status, velocity
  GET    /api/v1/projects/{id}/stats/capacity    -- team capacity vs load in period
  GET    /api/v1/projects/{id}/stats/time        -- hours by member, by skill, by period

COMMENTS  (доступны для каждого элемента планирования)
  -- Response shape: flat list, top-level comments first, replies embedded in "replies": [...].
  -- Client gets a ready-to-render tree; server does one query with ORDER BY created_at.
  GET    /api/v1/projects/{id}/comments              -- все комментарии проекта
  GET    /api/v1/epics/{id}/comments
  GET    /api/v1/releases/{id}/comments
  GET    /api/v1/stages/{id}/comments
  GET    /api/v1/backlog/{id}/comments
  GET    /api/v1/tasks/{id}/comments
  GET    /api/v1/tests/{id}/comments

  POST   /api/v1/projects/{id}/comments              -- { body, parent_id? }
  POST   /api/v1/epics/{id}/comments
  POST   /api/v1/releases/{id}/comments
  POST   /api/v1/stages/{id}/comments
  POST   /api/v1/backlog/{id}/comments
  POST   /api/v1/tasks/{id}/comments
  POST   /api/v1/tests/{id}/comments

  PATCH  /api/v1/comments/{id}                       -- edit own comment (24h window)
  DELETE /api/v1/comments/{id}                       -- soft delete (author or admin)

REAL-TIME
  GET    /api/v1/projects/{id}/events    -- SSE stream: item updates, status changes, new comments
```

---

## Соглашения по API

**Ответ всегда одной формы:**
```json
{
  "data": { ... },
  "meta": { "total": 42, "page": 1, "per_page": 20 },
  "error": null
}
```

При ошибке:
```json
{
  "data": null,
  "meta": null,
  "error": { "code": "VALIDATION_ERROR", "message": "title is required" }
}
```

**Коды ошибок** -- строки, не числа. Клиент switch-ует по `error.code`.

**PATCH -- только изменившееся.** Для смены статуса задачи:
```json
PATCH /api/v1/backlog/abc123
{ "status": "in_progress" }
```
Не нужно слать весь объект. Сервер применяет только то, что пришло.

**Drag-and-drop reorder** -- специальный эндпоинт:
```json
PATCH /api/v1/projects/{id}/backlog/reorder
{ "items": [{ "id": "abc", "priority": 0 }, { "id": "def", "priority": 1 }] }
```
Атомарно, транзакционно.

---

## План реализации

### Фаза 0 -- Фундамент (3-4 дня)
- [ ] `go mod init`, структура директорий
- [ ] `Dockerfile` (multi-stage: build + minimal runtime)
- [ ] `docker-compose.yml`: postgres + adminer (порт 8081, для дебага схемы)
- [ ] `Makefile`: `make dev`, `make build`, `make migrate-up`, `make migrate-down`, `make sqlc`
- [ ] `config.go`: читаем `.env`, валидируем при старте (нет конфига -- не запускается)
  - Production guard: если `APP_ENV=production` и `SEED_ADMIN_PASSWORD=changeme` -- падаем с явной ошибкой
- [ ] Подключение к БД с healthcheck
- [ ] `golang-migrate` setup, первая пустая миграция
- [ ] `chi` router, базовый `/api/v1/health` endpoint
- [ ] CORS middleware (`cors.go`): разрешаем React dev server (`:5173`) и production origin
- [ ] Rate limit middleware (`ratelimit.go`): применяем к `/api/v1/auth/*` (IP-based, 10 req/min)
- [ ] Логгер (structured JSON logs)

### Фаза 1 -- Схема данных (3-4 дня)
- [ ] Все миграции из раздела "Схема" выше
- [ ] `sqlc.yaml` config, базовые queries для всех таблиц
- [ ] `make sqlc` -- генерируем Go-код
- [ ] Проверяем на реальной БД (adminer -- наш друг)

### Фаза 2 -- Auth (2-3 дня)
- [ ] `POST /auth/login` -- bcrypt проверка, выдача JWT
- [ ] `POST /auth/refresh` -- refresh token rotation
- [ ] `GET /auth/me`
- [ ] JWT middleware (chi middleware)
- [ ] Role middleware
- [ ] Seed: один admin-пользователь при первом запуске

### Фаза 3 -- Пользователи и команды (2-3 дня)
- [ ] CRUD users
- [ ] CRUD skills (builtin seed + custom)
- [ ] CRUD member_skills
- [ ] CRUD teams + team members

### Фаза 4 -- Рабочие элементы (5-7 дней)
- [ ] CRUD projects (archive via PATCH status, no DELETE)
- [ ] CRUD epics (с автоматическим прогрессом)
- [ ] CRUD backlog items (с фильтрацией по всем измерениям)
- [ ] Drag-and-drop reorder: `PATCH /projects/{id}/backlog/reorder` (FLOAT8 midpoint trick)
- [ ] CRUD tasks
- [ ] CRUD tests (на всех уровнях: project / epic / backlog item)
- [ ] Time logging
- [ ] CRUD comments (для всех элементов: soft delete, 24h edit window, one-level threading)

### Фаза 4.5 -- Спринты (2-3 дня)
- [ ] CRUD sprints
- [ ] Sprint items: добавление/удаление backlog items из спринта
- [ ] Sprint test runs: инициализация результатов при старте спринта
- [ ] Auto-skip логика при failed тесте (domain/testrun.go)
- [ ] Sprint board view: `GET /sprints/{id}/board`

### Фаза 5 -- Таймлайн (2-3 дня)
- [ ] CRUD releases
- [ ] CRUD stages
- [ ] Привязка backlog items к stage/release

### Фаза 6 -- Статистика (2-3 дня)
- [ ] Overview endpoint
- [ ] Capacity vs load
- [ ] Time by member/skill

### Фаза 7 -- SSE Real-time (1-2 дня)
- [ ] SSE endpoint для проекта
- [ ] Broadcast при изменении item status

### Фаза 8 -- React UI (параллельно с 3-7, или после)
- [ ] Vite setup, TypeScript, базовый API-клиент
- [ ] Auth flow (login, token refresh)
- [ ] Project list + project dashboard
- [ ] Backlog view (список + фильтры)
- [ ] Sprint board (dnd-kit, columns by status)
- [ ] Epic board
- [ ] Timeline view (releases + stages)
- [ ] Capacity planning view

---

## Правила разработки

1. **Миграции -- только вперёд.** Никогда не редактируем существующую миграцию.
   Сломали -- пишем новую миграцию которая исправляет.

2. **sqlc -- источник истины для типов БД.** Не пишем SQL в Go-коде вручную.
   Всё -- через `.sql` файлы в `db/queries/`, потом `make sqlc`.

3. **Domain logic -- без HTTP и без SQL.** `internal/domain/` не импортирует
   `net/http` и не знает про sqlc. Это позволяет тестировать бизнес-логику без БД.

3a. **Видимость проектов (v1).** Пользователь видит проект если состоит в команде проекта
    (`team_members` -> `projects.team_id`). Проекты без команды видят только admin и maintainer.
    Это правило -- в middleware, не в каждом handler отдельно.

4. **API тесты с первого дня.** Каждый новый endpoint -- минимум один интеграционный тест
   с реальной тестовой БД. Это не обсуждается -- ради этого и строим V.42.

5. **Один `.env.example`.** Все конфиг-параметры задокументированы там.
   Никаких магических дефолтов в коде -- всё явно.

7. **Backlog item = цель + тест.** `ac_steps` и `ac_expected` -- не документация, а определение
   "готово". Переход в статус `done` требует `sprint_test_results.status = pass`.
   Это не опция -- это архитектурный принцип. Реализуется в `domain/backlog.go`.

6. **Semantic versioning API.** Сломать публичный контракт = новая `/api/v2/`.

---

## Переменные окружения (.env.example)

```bash
# Server
SERVER_PORT=8080
SERVER_HOST=0.0.0.0

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=v42
DB_USER=v42
DB_PASSWORD=changeme
DB_SSL_MODE=disable

# Auth
JWT_SECRET=change-this-to-a-long-random-secret-in-production
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

# App
APP_ENV=development          # development | production
LOG_LEVEL=info               # debug | info | warn | error
SEED_ADMIN_EMAIL=admin@v42.local
SEED_ADMIN_PASSWORD=changeme
```

---

## docker-compose.yml (базовый)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB:       ${DB_NAME}
      POSTGRES_USER:     ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 5s
      timeout: 5s
      retries: 5

  adminer:
    image: adminer:latest
    ports:
      - "8081:8080"
    depends_on:
      - postgres

  api:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
    env_file: .env
    ports:
      - "${SERVER_PORT}:${SERVER_PORT}"

volumes:
  postgres_data:
```

---

## Что дальше

Фаза 0 -- фундамент. Создаём структуру, поднимаем postgres, пишем healthcheck.
Первый `make dev` который ничего не делает, но делает это стабильно и с логами.
