# V.42 Quick Start

This guide covers **deploying V.42** for regular use (production or team install).
For **developer setup** (running Go natively, editing code, running tests), see [README.md](README.md).

Get from zero to running in under 10 minutes.

---

## Prerequisites

- **Docker Desktop** (v4.20+) with the Docker Compose plugin -- on Linux, Docker Engine works too
- **Git**
- A terminal:
  - **Linux / macOS**: any bash/sh terminal
  - **Windows**: a **WSL terminal** (Windows Terminal -> Ubuntu) -- NOT PowerShell or CMD

> **Windows users:** `make`, `bash`, and all shell utilities used in this guide are Linux tools.
> They are available inside WSL. Do NOT run these commands from PowerShell or CMD.
> If you do not have WSL, follow [Microsoft's WSL install guide](https://learn.microsoft.com/en-us/windows/wsl/install) first.

That is it. No Go, no Node, no database client required on the host -- everything runs in containers.

> **Got a distributable package (v42-vX.Y.Z.tar.gz)?**
> Skip straight to [Offline / USB install](#offline--usb-install) below -- no git or internet needed.

---

## 1. Clone the repo

```bash
git clone https://github.com/vpo/v42.git
cd v42
```

> **Windows:** run this from your WSL terminal. Clone into the Linux filesystem (e.g. `~/v42`)
> for best performance, not into `/mnt/c/...`.

---

## 2. Configure environment

Copy the distribution template and fill in your secrets:

```bash
cp .env.dist .env
```

Open `.env` and change the three `CHANGE_ME_*` values:

| Variable              | What to put there                                              |
|-----------------------|----------------------------------------------------------------|
| `DB_PASSWORD`         | Any strong password, e.g. `openssl rand -base64 18`           |
| `JWT_SECRET`          | Random 32+ char hex string: `openssl rand -hex 32`            |
| `SEED_ADMIN_PASSWORD` | Temporary admin password -- you will be forced to change it   |

You can also change `SEED_ADMIN_EMAIL` from `admin@example.com` to whatever you prefer.

> **Security note:** The admin account is created with `must_change_password = true`.
> On first login you will be redirected to a forced password-change page.
> The same applies to all users created by the demo seed.

---

## 3. Start

```bash
make prod-up
```

> **Windows:** run from a WSL terminal, not PowerShell.

This single command:
1. Starts PostgreSQL 16
2. Runs all schema migrations
3. Builds and starts the Go API (seeds the admin account)
4. Builds the React frontend and serves it via nginx

Wait about 30-60 seconds for the images to build on the first run.

Check that everything is up:

```bash
docker compose -f docker-compose.prod.yml ps
```

You should see four services with status `running` (migrate will be `exited (0)` -- that is correct).

---

## 4. Open the app

Navigate to **http://localhost:8042** in your browser.

Log in with the admin credentials from your `.env` (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).

You will be redirected to the password-change page immediately. Set a real password.

---

## 5. Load demo data (optional)

If you want a pre-populated workspace with sample users, a team, a project,
epics, and backlog items:

```bash
make prod-seed
```

This runs the seed script once and exits. Demo users and their temporary passwords
are printed at the end of the output. All of them will be forced to change passwords
on first login.

---

## Stop and start

```bash
make prod-down    # stop containers (data is preserved)
make prod-up      # start again (no rebuild unless code changed)
```

---

## Rebuild after code changes

```bash
make prod-up      # rebuilds only changed layers (Docker cache)
make prod-rebuild # force full rebuild of all images
```

---

**Custom port:**
```bash
FRONTEND_PORT=9000 make prod-up
```
Or set `FRONTEND_PORT=9000` in your `.env`.

---

## Data persistence

PostgreSQL data lives in the Docker named volume `v42_postgres_data`.
It survives `make prod-down`. To wipe everything and start clean:

```bash
docker compose -f docker-compose.prod.yml down -v
```

**This deletes all data.** There is no undo.

---

## Upgrade

```bash
git pull
make prod-up     # rebuilds API and frontend images with new code
```

Migrations run automatically on startup.

---

## Offline / USB install

Use this path when you have a distributable package (`v42-vX.Y.Z.tar.gz`) and the
target machine has **no internet access** and no git.  Docker must be installed.

### 1. Extract and load images

```bash
tar -xzf v42-vX.Y.Z.tar.gz
cd v42-vX.Y.Z
./install.sh
```

`install.sh` loads all four pre-built Docker images and creates a `.env` file from the template.

### 2. Configure secrets

Open the generated `.env` and set the three required values:

| Variable              | What to put there                                            |
|-----------------------|--------------------------------------------------------------|
| `DB_PASSWORD`         | Strong random password, e.g. `openssl rand -base64 18`      |
| `JWT_SECRET`          | 32+ char hex string: `openssl rand -hex 32`                  |
| `SEED_ADMIN_PASSWORD` | Temporary admin password -- forced change on first login     |

Optionally change `SEED_ADMIN_EMAIL` and `FRONTEND_PORT` (default `8042`).

### 3. Start

```bash
docker compose up -d
```

Wait ~15 seconds for migrations to complete and the API to become healthy.

### 4. Open the app

Navigate to **http://localhost:8042** (or your `FRONTEND_PORT`).
Log in with the admin credentials from `.env`. Change the password when prompted.

### 5. Load demo data (optional)

Note: the seed step requires internet to pull `python:3.12-alpine` on first run.
If the machine is fully air-gapped, skip this.

```bash
docker compose --profile seed run --rm seed
```

### Stop / start / backup

The same commands as the git install (see sections above), but replace
`docker compose -f docker-compose.prod.yml` with plain `docker compose`.

### Building a new package

On a machine that has Docker (no local Go or Node required -- the build happens inside containers):

```bash
git clone https://github.com/vpo/v42.git
cd v42
make dist
# Produces dist/v42-<version>.tar.gz
```

---

## Troubleshooting

**Port 8042 already in use:**
Set `FRONTEND_PORT=8043` (or any free port) in `.env` and re-run `make prod-up`.

**Container not starting -- check logs:**
```bash
docker compose -f docker-compose.prod.yml logs api
docker compose -f docker-compose.prod.yml logs frontend
docker compose -f docker-compose.prod.yml logs migrate
```

**API says "production config rejected":**
You left one of the `CHANGE_ME_*` values in `.env`. Open `.env` and set real values.

**Demo seed fails with "connection refused":**
The API health check may still be warming up. Wait 10 seconds and retry:
```bash
make prod-seed
```

---

## Backup

PostgreSQL stores everything: users, hashed passwords, teams, projects, backlog -- the whole state.
The backup is a standard `pg_dump` SQL file, portable across PostgreSQL 16 instances.

### Create a backup

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --compress=9 \
  > backup_$(date +%Y%m%d_%H%M%S).dump
```

Or with explicit values (if you have not exported the env):

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U v42user -d v42db --format=custom --compress=9 \
  > backup_$(date +%Y%m%d_%H%M%S).dump
```

Replace `v42user` / `v42db` with the values of `DB_USER` / `DB_NAME` from your `.env`.

**What the dump contains:**
- All tables and schema (users, teams, projects, backlog items, sprints, ...)
- User accounts with `bcrypt`-hashed passwords -- credentials are preserved but
  never stored in plain text
- All ENUM types, indexes, constraints
- **Does not contain** the `.env` file -- back that up separately (it holds JWT_SECRET,
  DB_PASSWORD, etc.)

**Automate it (cron example):**

```bash
# /etc/cron.d/v42-backup  -- runs daily at 03:00
0 3 * * *  root  cd /path/to/v42 && \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U v42user -d v42db --format=custom --compress=9 \
  > /backups/v42_$(date +\%Y\%m\%d).dump \
  && find /backups -name 'v42_*.dump' -mtime +30 -delete
```

---

## Restore from backup

### Into the running stack (in-place restore)

Stop the API so nothing is writing to the database while you restore:

```bash
docker compose -f docker-compose.prod.yml stop api frontend
```

Drop and recreate the database:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U v42user -d postgres -c "DROP DATABASE IF EXISTS v42db; CREATE DATABASE v42db;"
```

Load the dump:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U v42user -d v42db --no-owner --role=v42user \
  < backup_20260101_030000.dump
```

Bring the stack back up (migrations re-run automatically and are idempotent):

```bash
make prod-up
```

### Into a fresh installation

1. Follow steps 1-3 of this guide (clone, configure `.env`, `make prod-up`).
2. Stop the API: `docker compose -f docker-compose.prod.yml stop api frontend`
3. Drop + recreate DB and load the dump as shown above.
4. `make prod-up`

> **Note:** The `JWT_SECRET` in `.env` does NOT need to match the original -- it only
> affects session tokens, not stored data. Users log in normally after restore.
> The `DB_PASSWORD` in `.env` MUST match the one used when the container was first
> created (it is baked into the volume). If you are moving to a new machine, copy
> `.env` verbatim along with the dump file.

---

## Architecture summary

```
Browser
  |
  v
[nginx :8042]  ---- /api/* ----> [Go API :8080 internal]
     |                               |
     |--- /* (SPA) ---> index.html   v
                               [PostgreSQL :5432 internal]
```

All services communicate inside the Docker network. Only port 8042 (nginx)
is exposed to the host by default. The API and database are not reachable
from outside Docker.
