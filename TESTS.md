# V.42 -- Test Documentation

> "Тест без 'почему' -- это просто шум. Тест с 'почему' -- это спецификация."

Этот документ -- зеркало DESIGN.md. Развиваются вместе: иногда сначала тест (ATDD),
иногда сначала дизайн. Когда расходятся -- значит, что-то изменилось и надо синхронизировать.

---

## Стратегия тестирования

| Уровень | Тег | Запуск | Цель |
|---------|-----|--------|------|
| Unit | (без тега) | `make test` | Логика без внешних зависимостей |
| Integration | `//go:build integration` | `make test-integration` | Реальная БД, реальные constraints |
| E2E | (Phase 3+) | TBD | Полный стек через HTTP |

**Принцип**: integration-тесты живут рядом с кодом, который тестируют (`internal/db/`),
а не в отдельной папке. Тест ближе к коду -- меньше расстояние между "сломалось" и "вот почему".

**Race detector**: `-race` везде, включая integration. CGO доступен (native Go в WSL).
Если тест падает только с `-race` -- это не flake, это баг.

---

## Тест-инфраструктура

### `internal/testutil/db.go`

**Что**: хелпер `testutil.NewDB(t)` открывает pgxpool к тестовой БД, регистрирует `t.Cleanup`.

**Как**: читает `TEST_DB_DSN` из env (default: `localhost:5433/v42_test`). Фейлит тест
с человеческим сообщением если БД недоступна ("run: make test-db-up").

**Почему**: каждый тест получает живое соединение без boilerplate. `t.Cleanup` закрывает
пул автоматически -- нет утечек между тестами. Диагностика встроена в ошибку,
не надо гадать почему тест упал на CI.

---

## Категория: Миграции

### `TestMigrationsApply` -- `internal/db/migrate_test.go`

**Принцип**: smoke test схемы. Запускается после `make test-migrate-up`.

**Что**: проверяет что все 21 таблица из `000002_schema.up.sql` существуют в `public` schema.
Каждая таблица -- отдельный subtest.

**Как**: `information_schema.tables WHERE table_name = $1`. Простейший запрос, ноль логики.

**Почему**: миграция могла примениться частично (упала на середине), или кто-то
переименовал таблицу и забыл обновить список. Явный список таблиц в тесте -- это контракт.
Добавил таблицу в схему -- добавь в тест. Намеренно шумный.

**Когда ломается**: при добавлении/переименовании таблицы, при неприменённой миграции.

---

## Категория: Ограничения схемы (DB Constraints)

Эти тесты проверяют бизнес-инварианты закреплённые в БД. Инварианты в БД -- последняя линия
обороны: приложение может глючить, но БД не даст сохранить мусор.

### `TestConstraints_SprintTestResults` -- `internal/db/migrate_test.go`

**Принцип**: exactly-one constraint. Строка `sprint_test_results` привязана либо к тесту,
либо к backlog item -- никогда к обоим, никогда ни к кому.

**Что**: два случая нарушения: (1) оба id заданы, (2) ни один не задан.

**Как**: прямой `INSERT` в обход приложения. Ожидаем ошибку от postgres.
Если ошибки нет -- тест фейлит с объяснением.

**Почему**: это ATDD-инвариант. `sprint_test_results` -- точка где тест (техническая
сущность) встречается с backlog item (бизнес-сущность). Путаница здесь ломает
весь отчёт о прохождении критериев приёмки. CHECK constraint в БД дешевле
чем валидация в 10 местах приложения.

**Когда ломается**: если constraint убрали из миграции или изменили логику колонок.

---

### `TestConstraints_NoSelfDependency` -- `internal/db/migrate_test.go`

**Принцип**: граф зависимостей не может содержать петлю длиной 1.

**Что**: тест не может зависеть от самого себя (`test_id = depends_on_id`).

**Как**: `INSERT INTO test_dependencies` с одинаковым UUID в обоих полях.

**Почему**: самозависимость -- вырожденный цикл. Если разрешить, алгоритм обхода
зависимостей (топологическая сортировка для порядка выполнения тестов) зависнет
или даст бессмысленный результат. Дешевле запретить в БД чем ловить в рантайме.

**Когда ломается**: если constraint `no_self_dependency` убрали из миграции.

> **Не покрыто**: циклы длиной 2+ (A → B → A). Это задача для уровня приложения
> (Phase 5). БД не может проверить транзитивные циклы без рекурсивных триггеров --
> слишком дорого.

---

### `TestConstraints_CommentsExactlyOneParent` -- `internal/db/migrate_test.go`

**Принцип**: комментарий всегда принадлежит ровно одной сущности.

**Что**: `INSERT` комментария без единого parent_id должен упасть.

**Как**: прямой `INSERT` с заполненными только `body` и `author_id`.

**Почему**: `comments` -- полиморфная таблица (backlog_item, task, epic, sprint).
Без constraint можно создать "сироту" -- комментарий ни к чему. В UI такой
комментарий невозможно отобразить и невозможно удалить через нормальный флоу.
Лучше запретить на уровне БД.

**Не покрыто**: случай когда заданы два parent_id одновременно (тоже нарушение).
Нужен второй subtest -- **TODO** (Phase 3).

---

## Категория: Конфигурация (Phase 0 -- TODO)

### `TestConfig_MissingRequired` (planned)

**Принцип**: приложение должно падать при старте с понятной ошибкой, а не в рантайме
через 5 минут когда первый запрос дойдёт до БД.

**Что**: `config.Load()` вызывается с пустым env. Ожидаем ошибку содержащую
все отсутствующие переменные сразу (не по одной).

**Как**: `t.Setenv` убирает required vars, вызываем `config.Load()`, проверяем
что error содержит имена всех отсутствующих переменных.

**Почему**: текущая реализация уже собирает все ошибки перед возвратом (не fail-fast).
Тест фиксирует это поведение как контракт -- нельзя случайно сломать на "первую ошибку".

---

### `TestConfig_ProductionGuards` (planned)

**Принцип**: дев-значения не должны проходить в production.

**Что**: `APP_ENV=production` + слабый `JWT_SECRET` (< 32 символов) → ошибка.
`APP_ENV=production` + `LOG_LEVEL=debug` → ошибка.

**Как**: unit test, нет реальных зависимостей.

**Почему**: production guard -- последний барьер перед деплоем с дев-конфигом.
Секрет "changeme" в production -- это CVE ждущий своего часа.

---

## Категория: Auth (Phase 2 -- DONE)

Все тесты в `internal/api/auth_test.go`. Тег `//go:build integration`.
Инфраструктура: `testutil.NewDB(t)`, `newTestEnv(t)`, `seedUser(t, email, pw, role)`,
`simpleCookieJar`, `postWithCookie`, `mustJSON`.

---

### `TestAuth_Login_Success` -- ✓ DONE

**Что**: `POST /api/v1/auth/login` с валидными credentials возвращает 200,
`access_token` в теле и httpOnly `refresh_token` cookie.

**Почему**: happy path -- основной контракт эндпоинта.

---

### `TestAuth_Login_WrongPassword` -- ✓ DONE

**Что**: неверный пароль → 401 `INVALID_CREDENTIALS`.

**Почему**: нет разницы в ответе между "нет юзера" и "неверный пароль" (timing + enum attack protection).

---

### `TestAuth_Login_UnknownUser` -- ✓ DONE

**Что**: несуществующий email → 401 `INVALID_CREDENTIALS` (=тот же текст что и wrong password).

**Почему**: dummy bcrypt выравнивает время ответа между "нашёл" и "не нашёл" -- user enumeration via timing невозможен.

---

### `TestAuth_Login_EmailNormalization` -- ✓ DONE (regression)

**Что**: `USER@TEST.LOCAL` должен матчить пользователя `user@test.local`.

**Почему**: баг -- email был case-sensitive до добавления `strings.ToLower`.

---

### `TestAuth_Login_BodyTooLarge` -- ✓ DONE (regression)

**Что**: 5 KB JSON-тело на `/auth/login` → 400 `BAD_REQUEST`.

**Почему**: `http.MaxBytesReader(4096)` не даёт DoS через забитые тела запросов.

---

### `TestAuth_Login_InactiveUser` -- ✓ DONE (regression)

**Что**: `is_active = false` → 403 `ACCOUNT_INACTIVE`, даже с верным паролем.

**Как**: `UPDATE users SET is_active = false` в тест-БД, затем login.

**Почему**: проверяет что `ErrUserInactive` пробрасывается в HTTP-ответ с правильным кодом.

---

### `TestAuth_Refresh_TokenRotation` -- ✓ DONE

**Что**: `POST /auth/refresh` возвращает новый access token + ротирует cookie.

**Почему**: rotation -- основа защиты: каждый refresh уникален, украденный старый -- бесполезен.

---

### `TestAuth_TokenReuse_OldTokenRevoked` -- ✓ DONE (regression)

**Что**: после ротации, старый refresh token → 401 `TOKEN_REVOKED`.

**Как**: login без jar, сохраняем cookie, refresh, повторный refresh со старым cookie (`postWithCookie`).

**Почему**: reuse detection -- человек с украденным токеном видит  401; все сессии нуляются.

---

### `TestAuth_Me_WithValidToken` -- ✓ DONE

**Что**: `GET /auth/me` с валидным Bearer токеном → 200, профиль юзера с правильными snake_case полями.

**Почему**: JWT middleware декодирует, subject извлекается, пользователь грузится из БД.

---

### `TestAuth_Me_NoToken` -- ✓ DONE

**Что**: `GET /auth/me` без Authorization → 401.

**Почему**: JWTAuth middleware должен останавливать цепочку до handler.

---

### `TestAuth_Me_ExpiredToken` -- ✓ DONE

**Что**: просроченный access token → 401.

**Как**: `auth.GenerateAccessToken(..., -time.Second)` -- token с `exp` в прошлом.

**Почему**: expired != invalid -- middleware обрабатывает оба как 401, но клиент может попытаться refresh.

---

### `TestAuth_Logout` -- ✓ DONE

**Что**: `POST /auth/logout` → 204; последующий refresh → 401.

**Почему**: logout должен реально что-то делать. Проверяем что токен помечен в БД, а не просто 200.

---

### `TestAuth_ErrorEnvelope_HasDataAndMeta` -- ✓ DONE (regression)

**Что**: 401-ответ middleware содержит `data`, `meta`, `error` поля (API-контракт).

**Почему**: баг -- `http.Error()` в middleware давал только `error`, без `data` и `meta`.
Клиент должен получить полный энвелоп независимо от ошибки.

---

### `TestAuth_ErrorResponse_ContentTypeIsJSON` -- ✓ DONE (regression)

**Что**: ошибочные ответы имеют `Content-Type: application/json`, не `text/plain`.

**Как**: два субтеста: missing bearer + invalid token.

**Почему**: `http.Error()` выставляет `Content-Type: text/plain; charset=utf-8` -- независимо от тела.
Клиенты проверяющие Content-Type перед decode разваливались.

---

### `TestAuth_Login_RateLimit` (planned → ✓ DONE частично)

**Что**: 11 запросов от одного IP → 11-й возвращает 429.

**Статус**: тест есть в составе `TestAuth_RateLimit_XForwardedFor_CannotBypass` (исчерпывает burst и проверяет 429).
Прямой тест с порогом "ровно 10" -- TODO, добавить отдельным тестом.

---

### `TestAuth_RateLimit_XForwardedFor_CannotBypass` -- ✓ DONE (regression)

**Что**: `X-Forwarded-For: 1.2.3.4` не обходит rate limiter -- 11-й запрос со спуффенным IP → 429.

**Почему**: баг -- `chiware.RealIP` запускался ДО rate limiter и перезаписывал `r.RemoteAddr`;
атакующий мог выглядеть как разные IP с каждым запросом. `chiware.RealIP` убран из global middleware.

---

## Оценка покрытия Phase 2

| Модуль | Покрыто | Пробелы |
|--------|---------|--------|
| `handler_auth.go`: Login (happy path, wrong pw, unknown user, email norm, body limit, inactive) | ✓ 6/6 путей | - |
| `handler_auth.go`: Refresh (rotation, reuse) | ✓ 2/2 | Expired token через handler (TODO) |
| `handler_auth.go`: Logout (revokes token) | ✓ 1/1 | Logout без cookie (idemпотентно, TODO) |
| `handler_auth.go`: Me (valid, no token, expired) | ✓ 3/3 | - |
| `middleware/auth.go`: JWTAuth | ✓ покрыт через Me-тесты | - |
| `middleware/roles.go`: RequireRole | ✗ нет защищённых маршрутов | Phase 3 |
| `middleware/ratelimit.go` | ✓ + bypass test | Порог "ровно 10" (TODO) |
| `domain/auth.go`: Login, Refresh, Logout | ✓ через handler-тесты | ErrTokenReuse RevokeAll effect |
| `db/store/auth.go` | ✓ через integration | - |
| `config.go`: production guards | ✗ unit-тестов нет | Phase 3 cleanup |
| `db.go`: Connect | ✗ трудно тестировать без реальной БД | - |

**Итог**: ~85% путей Phase 2 покрыто тестами. Основные пробелы закрываются в Phase 3.

---

## Категория: Users / Skills / Teams (Phase 3 -- DONE)

Все тесты в `internal/api/users_skills_teams_test.go`. Тег `//go:build integration`.
Инфраструктура: `testEnv` из `auth_test.go` + Phase 3 helpers:
`loginToken`, `postAuth`, `patchAuth`, `putAuth`, `deleteAuth`, `userID`.

**Итого Phase 3 + регрессии**: 38 тестов, все green (53 суммарно по проекту).

---

### `TestUsers_List_AsAdmin` -- ✓ DONE

**Что**: `GET /api/v1/users` admin-токеном возвращает всех юзеров включая inactive.

**Почему**: admin видит полный список, non-admin -- только активных (фильтр в store).

---

### `TestUsers_List_AsDeveloper_HidesInactive` -- ✓ DONE

**Что**: developer-токен → GET /users возвращает только active=true юзеров.

**Почему**: inactive пользователи не должны "светиться" в листингах для коллег.

---

### `TestUsers_Get_Success` -- ✓ DONE

**Что**: `GET /api/v1/users/{id}` возвращает конкретного пользователя по UUID.

**Почему**: базовый контракт эндпоинта.

---

### `TestUsers_Get_NotFound` -- ✓ DONE

**Что**: валидный UUID которого нет в БД → 404.

**Почему**: UUID-формат не гарантирует существование записи.

---

### `TestUsers_Update_OwnProfile` -- ✓ DONE

**Что**: пользователь меняет свой `display_name` → 200, новое имя в ответе.

**Почему**: каждый может менять себя; не может менять других (тест ниже).

---

### `TestUsers_Update_RoleByAdmin` -- ✓ DONE

**Что**: admin меняет роль другого пользователя → 200.

**Почему**: role management -- только admin.

---

### `TestUsers_Update_RoleByNonAdmin_Forbidden` -- ✓ DONE

**Что**: developer пытается сменить роль → 403.

**Почему**: `RequireRole`/handler guard.

---

### `TestUsers_Update_OtherUser_Forbidden` -- ✓ DONE

**Что**: developer пытается PATCH чужого profile → 403.

**Почему**: isAdmin || isSelf guard в handler.

---

### `TestSkills_List` -- ✓ DONE

**Что**: `GET /api/v1/skills` возвращает список skills из seed (`migration 000004`).

**Почему**: skills -- read-only каталог для всех аутентифицированных.

---

### `TestSkills_Create_AsAdmin` -- ✓ DONE

**Что**: admin создаёт новый skill → 201, skill в ответе.

**Почему**: добавление skills в каталог -- admin-only операция.

---

### `TestSkills_Create_AsDeveloper_Forbidden` -- ✓ DONE

**Что**: developer пытается создать skill → 403.

**Почему**: RequireRole(admin) на `POST /skills`.

---

### `TestSkills_Create_Duplicate_Conflict` -- ✓ DONE

**Что**: admin создаёт skill с именем которое уже есть → 409 `CONFLICT`.

**Почему**: `unique` constraint в БД; store переводит `23505` в `domain.ErrConflict`; handler → 409.

---

### `TestMemberSkills_UpsertAndList` -- ✓ DONE

**Что**: PUT skill уровня + GET /users/{id}/skills → список содержит upsert-нутый skill.

**Почему**: upsert (INSERT ON CONFLICT DO UPDATE) -- основной паттерн для member_skills.

---

### `TestMemberSkills_OtherUser_Forbidden` -- ✓ DONE

**Что**: developer пытается PUT/DELETE skill другого пользователя → 403.

**Почему**: member_skills привязаны к конкретному user; только сам пользователь (или admin) управляет.

---

### `TestTeams_CreateAndList` -- ✓ DONE

**Что**: admin создаёт team, `GET /api/v1/teams` возвращает её в списке.

**Почему**: happy path для teams CRUD.

---

### `TestTeams_Create_AsDeveloper_Forbidden` -- ✓ DONE

**Что**: developer пытается POST team → 403.

**Почему**: RequireRole(admin, maintainer) на POST /teams.

---

### `TestTeams_GetWithMembers` -- ✓ DONE

**Что**: `GET /api/v1/teams/{id}` возвращает team + members array.

**Как**: создаём team, добавляем member, GET, проверяем `members[0].email`.

**Почему**: teams всегда возвращаются с members (единый эндпоинт).

---

### `TestTeams_Update` -- ✓ DONE

**Что**: PATCH team name → 200, новое имя в ответе.

**Почему**: merge-update: неуказанные поля остаются прежними.

---

### `TestTeams_Delete_AsAdmin` -- ✓ DONE

**Что**: admin удаляет team → 204.

**Почему**: Delete возвращает 204 даже если team уже нет (idempotent).

---

### `TestTeams_Delete_AsMaintainer_Forbidden` -- ✓ DONE

**Что**: maintainer пытается DELETE team → 403.

**Почему**: DELETE /teams/{id} ограничен только admin.

---

### `TestRequireRole_Integration` -- ✓ DONE

**Что**: `POST /api/v1/teams` без RequireRole роли → 403.

**Почему**: явный тест middleware цепочки: JWTAuth → RequireRole → handler.

---

## Round 1 -- Regression Tests (Phase 3, pass 1)

Баги найдены в ходе code review после создания Phase 3.

---

### `TestUsers_Get_MalformedUUID_Returns404` -- ✓ DONE (regression R1-1)

**Что**: `GET /api/v1/users/not-a-uuid` → 404.

**Почему**: `parseUUID` в store возвращал `fmt.Errorf` которое уходило в 500.
Теперь parseUUID failure → `domain.ErrNotFound` во всех store-методах.

---

### `TestSkills_Create_MalformedUUID_MemberSkill_Returns404` -- ✓ DONE (regression R1-2)

**Что**: `PUT /api/v1/users/{id}/skills/not-a-uuid` → 404.

**Почему**: аналогично -- parseUUID в SkillStore.UpsertMemberSkill давал 500.

---

### `TestTeams_AddMember_InvalidCapacity` -- ✓ DONE (regression R1-3)

**Что**: `capacity_hours: -1` и `capacity_hours: 169` → 400.

**Почему**: поле не валидировалось; -1 уходил в БД (int валиден), 169 > рабочей недели.
Теперь проверка `0 <= capacity_hours <= 168`.

---

### `TestTeams_AddMember_ReturnsFullUserDetails` -- ✓ DONE (regression R1-4)

**Что**: `POST /teams/{id}/members/{user_id}` возвращает `email`, `display_name` в member-объекте.

**Почему**: AddMember в store возвращал только `{user_id, capacity_hours, joined_at}`.
Теперь после INSERT делается GET user для полного member-объекта.

---

### `TestMemberSkills_UpsertNonexistentSkill_Returns404` -- ✓ DONE (regression R1-5)

**Что**: upsert skill с валидным UUID которого нет в БД → 404.

**Почему**: FK constraint 23503 в БД переводился в `domain.ErrNotFound` в store,
но handler проверял `strings.Contains(err.Error(), "foreign key")` -- хрупко.
Теперь `errors.Is(err, domain.ErrNotFound)` → 404.

---

## Round 2 -- Regression Tests (Phase 3, pass 2)

Баги найдены в ходе второго code review.

---

### `TestUsers_Update_AdminSelfRoleChange_Forbidden` -- ✓ DONE (regression R2-1)

**Что**: admin PATCH своей собственной роли → 403.

**Почему**: без guard admin мог сделать себя observer и потерять доступ навсегда.
Теперь `isAdmin && isSelf && req.Role != nil && *req.Role != claims.Role` → 403.

**Контракт**: смену роли admin-а должен делать другой admin.

---

### `TestUsers_Update_AdminChangesOtherRole_OK` -- ✓ DONE (regression R2-1, contra-test)

**Что**: admin меняет роль другого пользователя → 200 (guard не срабатывает).

**Почему**: проверяем что guard `isSelf` не перекрывает admin-права над другими.

---

### `TestUsers_Update_DisplayName_TooLong` -- ✓ DONE (regression R2-2)

**Что**: `display_name` длиной 201 символ → 400.

**Почему**: поле TEXT в БД принимает любую длину; клиент может передать мегабайтное имя.
Ограничение 200 символов соответствует DESIGN.md.

---

### `TestSkills_Create_NameTooLong` -- ✓ DONE (regression R2-2)

**Что**: skill `name` длиной 101 символ → 400.

**Почему**: skill name -- краткий идентификатор; 100 символов более чем достаточно.

---

### `TestTeams_Create_NameTooLong` -- ✓ DONE (regression R2-2)

**Что**: team `name` длиной 201 символ → 400.

**Почему**: TEXT без ограничений → DoS через длинное имя или garbage в UI.

---

### `TestTeams_Update_NameTooLong` -- ✓ DONE (regression R2-2)

**Что**: PATCH team name длиной 201 символ → 400.

**Почему**: валидация должна работать и при обновлении, не только при создании.

---

## Round 3 -- Crazy Monkey Tests (Phase 3, pass 3)

Бешенная обезьяна: ломимся в закрытые и открытые окна, двери и просто в стены.
Новые баги + тесты на каждый угол атаки.

**Новые баги найдены и зафиксированы:**
1. **R3-1**: `Delete`, `RemoveMember`, `DeleteSkill` не проверяли `domain.ErrNotFound` → малформированный UUID давал 500
2. **R3-2**: Null byte (`\u0000`) в любом текстовом поле → PostgreSQL hard error → 500
3. **R3-3**: Admin мог деактивировать собственный аккаунт (`is_active: false`) → тот же риск локаута что и с ролью
4. **R3-4**: `avatar_url` без ограничения длины → потенциальный хранение мусора в БД
5. **R3-5**: Role string не тримился → `" admin "` давал 400 вместо 200

**Итого после Round 3**: 76 тестов, все green.

---

### `TestTeams_Delete_MalformedUUID_Returns404` -- ✓ DONE (regression R3-1a)

**Что**: `DELETE /api/v1/teams/not-a-uuid` → 404.

**Почему**: `store.Delete` возвращал `domain.ErrNotFound` при parseUUID failure,
но Delete handler не проверял ErrNotFound → 500. Аналогично `Update` handler,
который был исправлен ещё в Round 1. Delete-пути всегда нужна та же проверка.

---

### `TestTeams_RemoveMember_MalformedUUID_Returns404` -- ✓ DONE (regression R3-1b)

**Что**: `DELETE /teams/{id}/members/not-a-uuid` → 404.

**Почему**: тот же паттерн — store возвращает ErrNotFound, handler давал 500.

---

### `TestUsers_DeleteSkill_MalformedSkillUUID_Returns404` -- ✓ DONE (regression R3-1c)

**Что**: `DELETE /users/{id}/skills/not-a-uuid` → 404.

**Почему**: тот же паттерн.

---

### `TestTeams_Delete_NonExistent_Idempotent` -- ✓ DONE

**Что**: DELETE валидного UUID которого нет в БД → 204 (идемпотентно).

**Почему**: SQL `DELETE WHERE id = $1` тихо не находит запись и возвращает nil.
Это корректное поведение (RFC 9110: DELETE идемпотентен). Отличие от malformed UUID:
malformed → parseUUID error → 404; valid but absent → DB deletes 0 rows → 204.

---

### `TestSkills_Create_NullByte_Returns400` -- ✓ DONE (regression R3-2a)

**Что**: `POST /skills` с `"name": "go\u0000lang"` → 400.

**Почему**: PostgreSQL отклоняет строки содержащие null byte (0x00) с ошибкой
"invalid byte sequence for encoding". Go's json.Decoder декодирует `\u0000` как
настоящий null byte в строке. Без guard → любое текстовое поле с null byte → 500.
`strings.ContainsRune(s, 0)` добавлен во все точки валидации текста.

---

### `TestTeams_Create_NullByte_Returns400` -- ✓ DONE (regression R3-2b)

**Что**: team name с null byte → 400.

**Почему**: аналогично R3-2a.

---

### `TestUsers_Update_NullByteInDisplayName_Returns400` -- ✓ DONE (regression R3-2c)

**Что**: display_name с null byte → 400.

**Почему**: аналогично R3-2a.

---

### `TestUsers_Update_AdminSelfDeactivate_Forbidden` -- ✓ DONE (regression R3-3)

**Что**: admin `PATCH /users/{own-id}` с `{"is_active": false}` → 403.

**Почему**: такой же риск локаута как и self-demotion (R2-1). Если admin единственный
и деактивирует себя — система теряет все admin-привилегии. Guard: `isAdmin && isSelf && !*req.IsActive`.

**Контракт**: деактивацию admin-а должен делать другой admin.

---

### `TestUsers_Update_AdminDeactivatesOther_OK` -- ✓ DONE (contra-test R3-3)

**Что**: admin деактивирует другого пользователя → 200.

**Почему**: guard `isSelf` не должен перекрывать admin-права над другими аккаунтами.

---

### `TestUsers_Update_AvatarURL_TooLong_Returns400` -- ✓ DONE (regression R3-4)

**Что**: `avatar_url` длиной >2048 символов → 400.

**Почему**: без ограничения — клиент может залить мегабайт в TEXT поле.
Ограничение 2048 соответствует максимальной длине URL в большинстве браузеров.

---

### `TestUsers_Update_Role_TrimmedWhitespace_OK` -- ✓ DONE (regression R3-5)

**Что**: `{"role": " tester "}` (пробелы вокруг) → 200, роль успешно обновлена.

**Почему**: поле role не тримировалось — `" tester "` давал 400 INVALID_ROLE.
Все строки через trim до валидации — единый стиль API.

---

### `TestUsers_Update_Role_Invalid_Returns400` -- ✓ DONE

**Что**: `"ADMIN"`, `"superuser"`, `""`, `"god"` → 400.

**Почему**: validRoles — whitelist; любое не-совпадение = 400. Case-sensitive после trim.
Подтверждает что нормализация (trim) не маскирует невалидные роли.

---

### `TestTeams_AddMember_CapacityWrongType_Returns400` -- ✓ DONE

**Что**: `{"capacity_hours": "forty"}` (строка вместо int16) → 400.

**Почему**: Go json.Decoder возвращает ошибку при несовместимых типах.
Тест фиксирует что handler не допускает тихое преобразование и возвращает 400, не 500.

---

### `TestUsers_Update_IsActive_WrongType_Returns400` -- ✓ DONE

**Что**: `{"is_active": "yes"}` (строка вместо bool) → 400.

**Почему**: аналогично — тип не совпадает → json.Decode ошибка → 400 INVALID_JSON.

---

### `TestSkills_Create_ArrayBody_Returns400` -- ✓ DONE

**Что**: JSON array `[{"name":"Go"}]` вместо объекта → 400.

**Почему**: json.Decoder не может распаковать массив в struct → ошибка → 400.
Проверяет что API не принимает произвольный JSON shape.

---

### `TestUsers_Update_EmptyPatch_NoOp` -- ✓ DONE

**Что**: `PATCH /users/{id}` с `{}` → 200, данные пользователя не изменились.

**Почему**: PATCH семантика — нет изменений = no-op. Handler делает GetByID + Update
с теми же значениями. Регрессия: если что-то сломает merge-логику, этот тест поймает.

---

### `TestTeams_Create_MissingName_Returns400` -- ✓ DONE

**Что**: `POST /teams` без поля `name` → 400.

**Почему**: `name` — required. Подтверждает что zero-value string `""` тоже не проходит.

---

### `TestTeams_AddMember_MissingUserID_Returns400` -- ✓ DONE

**Что**: `POST /teams/{id}/members` с `{}` → 400.

**Почему**: user_id — required. TrimSpace("") == "" → 400.

---

### `TestTeams_AddMember_MalformedUserID_Returns400` -- ✓ DONE

**Что**: `user_id: "not-a-uuid"` в теле → 400 (team or user not found).

**Почему**: parseUUID в store возвращает ErrNotFound → handler → 400.
Malformed user_id это плохой ввод, не "не нашли". 400 корректнее чем 404.

---

### `TestUsers_UpsertSkill_EmptyLevel_Returns400` -- ✓ DONE

**Что**: `PUT /users/{id}/skills/{skill_id}` с `level: ""` → 400 INVALID_LEVEL.

**Почему**: `validLevels[""]` == false → 400. Подтверждает что пустая строка не проходит whitelist.

---

### `TestUsers_UpsertSkill_InvalidInterest_Returns400` -- ✓ DONE

**Что**: `interest: "VERY_HIGH"` → 400 INVALID_INTEREST.

**Почему**: validInterests whitelist строгий. Аналогично role — case-sensitive.

---

### `TestTeams_AddMember_ReAdd_UpdatesCapacity` -- ✓ DONE

**Что**: добавить одного пользователя в команду дважды с разными `capacity_hours` → 200 оба раза.

**Как**: первый `capacity_hours=20`, второй `capacity_hours=40`. Проверяем что второй ответ содержит `40`.

**Почему**: SQL — `INSERT ON CONFLICT DO UPDATE SET capacity_hours = EXCLUDED.capacity_hours`.
UPSERT семантика: повторное добавление обновляет мощность, не дублирует запись.
Документирует что это намеренно, а не баг.

---

### `TestUsers_ListSkills_NonexistentUser_Returns404` -- ✓ DONE

**Что**: `GET /users/00000000-0000-0000-0000-000000000001/skills` → 404.

**Почему**: handler сначала проверяет существование пользователя через GetByID.
Если пользователя нет — 404, не пустой массив. Пустой массив был бы тихим обманом.

---

### `TestTeams_AddMember_CapacityBoundaries_Valid` -- ✓ DONE

**Что**: `capacity_hours=0` и `capacity_hours=168` → 200 (граничные значения валидны).

**Почему**: boundary testing. 0 = человек в команде без выделенного времени (ок).
168 = все часы недели (максимум). 167 и 1 проверяются косвенно через остальные тесты.

---

### `TestTeams_Get_MalformedUUID_Returns404` -- ✓ DONE

**Что**: `GET /teams/not-a-uuid` → 404.

**Почему**: GET-путь через GetWithMembers с parseUUID уже возвращал ErrNotFound → 404.
Тест явно фиксирует это поведение.

---

### `TestSkills_Create_Unicode_OK` -- ✓ DONE

**Что**: `POST /skills` с именем `"Алгоритмы и структуры"` (кириллица) → 201.

**Почему**: Unicode в именах должен работать. PostgreSQL TEXT полностью поддерживает UTF-8.
Проверяем что null byte guard не ломает легитимные многобайтные символы.

---

### `TestTeams_Create_WhitespaceOnlyName_Returns400` -- ✓ DONE

**Что**: `{"name": "   \t\n  "}` → 400.

**Почему**: TrimSpace убирает все whitespace символы, оставляет пустую строку → 400.
Проверяем что `\t` и `\n` тоже убираются, не только пробелы.

---

## Обновление покрытия Phase 3

| Модуль | Покрыто | Пробелы |
|--------|---------|--------|
| `handler_users.go`: List (admin/non-admin) | ✓ | Pagination (Phase 4+) |
| `handler_users.go`: Get (found, not found, malformed UUID) | ✓ | - |
| `handler_users.go`: Update (self, admin, forbidden, self-role-guard, self-deactivate, length, null byte, avatar, role trim) | ✓ | - |
| `handler_skills.go`: List | ✓ | - |
| `handler_skills.go`: Create (admin, forbidden, conflict, length, null byte, array body, unicode) | ✓ | - |
| `handler_users.go`: UpsertSkill (upsert, forbidden, nonexistent, malformed UUID, empty level, invalid interest) | ✓ | - |
| `handler_users.go`: ListMemberSkills (found, nonexistent user) | ✓ | - |
| `handler_users.go`: DeleteSkill (own, malformed UUID → 404) | ✓ | Delete of non-member (idempotent, TODO) |
| `handler_teams.go`: Create (admin, forbidden, length, null byte, whitespace-only, missing name) | ✓ | - |
| `handler_teams.go`: List | ✓ | - |
| `handler_teams.go`: Get (found, not found, malformed UUID) | ✓ | - |
| `handler_teams.go`: Update (merge, not found, length, null byte) | ✓ | - |
| `handler_teams.go`: Delete (admin, forbidden, malformed UUID → 404, non-existent → 204) | ✓ | - |
| `handler_teams.go`: AddMember (full response, capacity, FK, UPSERT, wrong type, malformed IDs, boundaries) | ✓ | - |
| `handler_teams.go`: RemoveMember (malformed UUID → 404) | ✓ | Non-member remove (idempotent, TODO) |
| `middleware/roles.go`: RequireRole | ✓ | - |
| `store/skills.go`: GetByID ErrNoRows | ✓ | - |
| `store/teams.go`: Get() lightweight | ✓ | - |

---

## Категория: Projects / Epics / Backlog / Tasks / Sprints / Comments (Phase 4 -- DONE)

Все тесты в `internal/api/projects_backlog_test.go`. Тег `//go:build integration`.
Инфраструктура: `testEnv` из `auth_test.go` + Phase 4 helpers: `seedProject`, `seedEpic`,
`seedBacklogItem`, `seedTask`, `seedSprint`, `extractID`.
Seed-функции делают прямой INSERT в БД и регистрируют `t.Cleanup` в LIFO-порядке
(дочерние записи удаляются до родительских — нет FK-нарушений при cleanup).

**Итого Phase 4 (Audit Pass 1 + Pass 2)**: 48 тестов, все green (138 суммарно по проекту).

---

### Audit Pass 1 — Projects (8 тестов)

---

### `TestProjects_Create_Success` -- ✓ DONE (BUG-01)

**Что**: `POST /api/v1/projects` admin-токеном возвращает 201 + id.

**Почему**: BUG-01 — ownerID hardcoded как `""` → parseUUID("") → 500. Тест фиксирует исправление.

---

### `TestProjects_Create_NoAuth` -- ✓ DONE

**Что**: запрос без Authorization → 401.

**Почему**: JWTAuth middleware должен останавливать цепочку до handler.

---

### `TestProjects_Create_RequiresRole` -- ✓ DONE

**Что**: developer-токен на `POST /projects` → 403.

**Почему**: создание проекта ограничено ролями admin/maintainer.

---

### `TestProjects_Create_EmptyName` -- ✓ DONE

**Что**: `{"name":""}` → 400.

**Почему**: handler валидирует `TrimSpace(name) == ""`.

---

### `TestProjects_Create_WhitespaceName` -- ✓ DONE

**Что**: `{"name":"   "}` → 400.

**Почему**: whitespace-only name без TrimSpace прошёл бы валидацию.

---

### `TestProjects_Create_NameTooLong` -- ✓ DONE

**Что**: name длиной 201 символ → 400.

**Почему**: ограничение 200 символов; PostgreSQL TEXT принимает любую длину без guard.

---

### `TestProjects_Get_Success` и `TestProjects_Get_NotFound` -- ✓ DONE

**Что**: GET существующего → 200 + JSON; GET нулевого UUID → 404.

**Почему**: базовый контракт эндпоинта и store.GetByID путь ErrNotFound.

---

### `TestProjects_Update_InvalidStatus` -- ✓ DONE (BUG-12)

**Что**: `PATCH /projects/{id}` с `{"status":"not_a_real_status"}` → 400.

**Почему**: BUG-12 — без `validProjectStatus` map любой статус уходил в БД → 22P02 → 500.

---

### `TestProjects_Delete_NotFound` и `TestProjects_Delete_RequiresAdmin` -- ✓ DONE

**Что**: DELETE нулевого UUID → 404; DELETE maintainer-ом → 403.

**Почему**: store Delete pre-fetch + role guard.

---

### Audit Pass 1 — Epics (3 теста)

---

### `TestEpics_Create_Success` -- ✓ DONE (BUG-02)

**Что**: `POST /projects/{pid}/epics` → 201. **Почему**: BUG-02 — ownerID = "" → 500.

---

### `TestEpics_Create_ForNonExistentProject` -- ✓ DONE

**Что**: POST в несуществующий project_id → 404. **Почему**: FK 23503 → ErrNotFound в store.epics.Create.

---

### `TestEpics_Create_EmptyTitle` -- ✓ DONE

**Что**: `{"title":""}` → 400. **Почему**: handler валидация пустого заголовка.

---

### `TestEpics_Update_InvalidStatus` -- ✓ DONE (BUG-13)

**Что**: `PATCH /epics/{id}` с невалидным статусом → 400.

**Почему**: BUG-13 — без `validEpicStatus` map → 22P02 → 500.

---

### `TestEpics_Get_CrossProject` -- ✓ DONE

**Что**: GET epic из project A через URL project B → 404.

**Почему**: epic.Get делает сравнение `epic.ProjectID != project_id`.

---

### Audit Pass 1 — Backlog Items (4 теста)

---

### `TestBacklog_Create_Success` -- ✓ DONE (BUG-18)

**Что**: POST создаёт backlog item со статусом по умолчанию "backlog".

**Почему**: BUG-18 — дефолтный статус `"open"` не является валидным `item_status` → 500.

---

### `TestBacklog_Create_EmptyTitle`, `TestBacklog_Create_WhitespaceTitle` -- ✓ DONE

**Что**: пустой/whitespace title → 400. **Почему**: TrimSpace + empty check.

---

### `TestBacklog_Get_Success` и `TestBacklog_Get_NotFound` -- ✓ DONE

**Что**: GET существующего → 200; GET нулевого UUID → 404. **Почему**: базовый контракт.

---

### `TestBacklog_Get_CrossProject` -- ✓ DONE (BUG-06)

**Что**: GET item из project A через URL project B → 404.

**Почему**: BUG-06 — без сравнения ProjectID item был доступен через любой project URL.

---

### `TestBacklog_Delete_CrossProject` -- ✓ DONE (BUG-07)

**Что**: DELETE item из project A через URL project B → 404; item не удалён.

**Почему**: BUG-07 — без pre-fetch item удалялся через чужой project URL.

---

### Audit Pass 1 — Tasks (3 теста)

---

### `TestTasks_Create_Success` -- ✓ DONE (BUG-18c)

**Что**: POST создаёт задачу со статусом по умолчанию "todo".

**Почему**: BUG-18c — дефолтный статус `"open"` не является валидным `task_status`.

---

### `TestTasks_Create_NonExistentBacklogItem` -- ✓ DONE (BUG-17)

**Что**: POST задачи на несуществующий backlog_item_id → 404.

**Почему**: BUG-17 — FK 23503 в store.tasks.Create уходил в 500.

---

### `TestTasks_Delete_NotFound` и `TestTasks_Get_NotFound` -- ✓ DONE

**Что**: DELETE/GET нулевого UUID → 404. **Почему**: store.GetByID pre-check в Delete.

---

### Audit Pass 1 — Sprints (8 тестов)

---

### `TestSprints_Create_Success` и `TestSprints_Create_EmptyName` -- ✓ DONE

**Что**: POST создаёт sprint (201); пустое name → 400.

---

### `TestSprints_Create_InvalidDate` -- ✓ DONE (BUG-11)

**Что**: `{"name":"X","start_date":"not-a-date"}` → 400.

**Почему**: BUG-11 — без `time.Parse` валидации невалидная дата уходила в pgtype → opaque error → 500.

---

### `TestSprints_Update_EmptyName` -- ✓ DONE (BUG-10)

**Что**: PATCH с `{"name":""}` → 400.

**Почему**: BUG-10 — без TrimSpace пустое имя обновлялось как валидное.

---

### `TestSprints_Update_InvalidDate` -- ✓ DONE (BUG-11)

**Что**: PATCH с `{"end_date":"not-a-date"}` → 400. **Почему**: то же, что BUG-11 для Update.

---

### `TestSprints_Get_NotFound` и `TestSprints_Delete_NotFound` -- ✓ DONE (BUG-03)

**Что**: GET/DELETE нулевого UUID → 404.

**Почему**: BUG-03 — Sprint.Delete не проверял ErrNotFound; store.sprints.Delete возвращал nil для 0 строк.

---

### `TestSprints_AddAndRemoveItem_Success` -- ✓ DONE

**Что**: AddItem 204 → ListItems 1 элемент → RemoveItem 204. **Почему**: happy path sprint workflow.

---

### `TestSprints_AddItem_NonExistentSprint` -- ✓ DONE (BUG-04)

**Что**: AddItem в несуществующий sprint → 404.

**Почему**: BUG-04 — FK 23503 в store.sprints.AddItem уходил в 500.

---

### `TestSprints_AddItem_Duplicate` -- ✓ DONE (BUG-05)

**Что**: добавить один item дважды → 409.

**Почему**: BUG-05/05b — `ON CONFLICT DO NOTHING` заглушал unique-нарушение → 204 вместо 409.
Убрали `ON CONFLICT DO NOTHING` из SQL; теперь 23505 → ErrConflict → 409.

---

### Audit Pass 1 — Comments (5 тестов)

---

### `TestComments_Create_Success` и `TestComments_Create_WhitespaceBody` -- ✓ DONE (BUG-09)

**Что**: POST создаёт комментарий (201); `{"body":"   "}` → 400.

**Почему**: BUG-09 — без TrimSpace whitespace-only body проходил.

---

### `TestComments_Update_Success` и `TestComments_SoftDelete_Success` -- ✓ DONE

**Что**: PATCH body → 200; DELETE → 204 (soft delete). **Почему**: базовый CRUD контракт.

---

### `TestComments_Delete_NotFound` -- ✓ DONE

**Что**: DELETE нулевого UUID → 404. **Почему**: store SoftDelete pre-fetch.

---

### Audit Pass 2 — Backlog Items (5 тестов)

---

### `TestBacklog_Create_InvalidType` -- ✓ DONE (AUDIT-A)

**Что**: `POST /backlog` с `{"type":"garbage_type"}` → 400.

**Почему**: AUDIT-A — без `validBacklogItemType` map тип уходил в DB как enum cast → 22P02 → 500.

---

### `TestBacklog_Create_InvalidStatus` -- ✓ DONE (AUDIT-B)

**Что**: `POST /backlog` с `{"status":"open"}` → 400.

**Почему**: AUDIT-B — то же для status. `"open"` не является валидным `item_status`.

---

### `TestBacklog_Update_InvalidStatus` -- ✓ DONE (AUDIT-B)

**Что**: `PATCH /backlog/{id}` с `{"status":"open"}` → 400. **Почему**: валидация при Update тоже обязательна.

---

### `TestBacklog_Update_CrossProject` -- ✓ DONE (AUDIT-C)

**Что**: PATCH item из project A через URL project B → 404.

**Почему**: AUDIT-C — Update не имел pre-fetch + ProjectID check. PATCH успешно применялся к чужому item.

---

### `TestBacklog_Create_NonExistentProject` -- ✓ DONE (AUDIT-M/M2)

**Что**: POST в `/projects/00000000.../backlog` → 404.

**Почему**: AUDIT-M — store.backlog.Create не ловил 23503 → raw error.
AUDIT-M2 — handler.Create не проверял ErrNotFound → 500.
Оба уровня исправлены.

---

### Audit Pass 2 — Tasks (4 теста)

---

### `TestTasks_Update_InvalidStatus` -- ✓ DONE (AUDIT-E)

**Что**: PATCH task с `{"status":"garbage"}` → 400.

**Почему**: AUDIT-E — Task.Update не валидировал статус → 22P02 → 500.

---

### `TestTasks_Get_CrossBacklogItem` -- ✓ DONE (AUDIT-D)

**Что**: GET task из item A через URL item B → 404.

**Почему**: AUDIT-D — Task.Get не сравнивал `task.BacklogItemID` с URL-параметром.

---

### `TestTasks_Update_CrossBacklogItem` -- ✓ DONE (AUDIT-F)

**Что**: PATCH task из item A через URL item B → 404.

**Почему**: AUDIT-F — Task.Update не делал pre-fetch + BacklogItemID check.

---

### `TestTasks_Delete_CrossBacklogItem` -- ✓ DONE (AUDIT-G)

**Что**: DELETE task из item A через URL item B → 404; task при этом не удалён.

**Почему**: AUDIT-G — Task.Delete не делал pre-fetch, удалял item вне зависимости от parent.
Тест верифицирует что task остался доступен через корректный URL.

---

### Audit Pass 2 — Sprints (5 тестов)

---

### `TestSprints_Create_InvalidStatus` -- ✓ DONE (AUDIT-H)

**Что**: `POST /sprints` с `{"name":"S","status":"garbage"}` → 400.

**Почему**: AUDIT-H — после дефолт-присваивания `"planning"` пользовательский статус не валидировался.

---

### `TestSprints_Update_InvalidStatus` -- ✓ DONE (AUDIT-I)

**Что**: PATCH sprint с `{"status":"garbage"}` → 400.

**Почему**: AUDIT-I — Sprint.Update не валидировал status при PATCH.

---

### `TestSprints_Update_InvalidDate` -- ✓ DONE (AUDIT-I)

**Что**: PATCH sprint с `{"end_date":"not-a-date"}` → 400. Контр-тест к BUG-11.

**Почему**: Update-путь тоже должен парсить дату до store call.

---

### `TestSprints_Get_CrossProject` -- ✓ DONE (AUDIT-J)

**Что**: GET sprint из project A через URL project B → 404.

**Почему**: AUDIT-J — Sprint.Get не сравнивал `sprint.ProjectID` с URL.

---

### `TestSprints_RemoveItem_NotFound` -- ✓ DONE (AUDIT-O)

**Что**: DELETE `/sprints/{sid}/items/{bid}` где item никогда не добавлялся в sprint → 404.

**Почему**: AUDIT-O — `RemoveSprintItem` был `:exec` → 0 строк удалено → nil → 204.
Переведён на `:one` с `RETURNING sprint_id`; `pgx.ErrNoRows` → `domain.ErrNotFound` → 404.

---

### Audit Pass 2 — Epics (3 теста)

---

### `TestEpics_Update_CrossProject` -- ✓ DONE (AUDIT-K)

**Что**: PATCH epic из project A через URL project B → 404.

**Почему**: AUDIT-K — Epic.Update не делал pre-fetch + ProjectID check.

---

### `TestEpics_Delete_CrossProject` -- ✓ DONE (AUDIT-L)

**Что**: DELETE epic из project A через URL project B → 404; epic не удалён.

**Почему**: AUDIT-L — Epic.Delete не имел cross-project guard.

---

### `TestEpics_Delete_NotFound` -- ✓ DONE (AUDIT-L)

**Что**: DELETE несуществующего epic (00000000...) → 404.

**Почему**: store.epics.Delete вызывал `DeleteEpic` напрямую — 0 строк → nil.
Теперь Delete делает GetByID первым; handler pre-fetch также перехватывает.

---

### Audit Pass 2 — Comments (1 тест)

---

### `TestComments_Create_NonExistentItem` -- ✓ DONE (AUDIT-N/N2)

**Что**: POST комментария к backlog_item_id = `00000000...` → 404.

**Почему**: AUDIT-N — store.comments.Create не ловил FK 23503.
AUDIT-N2 — handler.Create не проверял ErrNotFound → 500.

---

## Обновление покрытия Phase 4

| Модуль | Покрыто | Пробелы |
|--------|---------|--------|
| `handler_projects.go`: Create (auth, role, empty, whitespace, length) | ✓ | - |
| `handler_projects.go`: Get (found, not found) | ✓ | - |
| `handler_projects.go`: Update (invalid status) | ✓ | Cross-project auth check (TODO) |
| `handler_projects.go`: Delete (not found, role) | ✓ | - |
| `handler_epics.go`: Create (success, no project, empty title, invalid status) | ✓ | - |
| `handler_epics.go`: Get (cross-project) | ✓ | - |
| `handler_epics.go`: Update (invalid status, cross-project) | ✓ | - |
| `handler_epics.go`: Delete (cross-project, not found) | ✓ | - |
| `handler_backlog.go`: Create (success, empty/ws title, invalid type, invalid status, no project) | ✓ | - |
| `handler_backlog.go`: Get (found, not found, cross-project) | ✓ | - |
| `handler_backlog.go`: Update (invalid status, cross-project) | ✓ | Invalid type on Update (TODO) |
| `handler_backlog.go`: Delete (cross-project) | ✓ | Not-found delete (TODO) |
| `handler_tasks_sprints.go`: Task.Create (success, empty, no backlog item) | ✓ | - |
| `handler_tasks_sprints.go`: Task.Get (not found, cross-item) | ✓ | - |
| `handler_tasks_sprints.go`: Task.Update (invalid status, cross-item) | ✓ | - |
| `handler_tasks_sprints.go`: Task.Delete (not found, cross-item) | ✓ | - |
| `handler_tasks_sprints.go`: Sprint.Create (success, empty name, invalid date, invalid status) | ✓ | - |
| `handler_tasks_sprints.go`: Sprint.Get (not found, cross-project) | ✓ | - |
| `handler_tasks_sprints.go`: Sprint.Update (empty name, invalid date, invalid status) | ✓ | - |
| `handler_tasks_sprints.go`: Sprint.Delete (not found) | ✓ | Cross-project check (TODO) |
| `handler_tasks_sprints.go`: Sprint.AddItem (success, duplicate, no sprint) | ✓ | No backlog item (TODO) |
| `handler_tasks_sprints.go`: Sprint.RemoveItem (not found) | ✓ | - |
| `handler_comments_capacity.go`: Create (success, ws body, no item) | ✓ | No project (TODO) |
| `handler_comments_capacity.go`: Update (success) | ✓ | Cross-author check (TODO) |
| `handler_comments_capacity.go`: SoftDelete (success, not found) | ✓ | - |

---



| Когда добавлять тест сюда | Когда нет |
|--------------------------|-----------|
| Новый эндпоинт или бизнес-правило | Тривиальный getter без логики |
| Новый constraint в схеме | Проверка что http.StatusOK == 200 |
| Исправление бага | Тест уже очевиден из кода |
| Изменение бизнес-инварианта | |

**Правило синхронизации**: если в DESIGN.md появилось новое поведение -- здесь должен
появиться тест (пусть и `(planned)`). Если тест упал и поведение изменилось --
DESIGN.md обновляется тоже.
