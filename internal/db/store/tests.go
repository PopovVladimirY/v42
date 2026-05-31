package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/domain"
)

// TestSpec is the store-level representation of a test spec.
type TestSpec struct {
	ID              string    `json:"id"`
	ProjectID       string    `json:"project_id"`
	BacklogItemID   *string   `json:"backlog_item_id,omitempty"`
	EpicID          *string   `json:"epic_id,omitempty"`
	Title           string    `json:"title"`
	Description     *string   `json:"description"`
	Setup           *string   `json:"setup"`
	Config          *string   `json:"config"`
	Steps           *string   `json:"steps"`
	ExpectedResults *string   `json:"expected_results"`
	Type            string    `json:"type"`
	SkillRequired   *string   `json:"skill_required"`
	CreatedBy       string    `json:"created_by"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	Number          int64     `json:"number"`
}

// TestStore wraps sqlc test queries.
type TestStore struct {
	q *dbgen.Queries
}

// NewTestStore returns a TestStore backed by sqlc Queries.
func NewTestStore(q *dbgen.Queries) *TestStore {
	return &TestStore{q: q}
}

func testFromRow(r dbgen.Test) TestSpec {
	ts := TestSpec{
		ID:              uuidToString(r.ID),
		ProjectID:       uuidToString(r.ProjectID),
		Title:           r.Title,
		Description:     r.Description,
		Setup:           r.Setup,
		Config:          r.Config,
		Steps:           r.Steps,
		ExpectedResults: r.ExpectedResults,
		Type:            string(r.Type),
		CreatedBy:       uuidToString(r.CreatedBy),
		CreatedAt:       r.CreatedAt.Time,
		UpdatedAt:       r.UpdatedAt.Time,
		Number:          r.Number,
	}
	if r.BacklogItemID.Valid {
		v := uuidToString(r.BacklogItemID)
		ts.BacklogItemID = &v
	}
	if r.EpicID.Valid {
		v := uuidToString(r.EpicID)
		ts.EpicID = &v
	}
	if r.SkillRequired.Valid {
		v := uuidToString(r.SkillRequired)
		ts.SkillRequired = &v
	}
	return ts
}

// CreateTest creates a new test spec. parentKind is "project", "epic", or "item".
func (s *TestStore) CreateTest(ctx context.Context, projectID, parentKind, parentID, title, testType, createdBy string,
	description, setup, config, steps, expectedResults, skillRequired *string) (*TestSpec, error) {

	projUUID, err := parseUUID(projectID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	createdByUUID, err := parseUUID(createdBy)
	if err != nil {
		return nil, domain.ErrNotFound
	}

	arg := dbgen.CreateTestParams{
		ProjectID:       projUUID,
		Title:           title,
		Description:     description,
		Setup:           setup,
		Config:          config,
		Steps:           steps,
		ExpectedResults: expectedResults,
		CreatedBy:       createdByUUID,
	}

	// Optional required-skill FK. Bad UUIDs are treated as "not found" upstream.
	if skillRequired != nil {
		if arg.SkillRequired, err = parseUUID(*skillRequired); err != nil {
			return nil, domain.ErrNotFound
		}
	}

	// Wire the nullable type field.
	validTypes := map[string]bool{"manual": true, "acceptance": true, "integration": true, "unit": true}
	if !validTypes[testType] {
		testType = "manual"
	}
	arg.Type = dbgen.TestType(testType)

	switch parentKind {
	case "item":
		uid, err := parseUUID(parentID)
		if err != nil {
			return nil, domain.ErrNotFound
		}
		arg.BacklogItemID = uid
	case "epic":
		uid, err := parseUUID(parentID)
		if err != nil {
			return nil, domain.ErrNotFound
		}
		arg.EpicID = uid
	// "project" level: both remain zero (invalid = null)
	}

	row, err := s.q.CreateTest(ctx, arg)
	if err != nil {
		return nil, err
	}
	ts := testFromRow(row)
	return &ts, nil
}

// GetTest fetches a single test spec, checking project scope.
func (s *TestStore) GetTest(ctx context.Context, projectID, id string) (*TestSpec, error) {
	projUUID, err := parseUUID(projectID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	testUUID, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	row, err := s.q.GetTest(ctx, dbgen.GetTestParams{ID: testUUID, ProjectID: projUUID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	ts := testFromRow(row)
	return &ts, nil
}

// ListTests returns tests for the given scope within a project.
func (s *TestStore) ListTests(ctx context.Context, projectID, scope, scopeID string) ([]TestSpec, error) {
	projUUID, err := parseUUID(projectID)
	if err != nil {
		return nil, domain.ErrNotFound
	}

	var rows []dbgen.Test
	switch scope {
	case "item":
		itemUUID, err := parseUUID(scopeID)
		if err != nil {
			return nil, domain.ErrNotFound
		}
		rows, err = s.q.ListTestsByBacklogItem(ctx, dbgen.ListTestsByBacklogItemParams{
			ProjectID:     projUUID,
			BacklogItemID: itemUUID,
		})
		if err != nil {
			return nil, err
		}
	case "epic":
		epicUUID, err := parseUUID(scopeID)
		if err != nil {
			return nil, domain.ErrNotFound
		}
		rows, err = s.q.ListTestsByEpic(ctx, dbgen.ListTestsByEpicParams{
			ProjectID: projUUID,
			EpicID:    epicUUID,
		})
		if err != nil {
			return nil, err
		}
	default: // "project"
		rows, err = s.q.ListTestsByProject(ctx, projUUID)
		if err != nil {
			return nil, err
		}
	}

	out := make([]TestSpec, len(rows))
	for i, r := range rows {
		out[i] = testFromRow(r)
	}
	return out, nil
}

// UpdateTest patches fields on an existing test spec.
func (s *TestStore) UpdateTest(ctx context.Context, projectID, id string,
	title, description, setup, config, steps, expectedResults *string,
	testType, skillRequired *string) (*TestSpec, error) {

	projUUID, err := parseUUID(projectID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	testUUID, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}

	arg := dbgen.UpdateTestParams{
		ID:              testUUID,
		ProjectID:       projUUID,
		Title:           title,
		Description:     description,
		Setup:           setup,
		Config:          config,
		Steps:           steps,
		ExpectedResults: expectedResults,
	}
	if testType != nil {
		arg.Type = dbgen.NullTestType{TestType: dbgen.TestType(*testType), Valid: true}
	}
	if skillRequired != nil {
		if arg.SkillRequired, err = parseUUID(*skillRequired); err != nil {
			return nil, domain.ErrNotFound
		}
	}

	row, err := s.q.UpdateTest(ctx, arg)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	ts := testFromRow(row)
	return &ts, nil
}

// DeleteTest removes a test spec.
func (s *TestStore) DeleteTest(ctx context.Context, projectID, id string) error {
	projUUID, err := parseUUID(projectID)
	if err != nil {
		return domain.ErrNotFound
	}
	testUUID, err := parseUUID(id)
	if err != nil {
		return domain.ErrNotFound
	}
	return s.q.DeleteTest(ctx, dbgen.DeleteTestParams{ID: testUUID, ProjectID: projUUID})
}

// MoveTo reassigns a test to a different backlog item.
func (s *TestStore) MoveTo(ctx context.Context, testID, targetItemID string) (*TestSpec, error) {
	tid, err := parseUUID(testID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	nid, err := parseUUID(targetItemID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.MoveTest(ctx, dbgen.MoveTestParams{ID: tid, BacklogItemID: nid})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	ts := testFromRow(r)
	return &ts, nil
}

// -- Sprint test results -----------------------------------------------------

// SprintTestResultRow is the store-level view of a sprint test result.
type SprintTestResultRow struct {
	ID            string    `json:"id"`
	SprintID      string    `json:"sprint_id"`
	TestID        *string   `json:"test_id,omitempty"`
	BacklogItemID *string   `json:"backlog_item_id,omitempty"`
	Status        string    `json:"status"`
	SkipReason    *string   `json:"skip_reason,omitempty"`
	Notes         *string   `json:"notes,omitempty"`
	ExecutedBy    *string   `json:"executed_by,omitempty"`
	ExecutedAt    *time.Time `json:"executed_at,omitempty"`
	TestTitle     *string   `json:"test_title,omitempty"`
	TestType      *string   `json:"test_type,omitempty"`
	ItemTitle     *string   `json:"item_title,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// SprintTestStore wraps sqlc sprint_test_results queries.
type SprintTestStore struct {
	q    *dbgen.Queries
	pool *pgxpool.Pool
}

// NewSprintTestStore returns a SprintTestStore.
func NewSprintTestStore(q *dbgen.Queries, pool *pgxpool.Pool) *SprintTestStore {
	return &SprintTestStore{q: q, pool: pool}
}

// InitResults creates result rows for all tests and AC items in the sprint.
// Both seeding queries run in one transaction: a sprint must never end up with
// half its result grid populated if the second insert trips.
func (s *SprintTestStore) InitResults(ctx context.Context, sprintID string) error {
	uid, err := parseUUID(sprintID)
	if err != nil {
		return domain.ErrNotFound
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	qtx := s.q.WithTx(tx)
	if err := qtx.InitSprintTestResults(ctx, uid); err != nil {
		return err
	}
	if err := qtx.InitSprintACResults(ctx, uid); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ListResults returns all result rows for a sprint, with test/item titles.
func (s *SprintTestStore) ListResults(ctx context.Context, sprintID string) ([]SprintTestResultRow, error) {
	uid, err := parseUUID(sprintID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.ListSprintTestResults(ctx, uid)
	if err != nil {
		return nil, err
	}

	out := make([]SprintTestResultRow, len(rows))
	for i, r := range rows {
		row := SprintTestResultRow{
			ID:        uuidToString(r.ID),
			SprintID:  uuidToString(r.SprintID),
			Status:    string(r.Status),
			SkipReason: r.SkipReason,
			Notes:     r.Notes,
			CreatedAt: r.CreatedAt.Time,
			UpdatedAt: r.UpdatedAt.Time,
		}
		if r.TestID.Valid {
			v := uuidToString(r.TestID)
			row.TestID = &v
		}
		if r.BacklogItemID.Valid {
			v := uuidToString(r.BacklogItemID)
			row.BacklogItemID = &v
		}
		if r.ExecutedBy.Valid {
			v := uuidToString(r.ExecutedBy)
			row.ExecutedBy = &v
		}
		if r.ExecutedAt.Valid {
			t := r.ExecutedAt.Time
			row.ExecutedAt = &t
		}
		row.TestTitle = r.TestTitle
		if r.TestType.Valid {
			v := string(r.TestType.TestType)
			row.TestType = &v
		}
		row.ItemTitle = r.ItemTitle
		out[i] = row
	}
	return out, nil
}

// UpdateResult patches a single result row.
func (s *SprintTestStore) UpdateResult(ctx context.Context, sprintID, resultID, status string,
	skipReason, notes, executedBy *string) (*SprintTestResultRow, error) {

	sprintUUID, err := parseUUID(sprintID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	resultUUID, err := parseUUID(resultID)
	if err != nil {
		return nil, domain.ErrNotFound
	}

	validStatuses := map[string]bool{"pass": true, "failed": true, "skipped": true, "disabled": true, "on_hold": true}
	if status != "" && !validStatuses[status] {
		return nil, domain.ErrConflict
	}

	arg := dbgen.UpdateSprintTestResultParams{
		ID:         resultUUID,
		SprintID:   sprintUUID,
		SkipReason: skipReason,
		Notes:      notes,
	}
	if status != "" {
		arg.Status = dbgen.NullTestRunStatus{TestRunStatus: dbgen.TestRunStatus(status), Valid: true}
	}
	if executedBy != nil {
		uid, err := parseUUID(*executedBy)
		if err == nil {
			arg.ExecutedBy = uid
		}
	}
	if status == "pass" || status == "failed" {
		arg.ExecutedAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
	}

	row, err := s.q.UpdateSprintTestResult(ctx, arg)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}

	result := &SprintTestResultRow{
		ID:         uuidToString(row.ID),
		SprintID:   uuidToString(row.SprintID),
		Status:     string(row.Status),
		SkipReason: row.SkipReason,
		Notes:      row.Notes,
		CreatedAt:  row.CreatedAt.Time,
		UpdatedAt:  row.UpdatedAt.Time,
	}
	if row.TestID.Valid {
		v := uuidToString(row.TestID)
		result.TestID = &v
	}
	if row.BacklogItemID.Valid {
		v := uuidToString(row.BacklogItemID)
		result.BacklogItemID = &v
	}
	if row.ExecutedBy.Valid {
		v := uuidToString(row.ExecutedBy)
		result.ExecutedBy = &v
	}
	if row.ExecutedAt.Valid {
		t := row.ExecutedAt.Time
		result.ExecutedAt = &t
	}

	// Auto-skip logic: if test failed, cascade skips to dependents.
	if status == "failed" && row.TestID.Valid {
		go func() {
			dependents, err := s.q.GetFailedTestDependents(context.Background(), row.TestID)
			if err != nil || len(dependents) == 0 {
				return
			}
			reason := "auto-skipped: dependency test failed"
			_ = s.q.AutoSkipDependents(context.Background(), dbgen.AutoSkipDependentsParams{
				SprintID:   sprintUUID,
				TestIds:    dependents,
				SkipReason: &reason,
			})
		}()
	}

	return result, nil
}
