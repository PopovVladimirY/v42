# V.42 -- Design Review: готовность к Phase 4 (Рабочие элементы)

> Дата: 2026-05-22. Основание: аудит после завершения Phase 3.
> Метод: читаем что есть, сверяем с DESIGN.md, думаем куда идём дальше.

---

## Статус Phase 3

| Элемент | Статус | Примечание |
|---------|--------|------------|
| CRUD users | DONE | GET list, POST, GET by id, PATCH |
| CRUD skills (catalog) | DONE | GET list, POST [admin]; 409 on duplicate |
| CRUD member_skills | DONE | GET, PUT upsert, DELETE idempotent |
| CRUD teams + members | DONE | GET, POST, PATCH, DELETE; UPSERT capacity_hours |
| sqlc queries (users/skills/teams) | DONE | 4 файла в db/queries/ |
| db/store/ (users/skills/teams/auth) | DONE | parseUUID fail = ErrNotFound везде |
| Integration tests | DONE | 76 тестов, все зелёные, 2 прогона подряд |
| Validation | DONE | null bytes, trim, len limits, guard-цепочки |
| **sqlc queries для projects/epics/backlog** | **NOT DONE** | .gitkeep |
| **handler_projects.go** | **NOT DONE** | нет |
| **handler_backlog.go** | **NOT DONE** | нет |
| **handler_tasks.go** | **NOT DONE** | нет |
| **handler_comments.go** | **NOT DONE** | нет |
| **internal/domain/** | **NOT DONE** | директория не существует |
| **Project visibility middleware** | **NOT DONE** | правило 3a из DESIGN.md не реализовано |

---

## Центральная концепция: "Skills Capacity Planning"

Официально -- это инструмент планирования. Для традиционалистов и бухгалтеров:
"смотрим, хватает ли у нас людей с нужными навыками на спринт". Всё понятно, всё привычно.

На самом деле это **двигатель роста команды**.

### Проблема, которую никто не называет своим именем

В каждой команде есть негласная иерархия знаний. Сеньор знает Kubernetes, остальные --
"спрашивают Васю". Вася уходит -- и вместе с ним уходит 3 года экспертизы.
Никто не уходит из команды, где постоянно растёт. Никто не застревает в команде,
где застрял навсегда.

V42 решает это не через HR-процессы, а через механику работы. Тихо. Без лозунгов.

### Модель мастерства: Dreyfus (5 уровней)

Почему 5, а не 4 -- потому что разница между "начинаю" и "уже не паникую" огромна,
и она важна при планировании. Текущий enum в схеме: `beginner | competent | proficient | expert`.
Нужно добавить `novice` ПЕРЕД `beginner`.

```sql
-- Migration 000003: расширяем skill_level до 5 ступеней (Dreyfus model)
ALTER TYPE skill_level ADD VALUE 'novice' BEFORE 'beginner';
```

| Уровень | Dreyfus | Что это значит на практике |
|---------|---------|----------------------------|
| `novice` | Novice | Следует правилам не понимая зачем. Нужен пошаговый инструктаж. |
| `beginner` | Advanced Beginner | Видит паттерны, применяет приёмы. Ещё не видит ситуацию целиком. |
| `competent` | Competent | Планирует. Видит цель за задачей. Справляется самостоятельно. |
| `proficient` | Proficient | Видит ситуацию голографически. Отступает от правил когда надо. |
| `expert` | Expert | Интуитивное понимание. Правила -- для других. Видит возможности. |

Почему это важно при планировании спринтов:
- `novice` на задаче без `reviewer_id` = риск. Система должна это видеть.
- `competent+` = самостоятельная работа. `proficient+` = может вести других.
- Задача требует `expert`? Если в команде нет никого выше `proficient` -- честный разговор.

### Что уже есть в схеме (и почему это важнее, чем кажется)

```sql
-- member_skills уже хранит ДВА сигнала:
level    skill_level    -- novice | beginner | competent | proficient | expert
interest interest_level -- low | medium | high  (машиночитаемый приоритет для матчинга)

-- tasks и backlog_items уже хранят:
skill_required UUID REFERENCES skills(id)  -- что нужно, чтобы сделать эту задачу
assignee_id    UUID REFERENCES users(id)   -- кто делает
```

`interest` enum -- это машиночитаемый сигнал для алгоритмов (tandem matching, сортировка).
Но скилл -- это не просто уровень. Это характер. "С++ мой конёк" и "веб-дизайн это моя стезя"
не укладываются в `low | medium | high`. Это нарратив.

**Решение: `interest_note TEXT` рядом с `interest` enum.**

```sql
-- Migration 000003: interest как нарратив
ALTER TABLE member_skills
    ADD COLUMN interest_note TEXT CHECK (length(interest_note) <= 500);
```

Enum остаётся -- алгоритм читает его. Поле `interest_note` -- для людей.
"Микроконтроллеры bare-metal и RTOS это песня, хотел бы подрасти профессионально" --
это не `interest = high`. Это личность. Два поля дополняют друг друга.

### Что схеме не хватает для тандема

**Проблема 1: одна задача -- один человек.**

Сейчас `tasks.assignee_id` -- единственный исполнитель. Нет места для ментора.
Паттерн "эксперт + тот, кто хочет вырасти работают вместе" -- нереализуем без схемного изменения.

**Решение: `reviewer_id` на задаче.**

Не "code reviewer" в смысле git. А "тот, кто ведёт". Может быть ментором,
может быть пэйром, может просто смотреть. Одно поле -- бесконечно гибко.

```sql
-- Migration 000003: add reviewer_id to tasks
ALTER TABLE tasks
    ADD COLUMN reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL;
```

Что это даёт:
- `assignee_id` = кто делает (может быть beginner в этом навыке)
- `reviewer_id` = кто ведёт (должен быть competent+ в skill_required)
- Запрос "покажи все пары ментор-ученик в текущем спринте" -- тривиален

**Проблема 2: рост невидим.**

Когда Маша переходит от beginner Go к competent -- это событие. Оно произошло. Но оно
нигде не записано. Мы знаем только текущее состояние. История роста -- пуста.

**Решение: `member_skill_history`.**

```sql
-- Migration 000003: growth ledger
CREATE TABLE member_skill_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_id   UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    level_from skill_level,         -- NULL = первая запись (начало отсчёта)
    level_to   skill_level NOT NULL,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,  -- кто подтвердил рост
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_skill_history_user  ON member_skill_history(user_id, changed_at DESC);
CREATE INDEX idx_skill_history_skill ON member_skill_history(skill_id, changed_at DESC);
```

Каждое обновление `member_skills.level` через `PUT /users/{id}/skills` пишет строку сюда.
Через 3 месяца: "Маша: Go beginner → competent → proficient, за 12 недель". Это данные.
Это разговор с командой основанный на фактах, а не на ощущениях.

### Четыре метрики которые меняют команду, не пугая бухгалтера

**Метрика 1: Skill coverage (для спринта)**
"Сколько человек в команде могут закрыть задачу с skill_required=Go на уровне competent+?"
Если ответ: один -- это bus factor. Если ноль -- это блокер.

```sql
-- GetSkillCoverage(team_id, skill_id, min_level) -> count
-- ВАЖНО: enum >= не работает напрямую. Используем IN() -- это стандарт для всех capacity queries.
SELECT COUNT(*) FROM member_skills ms
JOIN team_members tm ON tm.user_id = ms.user_id
WHERE tm.team_id = $1
  AND ms.skill_id = $2
  AND ms.level IN ('competent', 'proficient', 'expert')  -- min_level=competent пример
```

**Метрика 2: Tandem opportunity (при планировании задачи)**
"Кто в команде хочет вырасти в этом навыке (interest=high) и кто может их повести (expert/proficient)?"

Это подсказка при назначении. Не принуждение. Просто: "кстати, у Алексея interest=high
на этот навык, он мог бы взять задачу под руководством Насти".

**Метрика 3: Team growth velocity**
Сколько level-up событий произошло за спринт / квартал. Это не KPI. Это зеркало.
Команды, которые учатся -- видят движение. Застывшие -- тоже видят.

**Метрика 4: Authentic engagement score**

Есть ловушка с `level=expert` как якорем адекватности: это декларация, не доказательство.
20 лет на табуретке != один успешный проект в нише. Дипломированный неуч с `expert`
на семи навыках -- реальный паттерн, и система не должна ему доверять слепо.

Настоящий калибровочный сигнал -- **паттерн интересов**, а не задекларированный уровень.
Человек, который пишет конкретные `interest_note` и честно ставит себе `novice`
там где он новичок -- вероятно знает на что похоже настоящее мастерство.
Человек, у которого везде `expert` и ни одной `interest_note` -- вопрос открытый.

```sql
-- GetAuthenticEngagement(user_id)
-- Сколько скиллов с реальным интересом (interest=high И interest_note заполнена)?
SELECT
    COUNT(*) FILTER (WHERE interest = 'high' AND interest_note IS NOT NULL)
        AS engaged_skills,
    COUNT(*) FILTER (WHERE level = 'expert')
        AS declared_expert_count,
    COUNT(*) FILTER (WHERE level = 'expert' AND interest_note IS NOT NULL)
        AS grounded_expert_count   -- expert + объяснение = более достоверно
FROM member_skills
WHERE user_id = $1;
```

Что система делает с этим: тихо.
- В tandem suggestions: приоритет тем, у кого `grounded_expert_count > 0` в нужной области.
- В skill matrix: интенсивность цвета определяется `interest`, а не `level`.
  Горящий интерес при среднем уровне честнее, чем холодный `expert`.
- Никаких ярлыков, никаких предупреждений. Данные -- людям, выводы -- людям.

**Метрика 5: Skill radar (личный и командный)**

Радиальная диаграмма -- лучший инструмент для ранних стадий проекта.
Видно сразу: где пробелы, что нужно подтянуть, где концентрация, где одинокий эксперт.
Чем раньше это видно -- тем дешевле исправить.

Для рендеринга нужна специфическая форма данных -- не "список скиллов",
а "матрица: навыки как оси, члены команды как линии".

Персональный radar:
```json
{
  "user_id": "...",
  "axes": [
    { "skill_id": "...", "name": "Go", "level_rank": 3, "interest": "high",
      "interest_note": "основной язык, предпочитаю для серверной логики" },
    { "skill_id": "...", "name": "C++", "level_rank": 5, "interest": "medium" }
  ]
}
```

Командный radar:
```json
{
  "team_id": "...",
  "skills": [{ "skill_id": "...", "name": "Go" }, ...],
  "members": [
    { "user_id": "...", "name": "...",
      "levels": { "<skill_id>": 3, "<skill_id>": 5 } }
  ],
  "coverage": { "<skill_id>": 2 }  -- сколько competent+ на каждой оси
}
```

`level_rank` -- числовое представление уровня (novice=1 ... expert=5).
Фронтенд рисует из этого spider chart. Бэкенд просто JOIN + GROUP BY.
Никакой бизнес-логики -- чистые данные.

Radar имеет два кольца: **capability ring** (level_rank, где сейчас) и
**intent ring** (interest=high отмечает ось, где хотят расти). Разрыв между
кольцами -- это личная учебная повестка. Видна без слов.

**Метрика 6: Learning appetite (тяга к росту)**

Самый важный скилл -- способность учиться. Любопытство и неуспокоенность.
Не "знать всё", а продолжать тянуться. Это не измеряется тестом и не декларируется
в резюме. Но оно виндно в данных.

Не формальная оценка -- индикатор личной вовлечённости. Человек, который тянется
в области, где ещё новичок (`interest=high` + `level IN ('novice', 'beginner')`),
показывает активную позицию. Без интервью. Без HR-анкет.

Для команды: агрегированный `reaching_count` -- индикатор коллективной
вовлечённости. Команда, где все уже давно ни к чему не тянутся -- стагнирует.
Это видно ещё до того, как кто-то подаст заявление.

```sql
-- GetLearningAppetite(user_id)
-- Личная учебная активность, не оценка.
SELECT
    -- тянется: interest=high там, где ещё не мастер
    COUNT(*) FILTER (WHERE interest = 'high'
        AND level IN ('novice', 'beginner', 'competent'))
            AS reaching_count,
    -- ширина любопытства: сколько направлений интересует вообще
    COUNT(*) FILTER (WHERE interest IN ('medium', 'high'))
            AS curious_breadth,
    COUNT(DISTINCT skill_id) AS total_skills
FROM member_skills
WHERE user_id = $1;

-- Momentum: level-up за последние 90 дней (из member_skill_history)
SELECT COUNT(*) AS recent_level_ups
FROM member_skill_history
WHERE user_id = $1
  AND changed_at > now() - INTERVAL '90 days';
```

Что система делает с этим: ничего насильственного.
- В radar: intent ring виден как незакрашенный контур на осях с `interest=high`.
  Разрыв между кольцами -- учебная программа человека, нарисованная им самим.
- В team dashboard: суммарный `reaching_count` по команде. Трендом, не числом.
  Рост -- значит команда живая. Плато -- разговор с менеджером, не с системой.
- В tandem suggestions: человек с `reaching_count > 0` в нужном направлении
  -- приоритетный кандидат для менторства (мотивирован, тянется сам).

```
GET /api/v1/users/{id}/learning-appetite
    -- { reaching_count, curious_breadth, total_skills, recent_level_ups }

GET /api/v1/teams/{id}/learning-appetite
    -- { members: [{ user_id, reaching_count, recent_level_ups }],
    --   team_reaching_total: N, team_momentum_90d: N }
```

---

## Блокеры Phase 4

### BLK-1: нет sqlc queries для основных сущностей

Нужны файлы (и соответственно `make sqlc`):

| Файл | Основные queries |
|------|-----------------|
| `db/queries/projects.sql` | CreateProject, GetProjectByID, ListProjects, UpdateProject |
| `db/queries/epics.sql` | CreateEpic, GetEpicByID, ListEpicsByProject, UpdateEpic, DeleteEpic |
| `db/queries/backlog.sql` | CreateBacklogItem, GetBacklogItemByID, ListBacklogItems, UpdateBacklogItem, DeleteBacklogItem, ReorderBacklogItems |
| `db/queries/tasks.sql` | CreateTask, GetTaskByID, ListTasksByItem, UpdateTask, DeleteTask |
| `db/queries/time_entries.sql` | CreateTimeEntry, ListTimeEntriesByTask, GetTotalHoursByTask |
| `db/queries/tests.sql` | CreateTest, GetTestByID, ListTestsByProject, UpdateTest, DeleteTest |
| `db/queries/comments.sql` | CreateComment, ListCommentsByParent, UpdateComment, SoftDeleteComment |
| `db/queries/skills_capacity.sql` | GetSkillCoverage, GetTandemOpportunities, GetTeamSkillMatrix, GetPersonalRadar, GetTeamRadar, GetAuthenticEngagement |

### BLK-2: migration 000003 не написана

Всё что нужно для growth mechanics в одной миграции:

```sql
-- 1. Dreyfus 5th level
ALTER TYPE skill_level ADD VALUE 'novice' BEFORE 'beginner';

-- 2. Interest as narrative
ALTER TABLE member_skills
    ADD COLUMN interest_note TEXT CHECK (length(interest_note) <= 500);

-- 3. Tandem pairing on tasks
ALTER TABLE tasks
    ADD COLUMN reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- 4. Growth ledger
CREATE TABLE member_skill_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_id   UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    level_from skill_level,
    level_to   skill_level NOT NULL,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_skill_history_user  ON member_skill_history(user_id, changed_at DESC);
CREATE INDEX idx_skill_history_skill ON member_skill_history(skill_id, changed_at DESC);
```

Пишем ДО старта Phase 4, иначе потом придётся мигрировать с данными.
Важно: `ADD VALUE` для enum в PostgreSQL необратимо без пересоздания типа.
Down-миграция для `skill_level`: придётся пересоздавать таблицы -- документируем это.

### BLK-3: `internal/domain/` не существует

DESIGN.md говорит: "domain logic без HTTP и без SQL". Phase 4 это место, где domain
наконец нужен: правило `done без pass в sprint_test_results -- невозможен` живёт здесь.
Project visibility (правило 3a) -- здесь. Float8 midpoint reorder -- здесь.

Создаём пакет до написания хендлеров.

### BLK-4: Project visibility -- правило есть, реализации нет

DESIGN.md правило 3a:
> Пользователь видит проект если состоит в команде проекта. Проекты без команды
> видят только admin и maintainer.

Сейчас: не реализовано нигде. Реализовывать в каждом хендлере -- повторение. В chi middleware
(для всего проекта) -- слишком жёстко, потому что нам нужен project_id из URL чтобы проверить.

**Решение**: helper-функция `canAccessProject(ctx, projectID, pool) bool` в пакете api.
Вызывается в начале каждого project-scoped хендлера. Одна функция -- один тест.

---

## Дефекты дизайна (не блокеры, исправить до Phase 4)

### DEF-1: "Что дальше" в DESIGN.md устарел

Раздел в конце DESIGN.md до сих пор говорит: "Фаза 0 -- фундамент". Это было актуально
9 месяцев назад. Обновить: убрать "Что дальше", или переписать под Phase 4.

### DEF-2: Backlog reorder -- алгоритм не задокументирован

DESIGN.md упоминает "FLOAT8 midpoint trick" но не описывает что делать когда
два соседа слились (приоритеты совпали). Нужна нормализация:

```sql
-- ReorderBacklogItems: batch update, transactional
-- Midpoint formula: new_priority = (left.priority + right.priority) / 2.0
-- Normalization trigger: when |left - right| < 1e-9 -> reassign 0,1,2,3... across project
-- Normalization is rare (O(n) for whole project) but safe inside a transaction
```

### DEF-3: enum ordering для skill_level сравнений (теперь 5 уровней)

После добавления `novice` enum имеет порядок:
`novice < beginner < competent < proficient < expert` (по декларации).

В PostgreSQL `>=` на enum работает (сравнение по internal position),
но sqlc генерирует параметры как `pgtype.Text`, что ломает типизацию.
Стандарт для всех capacity queries в этом проекте -- явный `IN()`:

```sql
-- min_level = competent
AND ms.level IN ('competent', 'proficient', 'expert')

-- min_level = proficient (может вести других)
AND ms.level IN ('proficient', 'expert')

-- calibrated (DK-anchor)
AND ms.level = 'expert'
```

Для сортировки skill_level в SELECT использовать CASE:
```sql
ORDER BY CASE ms.level
    WHEN 'novice'     THEN 1
    WHEN 'beginner'   THEN 2
    WHEN 'competent'  THEN 3
    WHEN 'proficient' THEN 4
    WHEN 'expert'     THEN 5
END DESC
```

Зафиксировать оба паттерна в `db/queries/skills_capacity.sql` как reference.

### DEF-4: Comments -- 14 эндпоинтов, 1 хендлер

7 типов родителей x (GET + POST) = 14 маршрутов. Если делать наивно -- 14 хендлер-функций,
98% которых идентичны. Правильно: один хендлер с параметром parentType.

```go
// router.go
commentH := &commentHandlers{...}
for _, parent := range []string{"projects","epics","releases","stages","backlog","tasks","tests"} {
    r.Get(fmt.Sprintf("/api/v1/%s/{id}/comments", parent),
        commentH.List(parent))
    r.Post(fmt.Sprintf("/api/v1/%s/{id}/comments", parent),
        commentH.Create(parent))
}
```

---

## Схема -- сверка с Phase 4

### Что уже есть в models.go и готово к использованию

```
BacklogItem  -- все поля включая ac_setup/ac_steps/ac_expected и skill_required
Task         -- assignee_id, skill_required, order_index (Float8 midpoint готов)
Test         -- backlog_item_id, epic_id (NULL = project-level test)
TimeEntry    -- hours NUMERIC(5,1), logged_date, immutable по дизайну
Comment      -- 7 nullable FK, soft delete через deleted_at
Project      -- owner_id NOT NULL, team_id nullable, status project_status
Epic         -- target_date DATE, owner_id nullable
```

### Чего нет в models.go (нужна миграция 000003)

```sql
-- skill_level enum: нет 'novice' (только 4 значения сейчас)
-- member_skills: нет interest_note TEXT
-- tasks: нет reviewer_id
-- member_skill_history: таблица не существует
```

После миграции + `make sqlc` появятся:
- `SkillLevelNovice` константа в enum
- `MemberSkills.InterestNote pgtype.Text`
- `Task.ReviewerID pgtype.UUID`
- Новый тип `MemberSkillHistory` со всеми полями

---

## Структура файлов для Phase 4

```
Шаг 1: Migration + sqlc
  migrations/000003_growth_mechanics.up.sql    -- reviewer_id, member_skill_history
  migrations/000003_growth_mechanics.down.sql
  internal/db/queries/projects.sql
  internal/db/queries/epics.sql
  internal/db/queries/backlog.sql
  internal/db/queries/tasks.sql
  internal/db/queries/time_entries.sql
  internal/db/queries/tests.sql
  internal/db/queries/comments.sql
  internal/db/queries/skills_capacity.sql      -- coverage, tandem, matrix
  -> make sqlc -> internal/db/gen/ (обновляется)

Шаг 2: domain (бизнес-правила, нет HTTP, нет SQL)
  internal/domain/backlog.go     -- статусные переходы, правило done=pass
  internal/domain/project.go     -- видимость, правило 3a как функция
  internal/domain/reorder.go     -- Float8 midpoint + нормализация
  internal/domain/capacity.go    -- skill coverage, tandem opportunity

Шаг 3: store layer
  internal/db/store/projects.go
  internal/db/store/backlog.go
  internal/db/store/tasks.go
  internal/db/store/comments.go
  internal/db/store/capacity.go  -- skill coverage queries

Шаг 4: handlers + router wiring
  internal/api/handler_projects.go
  internal/api/handler_epics.go
  internal/api/handler_backlog.go
  internal/api/handler_tasks.go
  internal/api/handler_comments.go
  internal/api/router.go  -- подключаем новые маршруты

Шаг 5: тесты
  internal/api/projects_epics_test.go
  internal/api/backlog_tasks_test.go
  internal/api/comments_test.go
```

---

## Новые API эндпоинты (дополнение к DESIGN.md)

```
SKILLS CAPACITY (новые, не были в исходном DESIGN.md)

  GET /api/v1/teams/{id}/skill-matrix
      -- все участники команды x все их навыки + уровень + интерес
      -- ответ: [{ user_id, user_name, skills: [{ skill_id, name, level, interest }] }]

  GET /api/v1/teams/{id}/skill-coverage?skill_id=...&min_level=competent
      -- сколько людей в команде покрывают навык на нужном уровне
      -- ответ: { skill_id, min_level, coverage: 2, members: [{ user_id, level }] }
      -- coverage=1 = bus factor warning. coverage=0 = blocker.

  GET /api/v1/projects/{id}/backlog/{item_id}/tandem-suggestions?skill_id=...
      -- кто может быть assignee (interest=high, уровень ниже требуемого)
      -- кто может быть reviewer (уровень competent+ в этом навыке)
      -- ответ: { candidates: [...], mentors: [...] }

  GET /api/v1/users/{id}/skill-growth
      -- история роста по навыкам (из member_skill_history)
      -- ответ: [{ skill_id, name, interest_note, history: [{ level_from, level_to, changed_at, changed_by }] }]

  GET /api/v1/users/{id}/skill-radar
      -- данные для spider chart: все скиллы как оси, level_rank + interest
      -- ответ: { axes: [{ skill_id, name, level_rank, interest, interest_note }] }

  GET /api/v1/teams/{id}/skill-radar
      -- командный spider chart: оси = объединение всех скиллов команды
      -- ответ: { skills: [...], members: [{ user_id, name, levels: {skill_id: rank} }], coverage: {skill_id: count} }

  GET /api/v1/users/{id}/engagement
      -- authentic engagement score (engaged_skills, declared_expert_count, grounded_expert_count)
      -- ответ: { engaged_skills: 3, declared_expert_count: 2, grounded_expert_count: 1 }
```

---

## API контракт -- уточнения для Phase 4

**Tasks -- с reviewer:**
```json
POST /api/v1/backlog/{id}/tasks
{
  "title": "...",
  "skill_required": "uuid",
  "assignee_id": "uuid",
  "reviewer_id": "uuid"   // NEW: ментор/пэйр, опционально
}
```

**Skills upsert -- теперь пишет историю и принимает нарратив:**
```json
PUT /api/v1/users/{id}/skills
[
  {
    "skill_id": "uuid",
    "level": "competent",
    "interest": "high",
    "interest_note": "микроконтроллеры bare-metal и RTOS -- хобби, хочу подрасти профессионально"
  }
]
```

Логика на стороне сервера:
- `level` изменился → `INSERT INTO member_skill_history (level_from, level_to, changed_by)`
- `interest` или `interest_note` изменились → просто UPDATE, в историю не пишем
- `interest_note` валидация: trim, null bytes, len <= 500

**Backlog reorder:**
```json
PATCH /api/v1/projects/{id}/backlog/reorder
{ "items": [{ "id": "uuid", "priority": 1.5 }] }
```
Все приоритеты применяются в одной транзакции. Если после вставки `|a - b| < 1e-9` --
нормализуем весь проект (присваиваем 0.0, 1.0, 2.0, ...) в той же транзакции.

---

## Порядок действий

> Лень -- двигатель прогресса. Думать прежде, чем делать. Festina lente.
> Поспешай не торопясь: правильно написанная миграция не требует хотфикса.
> Правильно спроектированный query не требует рефакторинга через спринт.

1. Написать `migrations/000003_growth_mechanics.up.sql` -- `reviewer_id` + `member_skill_history`
2. `make migrate-up` на тестовой БД, проверить через adminer
3. Написать все `.sql` файлы в `db/queries/` для Phase 4
4. `make sqlc` -- убедиться что генерация чистая
5. Создать `internal/domain/` -- project.go, backlog.go, reorder.go, capacity.go
6. Создать store layer для projects, backlog, tasks, comments, capacity
7. Написать хендлеры -- projects → epics → backlog → tasks → tests → comments
8. Подключить в router.go
9. Тесты: те же паттерны что Phase 3 (monkey testing, граничные случаи)
10. Обновить `PUT /users/{id}/skills` -- добавить запись в `member_skill_history`

---

## Что обновить в других файлах

| Файл | Что |
|------|-----|
| `DESIGN.md` | Убрать/переписать "Что дальше" -- он устарел |
| `DESIGN.md` | `skill_level` enum: добавить `novice`, обновить комментарии по Dreyfus |
| `DESIGN.md` | `member_skills`: добавить `interest_note TEXT` |
| `DESIGN.md` | Добавить `member_skill_history` в раздел схемы |
| `DESIGN.md` | Добавить `reviewer_id` в описание таблицы tasks |
| `DESIGN.md` | Добавить skill capacity эндпоинты в раздел API |
| `DESIGN.md` | Стек: "Go 1.22+" -> "Go 1.25" |
| `TESTS.md` | Добавить секцию Phase 4 по мере написания тестов |

---

## Принцип, который не надо объяснять

В корне всей модели -- один скилл. Способность учиться. Любопытство и неуспокоенность.
Не "знать всё", а продолжать тянуться. Учиться учиться учиться -- именно так, рекурсивно.
Постоянно искать способ учиться лучше, чем вчера.

Это не декларируется в `level`. Это видно в `interest=high` там, где человек ещё новичок.
Это видно в `interest_note`, где он объясняет зачем. Это видно в momentum -- сколько
level-up событий за последний квартал. Не потому что надо, а потому что тянет.

Это и есть лучший индикатор вовлечённости команды. Не NPS, не performance review.
Просто: тянется ли команда куда-то, чего ещё не умеет.

Традиционный capacity planning отвечает на вопрос: "влезает ли?"
V42 отвечает на вопрос: "растёт ли?"

Разница не в интерфейсе. Разница в том, что система считает важным.
Если система замечает рост -- команда замечает рост.
Если команда замечает рост -- никому не хочется уходить.

### 10% как инвестиция, а не расход

Любое планирование задач должно исходить из простой арифметики:
10% времени команды, вложенное в рост изнутри, даёт лучшую отдачу,
чем найм контрактника на время. Контрактник уходит вместе с контекстом.
Человек, который вырос внутри -- остаётся. И тянет следующего.

V42 делает этот принцип рутиной. Tandem-задачи, learning appetite в dashboard,
intent ring на radar -- всё это выглядит как обычный спринт. Никакой академии,
никаких "Learning Friday". Просто работа, внутри которой есть место расти.

Незаметно. До тех пор, пока в один прекрасный день это не принесёт очевидных плодов.
И тогда никто не сможет объяснить, почему именно эта команда так сильно выросла.

Потому что всегда есть место для пива и время познавать.

Реализуем это через данные. Тихо. Без плакатов.
