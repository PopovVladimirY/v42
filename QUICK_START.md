# V.42 Quick Start

Get from zero to running in under 10 minutes.

---

## Prerequisites

- **Docker Desktop** (v4.20+) with the Docker Compose plugin
- **Git**
- A terminal (PowerShell, bash, or WSL)

That is it. No Go, no Node, no database client required -- everything runs in containers.

---

## 1. Clone the repo

```bash
git clone https://github.com/vpo/v42.git
cd v42
```

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
