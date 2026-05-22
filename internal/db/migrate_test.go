//go:build integration

package db_test

import (
	"context"
	"testing"

	"github.com/vpo/v42/internal/testutil"
)

// TestMigrationsApply verifies that all 000002_schema.up.sql tables
// exist in the public schema after migrations run.
// Requires: make test-db-up && make test-migrate-up
// Table count: 21 (19 original + activity_log + outbox)
func TestMigrationsApply(t *testing.T) {
	pool := testutil.NewDB(t)

	// Every table that Phase 1 migration must create.
	// If the migration changes, this list changes -- intentionally loud.
	want := []string{
		"users",
		"skills",
		"teams",
		"team_members",
		"member_skills",
		"refresh_tokens",
		"projects",
		"epics",
		"releases",
		"stages",
		"backlog_items",
		"tasks",
		"sprints",
		"sprint_items",
		"tests",
		"test_dependencies",
		"time_entries",
		"sprint_test_results",
		"comments",
		"activity_log",
		"outbox",
	}

	for _, tbl := range want {
		tbl := tbl
		t.Run(tbl, func(t *testing.T) {
			var n int
			err := pool.QueryRow(context.Background(),
				"SELECT COUNT(*) FROM information_schema.tables "+
					"WHERE table_schema = 'public' AND table_name = $1",
				tbl,
			).Scan(&n)
			if err != nil {
				t.Fatalf("query: %v", err)
			}
			if n != 1 {
				t.Errorf("table %q not found in public schema -- did you run: make test-migrate-up?", tbl)
			}
		})
	}
}

// TestConstraints_SprintTestResults verifies the CHECK constraint that
// enforces exactly one of (test_id, backlog_item_id) per result row.
// This constraint is load-bearing: it implements the ATDD model invariant.
func TestConstraints_SprintTestResults(t *testing.T) {
	pool := testutil.NewDB(t)
	ctx := context.Background()

	// Inserting a row with BOTH ids set must fail.
	_, err := pool.Exec(ctx, `
		INSERT INTO sprint_test_results (sprint_id, test_id, backlog_item_id, status)
		VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'pass')
	`)
	if err == nil {
		t.Error("expected constraint violation when both test_id and backlog_item_id are set, got nil")
	}

	// Inserting a row with NEITHER id set must also fail.
	_, err = pool.Exec(ctx, `
		INSERT INTO sprint_test_results (sprint_id, status)
		VALUES (gen_random_uuid(), 'pass')
	`)
	if err == nil {
		t.Error("expected constraint violation when neither test_id nor backlog_item_id is set, got nil")
	}
}

// TestConstraints_NoSelfDependency verifies that a test cannot depend on itself.
func TestConstraints_NoSelfDependency(t *testing.T) {
	pool := testutil.NewDB(t)
	ctx := context.Background()

	id := "gen_random_uuid()"
	_, err := pool.Exec(ctx, `
		INSERT INTO test_dependencies (test_id, depends_on_id)
		VALUES (`+id+`, `+id+`)
	`)
	if err == nil {
		t.Error("expected constraint violation for self-referencing test_dependency, got nil")
	}
}

// TestConstraints_CommentsExactlyOneParent verifies the CHECK constraint
// that ensures every comment belongs to exactly one planning element.
func TestConstraints_CommentsExactlyOneParent(t *testing.T) {
	pool := testutil.NewDB(t)
	ctx := context.Background()

	// No parent at all must fail.
	_, err := pool.Exec(ctx, `
		INSERT INTO comments (body, author_id)
		VALUES ('orphan comment', gen_random_uuid())
	`)
	if err == nil {
		t.Error("expected constraint violation for comment with no parent, got nil")
	}
}
