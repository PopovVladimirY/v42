# Phase 2 -- Auth: Summary

> "Безопасность -- это не фича, это фундамент. Построишь плохо -- сверху ничего не спасёт."

Статус: **DONE** | Дата: май 2026 | Go 1.25.0, pgx/v5, golang-jwt/v5, x/crypto

---

## Что построено

### 4 HTTP-эндпоинта

| Метод | Путь | Описание |
|-------|------|----------|
| `POST` | `/api/v1/auth/login` | Bcrypt-проверка, выдача JWT + httpOnly cookie |
| `POST` | `/api/v1/auth/refresh` | Ротация токенов, детекция реюза |
| `POST` | `/api/v1/auth/logout` | Отзыв refresh-токена, идемпотентный |
| `GET`  | `/api/v1/auth/me` | Профиль текущего пользователя из JWT |

### Архитектура слоёв

```
HTTP handler (internal/api/handler_auth.go)
      |
      v
Domain service (internal/domain/auth.go)  -- бизнес-логика, чистая, без HTTP/SQL
      |               |
      v               v
UserRepo           TokenRepo              -- интерфейсы (domain-уровень)
      |               |
      v               v
UserStore        TokenStore               -- реализация (internal/db/store/auth.go)
      |               |
      v               v
  sqlc queries (internal/db/gen/)         -- типизированный SQL, сгенерирован
      |
      v
  PostgreSQL 16
```

### Ключевые решения по безопасности

| Решение | Почему |
|---------|--------|
| JWT HS256, 15 мин | Короткий TTL -- украденный токен быстро умирает |
| Refresh token -- SHA-256 хэш в БД | Детерминированный поиск; bcrypt -- не подходит (недетерминирован) |
| Bcrypt cost=12 для паролей | ~100ms на verify -- брутфорс нерентабелен |
| Dummy bcrypt при `user not found` | Константное время -- нет user enumeration via timing |
| Refresh token в httpOnly cookie | JS не видит; `SameSite=Strict` -- нет CSRF |
| Token rotation при каждом refresh | Украденный старый токен → `TOKEN_REVOKED` |
| Reuse detection | Старый токен использован повторно → `RevokeAll` все сессии пользователя |
| `ErrNotFound` sentinel | DB-ошибки ≠ "не нашли"; connection failure не маскируется как 401 |

---

## Файлы реализации

| Файл | Назначение |
|------|-----------|
| `internal/auth/jwt.go` | Генерация и парсинг JWT (HS256, Claims с `uid`+`role`) |
| `internal/auth/password.go` | bcrypt cost=12, `HashPassword`, `VerifyPassword` |
| `internal/domain/auth.go` | `AuthService`: Login, Refresh, Logout; sentinel errors; `generateRefreshToken` |
| `internal/db/store/auth.go` | `UserStore` + `TokenStore`; оборачивают `pgx.ErrNoRows` → `domain.ErrNotFound` |
| `internal/api/handler_auth.go` | 4 HTTP-хендлера; `MaxBytesReader(4096)`; нормализация email |
| `internal/api/middleware/auth.go` | `JWTAuth(secret)` middleware; `ClaimsFromContext` |
| `internal/api/middleware/roles.go` | `RequireRole(...)` -- chainable RBAC |
| `internal/api/middleware/ratelimit.go` | IP token bucket; burst=10, 1/6s; `Retry-After: 6` |
| `internal/api/middleware/cors.go` | chi/cors с `AllowCredentials: true` |
| `internal/api/middleware/logger.go` | Structured slog, chi WrapResponseWriter |
| `internal/api/router.go` | Route registration; `respond`/`respondErr` JSON envelope helpers |
| `internal/config/config.go` | Env loading; production guards (JWT secret length, changeme values) |
| `internal/db/db.go` | Pool setup via `url.URL` (safe for special chars in password) |
| `cmd/api/main.go` | Wire-up; `seedAdmin`; graceful shutdown; `ReadHeaderTimeout` |
| `migrations/000003_drop_redundant_token_hash_index.*` | Убрали дублирующий индекс (UNIQUE уже создаёт B-tree) |
| `internal/api/auth_test.go` | 15 интеграционных тестов |
| `internal/testutil/db.go` | Хелпер `testutil.NewDB(t)` для тест-БД |

---

## Тест-покрытие Phase 2

### Итого: 37 тестов (15 auth + 22 DB)

```
internal/api    -- 15 тестов, все PASS
internal/db     --  4 теста (24 subtests), все PASS
```

### Auth: что покрыто

| Путь кода | Тест |
|-----------|------|
| Login happy path | `TestAuth_Login_Success` |
| Login wrong password | `TestAuth_Login_WrongPassword` |
| Login unknown user (timing safe) | `TestAuth_Login_UnknownUser` |
| Login email normalization | `TestAuth_Login_EmailNormalization` |
| Login oversized body → 400 | `TestAuth_Login_BodyTooLarge` |
| Login inactive user → 403 | `TestAuth_Login_InactiveUser` |
| Refresh token rotation | `TestAuth_Refresh_TokenRotation` |
| Old token revoked after rotation | `TestAuth_TokenReuse_OldTokenRevoked` |
| Me with valid JWT | `TestAuth_Me_WithValidToken` |
| Me no token → 401 | `TestAuth_Me_NoToken` |
| Me expired token → 401 | `TestAuth_Me_ExpiredToken` |
| Logout revokes token | `TestAuth_Logout` |
| Envelope has data+meta+error fields | `TestAuth_ErrorEnvelope_HasDataAndMeta` |
| Error responses have `application/json` | `TestAuth_ErrorResponse_ContentTypeIsJSON` |
| X-Forwarded-For can't bypass rate limit | `TestAuth_RateLimit_XForwardedFor_CannotBypass` |

### Что НЕ покрыто тестами (known gaps)

| Пробел | Почему оставлен | Когда закрыть |
|--------|-----------------|---------------|
| `RequireRole` с реальным защищённым маршрутом | Нет защищённых маршрутов пока | Phase 3 (первый users-endpoint) |
| Config production guards | Нет unit-тестов config | Отдельный TODO |
| Health endpoint | Тривиальный, нет логики | По желанию |
| Refresh: expired token → 401 | Логика живёт в `domain.Refresh`, путь через хендлер не тестирован | Добавить в Phase 3 cleanup |
| Reuse detection → все сессии нулируются | `RevokeAll` вызывается, но результат не проверяется | Будущий тест |

---

## Баги найденные и исправленные (4 раунда review)

### Round 1 -- после первого написания кода
| # | Баг | Серьёзность |
|---|-----|------------|
| 1 | Rate limiter брал `r.RemoteAddr` с портом → разные ключи для одного IP | Medium |
| 2 | Dummy bcrypt хэш был hardcoded невалидной строкой (49 chars) → bcrypt сразу возвращал ошибку, timing protection не работала | **High** |
| 3 | `domain.User` без JSON tags → ответ API возвращал `DisplayName` вместо `display_name` | Medium |
| 4 | JWT secret minimum length не проверялся → `JWT_SECRET=abc` в production | Medium |

### Round 2 -- повторный проход
| # | Баг | Серьёзность |
|---|-----|------------|
| 5 | Нет `MaxBytesReader` на Login → DoS через огромное тело | Medium |
| 6 | Email не нормализовался → `user@example.com` ≠ `USER@EXAMPLE.COM` | Medium |
| 7 | Middleware 401/403 шли через `http.Error` → envelope без `data` и `meta` | Medium |
| 8 | Комментарий в миграции: "bcrypt hash" вместо "SHA-256 hash" | Low |
| 9 | Два индекса на `token_hash` (UNIQUE уже создаёт B-tree) | Low |
| 10 | Комментарий в коде: "10 req/min" → фактически "burst 10, then 1/6s" | Low |

### Round 3 -- DB error masking
| # | Баг | Серьёзность |
|---|-----|------------|
| 11 | DB-ошибки в `GetByEmail/GetByID/GetByHash` маскировались как `ErrNotFound` → connection failure выглядел как "неверный пароль", никакого лога на сервере | **High** |
| 12 | `Me` хендлер любую ошибку `GetByID` превращал в 401 → DB outage = "user not found" | Medium |

### Round 4 -- финальный полный проход
| # | Баг | Серьёзность |
|---|-----|------------|
| 13 | `chiware.RealIP` запускался ДО rate limiter → `X-Forwarded-For: 1.2.3.4` полностью обходил брутфорс-защиту | **High** |
| 14 | `http.Error()` в middleware ставит `Content-Type: text/plain` на JSON-тело | Medium |
| 15 | DSN через `fmt.Sprintf` → `DB_PASSWORD` со спецсимволами молча ломал подключение | Medium |
| 16 | Отсутствовал `ReadHeaderTimeout` → Slowloris мог держать соединения 15 сек | Low |

**Итого: 16 багов, из них 3 высокого уровня.**

---

## Что дальше (Phase 3)

- CRUD users (`GET/POST /users`, `GET/PATCH /users/{id}`)
- CRUD skills + member_skills
- CRUD teams + members
- Первый защищённый маршрут → тест для `RequireRole`
- Config unit-тесты (`TestConfig_ProductionGuards`, `TestConfig_MissingRequired`)
