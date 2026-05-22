.PHONY: dev build test lint migrate-up migrate-down sqlc \
        docker-up docker-down docker-dev docker-dev-down \
        test-db-up test-db-down test-migrate-up test-migrate-down test-integration \
        clean

-include .env
export

GO_IMAGE   := golang:1.25-alpine
GO_CACHE   := v42-gomod-cache
DOCKER_GO  := docker run --rm \
	-v "$(CURDIR):/app" \
	-v "$(GO_CACHE):/root/go/pkg/mod" \
	-w /app $(GO_IMAGE)

# Run API locally (requires: make docker-dev first, and Go installed)
# Or use: make docker-run
dev:
	go run ./cmd/api

# Build binary to bin/v42 (native, requires Go installed)
build:
	go build -ldflags="-s -w" -o bin/v42 ./cmd/api

# Build via Docker (no local Go required)
docker-build-go:
	$(DOCKER_GO) go build -ldflags="-s -w" -o bin/v42 ./cmd/api

# Download/update dependencies (native Go)
tidy:
	go mod tidy

# Run all unit tests with race detector (native Go + CGO)
test:
	go test -race -count=1 ./...

# Run go vet (native Go)
vet:
	go vet ./...

# Lint (install: https://golangci-lint.run/usage/install/)
lint:
	golangci-lint run ./...

# Apply all pending migrations
migrate-up:
	migrate \
		-database "postgres://$(DB_USER):$(DB_PASSWORD)@$(DB_HOST):$(DB_PORT)/$(DB_NAME)?sslmode=$(DB_SSL_MODE)" \
		-path migrations up

# Roll back one migration
migrate-down:
	migrate \
		-database "postgres://$(DB_USER):$(DB_PASSWORD)@$(DB_HOST):$(DB_PORT)/$(DB_NAME)?sslmode=$(DB_SSL_MODE)" \
		-path migrations down 1

# Generate typed Go code from SQL queries
sqlc:
	sqlc generate --no-remote

# Full stack: postgres + adminer + api (production-like)
docker-up:
	docker compose up -d --build

# Stop full stack
docker-down:
	docker compose down

# Dev infrastructure only: postgres + adminer (run API with: make dev)
docker-dev:
	docker compose -f docker-compose.dev.yml up -d

# Stop dev infrastructure
docker-dev-down:
	docker compose -f docker-compose.dev.yml down

# Remove built binary
clean:
	rm -rf bin/

# ----------------------------------------------------------------
# Test infrastructure
# ----------------------------------------------------------------

# DSN inside Docker network (for migrate container)
TEST_DB_DSN_INTERNAL := postgres://v42:testpassword@postgres_test:5432/v42_test?sslmode=disable
# DSN from host/WSL (port 5433 exposed)
TEST_DB_DSN_HOST     := postgres://v42:testpassword@localhost:5433/v42_test?sslmode=disable

# Official migrate image -- no local CLI installation required
DOCKER_MIGRATE := docker run --rm \
	-v "$(CURDIR)/migrations:/migrations" \
	--network v42_test \
	migrate/migrate

# Start isolated test postgres (port 5433 on host)
test-db-up:
	docker compose -f docker-compose.test.yml up -d

# Stop and remove test postgres + its volume
test-db-down:
	docker compose -f docker-compose.test.yml down -v

# Apply all migrations to test database
test-migrate-up:
	$(DOCKER_MIGRATE) -database "$(TEST_DB_DSN_INTERNAL)" -path /migrations up

# Roll back one migration on test database
test-migrate-down:
	$(DOCKER_MIGRATE) -database "$(TEST_DB_DSN_INTERNAL)" -path /migrations down 1

# Run integration tests (requires: make test-db-up && make test-migrate-up)
test-integration:
	TEST_DB_DSN="$(TEST_DB_DSN_HOST)" go test -race -tags integration -v ./...
