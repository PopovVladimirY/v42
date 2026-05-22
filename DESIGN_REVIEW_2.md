# V.42 -- Design Review: готовность к Phase 2 (Auth)

> Дата: 2026-05-22. Основание: аудит кодовой базы перед реализацией Phase 2.
> Метод: читаем что есть, сверяем с DESIGN.md, фиксируем расхождения и пробелы.

---

## Статус Phase 0 + Phase 1

| Элемент | Статус | Примечание |
|---------|--------|------------|
| `go mod init`, структура директорий | DONE | |
| `Dockerfile` multi-stage | DONE | |
| `docker-compose.yml` | DONE | |
| `Makefile` (dev/build/migrate/sqlc/test) | DONE | native Go, -race везде |
| `config.go` -- env vars, productionGuards | DONE | + DB_PASSWORD=changeme guard добавлен сегодня |
| DB connection + healthcheck | DONE | pgxpool, MaxConnLifetime/Idle |
| `golang-migrate` setup, миграция 000001 (pgcrypto) | DONE | |
| `000002_schema.up.sql` -- 21 таблица, 13 ENUM | DONE | включая outbox + activity_log |
| chi router, `/api/v1/health` | DONE | |
| CORS middleware | DONE | `go-chi/cors` в go.mod |
| Rate limit middleware (IP-based) | DONE | `golang.org/x/time/rate` |
| Structured JSON logger | DONE | `slog.NewJSONHandler` |
| 25 integration tests -- PASS с -race | DONE | |
| **sqlc queries** | **NOT DONE** | только .gitkeep |
| **internal/domain/** | **NOT DONE** | директория не существует |
| **internal/auth/** | **NOT DONE** | нет jwt.go, password.go |
| **internal/api/middleware/auth.go** | **NOT DONE** | |
| **internal/api/middleware/roles.go** | **NOT DONE** | |
| **internal/api/handler/** | **NOT DONE** | нет ни одного хендлера |

---

## Блокеры Phase 2 (нельзя начать без этого)

### BLK-1: golang-jwt и bcrypt не в go.mod

Phase 2 требует:
- `github.com/golang-jwt/jwt/v5` -- генерация и валидация JWT
- `golang.org/x/crypto/bcrypt` -- хеширование паролей

В текущем `go.mod` этих зависимостей нет. Добавить до начала реализации:

```bash
wsl -u vpo bash -lc 'cd ~/v42 ; go get github.com/golang-jwt/jwt/v5 golang.org/x/crypto'
```

### BLK-2: sqlc queries для auth не написаны

`internal/db/queries/` -- пустая папка. Phase 2 требует минимум:

| Query | Файл | Назначение |
|-------|------|------------|
| `GetUserByEmail` | `users.sql` | login: найти юзера по email |
| `GetUserByID` | `users.sql` | /auth/me: загрузить профиль |
| `CreateUser` | `users.sql` | seed admin |
| `CreateRefreshToken` | `refresh_tokens.sql` | выдать refresh токен |
| `GetRefreshTokenByHash` | `refresh_tokens.sql` | validate + rotate |
| `RevokeRefreshToken` | `refresh_tokens.sql` | rotation: старый токен |
| `RevokeAllUserRefreshTokens` | `refresh_tokens.sql` | logout + reuse detection |

Без `make sqlc` нет типизированного Go-кода для работы с БД в хендлерах.

### BLK-3: respond/respondErr недоступны из handler-пакета

`respond()` и `respondErr()` объявлены в `internal/api/router.go` как
**unexported** функции пакета `api`. Когда создаём `internal/api/handler/auth.go`
(отдельный пакет `handler`), они будут недоступны.

**Решение**: вынести в `internal/api/respond.go`, сделать exported (`Respond`, `RespondErr`),
или оставить всё в одном пакете `api` (handler файлы в `internal/api/handler_auth.go`).

Рекомендация: **один пакет `api`**, файлы `handler_auth.go`, `handler_users.go` и т.д.
Это проще чем sub-packages, и domain layer всё равно изолирован в `internal/domain/`.

---

## Дефекты дизайна (не блокеры, но исправить до Phase 2)

### DEF-1: /auth/me в rate-limited группе -- неправильно

В `router.go`:
```go
r.Group(func(r chi.Router) {
    r.Use(authLimiter.Middleware)
    r.Post("/auth/login", notImplemented)
    r.Post("/auth/refresh", notImplemented)
    r.Post("/auth/logout", notImplemented)
    r.Get("/auth/me", notImplemented)   // <-- BUG
})
```

`/auth/me` не должен быть rate-limited как brute-force цель. Он должен быть
в JWT-protected группе. Rate limit нужен только для `login` и `refresh`
(там возможен перебор credentials/токенов).

**Исправление**: разделить на две группы:
```go
// rate-limited: brute force targets
r.Group(func(r chi.Router) {
    r.Use(authLimiter.Middleware)
    r.Post("/auth/login", ...)
    r.Post("/auth/refresh", ...)
})

// jwt-protected: standard auth middleware
r.Group(func(r chi.Router) {
    r.Use(jwtMiddleware)
    r.Post("/auth/logout", ...)
    r.Get("/auth/me", ...)
})
```

### DEF-2: SeedAdminPassword -- поведение при пустой строке не определено

В config.go:
```go
SeedAdminPassword: opt("SEED_ADMIN_PASSWORD", ""),
```

Если переменная не задана -- пустая строка. Seed-логика (не написана) должна явно
обрабатывать этот случай: пустая строка = "не сидировать", а не "создать юзера без пароля".
Зафиксировать это правило в коде как комментарий, до написания seed-логики.

### DEF-3: TESTS.md указывает 19 таблиц, сейчас 21

В `TESTS.md` раздел `TestMigrationsApply`:
> "проверяет что все 19 таблиц из `000002_schema.up.sql`..."

После добавления `activity_log` и `outbox` -- 21. Надо обновить.

---

## Сверка схемы с Phase 2 требованиями

### Таблица `users` -- достаточна для Phase 2?

```sql
id, email (UNIQUE), password_hash, display_name, role, is_active, avatar_url,
created_at, updated_at
```

| Нужно для Phase 2 | Есть? |
|-------------------|-------|
| Логин по email | YES -- email UNIQUE + index |
| Проверка пароля | YES -- password_hash |
| Роль пользователя | YES -- user_role ENUM |
| Блокировка аккаунта | YES -- is_active |
| Профиль для /auth/me | YES -- display_name, role, avatar_url |

OK.

### Таблица `refresh_tokens` -- достаточна для Phase 2?

```sql
id, user_id (FK), token_hash (UNIQUE), expires_at, created_at, revoked_at
```

| Нужно для Phase 2 | Есть? |
|-------------------|-------|
| Хранить токен (не plaintext) | YES -- token_hash |
| Найти по хешу | YES -- idx_refresh_tokens_hash |
| Проверить не истёк | YES -- expires_at |
| Отозвать один токен (rotation) | YES -- revoked_at |
| Отозвать все (logout + reuse) | YES -- WHERE user_id + UPDATE |
| Найти токены юзера | YES -- idx_refresh_tokens_user |

OK. **Детект кражи токена**: при reuse (попытка использовать уже ротированный токен)
следует вызвать `RevokeAllUserRefreshTokens` -- вся сессия компрометирована.
Это бизнес-правило, реализуется в `domain/auth.go`.

---

## Структура файлов для Phase 2

Что создаём, в каком порядке:

```
Шаг 1: sqlc queries
  internal/db/queries/users.sql
  internal/db/queries/refresh_tokens.sql
  -> make sqlc -> internal/db/gen/ (автогенерация)

Шаг 2: auth пакет (чистая логика, нет HTTP, нет SQL)
  internal/auth/jwt.go       -- Generate(userID, role, ttl) -> string; Parse(token) -> Claims
  internal/auth/password.go  -- Hash(plain) -> hash; Verify(plain, hash) -> bool

Шаг 3: domain (бизнес-правила auth, нет HTTP)
  internal/domain/auth.go    -- Login(email, pass), Refresh(tokenHash), Logout(tokenHash)
                             -- DetectTokenReuse(userID) -> revoke all

Шаг 4: middleware
  internal/api/middleware/auth.go   -- JWT Bearer extraction, context injection
  internal/api/middleware/roles.go  -- RequireRole(roles...) http.Handler

Шаг 5: handlers + router wiring
  internal/api/handler_auth.go      -- Login, Refresh, Logout, Me
  internal/api/router.go            -- убрать DEF-1, подключить реальные хендлеры

Шаг 6: seed
  cmd/api/main.go                   -- seedAdmin() при первом запуске если SEED_ADMIN_EMAIL задан
```

---

## Security checklist для Phase 2

| Пункт | Требование | Заложено? |
|-------|-----------|-----------|
| Пароли | bcrypt, cost >= 12 | Схема: password_hash. Реализация -- в auth/password.go |
| Токены (refresh) | Хранить hash (bcrypt/SHA-256), не plaintext | Схема: token_hash UNIQUE |
| JWT secret | >= 32 символов, из env | config.go: required("JWT_SECRET") |
| JWT TTL | Access 15m, Refresh 7d | config.go: JWT_ACCESS_TTL, JWT_REFRESH_TTL |
| Rate limit auth | 10 req/min/IP на login+refresh | middleware/ratelimit.go |
| INVALID_CREDENTIALS | Одинаковый ответ для "нет юзера" и "неверный пароль" | В хендлере |
| Timing attack | bcrypt.CompareHashAndPassword всегда вызываем, даже если юзер не найден | В domain/auth.go |
| Token reuse | Ротированный токен используется повторно → revoke all | В domain/auth.go |
| Logout | Реально ревокация в БД, а не просто 200 | В domain/auth.go |
| is_active | Неактивный юзер → 401, даже с валидным токеном | В JWT middleware |
| DB_PASSWORD prod | Заблокирован guard если "changeme" | config.go: productionGuards() -- DONE |

---

## API контракт -- сверка с DESIGN.md

```
POST /api/v1/auth/login
  Request:  { "email": "...", "password": "..." }
  Response: { "data": { "token": "...", "refresh_token": "...", "user": {...} } }
  Errors:   401 INVALID_CREDENTIALS | 429 RATE_LIMITED

POST /api/v1/auth/refresh
  Request:  { "refresh_token": "..." }
  Response: { "data": { "token": "...", "refresh_token": "..." } }
  Errors:   401 TOKEN_EXPIRED | 401 TOKEN_REVOKED | 429 RATE_LIMITED

POST /api/v1/auth/logout
  Headers:  Authorization: Bearer <access_token>
  Request:  { "refresh_token": "..." }
  Response: { "data": null }
  Errors:   401 UNAUTHORIZED

GET /api/v1/auth/me
  Headers:  Authorization: Bearer <access_token>
  Response: { "data": { "id": "...", "email": "...", "role": "...", "display_name": "..." } }
  Errors:   401 UNAUTHORIZED | 401 TOKEN_EXPIRED
```

**Открытый вопрос**: у `TOKEN_EXPIRED` и `INVALID_TOKEN` -- разные коды ошибок.
Клиент: expired → попробуй refresh; invalid → иди логиниться. Это важно.

---

## Порядок действий

1. `go get github.com/golang-jwt/jwt/v5 golang.org/x/crypto` -- добавить зависимости
2. Написать `internal/db/queries/users.sql` + `refresh_tokens.sql`, запустить `make sqlc`
3. Создать `internal/auth/password.go` (bcrypt, cost 12)
4. Создать `internal/auth/jwt.go` (generate, parse, Claims struct)
5. Создать `internal/domain/auth.go` (Login, Refresh, Logout бизнес-логика)
6. Исправить DEF-1 в router.go (разделить группы)
7. Создать `internal/api/middleware/auth.go` (JWT Bearer → context)
8. Создать `internal/api/handler_auth.go` (4 хендлера)
9. Подключить в router.go, убрать notImplemented для auth маршрутов
10. Seed admin в main.go
11. Написать integration тесты из TESTS.md (TestAuth_*)

---

## Что обновить в других файлах

| Файл | Что |
|------|-----|
| `TESTS.md` | "19 таблиц" → "21 таблица" в описании TestMigrationsApply |
| `DESIGN.md` фаза 1 | Отметить sqlc как TODO (остался от Phase 1) |
| `.env.example` | Добавить комментарий про SEED_ADMIN_PASSWORD="" = no seed |
