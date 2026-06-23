# V.42

Project management platform. Spiritual successor to VersionOne / Planview Agility.
Built without enterprise bloat, XML APIs, or mandatory SAFe certification.
Focus on the Team, Capabilities, and Capacity.

**"Grow your team - grow your capabilites"**

Stack: **Go 1.25** + **PostgreSQL 16** + **React 18** (Vite + TanStack Query + Zustand + dnd-kit).

---

## Development Environment

All build commands run in a **Linux shell** (bash). Two supported setups:

| | Native Linux | Windows with WSL2 |
|---|---|---|
| **Shell** | Any terminal | WSL2 terminal (Ubuntu) -- NOT PowerShell |
| **Go 1.25** | Install natively | Install inside WSL |
| **Docker** | Docker Engine | Docker Desktop with WSL2 backend |
| **Project path** | Wherever you cloned it | Symlinked from Windows filesystem into WSL |

> **Windows users:** every `make` command in this file must be run from a **WSL terminal**
> (Windows Terminal -> Ubuntu), not from PowerShell or CMD. Make and Go are not installed
> on the Windows side.

---

## One-Time Setup: Native Linux

### 1. Install Go 1.25

```bash
curl -Lo /tmp/go.tar.gz https://go.dev/dl/go1.25.0.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf /tmp/go.tar.gz
sudo ln -sf /usr/local/go/bin/go /usr/local/bin/go
sudo ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
go version
# go version go1.25.0 linux/amd64
```

### 2. Install Docker Engine

Follow the official guide for your distro:
[https://docs.docker.com/engine/install/](https://docs.docker.com/engine/install/)

Then add your user to the `docker` group so you can run Docker without `sudo`:

```bash
sudo usermod -aG docker $USER
# Log out and back in for the group change to take effect
```

### 3. Verify

```bash
cd /path/to/v42
make vet    # runs go vet ./... -- should print nothing on success
```

---

## One-Time Setup: Windows with WSL2

Open a **WSL terminal** (Windows Terminal -> Ubuntu) for all steps below.

### 1. Install Go 1.25 in WSL

```bash
curl -Lo /tmp/go.tar.gz https://go.dev/dl/go1.25.0.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf /tmp/go.tar.gz
sudo ln -sf /usr/local/go/bin/go /usr/local/bin/go
sudo ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
go version
# go version go1.25.0 linux/amd64
```

### 2. Install Docker Desktop (Windows side)

Download and install [Docker Desktop](https://www.docker.com/products/docker-desktop/) with
the **WSL2 backend** enabled. Docker Desktop makes the `docker` command available inside WSL
automatically -- no separate Docker installation inside WSL is needed.

### 3. Fix WSL HOME variable

WSL inherits the Windows `HOME` variable, which breaks `~` expansion in some shells.
Run once:

```bash
printf 'export HOME=$(getent passwd $(id -un) | cut -d: -f6)\n' \
  | sudo tee /etc/profile.d/fix-wsl-home.sh
sudo chmod +x /etc/profile.d/fix-wsl-home.sh
# Reload the shell (open a new WSL tab or run: source /etc/profile.d/fix-wsl-home.sh)
```

### 4. Symlink the project into WSL home

Link the Windows project folder into your Linux home so `~/v42` and `C:\...\V42`
are the same directory -- one copy, zero sync overhead:

```bash
# Adjust the path if your project lives elsewhere on Windows
ln -s /mnt/c/Users/$USER/Desktop/V42 ~/v42
ls ~/v42/go.mod   # should print the file path
```

### 5. Verify

```bash
cd ~/v42
make vet    # runs go vet ./... -- should print nothing on success
```

---

## Quick Start (Development Mode)

> Run all commands below in a **Linux terminal** (native Linux) or a **WSL terminal**
> (Windows: Windows Terminal -> Ubuntu). Do NOT use PowerShell or CMD.

```bash
# Native Linux:
cd /path/to/v42

# Windows (WSL):
cd ~/v42

cp .env.example .env          # copy dev defaults; set DB_PASSWORD and JWT_SECRET at minimum

make docker-dev               # start postgres + adminer in background (Docker required)
make migrate-up               # apply all SQL migrations
make dev                      # start the API -- logs to stdout, Ctrl+C to stop
```

In a second terminal (same type -- Linux or WSL):

```bash
curl http://localhost:8080/api/v1/health
# {"data":{"status":"ok","db":"ok","version":"0.1.0"},"error":null,"meta":null}
```

`status: ok` means the API is up. `db: ok` means PostgreSQL is reachable.

To also run the React frontend in dev mode:

```bash
cd frontend
npm install        # first time only
npm run dev        # Vite dev server on http://localhost:5173
```

Or as a detached background process (survives terminal close):

```bash
make frontend-dev           # logs: /tmp/v42-vite.log
make frontend-kill          # stop it
```

### Database browser (Adminer)

Open [http://localhost:8742](http://localhost:8742) after `make docker-dev`.

| Field | Value |
|-------|-------|
| System | PostgreSQL |
| Server | postgres |
| Username | value of `DB_USER` in `.env` |
| Password | value of `DB_PASSWORD` in `.env` |
| Database | value of `DB_NAME` in `.env` |

---

## Makefile Commands

```bash
# -- Go (requires Go 1.25 -- see one-time setup above) --
make dev               # run API locally (requires: make docker-dev first)
make build             # build binary to bin/v42
make tidy              # go mod tidy
make vet               # go vet ./...
make test              # go test -race ./...  (unit tests)
make lint              # golangci-lint run

# -- Docker infrastructure --
make docker-dev        # start postgres + adminer in background
make docker-dev-down   # stop postgres + adminer
make docker-up         # start full stack (postgres + api + adminer)
make docker-down       # stop full stack

# -- Migrations (golang-migrate via Docker, no local CLI needed) --
make migrate-up        # apply all pending SQL migrations
make migrate-down      # roll back one migration

# -- Integration tests (isolated postgres on port 5433) --
make test-db-up        # start test postgres
make test-db-down      # stop test postgres + wipe volume
make test-migrate-up   # apply migrations to test DB
make test-integration  # go test -race -tags integration ./...

# -- Code generation --
make sqlc              # regenerate Go code from SQL query files
make docker-build-go   # build binary via Docker (for CI without local Go)
```

---

## Project Layout

```
cmd/api/           -- entry point (main.go)
internal/
  api/             -- HTTP router, handlers
    middleware/    -- logger, cors, rate limiter
  config/          -- environment variables, validation
  db/              -- database connection pool
    queries/       -- SQL query files for sqlc (edit these)
    gen/           -- generated by sqlc (never edit by hand)
migrations/        -- numbered SQL migration files (up + down)
docker/
  postgres/        -- init.sql runs on first container start
.github/
  skills/          -- AI agent skill files (v42-go, v42-db, v42-frontend, v42-pm)
.env.example       -- all available env vars with comments
.env               -- your local config (gitignored)
```

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and edit as needed.

Required variables (the app refuses to start without them):

| Variable | Description |
|----------|-------------|
| `DB_NAME` | PostgreSQL database name |
| `DB_USER` | PostgreSQL username |
| `DB_PASSWORD` | PostgreSQL password |
| `JWT_SECRET` | Secret for signing JWT tokens (min 32 chars in prod) |

Everything else has sensible defaults. See [.env.example](.env.example) for the full list.

---

## Development Workflow

Edit code in VS Code (Windows or Linux). Run all `make` commands in a Linux/WSL terminal.

```bash
# Typical loop
make dev                 # start API; Ctrl+C to stop, re-run to reload
make test                # unit tests with race detector
make test-integration    # integration tests (needs test-db-up first)
```

Database schema changes:

```bash
# 1. Create migration files
touch migrations/00000N_describe_change.{up,down}.sql
# 2. Fill them in, then:
make migrate-up
```

New SQL queries (typed Go code via sqlc):

```bash
# 1. Add query to internal/db/queries/<domain>.sql
# 2. Regenerate
make sqlc
# 3. Use generated functions from internal/db/gen/
```

---

## Architecture

```
Browser / API client
        |
    HTTP (8080)
        |
    Go API (chi router)
    - RequestID -> RealIP -> Logger -> CORS -> Recoverer
    - Auth endpoints: rate limited (10 req/min per IP)
        |
    pgx/v5 pool (max 25 connections)
        |
    PostgreSQL 16 (port 5432)
```

Response envelope -- every endpoint returns:

```json
{
  "data": <payload or null>,
  "meta": <pagination or null>,
  "error": <{"code": "...", "message": "..."} or null>
}
```

---

## Current Status

| Phase | What | Status |
|-------|------|--------|
| 0 | Scaffold: Go, chi, pgx, middleware, health endpoint | Done |
| 1 | Full DB schema (19 tables, 13 ENUMs), migrations, test infra | Done |
| 2 | Auth: login, JWT tokens, refresh, logout | Done |
| 3 | Projects, epics, backlog items, teams, skills | Done |
| 4 | Tasks, comments, sprint management, SSE | Done |
| 5 | React frontend (all core pages) | Done |
| 6 | Distribution: Docker all-in-one, demo seed | Done |
| 7 | Analytics, export, project hierarchy | Planned |

---

## Deploying / Distribution

> See [QUICK_START.md](QUICK_START.md) for the full deployment and installation guide.

**TL;DR -- three commands from zero to a running production stack:**

```bash
# Run from a Linux terminal (native) or WSL terminal (Windows)
cp .env.dist .env          # fill in DB_PASSWORD, JWT_SECRET, SEED_ADMIN_PASSWORD
make prod-up               # builds images and starts everything in Docker
# open http://localhost:8042
```

> `.env.dist` is the production template with `CHANGE_ME_*` placeholders.
> `.env.example` (used in dev) has pre-filled defaults and is not suitable for production.

### Build the distribution images

```bash
# Full rebuild (no cache)
make prod-rebuild

# Normal rebuild (uses Docker cache -- only changed layers)
make prod-up
```

### Load demo data

```bash
make prod-seed             # creates sample users, team, project, backlog
```

All demo users are created with `must_change_password = true` -- they are forced
to change their password on first login. This includes the bootstrap admin account.

### Makefile distribution targets

| Command | What it does |
|---------|-------------|
| `make prod-up` | Build images and start postgres + api + frontend |
| `make prod-down` | Stop all containers (data is preserved) |
| `make prod-seed` | Load demo data into a running stack |
| `make prod-rebuild` | Force full image rebuild (no Docker cache) |
