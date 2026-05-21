// Package testutil provides helpers for V42 integration tests.
//
// Integration tests require a running test database.
// Start one with: make test-db-up
// Apply migrations: make test-migrate-up
package testutil

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DefaultTestDSN is used when TEST_DB_DSN env var is not set.
// Matches docker-compose.test.yml: postgres_test on host port 5433.
const DefaultTestDSN = "postgres://v42:testpassword@localhost:5433/v42_test?sslmode=disable"

// DSN returns the connection string for the test database.
// Override with TEST_DB_DSN env var (set automatically by make test-integration).
func DSN() string {
	if v := os.Getenv("TEST_DB_DSN"); v != "" {
		return v
	}
	return DefaultTestDSN
}

// NewDB opens a pgxpool connection to the test database and registers cleanup.
// It assumes migrations have already been applied (make test-migrate-up).
// Fails immediately with a helpful message if the DB is unreachable.
func NewDB(t *testing.T) *pgxpool.Pool {
	t.Helper()

	pool, err := pgxpool.New(context.Background(), DSN())
	if err != nil {
		t.Fatalf("testutil.NewDB: pgxpool.New: %v", err)
	}

	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Fatalf(
			"testutil.NewDB: cannot reach test DB at %s: %v\n\n"+
				"Run: make test-db-up && make test-migrate-up",
			DSN(), err,
		)
	}

	t.Cleanup(pool.Close)
	return pool
}
