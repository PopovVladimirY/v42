package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/domain"
)

// Project is the store-level representation of a project.
type Project struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description *string   `json:"description"`
	Status      string    `json:"status"`
	TeamID      *string   `json:"team_id"`
	OwnerID     string    `json:"owner_id"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// ProjectStore wraps sqlc project queries.
type ProjectStore struct {
	q *dbgen.Queries
}

// NewProjectStore returns a ProjectStore backed by sqlc Queries.
func NewProjectStore(q *dbgen.Queries) *ProjectStore {
	return &ProjectStore{q: q}
}

func projectFromRow(r dbgen.Project) Project {
	p := Project{
		ID:          uuidToString(r.ID),
		Name:        r.Name,
		Description: r.Description,
		Status:      string(r.Status),
		OwnerID:     uuidToString(r.OwnerID),
		CreatedAt:   r.CreatedAt.Time,
		UpdatedAt:   r.UpdatedAt.Time,
	}
	if r.TeamID.Valid {
		v := uuidToString(r.TeamID)
		p.TeamID = &v
	}
	return p
}

// List returns projects, optionally filtered by teamID or status.
func (s *ProjectStore) List(ctx context.Context, teamID *string, status *string) ([]Project, error) {
	var tid pgtype.UUID
	if teamID != nil {
		var err error
		tid, err = parseUUID(*teamID)
		if err != nil {
			return nil, domain.ErrNotFound
		}
	}
	var st *dbgen.ProjectStatus
	if status != nil {
		v := dbgen.ProjectStatus(*status)
		st = &v
	}
	rows, err := s.q.ListProjects(ctx, dbgen.ListProjectsParams{TeamID: tid, Status: st})
	if err != nil {
		return nil, err
	}
	out := make([]Project, len(rows))
	for i, r := range rows {
		out[i] = projectFromRow(r)
	}
	return out, nil
}

// GetByID returns a project or ErrNotFound.
func (s *ProjectStore) GetByID(ctx context.Context, id string) (*Project, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.GetProjectByID(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	p := projectFromRow(r)
	return &p, nil
}

// Create inserts a new project.
func (s *ProjectStore) Create(ctx context.Context, name string, description *string, status, ownerID string, teamID *string) (*Project, error) {
	oid, err := parseUUID(ownerID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var tid pgtype.UUID
	if teamID != nil {
		tid, err = parseUUID(*teamID)
		if err != nil {
			return nil, domain.ErrNotFound
		}
	}
	r, err := s.q.CreateProject(ctx, dbgen.CreateProjectParams{
		Name:        name,
		Description: description,
		Status:      dbgen.ProjectStatus(status),
		TeamID:      tid,
		OwnerID:     oid,
	})
	if err != nil {
		return nil, err
	}
	p := projectFromRow(r)
	return &p, nil
}

// Update partially updates a project (PATCH semantics).
func (s *ProjectStore) Update(ctx context.Context, id string, name, description *string, status *string, teamID *string) (*Project, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var st *dbgen.ProjectStatus
	if status != nil {
		v := dbgen.ProjectStatus(*status)
		st = &v
	}
	var tid pgtype.UUID
	if teamID != nil {
		tid, err = parseUUID(*teamID)
		if err != nil {
			return nil, domain.ErrNotFound
		}
	}
	r, err := s.q.UpdateProject(ctx, dbgen.UpdateProjectParams{
		ID:          uid,
		Name:        name,
		Description: description,
		Status:      st,
		TeamID:      tid,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	p := projectFromRow(r)
	return &p, nil
}

// Delete removes a project and all its children (cascade).
func (s *ProjectStore) Delete(ctx context.Context, id string) error {
	uid, err := parseUUID(id)
	if err != nil {
		return domain.ErrNotFound
	}
	return s.q.DeleteProject(ctx, uid)
}
