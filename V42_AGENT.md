# V42 & AI Agents -- Architecture & Roadmap

> "Реальная работа с ИИ агентами до сих пор идет через текст. Нужно решить эту незадачу."
> -- TODO.md, 2026

---

## Постановка задачи

Сейчас цикл выглядит так:

```
Человек --> копирует текст из V42 --> вставляет в промт --> AI отвечает --> человек копирует обратно
```

Это утомительно, теряется контекст, нет трассировки, нет закрытия петли.

Цель: сделать V42 нативной средой для работы с AI агентами. Агент должен знать,
что делать, видеть статус, обновлять его и отчитываться -- всё через API.

---

## Три уровня интеграции

### Level 1: Export (Quick Win, 2-3 дня)

Самый простой и немедленно полезный шаг.

**Суть:** добавить в API endpoint экспорта контекста в структурированном тексте.

```
GET /api/v1/backlog/{id}/context?format=md
GET /api/v1/backlog/{id}/context?format=json
GET /api/v1/epics/{id}/context?format=md
GET /api/v1/sprints/{id}/context?format=md
```

Возвращает полный контекст элемента: описание, acceptance criteria, задачи, тесты,
привязанный эпик, спринт, clarity-уровень, скилсет требования.

**Пример вывода для backlog item:**

```markdown
# BI-12345: User can reset their password

**Type:** story | **Complexity:** B | **Status:** in_progress
**Clarity:** scoped | **Sprint:** Sprint 14 | **Epic:** Authentication

## Description
As a user who forgot their password, I want to reset it via email link
so that I can regain access without contacting support.

## Acceptance Criteria
- [ ] User can request reset by email
- [ ] System sends link valid 24h
- [ ] Link expires after first use
- [ ] Confirmation email sent after success

## Tasks
- [x] T-4521: Create reset_tokens migration
- [ ] T-4522: POST /auth/forgot-password endpoint
- [ ] T-4523: POST /auth/reset-password endpoint

## Tests
- [ ] TST-891: Email received within 60s
- [ ] TST-892: Link expires after 24h
- [ ] TST-893: Used link cannot be reused
- [ ] TST-894: Invalid token returns 400

## Context
Project: V42 Platform
Epic goal: Complete auth flow with JWT + refresh tokens
Clarity rationale: endpoints designed, DB schema done, only implementation left
Required skills: Go (proficient), PostgreSQL (competent)
```

**Где применяется:** "Скопировать для AI" кнопка в UI на странице баклога, детали задачи,
страница эпика. Можно сразу в буфер обмена -- без скачивания файла.

**Реализация:** один Go handler, форматирует JOIN-запрос по всем дочерним объектам.
Шаблон Markdown в темплейт-строке. Не нужна никакая отдельная инфраструктура.

---

### Level 2: MCP Server (The Right Way, 1-2 недели)

MCP (Model Context Protocol) -- это стандарт Anthropic, который уже поддерживают
Claude Desktop, GitHub Copilot, Cursor, Zed. По сути -- плагин для AI, который
даёт ему инструменты для работы с внешними системами.

**Суть:** `v42-mcp` -- маленький бинарник рядом с `v42`, который говорит по MCP-протоколу
и пробрасывает вызовы в V42 REST API.

```
AI Agent (Claude/Copilot/Cursor)
    |
    | MCP Protocol (JSON-RPC over stdio/SSE)
    v
v42-mcp (Go binary, ~500 lines)
    |
    | HTTP + JWT
    v
V42 API (localhost:8080)
```

**Tools, которые MCP-сервер экспортирует агенту:**

```
Read tools (no side effects):
  get_backlog_item(id)          -- полный контекст по ID
  list_sprint_backlog(sprint_id) -- что в спринте
  check_readiness(id)           -- готов ли беклог к разработке?
  get_tests(backlog_id)         -- список тестов с критериями
  get_team_skillset(team_id)    -- скилсет команды (для подбора исполнителя)
  search_backlog(text, project_id) -- поиск по тексту

Write tools (require user confirmation in UI):
  update_status(id, status)     -- in_progress / in_review / done
  add_comment(id, text)         -- комментарий от агента
  create_task(backlog_id, title, description)
  create_test(backlog_id, title, acceptance_criteria)
  update_task(id, status)
  flag_unclear(id, reason)      -- "не могу работать, нет ясности вот здесь"
```

**Конфигурация:**

```json
// ~/.config/claude/config.json или cursor settings
{
  "mcpServers": {
    "v42": {
      "command": "v42-mcp",
      "args": ["--url", "http://localhost:8080", "--token", "eyJ..."]
    }
  }
}
```

**Что это даёт:** агент сам решает, когда и что запрашивать. Ты пишешь:
"Поработай над BI-12345" -- и агент сам дёргает `get_backlog_item`, смотрит тесты,
проверяет clarity, обновляет статус, добавляет комментарии. Без копипасты.

**Токен:** отдельный API token для агента. Нужна таблица `agent_tokens` или
расширение `refresh_tokens` с типом `agent`. Никаких паролей, только токен
с ограниченным скоупом (например, только конкретный проект).

---

### Level 3: Readiness Check API (Инспектор ясности, 3-4 дня)

Перед тем как агент начнёт работать, нужно понять: готов ли беклог?

```
POST /api/v1/backlog/{id}/readiness
```

Возвращает структурированный анализ:

```json
{
  "ready": false,
  "score": 0.6,
  "checks": [
    { "name": "has_description",       "pass": true,  "note": null },
    { "name": "has_acceptance_criteria","pass": false, "note": "Description exists but no AC list found" },
    { "name": "has_tests",             "pass": true,  "note": "3 tests defined" },
    { "name": "has_complexity",        "pass": true,  "note": "B (3 pts)" },
    { "name": "clarity_sufficient",    "pass": false, "note": "Current: foggy. Minimum: scoped" },
    { "name": "no_blocking_tasks",     "pass": true,  "note": null }
  ],
  "suggestions": [
    "Add explicit acceptance criteria as a checklist",
    "Clarity level must be raised to at least 'scoped' before development"
  ]
}
```

Это полезно и людям, и агентам. В UI -- иконка-светофор на карточке баклога.
Агент перед стартом вызывает это и либо начинает работу, либо пишет в комментарии
"не могу начать: clarity=foggy, нет acceptance criteria" -- и ждёт.

---

## Полный цикл (как это будет выглядеть)

```
1. Разработчик/PM ставит задачу в V42 (BI-12345)
   |
2. Агент получает задание: "work on BI-12345"
   |
3. get_backlog_item(12345) --> читает контекст
   check_readiness(12345) --> проверяет готовность
   |
   |- НЕ ГОТОВ --> add_comment("clarity=foggy, нужна AC")
   |               update_status("blocked") --> стоп, ждём человека
   |
   |- ГОТОВ --> update_status("in_progress")
   |
4. [Агент реализует фичу в коде]
   -- по ходу: add_comment("реализовал endpoint, добавляю тест")
   -- update_task(T-4522, "done")
   -- update_task(T-4523, "done")
   |
5. Агент предлагает MR:
   add_comment("PR ready: branch feat/bi-12345-reset-password. Changes: ...")
   update_status("in_review")
   |
6. Команда ревьюит, возможные исходы:
   a) LGTM --> update_status("done")
   b) Нужны правки --> add_comment("правки: ...") --> агент возвращается к шагу 4
   c) Задача слишком большая --> create_backlog(title, description) --> новый цикл
```

Весь этот цикл трассируется в V42: комментарии агента, смена статусов, задачи.
Ничего не теряется. Всё видно команде.

---

## Агент как пользователь V42

Агент должен быть зарегистрирован в системе как специальный пользователь:

```
role: developer (или новый role: agent)
display_name: "AI Agent (Claude)"
actor_id: <uuid>  -- в activity_log уже есть поле NULL = system/AI
```

Это даёт:
- авторство комментариев и изменений видно в UI
- агент может быть назначен на задачи
- его скилсет можно задать (Go=expert, React=proficient, etc.)
- `must_change_password = false` (очевидно)
- `is_active = false` когда агент отключён

Для auth: agent token без срока действия (или очень длинный), хранится в
`refresh_tokens` с типом `agent`. Revoke-able в любой момент из UI.

---

## Что строить и в каком порядке

### Phase A -- Export Endpoint (Level 1)

**Backend:**
- `GET /api/v1/backlog/{id}/context` -- markdown + json форматы
- `GET /api/v1/epics/{project_id}/{epic_id}/context`
- `GET /api/v1/sprints/{id}/context` -- весь бэклог спринта одним документом

**Frontend:**
- Кнопка "Copy context" на странице деталей баклога (копирует markdown в clipboard)
- Кнопка "Copy sprint context" на Kanban и таблице спринта

**Ценность:** немедленная. Работает уже сегодня, без MCP, без настройки агентов.

---

### Phase B -- Readiness API (Level 3)

**Backend:**
- `POST /api/v1/backlog/{id}/readiness` -- анализ готовности
- Логика в `internal/domain/readiness.go`

**Frontend:**
- Светофор-иконка на карточке баклога (зелёный/жёлтый/красный)
- Тултип с деталями по наведению
- В деталях баклога -- раздел "Agent Readiness" с чеклистом

**Ценность:** помогает командам не запускать агента на неготовые задачи.
Также полезен для людей как "definition of ready" чеклист.

---

### Phase C -- MCP Server (Level 2)

**Новый бинарник:** `cmd/mcp/main.go` --> собирается в `bin/v42-mcp`

**Зависимости:** только стандартная библиотека Go + `github.com/mark3labs/mcp-go`
(MIT, активно поддерживается, уже используется в продакшн MCP серверах).

**Конфигурация через ENV или flags:**
```
V42_API_URL=http://localhost:8080
V42_AGENT_TOKEN=<token>
V42_PROJECT_ID=<uuid>  -- опционально, сужает скоуп
```

**Makefile target:**
```make
mcp:
    go build -o bin/v42-mcp ./cmd/mcp
```

**Безопасность:**
- Read tools -- без подтверждения
- Write tools -- агент сам решает (доверяем токену)
- Destructive operations (delete) -- недоступны через MCP вообще
- Scoped токен: привязан к проекту, не может видеть другие проекты

---

### Phase D -- Agent Token Management

**Backend:**
- `POST /api/v1/agent-tokens` -- создать токен для агента (admin only)
- `GET /api/v1/agent-tokens` -- список токенов
- `DELETE /api/v1/agent-tokens/{id}` -- отозвать

**Frontend:**
- Страница настроек системы --> раздел "Agent Tokens"
- Создание токена с именем, скоупом (project_id), сроком жизни

---

## Технический долг и что НЕ строить

**Не строить:**
- Собственный "агент-демон" -- это велосипед. MCP + существующие AI tools лучше.
- Webhook-based пуши агенту -- SSE уже есть, MCP работает через polling или SSE.
- "AI внутри V42" (встроенный LLM) -- пусть агент живёт снаружи, V42 -- его инструмент.
- Парсинг git webhooks в V42 -- пусть агент сам обновляет статусы через API.

**Важный принцип:** V42 -- источник правды о задачах. Агент -- исполнитель.
Не надо делать агента частью V42. Надо сделать V42 удобным инструментом для агента.

---

## Оценка сложности

| Компонент               | Сложность | Ценность | Приоритет |
|-------------------------|-----------|----------|-----------|
| Export endpoint         | C (low)   | High     | NOW       |
| Readiness API           | B         | High     | NEXT      |
| "Copy context" в UI     | A (trivial)| High    | NOW       |
| MCP Server (read-only)  | B         | Very High| NEXT      |
| MCP Server (write tools)| C         | High     | AFTER     |
| Agent Token management  | B         | Medium   | AFTER     |
| Agent as V42 user       | A         | Medium   | AFTER     |

Complexity scale: A=1pt, B=3pt, C=8pt (как в баклоге).

---

## Что можно сделать прямо сейчас

1. **"Copy as Markdown"** -- кнопка в UI, фронтенд. Берёт данные уже загруженного
   баклога из React Query cache, форматирует в MD, кидает в clipboard.
   Нулевой backend cost. Делается за полдня.

2. **Export endpoint** -- backend, один handler, шаблон.
   Нужен JOIN: backlog + tasks + tests + epic + sprint.
   Примерно 80-100 строк Go + SQL-запрос в sqlc.

3. **MCP read-only** -- 200-300 строк Go, использует те же endpoints что UI.
   Работает с любым MCP-совместимым агентом сразу.

---

## Подключение MCP-сервера к AI клиентам

Бинарник живёт в WSL: `~/v42/bin/v42-mcp`. Все Windows-клиенты вызывают его через
WSL transport (`wsl -u vpo ...`).

---

### Шаг 0: Получить токен

MCP-серверу нужен JWT-токен V42 в переменной окружения `V42_API_TOKEN`.
Токенов два вида -- читай внимательно, это важно.

#### Вариант A: быстрый токен для теста (живёт 15 минут)

Запускаешь в WSL/терминале:

```bash
curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@v42.local","password":"changeme"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['access_token'])"
```

Скопируй вывод (длинная строка `eyJ...`) -- это и есть токен.
Вставь его в конфиг клиента вместо `<your-jwt-here>`.

**Минус:** истекает через 15 минут. Для Claude Desktop это неприемлемо --
он запускает MCP-сервер один раз при старте и держит его живым.

#### Вариант B: длинный токен для разработки (рекомендуется)

Открыть `~/v42/.env` и изменить TTL:

```bash
# Было:
JWT_ACCESS_TTL=15m

# Стало (7 дней, достаточно для постоянной работы):
JWT_ACCESS_TTL=168h
```

Перезапустить backend: `make dev` (или убить и запустить заново).
Теперь залогиниться как в Варианте A -- токен будет жить 7 дней.

> Это только для локальной разработки. На проде TTL трогать нельзя.

#### Вариант C: agent token без срока жизни (РЕАЛИЗОВАНО -- Phase D done)

Самый правильный способ. Токен живёт до отзыва. Хэш хранится в БД, не пароль.
Формат: `v42_<64 hex символа>`. Показывается один раз при создании.

**Шаги:**

1. **Создать V42-пользователя для агента** (Admin > Users > + New User):
   - Email: `claude@v42.local` (или любой внутренний)
   - Role: `developer` (агент не может получить admin/maintainer -- это запрещено на уровне API)
   - Password: случайный (агент никогда не логинится через форму)
   - `must_change_password` = false

2. **Создать токен** (Admin > System Settings > Agent Tokens > + New token):
   - Token name: `"Claude Desktop -- vpo laptop"` (описательно, per deployment)
   - Acts as: выбрать созданного пользователя из дропдауна
   - Скопировать токен **немедленно** -- больше не покажем

3. **Прописать токен** -- см. раздел ниже по платформам.

#### Где хранить токен

**Не хранить в коде и не коммитить в git.**

**Windows -- PowerShell (постоянная переменная окружения пользователя):**

```powershell
# Записать один раз -- переживёт перезагрузку
[System.Environment]::SetEnvironmentVariable(
    "V42_AGENT_TOKEN",
    "v42_abcdef...",   # вставить свой токен
    "User"             # "Machine" -- для всех пользователей (нужны права)
)

# Проверить (в новом терминале):
$env:V42_AGENT_TOKEN
```

Или через GUI: Win+R → `sysdm.cpl` → Дополнительно → Переменные среды.

**Windows -- в конфиге клиента напрямую** (приемлемо, если файл не в git):

```json
"env": { "V42_AGENT_TOKEN": "v42_abcdef..." }
```
Файлы `%APPDATA%\Claude\claude_desktop_config.json`, `~/.cursor/mcp.json` и аналоги
не попадают в git по определению -- можно хранить токен там.

**Linux / WSL:**

```bash
# ~/.bashrc или ~/.profile (для интерактивных сессий)
echo 'export V42_AGENT_TOKEN="v42_abcdef..."' >> ~/.bashrc
source ~/.bashrc

# Проверить:
echo $V42_AGENT_TOKEN
```

Для systemd-сервисов и неинтерактивных агентов -- в `.env`-файле рядом с сервисом:

```ini
# /etc/v42-agent/env  (chmod 600, chown agent:agent)
V42_AGENT_TOKEN=v42_abcdef...
V42_API_URL=http://localhost:8080/api/v1
```

---

## Несколько агентов: один токен или много?

**Ответ: один токен на один деплой. Никогда не шарить.**

Причины:

| Вопрос | Шаренный токен | Один токен на деплой |
|--------|---------------|----------------------|
| Компрометация токена | Валим все агенты разом | Отзываем один, остальные работают |
| Кто это сделал? | Непонятно | `last_used_at` + имя токена показывают конкретный агент |
| Ротация | Нужно обновить конфиг всем | Меняем только один |
| Отключить агент на ночь | Нельзя избирательно | Revoke -- и готово |

**Схема для типичной команды:**

```
V42 Users:
  claude@v42.local      (role: developer) -- для Claude-based агентов
  copilot@v42.local     (role: developer) -- для GitHub Copilot
  ci-agent@v42.local    (role: developer) -- для CI/CD pipeline

Agent Tokens:
  "Claude Desktop -- vpo laptop"    --> acts as claude@v42.local
  "Claude Desktop -- team server"   --> acts as claude@v42.local
  "Copilot -- VS Code vpo"          --> acts as copilot@v42.local
  "CI pipeline -- GitHub Actions"   --> acts as ci-agent@v42.local
```

Несколько токенов на одного V42-пользователя -- норм. В activity log и комментариях
будет видно `claude@v42.local`, но `last_used_at` в таблице токенов разделит деплои.
Хочешь различать деплои в UI комментариях -- создавай отдельных пользователей.

**Правило большого пальца:**
- Один AI-провайдер = один V42 пользователь
- Один деплой = один токен
- Один проект в CI = отдельный токен (чтобы scope был отдельным)

**Ротация токенов:**
Токены не истекают, но вращать их раз в квартал -- хорошая практика.
В UI: Admin > Agent Tokens > Revoke старый > Create новый > обновить конфиг.

---

### Claude Desktop

Конфиг: `%APPDATA%\Claude\claude_desktop_config.json` (Windows)
или `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS).

```json
{
  "mcpServers": {
    "v42": {
      "command": "wsl",
      "args": ["-u", "vpo", "/home/vpo/v42/bin/v42-mcp"],
      "env": {
        "V42_API_URL": "http://localhost:8080/api/v1",
        "V42_API_TOKEN": "<your-jwt-here>"
      }
    }
  }
}
```

После правки -- перезапустить Claude Desktop. В левом нижнем углу должно появиться
молоточек с числом инструментов (8). Если нет -- смотреть `%APPDATA%\Claude\logs\`.

---

### VS Code + GitHub Copilot

Создать файл `.vscode/mcp.json` в корне репозитория (уже лежит рядом с `.vscode/settings.json`):

```json
{
  "servers": {
    "v42": {
      "type": "stdio",
      "command": "wsl",
      "args": ["-u", "vpo", "/home/vpo/v42/bin/v42-mcp"],
      "env": {
        "V42_API_URL": "http://localhost:8080/api/v1",
        "V42_API_TOKEN": "${env:V42_API_TOKEN}"
      }
    }
  }
}
```

Переменную задаём в окружении или через VS Code settings:
```json
// .vscode/settings.json
{
  "terminal.integrated.env.windows": {
    "V42_API_TOKEN": "<your-jwt-here>"
  }
}
```

Открыть Copilot Chat --> переключить режим на **Agent** --> в выпадающем меню
инструментов появятся `list_projects`, `get_backlog_item` и остальные 6.

> Требует VS Code >= 1.99 и GitHub Copilot Chat >= 0.26.

---

### Cursor

Глобальный конфиг: `~/.cursor/mcp.json`
Или проектный: `.cursor/mcp.json` в корне репо.

```json
{
  "mcpServers": {
    "v42": {
      "command": "wsl",
      "args": ["-u", "vpo", "/home/vpo/v42/bin/v42-mcp"],
      "env": {
        "V42_API_URL": "http://localhost:8080/api/v1",
        "V42_API_TOKEN": "<your-jwt-here>"
      }
    }
  }
}
```

Cursor --> Settings --> MCP --> должен загореться зелёный кружок рядом с `v42`.
В Composer (Agent mode) инструменты появляются автоматически.

---

### Zed

`~/.config/zed/settings.json`:

```json
{
  "context_servers": {
    "v42": {
      "command": {
        "path": "wsl",
        "args": ["-u", "vpo", "/home/vpo/v42/bin/v42-mcp"],
        "env": {
          "V42_API_URL": "http://localhost:8080/api/v1",
          "V42_API_TOKEN": "<your-jwt-here>"
        }
      },
      "settings": {}
    }
  }
}
```

Zed --> Assistant Panel --> slash-команды из MCP появятся как `/v42:list_projects` и т.д.

---

### Continue.dev (VS Code / JetBrains)

`.continue/config.json`:

```json
{
  "mcpServers": [
    {
      "name": "v42",
      "command": "wsl",
      "args": ["-u", "vpo", "/home/vpo/v42/bin/v42-mcp"],
      "env": {
        "V42_API_URL": "http://localhost:8080/api/v1",
        "V42_API_TOKEN": "<your-jwt-here>"
      }
    }
  ]
}
```

---

### Windsurf (Codeium)

`%USERPROFILE%\.codeium\windsurf\mcp_config.json`:

```json
{
  "mcpServers": {
    "v42": {
      "command": "wsl",
      "args": ["-u", "vpo", "/home/vpo/v42/bin/v42-mcp"],
      "env": {
        "V42_API_URL": "http://localhost:8080/api/v1",
        "V42_API_TOKEN": "<your-jwt-here>"
      }
    }
  }
}
```

---

### Антигравитация (нативный WSL / CLI тест)

Для отладки и смоук-теста без всяких AI клиентов -- скрипт уже лежит:

```bash
# Проверка протокола (без живого API)
~/v42/scripts/test_mcp.sh

# Живой тест с реальным токеном
~/v42/scripts/test_mcp_live.sh

# Или руками:
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | V42_API_TOKEN=<token> ~/v42/bin/v42-mcp
```

Логи (включая ошибки HTTP) -- в stderr. Stdout -- только JSON-RPC.
Это важно: не надо смешивать их в пайпе.

---

### Сборка нативного Windows-бинарника (опционально)

Если хочется запускать без WSL (например, на macOS-машине или Windows без WSL):

```bash
# В WSL:
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o bin/v42-mcp.exe ./cmd/mcp

# Тогда в конфиге клиентов:
# "command": "C:\\path\\to\\v42-mcp.exe"
# Без "wsl" и args
```

Но V42 API всё равно должен быть доступен с той машины где запущен агент.

---

## Ссылки

- [Model Context Protocol Spec](https://modelcontextprotocol.io)
- [mcp-go library](https://github.com/mark3labs/mcp-go)
- [GitHub Copilot MCP support](https://docs.github.com/en/copilot/customizing-copilot/using-mcp-servers-in-github-copilot)
- [Cursor MCP docs](https://docs.cursor.com/context/model-context-protocol)
- [Zed context servers](https://zed.dev/docs/assistant/context-servers)
- [Continue.dev MCP](https://docs.continue.dev/customize/context-providers#mcp)
- V42 API Reference: [API_REFERENCE.md](API_REFERENCE.md)
- V42 Design: [DESIGN.md](DESIGN.md)

---

*Документ создан: 2026-05-26. Автор: Claude Sonnet 4.6 & vpo.*
*Следующий шаг: выбрать Phase A или Phase C и поставить в спринт.*
