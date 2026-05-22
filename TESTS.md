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

## Развитие документа

| Когда добавлять тест сюда | Когда нет |
|--------------------------|-----------|
| Новый эндпоинт или бизнес-правило | Тривиальный getter без логики |
| Новый constraint в схеме | Проверка что http.StatusOK == 200 |
| Исправление бага | Тест уже очевиден из кода |
| Изменение бизнес-инварианта | |

**Правило синхронизации**: если в DESIGN.md появилось новое поведение -- здесь должен
появиться тест (пусть и `(planned)`). Если тест упал и поведение изменилось --
DESIGN.md обновляется тоже.
