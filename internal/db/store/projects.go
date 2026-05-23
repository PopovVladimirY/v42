package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/domain"
)

// Project is the store-level representation of a project.
type Project struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description *string   `json:"description"`
	Status      string    `json:"status"`
	OwnerID     string    `json:"owner_id"`
	IsArchived  bool      `json:"is_archived"`
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
	return Project{
		ID:          uuidToString(r.ID),
		Name:        r.Name,
		Description: r.Description,
		Status:      string(r.Status),
		OwnerID:     uuidToString(r.OwnerID),
		IsArchived:  r.IsArchived,
		CreatedAt:   r.CreatedAt.Time,
		UpdatedAt:   r.UpdatedAt.Time,
	}
}

// List returns projects, optionally filtered by teamID or status.
func (s *ProjectStore) List(ctx context.Context, teamID *string, status *string) ([]Project, error) {
	var st *dbgen.ProjectStatus
	if status != nil {
		v := dbgen.ProjectStatus(*status)
		st = &v
	}
	if teamID != nil {
		tid, err := parseUUID(*teamID)
		if err != nil {
			return nil, domain.ErrNotFound
		}
		rows, err := s.q.ListProjectsByTeam(ctx, dbgen.ListProjectsByTeamParams{TeamID: tid, Status: st})
		if err != nil {
			return nil, err
		}
		out := make([]Project, len(rows))
		for i, r := range rows {
			out[i] = projectFromRow(r)
		}
		return out, nil
	}
	rows, err := s.q.ListProjects(ctx, st)
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
	r, err := s.q.CreateProject(ctx, dbgen.CreateProjectParams{
		Name:        name,
		Description: description,
		Status:      dbgen.ProjectStatus(status),
		OwnerID:     oid,
	})
	if err != nil {
		return nil, err
	}
	p := projectFromRow(r)
	// Optionally wire up first team immediately.
	if teamID != nil {
		tid, err := parseUUID(*teamID)
		if err == nil {
			_ = s.q.AddTeamToProject(ctx, dbgen.AddTeamToProjectParams{
				ProjectID: r.ID,
				TeamID:    tid,
			})
		}
	}
	return &p, nil
}

// Update partially updates a project (PATCH semantics).
func (s *ProjectStore) Update(ctx context.Context, id string, name, description *string, status *string) (*Project, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var st *dbgen.ProjectStatus
	if status != nil {
		v := dbgen.ProjectStatus(*status)
		st = &v
	}
	r, err := s.q.UpdateProject(ctx, dbgen.UpdateProjectParams{
		ID:          uid,
		Name:        name,
		Description: description,
		Status:      st,
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
	// GetByID detects missing rows -- DeleteProject returns nil even for 0 rows deleted.
	if _, err := s.GetByID(ctx, id); err != nil {
		return err
	}
	return s.q.DeleteProject(ctx, uid)
}

// Archive sets is_archived = true on a project.
func (s *ProjectStore) Archive(ctx context.Context, id string) (*Project, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.ArchiveProject(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	p := projectFromRow(r)
	return &p, nil
}

// ListArchived returns all soft-deleted projects.
func (s *ProjectStore) ListArchived(ctx context.Context) ([]Project, error) {
	rows, err := s.q.ListArchivedProjects(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Project, len(rows))
	for i, r := range rows {
		out[i] = projectFromRow(r)
	}
	return out, nil
}

// Unarchive restores a soft-deleted project.
func (s *ProjectStore) Unarchive(ctx context.Context, id string) (*Project, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.UnarchiveProject(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	p := projectFromRow(r)
	return &p, nil
}
