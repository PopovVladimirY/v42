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
> -> activity_log -> outbox

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
    token_hash TEXT NOT NULL UNIQUE,  -- SHA-256 hex hash of the raw token, never plaintext
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
    -- team_id removed: projects are not owned by a single team.
    -- Teams are linked via project_teams junction table (M:M).
    -- A QA team, a DevOps team, and a Dev team can all work on the same project.
    owner_id    UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Project <-> Team: many-to-many.
-- A project can have multiple teams (dev, QA, ops, support).
-- A team can work on multiple projects simultaneously.
-- Visibility rule: user sees project if they are a member of ANY team on the project.
CREATE TABLE project_teams (
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    team_id     UUID NOT NULL REFERENCES teams(id)    ON DELETE CASCADE,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, team_id)
);
CREATE INDEX idx_project_teams_project ON project_teams(project_id);
CREATE INDEX idx_project_teams_team    ON project_teams(team_id);

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

## Событийная шина

SQL-база -- один из игроков системы, не единственный. Есть разработчики, пользователи,
клиенты, CI/CD, AI-агенты. Все они живут и общаются в реальном времени. Не через SQL.

```
                           [ Event Bus ]
                                |
     ┌──────────┬───────────────┼───────────────┬──────────┐
     v          v               v               v          v
 developer   user/UI         CI/CD          AI agent   V42 API
  (push)   (SSE stream)  (build.passed)  (suggestion)  (handler)
```

**SQL фиксирует результат.** Шина несёт сигнал.

### Граница: что в SQL, что в шине

| В PostgreSQL (текущее состояние, ACID) | В шине (события, fan-out, интеграции) |
|----------------------------------------|---------------------------------------|
| Все entity-таблицы | `v42.events.items` -- status_changed, assigned |
| `comments` (редактируемые, FK) | `v42.events.sprints` -- started, completed |
| `sprint_test_results` (текущий статус) | `v42.events.tests` -- result_recorded |
| `notifications` (is_read, счётчик) | `v42.events.comments` -- created (для @mentions) |
| `activity_log` (consumer пишет сюда) | `v42.audit` -- полная копия, long retention |
| `outbox` (transactional buffer) | `v42.notifications` -- push к конкретному юзеру |

### Паттерн: Transactional Outbox

В одной TX с основной записью пишем в `outbox`.
Горутина-publisher асинхронно читает непосланные строки и льёт в шину.
Гарантия: если TX откатилась -- outbox чистый. Если шина упала -- outbox ждёт.

```
handler:  BEGIN
          UPDATE backlog_items SET status = 'done' WHERE id = $1
          INSERT INTO outbox (topic, key, payload) VALUES (
              'v42.events.items',
              project_id::text,
              '{"type":"status_changed","from":"review","to":"done",...}'
          )
          COMMIT
          -- if COMMIT fails: nothing sent. if bus fails: outbox retries.

publisher goroutine (runs every 200ms):
          SELECT * FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 100
          -> publish to bus
          -> UPDATE outbox SET published_at = now() WHERE id = ...
```

### Таблицы (заложены в Phase 1 миграции)

```sql
-- Activity log: human-readable trail. Written by event bus consumer, not app code.
CREATE TABLE activity_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,  -- NULL = system/AI agent
    entity_type TEXT NOT NULL,   -- 'backlog_item' | 'sprint' | 'test' | 'comment' | ...
    entity_id   UUID NOT NULL,
    action      TEXT NOT NULL,   -- 'status_changed' | 'assigned' | 'commented' | ...
    payload     JSONB,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- append-only: no updated_at, no soft delete
CREATE INDEX idx_activity_project ON activity_log(project_id, occurred_at DESC);
CREATE INDEX idx_activity_entity  ON activity_log(entity_type, entity_id, occurred_at DESC);

-- Outbox: transactional guarantee for event delivery.
CREATE TABLE outbox (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic        TEXT NOT NULL,
    key          TEXT NOT NULL,         -- partition key (usually project_id)
    payload      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ            -- NULL = pending
);
CREATE INDEX idx_outbox_unpublished ON outbox(created_at) WHERE published_at IS NULL;
```

### SSE без outbox vs с outbox

| | Phase 7 без шины | Phase 7 с шиной |
|-|------------------|-----------------|
| Broadcaster | горутина внутри процесса | consumer каждого инстанса |
| Масштабирование | один инстанс | горизонтально, без sticky sessions |
| AI агенты | нет | подписываются как любой consumer |

### Выбор шины

Kafka vs NATS JetStream -- решение к Phase 7. Инфраструктура (`kv8-kafka`) уже есть.
Outbox-паттерн не зависит от выбора -- меняется только один файл publisher-горутины.

---

## API -- структура эндпоинтов v1

Все эндпоинты под `/api/v1/`. Авторизация -- Bearer JWT в заголовке.
Ответ всегда в формате `{ "data": ..., "meta": ..., "error": ... }`.

```
AUTH
  POST   /api/v1/auth/login              -- { email, password } -> { access_token, user } + httpOnly refresh cookie
  POST   /api/v1/auth/refresh            -- refresh_token cookie -> new access_token + rotated refresh cookie
  POST   /api/v1/auth/logout             -- revoke refresh token (idempotent), clear cookie
  GET    /api/v1/auth/me                 -- current user profile (requires Bearer token)

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

### Фаза 0 -- Фундамент ✓ DONE (commit af2a044, fe8984e)
- [x] `go mod init`, структура директорий
- [x] `Dockerfile` (multi-stage: build + minimal runtime)
- [x] `docker-compose.yml`: postgres + adminer (порт 8081, для дебага схемы)
- [x] `Makefile`: `make dev`, `make build`, `make migrate-up`, `make migrate-down`, `make sqlc`
- [x] `config.go`: читаем `.env`, валидируем при старте (нет конфига -- не запускается)
  - Production guard: если `APP_ENV=production` и `SEED_ADMIN_PASSWORD=changeme` -- падаем с явной ошибкой
- [x] Подключение к БД с healthcheck
- [x] `golang-migrate` setup, первая пустая миграция
- [x] `chi` router, базовый `/api/v1/health` endpoint
- [x] CORS middleware (`cors.go`): разрешаем React dev server (`:5173`) и production origin
- [x] Rate limit middleware (`ratelimit.go`): применяем к `/api/v1/auth/login` + `/auth/refresh` (IP-based, burst=10 then 1/6s per IP)
- [x] Логгер (structured JSON logs)

### Фаза 1 -- Схема данных ✓ DONE
- [x] Все миграции из раздела "Схема" выше -- `000002_schema.up.sql`
- [x] `sqlc.yaml` config, базовые queries для всех таблиц
- [x] `make sqlc` -- генерируем Go-код
- [x] Проверяем на реальной БД (adminer -- наш друг)

### Фаза 2 -- Auth ✓ DONE (см. PHASE2_SUMMARY.md)
- [x] `POST /auth/login` -- bcrypt check, JWT access token + httpOnly refresh cookie
- [x] `POST /auth/refresh` -- token rotation, reuse detection (replay → RevokeAll)
- [x] `POST /auth/logout` -- revoke refresh token, idempotent
- [x] `GET /auth/me` -- profile from JWT claims
- [x] JWT middleware -- Bearer validation, `*auth.Claims` injected into context
- [x] Role middleware -- `RequireRole(...)`, chains after JWTAuth
- [x] Rate limiter -- burst=10 then 1/6s per IP; `Retry-After` header; X-Forwarded-For bypass blocked
- [x] Seed admin -- `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` at startup
- [x] 15 integration tests; 4 security review rounds; 16 bugs found and fixed

### Фаза 3 -- Пользователи и команды ✓ DONE
- [x] CRUD users (GET list, POST, GET by id, PATCH -- с role/active guard-цепочкой)
- [x] CRUD skills -- каталог (GET list, POST [admin]; ErrConflict → 409)
- [x] CRUD member_skills (GET, PUT upsert, DELETE -- idempotent)
- [x] CRUD teams + team members (GET, POST, PATCH, DELETE; UPSERT capacity_hours)
- [x] 61 integration tests; 3 review + 1 monkey round; 19 bugs found and fixed
  - validation: null bytes, trim, length limits (name 200, skill 100, avatar_url 2048)
  - admin self-deactivation guard (403)
  - malformed UUID → 404 on all DELETE handlers
  - ErrConflict / ErrNotFound propagation сквозь store → handler

### Фаза 4 -- Рабочие элементы ✓ PARTIAL (см. PHASE4_SUMMARY.md)
- [x] CRUD projects (archive via PATCH status, admin DELETE)
- [x] CRUD epics (с базовым прогрессом через поле status)
- [x] CRUD backlog items (с фильтрацией по всем измерениям)
- [x] Reorder: `POST /projects/{id}/backlog/reorder` (FLOAT8 midpoint trick)
- [x] CRUD tasks
- [x] CRUD tests (на всех уровнях: project / epic / backlog item)
- [x] Time logging
- [x] CRUD comments (soft delete + one-level threading; 24h edit window -- pending)
- [x] 136 integration tests (cumulative); 2 audit passes; 39 bugs found and fixed

### Фаза 4.5 -- Спринты ✓ PARTIAL DONE
- [x] CRUD sprints
- [x] Sprint items: добавление/удаление/список backlog items из спринта
- [x] Sprint test runs: инициализация результатов при старте спринта
- [x] Auto-skip логика при failed тесте (domain/testrun.go)
- [ ] Sprint board view: `GET /sprints/{id}/board`

### Фаза 5 -- Таймлайн (2-3 дня)
- [ ] CRUD releases
- [ ] CRUD stages
- [ ] Привязка backlog items к stage/release

### Фаза 6 -- Ясность, Риск и Аналитика (6-8 дней)

Цель фазы: сделать невидимое видимым. Не только "сколько сделали", но и
"насколько понимали что делаем". Основа -- квадранты недопонимания (см. IDEAS.md).

#### 6a -- Модель ясности (2-3 дня)

**Миграция 000007** -- добавляем `clarity_level` на ключевые сущности.
_(000006 занята: `users.theme` -- тема пользователя, сохраняемая на сервере)_

Уровни основаны на фреймворке Cynefin (Дэвид Сноуден): каждый домен требует
своего подхода к принятию решений, оценке рисков и управлению.

```sql
CREATE TYPE clarity_level AS ENUM (
    'unknown',  -- disorder: ещё не разобрались даже с тем, в каком домене находимся;
                --           первый шаг -- не планировать, а исследовать
    'foggy',    -- chaos: усилие != результат; долгая упорная работа может не дать ничего,
                --        а случайное озарение -- решить задачу легко и с заделом;
                --        нужен spike или эксперимент, не оценка
    'tacit',    -- complex (экспертный): территория инженерии, дизайна, архитектуры;
                --                           поиск с заданными параметрами; решение есть,
                --                           но его нужно найти и обосновать
    'scoped',   -- complicated (организационный): задача понятна, но есть орг. сложности;
                --                               процесс не налажен, логистика не настроена;
                --                               open questions идентифицированы
    'clear'     -- simple: производство; всё промерено, best practices прописаны,
                --          команда на уровне; берём в спринт без spike
);

ALTER TABLE backlog_items ADD COLUMN clarity_level clarity_level NOT NULL DEFAULT 'unknown';
ALTER TABLE epics         ADD COLUMN clarity_level clarity_level NOT NULL DEFAULT 'unknown';
ALTER TABLE tasks         ADD COLUMN clarity_level clarity_level NOT NULL DEFAULT 'unknown';
```

Новые sqlc queries:
- `UpdateBacklogItemClarity(id, clarity_level)` -- PATCH отдельным эндпоинтом
- `ListBacklogItemsByClarity(project_id, clarity_level)` -- фильтрация для grooming view
- `GetProjectClarityDistribution(project_id)` -- COUNT по каждому уровню
- `GetSprintClaritySnapshot(sprint_id)` -- clarity_level айтемов на момент старта спринта

API эндпоинты:
- `PATCH /projects/{id}/backlog/{item_id}/clarity` -- обновить clarity_level
- `GET  /projects/{id}/clarity-map` -- distribution по всем айтемам проекта
- `GET  /projects/{id}/backlog?clarity=foggy` -- фильтр беклога по clarity (расширение существующего)
- `GET  /sprints/{id}/risk-score` -- вычисленный risk score по формуле из IDEAS.md

Sprint risk score:
```
score = (foggy*4 + unknown*3 + tacit*2 + scoped*1 + clear*0) / total_items
```
Возвращается вместе с breakdown по квадрантам. Никаких светофоров -- только данные.

#### 6b -- Аналитика и статистика (3-4 дня)

Три уровня аналитики (согласно IDEAS.md раздел 3):

**Оперативный уровень** (для тимлида еженедельно):
- `GET /teams/{id}/load` -- кто сколько взял, кто перегружен, кто простаивает
  Ответ: `{ member_id, name, capacity_hours, assigned_hours, utilization_pct }`
- `GET /sprints/{id}/burndown` -- items и часы по дням спринта (actual vs planned)
  Requires: `time_logs` таблица (новая миграция 000008, см. ниже)

**Тактический уровень** (для планирования релиза):
- `GET /projects/{id}/velocity` -- нормализованная velocity по спринтам
  `velocity = story_points_done / available_capacity` (не абсолютные цифры)
- `GET /teams/{id}/skill-throughput` -- tasks_done_in_skill / available_hours_in_skill
  Отвечает: "насколько эффективно используются Python-компетенции в квартале"
- `GET /projects/{id}/epic-progress` -- прогресс каждого эпика (% закрытых айтемов)

**Агрегированный overview** (дашборд проекта):
- `GET /projects/{id}/overview` -- всё в одном: items by status, sprint health,
  fog distribution, capacity utilization, top blocked items

**Миграция 000008** -- time_logs (нужна для burndown и аналитики):
```sql
CREATE TABLE time_logs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id        UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id),
    logged_hours   NUMERIC(5,2) NOT NULL CHECK (logged_hours > 0),
    logged_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    note           TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_time_logs_task   ON time_logs(task_id);
CREATE INDEX idx_time_logs_user   ON time_logs(user_id);
CREATE INDEX idx_time_logs_date   ON time_logs(logged_date);
```

API для time_logs:
- `POST /tasks/{id}/time-logs` -- залогировать время
- `GET  /tasks/{id}/time-logs` -- история по задаче
- `GET  /users/{id}/time-logs?from=&to=` -- история по пользователю за период

---

### Фаза 3c -- Multi-team projects (миграция модели данных)

**Суть проблемы:** `projects.team_id` -- жёсткий FK на одну команду. В реальности:
QA-инженер работает на трёх проектах. DevOps -- на всех. У проекта есть dev-команда,
QA-команда и команда поддержки. Каждая со своим capacity, своими спринтами, своими навыками.

**Новая модель:** M:M через `project_teams`. Проект принадлежит нулю или нескольким командам.
Команда работает на нескольких проектах. Sprint `team_id` -- сохраняется (один тим проводит
один спринт; у QA-команды свои спринты, у dev-команды свои).

#### Миграция 000009 -- project_teams

```sql
-- Step 1: create junction table
CREATE TABLE project_teams (
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    team_id     UUID NOT NULL REFERENCES teams(id)    ON DELETE CASCADE,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, team_id)
);
CREATE INDEX idx_project_teams_project ON project_teams(project_id);
CREATE INDEX idx_project_teams_team    ON project_teams(team_id);

-- Step 2: migrate existing data (zero data loss)
INSERT INTO project_teams (project_id, team_id)
    SELECT id, team_id FROM projects WHERE team_id IS NOT NULL;

-- Step 3: drop the old FK column
ALTER TABLE projects DROP COLUMN team_id;
```

Down migration (000009.down.sql):
```sql
ALTER TABLE projects ADD COLUMN team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- restore best-guess: first team added per project (arbitrary but lossless for v1 data)
UPDATE projects p SET team_id = (
    SELECT team_id FROM project_teams pt
    WHERE pt.project_id = p.id
    ORDER BY pt.added_at
    LIMIT 1
);

DROP TABLE project_teams;
```

#### Бэкенд изменения

**Middleware `projectVisibility`** -- поменять SQL:
```go
// Before (v1):
// WHERE p.team_id IN (SELECT team_id FROM team_members WHERE user_id = $me)
// After (v2):
const q = `
  SELECT EXISTS (
      SELECT 1 FROM project_teams pt
      JOIN team_members tm ON tm.team_id = pt.team_id
      WHERE pt.project_id = $1 AND tm.user_id = $2
  )
`
```

**`GET /projects?team_id={id}`** -- запрос через `project_teams`:
```sql
-- Before: WHERE p.team_id = $1
-- After:
SELECT p.* FROM projects p
JOIN project_teams pt ON pt.project_id = p.id
WHERE pt.team_id = $1
```

**`POST /projects`** -- body больше не требует `team_id`.
Опциональный `team_id` в body: если передан -- сразу создаётся запись в `project_teams`.

**Новые endpoints:**
```
GET    /projects/{id}/teams              -- список команд проекта
POST   /projects/{id}/teams             -- { team_id } -- добавить команду на проект
DELETE /projects/{id}/teams/{team_id}   -- убрать команду с проекта
```

**sqlc queries (обновить):**
- `ListProjectsByTeam(team_id)` -- через JOIN `project_teams`
- `ListTeamsByProject(project_id)` -- новый
- `AddTeamToProject(project_id, team_id)` -- INSERT
- `RemoveTeamFromProject(project_id, team_id)` -- DELETE
- `UserCanAccessProject(user_id, project_id)` -- EXISTS через `project_teams`

#### Фронтенд изменения

- `ProjectsPage` (`/teams/:id/projects`): без изменений -- `?team_id` работает
- `ProjectOverviewPage`: добавить секцию **Teams** -- список команд + кнопка "Add team" (admin/maintainer)
- Модалка создания проекта: опционально добавить drop-down "Add to team" -- или сделать в два шага
- `TeamDetailPage`: секция "Projects" -- уже показывает проекты через `/projects?team_id=` -- работает

#### Затронутые файлы

| Слой | Файл | Что меняем |
|------|------|------------|
| DB | `migrations/000009_project_teams.{up,down}.sql` | новый |
| DB | `db/queries/projects.sql` | ListProjectsByTeam, UserCanAccessProject |
| DB | `db/queries/project_teams.sql` | новый файл |
| Go | `internal/api/middleware/roles.go` | projectVisibility SQL |
| Go | `internal/api/handler/projects.go` | list, create, + 3 new handlers |
| Go | `internal/api/router.go` | 3 new routes |
| TS | `frontend/src/api/projects.ts` | listTeams, addTeam, removeTeam |
| TS | `frontend/src/pages/ProjectOverviewPage.tsx` | Teams section |

**Оценка:** 1-2 дня. Миграция нулевых потерь данных. Rollback через down-скрипт.

---

### Фаза 7 -- SSE Real-time (2-3 дня)

SSE endpoint позволяет клиентам подписаться на поток событий без polling.
Один постоянный HTTP-соединение, события в формате `text/event-stream`.

**Broadcaster:**
Горутина внутри процесса. Каналы per-project (map[projectID][]chan Event).
При горизонтальном масштабировании -- заменить на Kafka/NATS (outbox готов).
Сейчас: один инстанс, этого достаточно для v1.

**Эндпоинт:**
```
GET /projects/{id}/events
Content-Type: text/event-stream
Cache-Control: no-cache
Authorization: Bearer <token>   (JWT в query param как fallback для EventSource)
```

**Типы событий:**

| event type             | когда                                          | payload                              |
|------------------------|------------------------------------------------|--------------------------------------|
| `item.status_changed`  | backlog_item.status изменился                  | `{id, old_status, new_status}`       |
| `item.clarity_changed` | backlog_item.clarity_level изменился           | `{id, old_clarity, new_clarity}`     |
| `item.reordered`       | после drag-and-drop reorder                    | `{project_id}`  (клиент перезапросит)|
| `sprint.started`       | sprint.status = active                         | `{sprint_id, name}`                  |
| `sprint.completed`     | sprint.status = completed                      | `{sprint_id, velocity}`              |
| `task.assigned`        | task.assignee_id изменился                     | `{task_id, assignee_id, name}`       |
| `comment.created`      | новый комментарий                              | `{comment_id, author, body_preview}` |
| `fog.alert`            | sprint risk score превысил порог (> 1.5)       | `{sprint_id, score, foggy_count}`    |
| `ping`                 | каждые 30 секунд для keep-alive                | `{ts}`                               |

**Fog alert** -- новое: когда кто-то меняет clarity_level и risk score спринта
пересекает порог, broadcaster рассылает `fog.alert` всем подписчикам проекта.
Это не блокировка -- это сигнал для planning meeting.

**Go реализация (структура):**

```go
// internal/api/sse.go
type SSEBroker struct {
    mu       sync.RWMutex
    channels map[string][]chan SSEEvent  // key = project_id
}

type SSEEvent struct {
    Type    string `json:"type"`
    Payload any    `json:"payload"`
}

func (b *SSEBroker) Subscribe(projectID string) (<-chan SSEEvent, func())
func (b *SSEBroker) Publish(projectID string, event SSEEvent)
```

Handler пишет в `w` в цикле пока клиент не отключится (context.Done()).
При отключении вызывает unsubscribe функцию (убирает канал из map).

**Интеграция с handlers:**
После каждого successful PATCH status или PATCH clarity в handler --
`broker.Publish(projectID, SSEEvent{Type: "item.status_changed", ...})`.
Broker живёт в Router как зависимость (передаётся в handlers через конструктор).

### Фаза 8 -- React UI (не "потом", а параллельно с каждой фазой)

UI строится итерационно -- каждый шаг синхронизирован с соответствующим бэкенд-этапом.
Точка входа после логина -- **команда**, не проекты. Человек в системе первичен.

Общий техстек (один раз, в самом начале):
- Vite + React 18 + TypeScript
- TanStack Query v5 -- data fetching, кэш, invalidation
- Zustand -- глобальный state (auth, текущая команда/проект, SSE-события)
- Axios + JWT interceptor (auto-refresh через refresh token)
- React Router v6 -- структура маршрутов
- shadcn/ui + Tailwind CSS -- дизайн-система

---

#### Фаза 8.0 -- Vite Foundation + Auth UI (параллельно с Фазой 2 | уже можно)

Бэкенд Фазы 2 сделан. UI можно начинать прямо сейчас.

- [x] Vite + TS + Tailwind v4 + React Router v7 -- инициализация проекта
- [x] Axios instance: `baseURL`, request/response interceptors, token refresh logic
- [x] Zustand: `useAuthStore` -- user, accessToken, setAuth, logout, refresh, loadMe
- [x] `POST /auth/login` -- login form, валидация (zod + react-hook-form), error display
- [x] `POST /auth/refresh` -- автоматически при 401, прозрачно для компонентов
- [x] Protected route wrapper -- redirect to `/login` если нет токена
- [x] `GET /auth/me` -- загрузка текущего пользователя при старте
- [x] `POST /auth/logout` -- очистка стора, redirect
- [x] Playwright E2E: auth flow tests (e2e/auth.spec.ts) -- 4/4 pass

---

#### Фаза 8.1 -- Design System & Theme Engine (предусловие для всех следующих фаз)

Закладывается один раз, используется везде. Без этого фундамента каждый следующий экран
будет стилизован "на глаз" и окажется несовместим с предыдущим.

**Принципы:**
- UI language: **English only.** No mixed-language labels -- ever.
- Density: compact but not cramped. Information fits the screen; scrolling is the exception.
- Readability first: contrast, type scale, line-height. Everything else is secondary.
- Theming via CSS custom properties (`data-theme` attribute on `<html>`). Zero runtime JS cost.

---

**Темы (реестр):**

| ID              | Family | Character                                                           | Default |
|-----------------|--------|---------------------------------------------------------------------|---------|
| `deep-dive`     | Dark   | Deep navy, electric-blue accent. Focus mode -- zero distraction.    | YES     |
| `night-sky`     | Dark   | Near-black with indigo tones. Warmer than DeepDive.                 |         |
| `classic-dark`  | Dark   | Classic dark grey like most IDEs. Familiar, safe.                   |         |
| `ocean-blue`    | Light  | Cool blue-grey surfaces, crisp borders. Professional daytime.       |         |
| `paper-white`   | Light  | Off-white + warm accents. Easy on the eyes in natural light.        |         |
| `sunrise`       | Light  | Warm amber tones. Energetic, high-contrast.                         |         |
| `high-contrast` | Any    | WCAG AAA -- black/white base + saturated accent. For color-blind.   |         |

Пользователь выбирает тему в своём профиле. Сохраняется в `localStorage` + на сервере (Phase 6+).

---

**Цветовые токены (CSS custom properties per theme):**

```
-- Layer colors --
--bg-base        base page background
--bg-surface     cards, panels
--bg-elevated    dropdowns, popovers, modals
--bg-hover       interactive hover state
--bg-active      selected/active item

-- Text --
--text-1         primary: headings, labels
--text-2         secondary: descriptions, subtitles
--text-3         muted: timestamps, metadata, placeholders

-- Accent (primary action) --
--accent         button bg, links, focus rings
--accent-hover
--accent-fg      text on accent bg (always passes WCAG AA)

-- Semantic --
--color-success  done, passing tests
--color-warning  at-risk, needs attention
--color-danger   blocked, failed, overdue
--color-info     neutral callouts

-- Chrome --
--border         default border (subtle)
--border-strong  emphasized dividers, table headers
--shadow-sm      subtle elevation
--shadow-md      modal / popover elevation
```

**DeepDive tokens (reference implementation):**

```css
/* Deep ocean abyss -- bioluminescent accent, zero warmth */
[data-theme="deep-dive"] {
  --bg-base:      #050d14;
  --bg-surface:   #0a1a24;
  --bg-elevated:  #0f2535;
  --bg-hover:     #163040;
  --bg-active:    #1c3c50;

  --text-1:  #c8e4ef;
  --text-2:  #5a8fa8;
  --text-3:  #2e5468;

  --accent:       #00c4b8;   /* bioluminescent teal */
  --accent-hover: #00e5d4;
  --accent-fg:    #001a18;

  --color-success: #10b89a;
  --color-warning: #f59e0b;
  --color-danger:  #e05555;
  --color-info:    #22d3ee;

  --border:        rgba(0 180 220 / 0.07);
  --border-strong: rgba(0 180 220 / 0.14);
  --shadow-sm: 0 1px 3px rgba(0 0 0 / 0.5);
  --shadow-md: 0 8px 24px rgba(0 0 0 / 0.7);
}
```

---

**Типографика:**

Font: **Inter Variable** (`@fontsource-variable/inter`) -- shipped with the bundle, no CDN.
Fallback: `system-ui, sans-serif`.
Mono (code, IDs, hashes): `'JetBrains Mono', 'Fira Code', monospace`.

| Scale token  | Size  | Weight | Use                                     |
|--------------|-------|--------|-----------------------------------------|
| `--text-xs`  | 11px  | 400    | badges, table metadata                  |
| `--text-sm`  | 13px  | 400    | body, form labels, sidebar items        |
| `--text-base`| 14px  | 400    | default body                            |
| `--text-md`  | 15px  | 500    | card titles, section headers            |
| `--text-lg`  | 18px  | 600    | page headings                           |
| `--text-xl`  | 22px  | 700    | primary view title                      |

Line-height: `1.5` for body, `1.25` for headings. No orphan lines.

---

**Плотность и сетка:**

Базовая единица: `4px`. Все отступы кратны 4.

| Context              | Padding         | Gap    |
|----------------------|-----------------|--------|
| Page container       | `24px` H        |        |
| Card / panel         | `16px`          |        |
| Compact table row    | `8px` V / `12px` H | `8px`  |
| Sidebar item         | `8px` V / `12px` H |        |
| Form group           | `12px` bottom   |        |
| Inline badge         | `2px` V / `6px` H |        |

---

**Длинные строки и таблицы:**

- Text cells: `truncate` (`text-overflow: ellipsis`) по умолчанию + `title` tooltip с полным текстом.
- Многострочность включается классом `.multiline` или настройкой пользователя.
- Таблицы: drag-to-reorder columns (dnd-kit), resize handle, per-column visibility toggle.
  Настройки сохраняются в `localStorage` под ключом `v42-table-prefs:{viewName}`.
- Минимальная ширина колонки: `60px`. Максимум по умолчанию: `320px`.

---

**Checklist:**

- [x] `@fontsource-variable/inter` -- установить, импортировать в `index.css`
- [x] `index.css` -- полный реестр CSS-токенов для всех 8 тем
- [x] `src/stores/useTheme.ts` -- Zustand store: `theme`, `setTheme()`, persist в localStorage
- [x] `src/components/ThemeProvider.tsx` -- ставит `data-theme` на `<html>` при монтировании и смене
- [x] `main.tsx` -- обернуть приложение в `<ThemeProvider />`
- [x] `src/lib/cn.ts` -- утилита `cn(...classes)` (clsx + tailwind-merge)
- [x] Переписать `LoginPage` и `DashboardPage` под токены DeepDive
- [x] Smoke test: смена темы в `localStorage` -- страница перерисовывается правильно
- [x] **BONUS:** Тема сохраняется на сервере (`users.theme`, migration 000006, `PATCH /auth/me`)
- [x] **BONUS:** WebGL2 bubble easter egg -- 3 режима (classic / rainbow / вращающиеся квадраты) + idle detection 30s
- [x] **BONUS:** DeepDive и NightSky разведены -- разные палитры, разные характеры
- [x] **BONUS:** Тема `new-york` -- тёплый асфальт, cab yellow accent (migration 000008)

---

#### Фаза 8.3 -- Команды и люди (параллельно с Фазой 3 | уже можно)

Бэкенд Фазы 3 сделан. Teams UI -- первый экран после логина.
Человек видит свои команды, а не список абстрактных проектов.

**Лэйаут и навигация:**
- [x] App shell: левый sidebar (команды, быстрые ссылки), header (профиль, logout)
- [x] После логина → `/teams` (список команд пользователя, не `/projects`)
- [x] `GET /teams` -- список команд текущего пользователя (фильтр по member)

**Team list** (`/teams`):
- [x] Карточки команд с названием, описанием, датой создания -- клик → `/teams/{id}`
- [x] Empty state с иллюстрацией

**Team dashboard** (`/teams/{id}`):
- [x] Члены команды: имя, email, роль (с цветом по токену), capacity_hours
- [x] Статистика: кол-во участников, суммарная ёмкость, дата создания
- [x] Skeleton при загрузке, back link → `/teams`, error state
- [x] Skill radar (recharts RadarChart): покрытие навыков в команде (`GET /teams/{id}/skill-matrix`)
- [x] Capacity bars: available h/wk per member + active sprint item count (`GET /teams/{id}/member-capacity`)
- [x] Tandem opportunities UI: кто кого может менторить (`GET /teams/{id}/tandems`)
- [x] Learning appetite UI: кто хочет расти в каком навыке (`GET /teams/{id}/learning-appetite`)

**Управление командой** (admin/maintainer):
- [x] Добавить члена команды (форма: user dropdown + capacity)
- [x] Удалить члена команды
- [x] Обновить capacity_hours члена
- [x] `GET /skills` -- каталог навыков для выбора
- [x] Редактировать название / описание команды (`PATCH /teams/{id}`, inline форма в хедере TeamDetailPage)
- [x] Создать команду (кнопка "New team" в хедере `/teams`, inline форма; только admin/maintainer)
- [x] Удалить команду (`DELETE /teams/{id}`, confirm-диалог в хедере TeamDetailPage; только admin)

**Профиль пользователя** (`/profile`):
- [x] Страница `/profile` -- аватар, имя, email, роль, дата регистрации
- [x] Theme switcher перенесён сюда из sidebar (8 тем, активная выделена)
- [x] Список навыков пользователя (уровень + interest badge + note)
- [x] Добавить / редактировать / удалить навык (`PUT /users/{id}/skills/{skill_id}`)
- [x] Список команд пользователя
- [x] Sidebar bottom: аватар+имя → link `/profile`; только кнопка sign out
- [x] Ссылка на смену пароля → `/change-password`
- [x] Skill radar (персональный): мои компетенции по Дрейфусу (`GET /users/{id}/skill-radar`)
- [x] Learning appetite: trajectory (куда хочу расти) (`GET /users/{id}/learning-appetite`)
- [x] Engagement score: calibration -- grounded experts vs declared (`GET /users/{id}/engagement`)

**Безопасность и администрирование:**
- [x] `ChangePasswordPage` (`/change-password`) -- всегда 3 поля: текущий + новый + подтверждение
- [x] Backend: current_password всегда верифицируется (no skip)
- [x] Forced flow: `must_change_password=true` → redirect до входа в приложение
- [x] Migration 000007: `users.must_change_password BOOLEAN NOT NULL DEFAULT false`
- [x] `AdminUsersPage` (`/admin/users`) -- список, создать, активировать/деактивировать, сбросить пароль
- [x] autoComplete на всех password-полях формы (защита от autofill-бага браузера)

---

#### Фаза 8.4 -- Проекты и беклог (параллельно с Фазой 4) ✓ PARTIAL DONE

Проекты открываются из контекста команды. `/teams/{id}/projects` -- не отдельный раздел.

**Project list:**
- [x] `GET /projects?team_id={id}` -- проекты команды (`projectsApi.list`)
- [x] Карточка проекта: название, статус (active / on_hold / completed / archived)
- [x] Создать проект (модалка: название, описание; team_id из URL)
- [ ] PATCH статуса проекта (заглушка в ProjectOverviewPage -- "coming soon")
- [ ] % закрытых айтемов, fog distribution mini-bar -- нет данных с бэкенда
- [ ] **[v2]** Create project modal: immediately link to creating team via `project_teams`
- [ ] **[v2]** `ProjectOverviewPage`: секция "Teams on this project" -- список + добавить/убрать команду

**Project shell** (`/projects/{id}`):
- [x] Tab-навигация: Overview / Backlog / Epics / Sprints
- [x] Breadcrumb: Teams → Projects → {name}
- [x] Status badge (active / on_hold / completed / archived)
- [x] `ProjectOverviewPage` -- быстрые ссылки на Backlog / Epics / Sprints + Danger Zone
- [ ] Stats: items by status, velocity, fog distribution -- отложено до Phase 8.6

**Backlog view** (`/projects/{id}/backlog`):
- [x] Список айтемов с фильтрами: status, clarity, epic_id
- [x] Clarity badge на каждой строке (4 цвета по квадранту)
- [x] Inline PATCH статуса: клик по бейджу статуса → меняет без перехода
- [x] Создать айтем: inline панель (title + type + epic)
- [x] Удалить айтем (с confirm)
- [ ] Grooming filter preset "Требуют уточнения" -- отложено
- [ ] Drag-and-drop сортировка (dnd-kit) -- `POST /backlog/reorder` готов, UI не сделан
- [x] Backlog item detail (`/projects/:id/backlog/:itemId`) -- полная страница:
  - Описание (редактируемое inline)
  - ATDD поля (ac_setup / ac_steps / ac_expected, read-only)
  - Задачи (Tasks): CRUD, статус, skill_required (inline edit), estimate
  - Тесты (Tests): CRUD, type, steps, expected_results
  - Skill Load Distribution: агрегированный bar по skill_required задач
  - Кнопка "+ Sprint" -- выбор planning/active спринта и добавление айтема

**Epic board** (`/projects/{id}/epics`):
- [x] Карточки эпиков: title, status badge
- [x] Создать эпик (inline панель: title + description)
- [x] Переименовать эпик (клик по title → inline edit)
- [x] Сменить статус эпика (dropdown)
- [x] Удалить эпик (с confirm)
- [ ] Progress bar (% done backlog items) -- нет агрегатов с бэкенда
- [ ] Клик → backlog с фильтром epic_id -- отложено

**Роутинг и связность:**
- [x] `/teams/:id/projects` -- `ProjectsPage`
- [x] `/projects/:projectId` -- `ProjectShell` + `ProjectOverviewPage`
- [x] `/projects/:projectId/backlog` -- `BacklogPage`
- [x] `/projects/:projectId/epics` -- `EpicsPage`
- [x] Ссылка "Projects" на `TeamDetailPage` (кнопка-ряд)

**Тесты (Playwright e2e):**
- [x] `e2e/projects.spec.ts` -- 14 структурных тестов (без бэкенда): redirect guards, page structure, modal open/close, form disable state
- [ ] Backend flow тесты (CRUD) -- 3 теста написаны, пропускаются без `RUN_E2E_WITH_BACKEND=1`

---

#### Фаза 8.4.5 -- Sprint board (параллельно с Фазой 4.5) ✓ PARTIAL DONE

- [x] Список спринтов проекта, создать спринт, статус (planning / active / completed)
- [x] Sprint detail: дата начала/конца, capacity команды, кол-во айтемов
- [ ] Risk score badge на заголовке: цвет по порогу (< 0.5 зелёный, 0.5-1.5 жёлтый, > 1.5 красный)
  - `GET /sprints/{id}/risk-score`
- [x] Sprint board: колонки open / in_progress / in_review / done (dnd-kit DndContext)
- [x] Drag карточки между колонками -- `PATCH /backlog/{id}` со статусом
- [x] Добавить айтем из спринта -- панель "Add from backlog" в футере борда (фильтр + поиск + кнопка +)
- [x] Удалить айтем из спринта -- через `DELETE /sprints/{id}/items/{backlog_item_id}` (хук готов)
- [ ] Fog alert toast: SSE событие `fog.alert` -- откладывается до Phase 8.7

---

#### Фаза 8.4.8 -- Коррекция курса (UX / polish)

Промежуточная фаза: исправляем накопившиеся огрехи до движения вперёд.

- [ ] **Пасхалка**: пузыри активируются только в левом нижнем углу (fix click zone, сейчас срабатывает везде)
- [ ] **Session timeout**: честный logout с настройкой в профиле пользователя
  - `idle_timeout_minutes` в `PATCH /api/v1/users/me` (default 30, 0 = никогда)
  - Frontend: читаем из профиля, idle timer через `mousemove`/`keydown`, показываем предупреждение за 1 мин до logout
- [ ] **Theme picker**: дропдаун в ProfilePage вместо кликабельных плашек; цветовой индикатор сохраняется
- [ ] **TeamDetailPage layout**: горизонтальный 16:9 -- список 2/3, радар + статистика 1/3, без мобильного сжатия
- [ ] **Add member widget**: позиционирование в пределах viewport (overflow-hidden на контейнере + dropup если нет места снизу)
- [ ] **Skill radar**: вынести из центра на правую колонку рядом со списком команды
- [ ] **Контраст текста**: увеличить `--text-1` / `--text-2` в светлых темах (OceanBlue, PaperWhite, Sunrise); цель WCAG AA (4.5:1)
- [ ] **Сайдбар**: прямой доступ -- секция "Last project" с ссылками на Backlog и Sprints выбранного проекта
- [ ] **Persistence**: `localStorage` сохраняет последний проект, активные фильтры, текущую страницу пагинации; восстанавливается при логине

---

#### Фаза 8.5 -- Таймлайн (параллельно с Фазой 5)

- [ ] Горизонтальная шкала времени (кастомный SVG или vis-timeline -- решить по ходу)
- [ ] Полосы Release: название, период, цвет по статусу
- [ ] Полосы Stage внутри Release: вложенно, с датами
- [ ] Epic bars: span от первого до последнего айтема в эпике (auto-computed)
- [ ] Backlog items в Stage: точки или мини-карточки на полосе
- [ ] Fog heat-map наложение: интенсивность фона по fog-density в периоде
  (много foggy айтемов в этапе → тёмный фон этапа → концентрация риска видна сразу)
- [ ] Drag stage/release для изменения дат → `PATCH /releases/{id}` или `PATCH /stages/{id}`
- [ ] Привязать айтем к stage: drag с backlog на полосу, или select в item detail

---

#### Фаза 8.6 -- Ясность и аналитика (параллельно с Фазой 6)

Clarity controls уже встроены в backlog (8.4). Здесь -- аналитическая надстройка.

- [ ] Clarity map view (`/projects/{id}/clarity`): quadrant distribution в виде bubble chart
  - Каждый пузырь = один айтем, ось X = приоритет, ось Y = quadrant, размер = estimate
- [ ] Time logging UI: кнопка "Залогировать время" на task detail, форма (часы + дата + заметка)
  - `POST /tasks/{id}/time-logs`
- [ ] Burndown chart: actual vs planned по дням спринта (recharts LineChart)
  - `GET /sprints/{id}/burndown`
- [ ] Velocity chart: нормализованная velocity по спринтам (recharts BarChart)
  - `GET /projects/{id}/velocity`
- [ ] Team load view (`/teams/{id}/load`): кто перегружен, кто простаивает
  - Таблица: member, capacity_hours, assigned_hours, utilization_pct, colored bar
- [ ] Skill throughput: гистограмма эффективности по навыкам
  - `GET /teams/{id}/skill-throughput`

---

#### Фаза 8.7 -- Real-time (параллельно с Фазой 7)

Не добавляет новых экранов -- добавляет живость к уже существующим.

- [ ] `useProjectEvents(projectId)` hook -- EventSource с auto-reconnect
  - Exponential backoff: 1s → 2s → 4s → 8s → max 30s
  - Reconnect при visibilitychange (вернулся с другой вкладки)
- [ ] Zustand event handler: обновляет QueryClient кэш по типу события
  - `item.status_changed` → invalidate backlog query (без перезагрузки страницы)
  - `item.clarity_changed` → invalidate clarity-map + backlog
  - `sprint.started` / `sprint.completed` → invalidate sprint list
  - `fog.alert` → toast notification (shadcn Toast, не блокирующий)
- [ ] Оптимистичное обновление при drag-and-drop:
  - Zustand применяет изменение немедленно
  - При HTTP ошибке → rollback + error toast
- [ ] Online indicator: зелёная точка в header пока SSE соединение активно



### Фаза 9 -- Умная аналитика и knowledge map (future, v2)

Когда данных накопится достаточно (3-6 месяцев работы с системой).

- [ ] Clarity trend по спринтам: как менялся fog-distribution со временем
- [ ] Bus factor alerts: автоматическое обнаружение skill = tacit по истории задач
  (навык у одного человека + он закрыл >70% задач в этом навыке = alert)
- [ ] Fog-to-clear trajectory: среднее время от unknown до clear по типам задач
  (выявляет паттерны: "epic-level задачи у нас в среднем 2 недели в foggy -- ок или нет?")
- [ ] Sprint health score trending: risk_score + velocity + utilization = composite health
- [ ] Retrospective insights: автоматические наблюдения для retro ("3 foggy айтема
  в этом спринте потребовали 40% больше времени чем оценка -- обсудить на retro")
- [ ] Skill gap analysis: команда берёт Python-задачи, но уровень Dreyfus = Beginner
  и clarity = foggy -- система предлагает learning task или найти ментора

---

## Правила разработки

1. **Миграции -- только вперёд.** Никогда не редактируем существующую миграцию.
   Сломали -- пишем новую миграцию которая исправляет.

2. **sqlc -- источник истины для типов БД.** Не пишем SQL в Go-коде вручную.
   Всё -- через `.sql` файлы в `db/queries/`, потом `make sqlc`.

3. **Domain logic -- без HTTP и без SQL.** `internal/domain/` не импортирует
   `net/http` и не знает про sqlc. Это позволяет тестировать бизнес-логику без БД.

3a. **Видимость проектов (v2 -- multi-team).** Пользователь видит проект если состоит
    в ЛЮБОЙ из команд проекта (`team_members` -> `project_teams` -> `projects`).
    Проекты без команд видят только admin и maintainer.
    SQL-паттерн для middleware:
    ```sql
    EXISTS (
        SELECT 1 FROM project_teams pt
        JOIN team_members tm ON tm.team_id = pt.team_id
        WHERE pt.project_id = $project_id AND tm.user_id = $current_user_id
    )
    ```
    Правило в middleware, не в каждом handler отдельно.
    Миграция с v1 (`projects.team_id`) -- см. миграцию 000009.

4. **API тесты с первого дня.** Каждый новый endpoint -- минимум один интеграционный тест
   с реальной тестовой БД. Это не обсуждается -- ради этого и строим V.42.

5. **Один `.env.example`.** Все конфиг-параметры задокументированы там.
   Никаких магических дефолтов в коде -- всё явно.

7. **Backlog item = цель + тест.** `ac_steps` и `ac_expected` -- не документация, а определение
   "готово". Переход в статус `done` требует `sprint_test_results.status = pass`.
   Это не опция -- это архитектурный принцип. Реализуется в `domain/backlog.go`.

8. **Clarity_level = обязательное поле с первого дня данных.** Новый беклог-айтем всегда
   начинает как `unknown`. Переход в спринт без `clear` или `scoped` -- warning,
   но не hard block. Система подсвечивает, команда решает. Данные накапливаются.

9. **Fog-change события через SSE.** Каждое изменение `clarity_level` -- это событие
   которое broadcaster публикует в проектный SSE поток. Клиент обновляет risk score
   без reload. Это не nice-to-have -- это корень real-time аналитики.

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

## Бить? Или не бить?

Интересное наблюдение культурных особенностей. Для одних "дорого-богато", для других "практично-лаконично" и так далее. На всех не угодишь. Или всё таки есть шанс? Ведь может же дерево смотреться богато, а золото убого. Так? Вот мне любопытно. Наши пузыри кому зайдут? Вопрос чисто филосовский, но далеко не праздный.

По поводу братьев Дрейфус и их модели. Средне статистически переход на каждый следующий уровень требует экспоненциально больше затрат. Например, с начинающего до новичка это месяц-два. До уверенного уже три-четыре месяца. Дальше полтора года до автономии, когда включаются мозги и задают вопрос "почему?". До профи три-четыре года. Мастерство 10+. И это регулярной работы и по каждому скилу отдельно... Жизнь прожить, не поле перейти. Но, после мастера -- ты снова новичок! Достигнув предела познания в отдельно взятой области ты попадаешь в трансцендентное состояние, когда ты и есть правило. Очень одинокое состояние на вершине бытия... Но в то же время, чтобы освоить что-то другое нужно спуститься в долину незнания... Уроборос. Цикл замкнут. Познание не имеет предела.

Учитывая всё это и не только, рост команды и каждого отдельного её члена -- залог успеха. Нет предела совершенству. Best practices are the past practices. На том стояли и стоять будем на славу отчизне. Без пафоса. Не подведём предков.

Можно весь этот поток сознания сбросить в IDEAS.md, как базу для калибровки точки сборки по Кастанеде. Потому, что мы в пути. Трансцендируем в грядущее. Ибо время не идёт вспять, а с дураками не спорим. Они -- присоединённая масса. Гарант стабильности. Якорь и залог, который придётся отдать однажды каждому...

> "исторический роман сочинял я по-немногу. Пробираясь сквозь туман от пролога к эпилогу"
> "как он дышит, так и пишет"
>
> -- Булат Окуджава

---

## Backlog Power Features (VersionOne-style)

Три возможности из V1, которые сделали работу с бэклогом реальной, а не декоративной.
Реализованы как расширение Фазы 4, не ломая ни одного существующего контракта.

---

### 1. Inline expand: задачи и тесты прямо в строке бэклога

**Зачем:** видеть состав item-а без перехода на страницу деталей. Всё как на ладони,
прямо в таблице -- как в V1 "Add Task" / "Expand Tests" в сетке бэклога.

**UX:**
- В крайней левой колонке каждой строки -- кнопка `[+]` / `[-]`
- По клику раскрывается панель под строкой item-а (не сбоку, а именно под)
- Внутри: две секции -- Tasks и Tests. Кол-во в заголовке (Tasks: 3 / Tests: 2)
- Каждая задача в одну строку: статус-пилюля | название | оценка | кнопка Move
- Каждый тест: тип-бэдж | название | кнопка Move
- Данные загружаются лениво (on demand) при первом раскрытии; кэш TanStack Query
- State: `expandedItems: Set<string>` в компоненте BacklogPage (не в zustand -- локальный UI state)

**Данные:**
- `GET /projects/:pid/backlog/:itemId/tasks` -- уже есть
- `GET /projects/:pid/backlog/:itemId/tests` -- уже есть
- Хуки `useTasks` и `useItemTests` из `useItemDetails.ts` -- уже есть

**Изменения:**
- `BacklogPage.tsx`: добавить колонку expand, компонент `ExpandedItemPanel`
- `useItemDetails.ts`: без изменений (хуки уже готовы)
- Backend: без изменений

---

### 2. Move task / Move test между backlog items

**Зачем:** реалокация работы -- самая частая операция на грумингах. "Эта задача
теперь относится к той фиче" -- одно движение, а не удали / пересоздай.

**UX:**
- Кнопка "Move" в строке каждой задачи / теста внутри expanded panel
- Открывает inline-dropdown со списком всех backlog items проекта (кроме текущего)
- Item picker: searchable, показывает `#номер Название`
- После выбора: оптимистичный UI (задача исчезает из текущего item-а), подтверждение
  через инвалидацию кэша обоих item-ов

**Данные:**
- Новый endpoint: `POST /projects/:pid/backlog/:itemId/tasks/:taskId/move`
  Body: `{ "target_item_id": "uuid" }`
  Ответ: перемещённая задача с новым `backlog_item_id`
- Аналогично: `POST /projects/:pid/backlog/:itemId/tests/:testId/move`
  Body: `{ "target_item_id": "uuid" }`

**Реализация (Go):**
- SQL: `UPDATE tasks SET backlog_item_id = $2, updated_at = now() WHERE id = $1 RETURNING ...`
- SQL для тестов аналогично
- Store: `TaskStore.MoveTo(ctx, taskID, newItemID)`, `TestStore.MoveTo(...)`
- Handler: валидирует что task принадлежит текущему item (защита), выполняет move
- Router: `POST /backlog/{backlog_item_id}/tasks/{id}/move` (without RequireRole -- любой участник)
- Аналогично для tests

**Инвалидация кэша (frontend):**
```typescript
// onSuccess:
qc.invalidateQueries({ queryKey: taskKeys.byItem(projectId, oldItemId) });
qc.invalidateQueries({ queryKey: taskKeys.byItem(projectId, targetItemId) });
```

---

### 3. Backlog breakdown: разбить один item на несколько

**Зачем:** классическая ситуация грумминга -- "эта история слишком большая, давайте
разобьём на три". В V1 это был отдельный экран с drag-and-drop распределением задач.

**UX:**
- Кнопка "Break down" в expanded panel или в контекстном меню строки бэклога
- Открывается модал на весь экран:
  - Слева: исходный item (заголовок, задачи, тесты) -- readonly
  - Справа: 2+ новых item-а (можно добавлять/удалять)
    - Каждый: поле Title + Estimate (SP)
    - Drag zone: перетащи задачи/тесты в этот item
  - Задачи/тесты, не назначенные ни в один новый item, остаются в оригинальном
    (или оригинальный item сохраняется как "remainder" с нераспределённой работой)
  - Кнопка "Execute breakdown" внизу

**Правила:**
- Минимум 2 новых item-а
- Каждый должен иметь title
- Сумма estimate-ов новых items -- рекомендательная (не обязательна совпадать с оригиналом)
- Оригинальный item **всегда сохраняется** -- история не переписывается. Он получает
  статус `decomposed`, скрывается из всех рабочих view (backlog, sprint board, фильтры),
  но хранится как корень поддерева в "Дереве жизни проекта"

**Дерево жизни (Life Tree) -- будущий экран:**
В backlog_items добавляется `parent_item_id UUID REFERENCES backlog_items(id)`.
Новые items после breakdown получают ссылку на оригинальный item.
Если новый item тоже разбивается -- он тоже становится `decomposed` и порождает своих детей.
Получается дерево, в котором видно, как понимание проекта эволюционировало:
что выросло, что завяло, что мутировало. Живая история грумминга.

Экран "History / Life Tree": интерактивная D3 или Recharts tree-диаграмма,
только read-only, без правок. Каждый узел показывает:
- заголовок item-а
- дату декомпозиции
- оценку (оригинальную vs. суммарную детей)
- статус ветки

Пример визуализации: горизонтальное дерево слева-направо, узлы кликабельны,
открывают side panel с деталями item-а.

**Данные (frontend-driven batch):**
1. `POST /projects/:pid/backlog` x N -- создать новые items (с теми же epic/release/stage)
2. `POST /projects/:pid/backlog/:oldItemId/tasks/:taskId/move` x M -- переместить задачи
3. `POST /projects/:pid/backlog/:oldItemId/tests/:testId/move` x K -- переместить тесты
4. Опционально: `DELETE /projects/:pid/backlog/:oldItemId` или `PATCH` status=cancelled

Batch выполняется последовательно с rollback по ошибке (delete новых items если шаг 2/3 упал).

**Специального backend endpoint не нужно** -- orchestration на frontend через
существующие примитивы. Атомарность не критична для грумминга (не транзакционная операция).

**Статус:** дизайн готов. Реализация -- следующий приоритет после move (зависит от него).
UI: модал с dnd-kit DragOverlay (уже в стеке), три drop zone-ы для новых item-ов.

---

## Что дальше

Фаза 0 -- фундамент. Создаём структуру, поднимаем postgres, пишем healthcheck.
Первый `make dev` который ничего не делает, но делает это стабильно и с логами.
