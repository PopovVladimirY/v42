package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/domain"
)

// Epic is the store-level representation of an epic.
type Epic struct {
	ID          string    `json:"id"`
	ProjectID   string    `json:"project_id"`
	Number      int64     `json:"number"`
	Title       string    `json:"title"`
	Description *string   `json:"description"`
	Status      string    `json:"status"`
	Clarity     string    `json:"clarity"`
	OwnerID     *string   `json:"owner_id"`
	TargetDate  *string   `json:"target_date"` // ISO date string "2026-12-31"
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// EpicStore wraps sqlc epic queries.
type EpicStore struct {
	q *dbgen.Queries
}

// NewEpicStore returns an EpicStore backed by sqlc Queries.
func NewEpicStore(q *dbgen.Queries) *EpicStore {
	return &EpicStore{q: q}
}

// buildEpic assembles a store.Epic from the raw pgtype fields shared by all
// sqlc-generated epic row types (CreateEpicRow, GetEpicByIDRow, etc.).
func buildEpic(id, projectID pgtype.UUID, number int64, title string, description *string,
	status dbgen.EpicStatus, clarity string, ownerID pgtype.UUID, targetDate pgtype.Date,
	createdAt, updatedAt pgtype.Timestamptz) Epic {
	e := Epic{
		ID:          uuidToString(id),
		ProjectID:   uuidToString(projectID),
		Number:      number,
		Title:       title,
		Description: description,
		Status:      string(status),
		Clarity:     clarity,
		CreatedAt:   createdAt.Time,
		UpdatedAt:   updatedAt.Time,
	}
	if ownerID.Valid {
		v := uuidToString(ownerID)
		e.OwnerID = &v
	}
	if targetDate.Valid {
		v := targetDate.Time.Format("2006-01-02")
		e.TargetDate = &v
	}
	return e
}

// List returns all epics for a project.
func (s *EpicStore) List(ctx context.Context, projectID string) ([]Epic, error) {
	pid, err := parseUUID(projectID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.ListEpicsByProject(ctx, pid)
	if err != nil {
		return nil, err
	}
	out := make([]Epic, len(rows))
	for i, r := range rows {
		out[i] = buildEpic(r.ID, r.ProjectID, r.Number, r.Title, r.Description, r.Status, r.Clarity, r.OwnerID, r.TargetDate, r.CreatedAt, r.UpdatedAt)
	}
	return out, nil
}

// GetByID returns an epic or ErrNotFound.
func (s *EpicStore) GetByID(ctx context.Context, id string) (*Epic, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.GetEpicByID(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	e := buildEpic(r.ID, r.ProjectID, r.Number, r.Title, r.Description, r.Status, r.Clarity, r.OwnerID, r.TargetDate, r.CreatedAt, r.UpdatedAt)
	return &e, nil
}

// Create inserts a new epic.
func (s *EpicStore) Create(ctx context.Context, projectID, title string, description *string, status, ownerID string, targetDate *string) (*Epic, error) {
	pid, err := parseUUID(projectID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var oid pgtype.UUID
	if ownerID != "" {
		oid, err = parseUUID(ownerID)
		if err != nil {
			return nil, domain.ErrNotFound
		}
	}
	var td pgtype.Date
	if targetDate != nil {
		if parseErr := td.Scan(*targetDate); parseErr != nil {
			return nil, domain.ErrConflict // bad date format
		}
	}
	r, err := s.q.CreateEpic(ctx, dbgen.CreateEpicParams{
		ProjectID:   pid,
		Title:       title,
		Description: description,
		Status:      dbgen.EpicStatus(status),
		OwnerID:     oid,
		TargetDate:  td,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			// FK violation — project_id does not exist
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	e := buildEpic(r.ID, r.ProjectID, r.Number, r.Title, r.Description, r.Status, r.Clarity, r.OwnerID, r.TargetDate, r.CreatedAt, r.UpdatedAt)
	return &e, nil
}

// Update partially updates an epic.
func (s *EpicStore) Update(ctx context.Context, id string, title, description *string, status, ownerID *string, clarity *string, targetDate *string) (*Epic, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var st dbgen.NullEpicStatus
	if status != nil {
		st = dbgen.NullEpicStatus{EpicStatus: dbgen.EpicStatus(*status), Valid: true}
	}
	var oid pgtype.UUID
	if ownerID != nil {
		oid, err = parseUUID(*ownerID)
		if err != nil {
			return nil, domain.ErrNotFound
		}
	}
	var td pgtype.Date
	if targetDate != nil {
		if parseErr := td.Scan(*targetDate); parseErr != nil {
			return nil, domain.ErrConflict
		}
	}
	r, err := s.q.UpdateEpic(ctx, dbgen.UpdateEpicParams{
		ID:          uid,
		Title:       title,
		Description: description,
		Status:      st,
		Clarity:     clarity,
		OwnerID:     oid,
		TargetDate:  td,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	e := buildEpic(r.ID, r.ProjectID, r.Number, r.Title, r.Description, r.Status, r.Clarity, r.OwnerID, r.TargetDate, r.CreatedAt, r.UpdatedAt)
	return &e, nil
}

// Delete removes an epic; returns ErrNotFound when the epic does not exist.
func (s *EpicStore) Delete(ctx context.Context, id string) error {
	uid, err := parseUUID(id)
	if err != nil {
		return domain.ErrNotFound
	}
	// GetByID detects missing epics — DeleteEpic returns nil even for 0 rows.
	if _, err := s.GetByID(ctx, id); err != nil {
		return err
	}
	return s.q.DeleteEpic(ctx, uid)
}
