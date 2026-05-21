# V.42 -- Design Review #1

> Critical pass before Phase 0. No mercy.

---

## Итог

Фундамент крепкий, идеи правильные. Но есть дыры -- некоторые с летальным исходом для первой
миграции, некоторые просто неприятные. Ниже по категориям: сначала критичное, потом важное,
потом замечания.

---

## КРИТИЧНО -- Сломает всё при первом запуске

### 1. Forward reference в схеме БД

`backlog_items` ссылается на `releases` и `stages` через FK, но эти таблицы определены ПОЗЖЕ
в документе. Если миграция пойдёт в таком порядке -- упадёт с ошибкой "relation does not exist".

**Правильный порядок создания таблиц:**
```
users -> skills -> teams -> team_members -> member_skills
-> projects -> epics
-> releases -> stages           (сначала!)
-> backlog_items                (потом, с FK на releases и stages)
-> tasks -> tests -> time_entries -> comments
```

В итоговой миграции порядок `CREATE TABLE` должен строго следовать зависимостям.

### 2. Нет таблицы `refresh_tokens`

В Auth описано "refresh token rotation" и "logout -- удаляем из БД", но в схеме нет таблицы
для хранения refresh-токенов. Без неё:
- Logout не работает (токен нельзя инвалидировать)
- Rotation невозможен
- Один украденный refresh-токен -- навсегда

**Добавить:**
```sql
CREATE TABLE refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,  -- bcrypt hash, not plaintext
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ           -- NULL = active
);
CREATE INDEX idx_refresh_tokens_user    ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash    ON refresh_tokens(token_hash);
```

### 3. `comments.body TEXT NOT NULL` -- противоречие с soft delete

В правилах написано "soft delete: keep thread context, just blank the body".
Но `body NOT NULL` не позволяет занулить тело. Либо:
- `body TEXT` (nullable) -- при удалении ставим NULL
- Или добавляем `is_deleted BOOLEAN` и оставляем body как есть (хуже, занимает место)

Рекомендация: `body TEXT` (nullable) + `deleted_at TIMESTAMPTZ`. При удалении: `body = NULL, deleted_at = now()`.

### 4. Нет CHECK constraint на `comments` -- любой может создать "бесхозный" комментарий

Написано "exactly one of these is set", но нет ни одного constraint который это гарантирует.
Можно создать комментарий без единого parent -- или с тремя. БД не защитит.

**Добавить:**
```sql
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
```

---

## ВАЖНО -- Не сломает сразу, но создаст боль позже

### 5. Нет таблицы `sprints`

В TODO прямо написано "Задачи в спринте", в Phase 8 -- "Sprint board (dnd-kit, columns by status)".
Но таблицы `sprints` и `sprint_items` в схеме нет вообще. Sprint board без спринтов -- это просто
Kanban по статусам. Это другое.

Надо решить: это Kanban (по статусам, без итераций) или Sprint-based (итерации с датами)?
Если Sprint-based -- нужна таблица. Если Kanban -- убрать слово "sprint" из UI-описания.

### 6. Двойной учёт реального времени

`tasks.actual_hours` + таблица `time_entries` -- это конфликт. Если тред логов в `time_entries`,
зачем `actual_hours` в `tasks`? Два источника истины для одного числа -- это баг в ожидании.

Варианты:
- **Убрать `tasks.actual_hours`**, считать через `SUM(time_entries.hours) WHERE task_id = ?`
- **Убрать `time_entries`**, оставить только `actual_hours` (нет истории, нет аудита -- плохо)

Рекомендация: убираем `tasks.actual_hours`, считаем всегда из `time_entries`. sqlc + view или
вычисляемое поле. История важнее.

### 7. Нет явного контроля доступа к проектам

Роль -- системная (admin/maintainer/developer/...). Но кто видит какие проекты?
Сейчас любой `developer` видит все проекты в системе. Это нормально для маленькой команды,
но архитектурно странно.

Минимальное решение: `project_id` в `team_members` через `projects.team_id` -- то есть ты видишь
проект если состоишь в команде проекта. Но что если один человек в двух командах? Что если
проект без команды?

Надо зафиксировать правило: кто видит проект, который достаточно для v1.

### 8. `epics` без временных границ

Эпик описан как "горизонт", но нет `start_date`/`end_date`. Timeline view (Phase 8) должен
показывать эпики -- как, если у них нет дат? Без дат эпик на таймлайне -- это точка в бесконечности.

Добавить опциональные `target_date DATE` или пару `start_date / target_date`. Не обязательные,
но нужны для отображения на timeline.

### 9. `DELETE` для архивации проекта -- семантически неверно

```
DELETE /api/v1/projects/{id}  -- archive [admin/maintainer]
```

DELETE должен удалять, а не архивировать. Это нарушение REST-семантики и источник путаницы.

Правильно:
```
PATCH /api/v1/projects/{id}
{ "status": "archived" }
```

DELETE -- только если реально удаляем (и это отдельный разговор с confirmation).

### 10. Нет CORS, нет rate limiting -- это не опции

React на `localhost:5173`, API на `localhost:8080` -- первый же запрос упадёт с CORS error.
CORS middleware должен быть в Phase 0, не "потом".

Rate limiting на `/auth/login` и `/auth/refresh` -- это базовая защита от brute force. Без него
любой может перебирать пароли. Нужен с первого auth endpoint.

Оба -- chi middleware, добавляются в 2 строки. Нет причин откладывать.

### 11. `comments` не учтены в плане реализации

Таблица есть, API есть, а в плане фаз -- нет. Между Phase 4 и Phase 5 нужна Phase 4.5 или
включить в Phase 4: CRUD comments для всех элементов.

### 12. `handler/comments.go` отсутствует в структуре проекта

В `internal/api/handler/` нет `comments.go`. Если забыть добавить -- при `go build` сразу
станет понятно, но лучше зафиксировать сейчас.

---

## ЗАМЕЧАНИЯ -- Мелкие, но неприятные

### 13. `tasks.priority` -- нет его в схеме, но в backlog есть

В `backlog_items` есть `priority SMALLINT`. В `tasks` нет. Задачи внутри беклог-айтема не
упорядочены? Для drag-and-drop внутри задач нужен порядок.

### 14. `priority SMALLINT` -- плохо для drag-and-drop

При перетаскивании нужно обновлять `priority` у всех затронутых элементов (renumbering).
При SMALLINT это N UPDATE запросов при каждом перемещении.

Лучше: `priority FLOAT8` (double). Вставка между двумя элементами = среднее значение.
Renumber только когда значения сходятся слишком близко (редко). Это "Jira trick".

### 15. `member_skills` нет `created_at`

Все таблицы имеют `created_at`, `member_skills` -- нет (только `updated_at`). Когда человек
получил навык -- неизвестно. Для статистики роста это важно.

### 16. `time_entries` нет `updated_at` -- намеренно?

Если time entries нельзя редактировать (audit trail) -- это правило надо зафиксировать
в "Правилах разработки". Если можно -- нужен `updated_at`.

### 17. Нет `Dockerfile` в структуре проекта

`docker-compose.yml` содержит `build: .`, но Dockerfile не описан и не упомянут.
Phase 0 без Dockerfile не даст рабочий `docker compose up`.

### 18. Adminer есть в тексте, нет в compose

"adminer -- наш друг" в Phase 1, но в `docker-compose.yml` его нет. Добавить:
```yaml
  adminer:
    image: adminer:latest
    ports:
      - "8081:8080"
    depends_on:
      - postgres
```

### 19. GET comments -- нет структуры ответа для тредов

Комментарии с `parent_id` -- как возвращаем? Flat список (клиент строит дерево)?
Вложенный JSON (`replies: [...]`)? Это влияет на sqlc queries и на API контракт.
Надо зафиксировать до реализации.

### 20. `PUT /api/v1/users/{id}/skills` -- PUT среди PATCH

Весь API использует PATCH. Только для skills используется PUT. Это осознанное решение
(полная замена профиля компетенций), но надо явно документировать почему.

### 21. `SEED_ADMIN_PASSWORD=changeme` -- нужна защита в production

В `config.go` при `APP_ENV=production` должна быть проверка: если пароль "changeme" -- отказываем
в запуске с явным сообщением. Иначе кто-нибудь задеплоит в prod с дефолтным паролем.

---

## Что хорошо (чтобы не казалось, что всё плохо)

- Независимые измерения для `backlog_items` (epic/release/stage) -- правильное решение,
  держать
- Nullable FK паттерн для `comments` -- консистентно и понятно, нужно только добавить CHECK
- JWT с rotation -- правильная архитектура (как только добавим таблицу)
- sqlc + golang-migrate -- правильный выбор, не менять
- Структура `internal/domain/` отдельно от HTTP и SQL -- хорошая архитектура
- API response format `{ data, meta, error }` -- держать, не менять
- Soft delete для comments -- правильно

---

## Что делать перед Phase 0

Обязательно до первой строки кода:

1. Зафиксировать порядок CREATE TABLE в миграции (п.1)
2. Добавить `refresh_tokens` в схему (п.2)
3. Исправить `comments.body` на nullable (п.3)
4. Добавить CHECK constraint в `comments` (п.4)
5. Решить вопрос Sprint vs Kanban (п.5)
6. Убрать `tasks.actual_hours` (п.6)
7. Зафиксировать правило видимости проектов (п.7)
8. Добавить CORS и rate limiting в Phase 0 (п.10)

Остальное можно взять в работу по ходу, не блокирует старт.
