# V.42 -- Operational Playbook

> Платформа управляет собой. Данные не теряются. Апгрейды без слёз.

---

## Bootstrap: переезжаем на себя (Мюнхгаузен)

Управление V.42 переносится в V.42. Текстовые файлы остаются как архив.

### Что создаём в системе

| V.42 объект | Содержимое |
|-------------|------------|
| **Проект** | "V.42 Platform" (уже существует: `75b310d5-...`) |
| **Команда** | "Core" (уже существует: `81af9417-...`) |
| **Эпики** | По одному на каждую фазу из DESIGN.md |
| **Беклог** | Открытые задачи + технический долг из DESIGN_REVIEW_4.md |
| **Спринт** | Текущий (Phase 5 + долги Phase 3c) |

### Как вносить фазы

```
Phase 0 -- Foundation        → Epic, status: done
Phase 1 -- Schema            → Epic, status: done
Phase 2 -- Auth              → Epic, status: done
Phase 3 -- Users/Teams       → Epic, status: done
Phase 3c -- Multi-team       → Epic, status: done
Phase 4 -- Work items        → Epic, status: done
Phase 4.5 -- Sprints         → Epic, status: done  (board view -- pending, беклог-айтем)
Phase 5 -- Releases/Stages   → Epic, status: active  ← текущий фронт
Phase 6 -- Clarity + Stats   → Epic, status: draft
Phase 7 -- SSE Real-time     → Epic, status: draft
Phase 8 -- UI Polish / DnD   → Epic, status: draft
```

Исторические задачи внутри done-эпиков **не детализировать** — тратить время не стоит.
Достаточно беклог-айтема на эпик с кратким описанием результата и статусом `done`.

### Агенты как члены команды

Создать пользователей через `POST /api/v1/users` (admin):

| Email | Display name | Role | Навыки |
|-------|-------------|------|--------|
| `copilot@v42.local` | GitHub Copilot | maintainer | Go, TypeScript, SQL, React, PostgreSQL — все expert |
| `vpo@v42.local` | vpo | admin | Architecture, Product, Go, TypeScript — proficient/expert |

Это одновременно тест user-creation flow и документация команды.

---

## Backup: не теряем данные

### Ручной снапшот (разработка)

```bash
# сделать дамп текущей БД (из WSL)
make db-dump

# что делает make db-dump:
docker exec v42_postgres pg_dump \
  -U v42 -d v42 --no-owner --no-acl \
  -Fc -f /tmp/v42_$(date +%Y%m%d_%H%M%S).dump

# скопировать из контейнера на хост
docker cp v42_postgres:/tmp/v42_*.dump ./backups/
```

Добавить в Makefile:

```makefile
db-dump:
	@mkdir -p backups
	docker exec v42_postgres pg_dump \
	  -U v42 -d v42 --no-owner --no-acl -Fc \
	  -f /tmp/v42_$$(date +%Y%m%d_%H%M%S).dump
	docker cp v42_postgres:/tmp/v42_$$(date +%Y%m%d_%H%M%S).dump ./backups/
	@echo "Dump saved to ./backups/"

db-restore:
	@test -n "$(FILE)" || (echo "Usage: make db-restore FILE=backups/v42_....dump" && exit 1)
	docker cp $(FILE) v42_postgres:/tmp/restore.dump
	docker exec v42_postgres pg_restore \
	  -U v42 -d v42 --clean --if-exists /tmp/restore.dump
```

### Автоматический backup (pre-migration хук)

Перед каждым `make migrate-up` — автодамп:

```makefile
migrate-up: db-dump
	docker run --rm \
	  -v "$(PWD)/migrations:/migrations" \
	  --network v42_default \
	  migrate/migrate \
	  -database "$(DATABASE_URL)" \
	  -path /migrations up
```

Теперь `make migrate-up` всегда сначала сохраняет состояние. Откат возможен.

### Расписание (продакшн, когда дойдём)

```bash
# crontab -e (на хосте)
0 3 * * * cd ~/v42 && make db-dump >> logs/backup.log 2>&1
# ежедневно в 3:00, дампы в ./backups/
# хранить последние 30:
find ./backups -name '*.dump' -mtime +30 -delete
```

---

## Upgrade: миграция без страха

### Стандартный цикл апгрейда

```
1. make db-dump                    -- страховка перед всем
2. git pull                        -- новый код
3. go build ./...                  -- убедиться, что собирается
4. make migrate-up                 -- применить новые миграции
5. make dev (или restart сервиса)  -- запустить новый бинарник
6. go test -tags=integration ./... -- убедиться, что всё зелёное
```

**Критическое правило:** сервер убивать ПОСЛЕ применения миграций, не до.
Старый бинарник на новой схеме = 500. (Урок Phase 3c: стоило часа отладки.)

Правильная последовательность:
```
old binary running → migrate-up → kill old → start new binary
```

### Rollback

```bash
# если что-то пошло не так после migrate-up:
make migrate-down              # откат одной миграции
make db-restore FILE=backups/v42_YYYYMMDD_HHMMSS.dump  # ядерный вариант
```

Down-миграции обязательны для каждой up-миграции. Проверять в тест-базе до мержа.

### Zero-downtime (будущее, Phase 7+)

Сейчас: single-instance, downtime при рестарте ~1-2 секунды — приемлемо.
Когда понадобится ZDD:
- Blue-green deploy: поднять новый инстанс, переключить nginx upstream, убить старый
- Требует: миграции должны быть backward-compatible (additive only, no DROP в той же версии)

---

## Export / Import данных

### SQL dump (полный)

```bash
# Export: человекочитаемый SQL (для аудита, переноса)
docker exec v42_postgres pg_dump \
  -U v42 -d v42 --no-owner --no-acl \
  --inserts \                    # INSERT вместо COPY -- переносимо
  -f /tmp/v42_export.sql
docker cp v42_postgres:/tmp/v42_export.sql ./exports/

# Import на новый инстанс:
psql $NEW_DATABASE_URL < ./exports/v42_export.sql
```

### JSON export по API (будущая фича)

Для отчётности и интеграций: `GET /api/v1/projects/{id}/export?format=json`
Возвращает всё дерево проекта: эпики → беклог → задачи → тесты → спринты → результаты.

Подходит для:
- Переноса проекта между инстансами V.42
- Генерации release notes (см. TODO.md: экспорт по спринту/этапу)
- AI-агентов, которым нужен полный контекст проекта

Формат (черновик):
```json
{
  "project": { "id": "...", "name": "...", "status": "active" },
  "epics": [...],
  "backlog": [
    {
      "id": "...",
      "title": "...",
      "status": "done",
      "tasks": [...],
      "sprint_results": [...]
    }
  ],
  "sprints": [...],
  "exported_at": "2026-05-23T..."
}
```

CSV export (`?format=csv`) — табличный вид для Excel/отчётов:
- Строка = беклог-айтем
- Колонки: id, title, type, status, priority, epic, assignee, estimate, sprint

**Это Phase 5+ задача.** Пока: использовать прямой SQL dump.

### Перенос между средами (dev → staging → prod)

```bash
# Дамп dev
make db-dump

# Восстановить на staging (с другой строкой подключения)
pg_restore \
  -h staging-host -U v42 -d v42 \
  --clean --if-exists \
  ./backups/v42_latest.dump
```

Важно: `refresh_tokens` и `activity_log` можно не переносить — они среда-специфичные.
Для переноса только бизнес-данных:
```bash
pg_dump -U v42 -d v42 \
  -t users -t skills -t teams -t team_members -t member_skills \
  -t projects -t project_teams -t epics -t backlog_items \
  -t tasks -t tests -t sprints -t sprint_items \
  --inserts -f ./exports/v42_data_only.sql
```

---

## Что делать прямо сейчас

1. Добавить `make db-dump` и `make db-restore` в Makefile
2. Обновить `make migrate-up` чтобы вызывал `db-dump` как prerequisite
3. Создать директорию `backups/` с `.gitignore` (дампы не в репо)
4. Создать первый ручной дамп: `make db-dump`
5. Приступить к bootstrap: создать эпики Phase 0–8 в V.42

```bash
# Быстрый старт
mkdir -p backups exports
echo "backups/*.dump" >> .gitignore
echo "exports/*.sql" >> .gitignore
echo "exports/*.json" >> .gitignore
echo "exports/*.csv" >> .gitignore
```
