.PHONY: dev build test lint migrate-up migrate-down sqlc \
        docker-up docker-down docker-dev docker-dev-down clean

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

# Download/update dependencies via Docker
tidy:
	$(DOCKER_GO) go mod tidy

# Run all tests with race detector via Docker
test:
	$(DOCKER_GO) go test -race -count=1 ./...

# Run go vet via Docker
vet:
	$(DOCKER_GO) go vet ./...

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
	sqlc generate

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
