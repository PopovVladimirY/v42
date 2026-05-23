package store

import (
	"context"
	"time"

	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/domain"
)

// ProjectTeamEntry represents a team linked to a project.
type ProjectTeamEntry struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description *string   `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	AddedAt     time.Time `json:"added_at"`
}

// ProjectTeamStore manages project <-> team associations.
type ProjectTeamStore struct {
	q *dbgen.Queries
}

// NewProjectTeamStore returns a new ProjectTeamStore.
func NewProjectTeamStore(q *dbgen.Queries) *ProjectTeamStore {
	return &ProjectTeamStore{q: q}
}

// ListTeams returns the teams associated with a project.
func (s *ProjectTeamStore) ListTeams(ctx context.Context, projectID string) ([]ProjectTeamEntry, error) {
	pid, err := parseUUID(projectID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.ListTeamsByProject(ctx, pid)
	if err != nil {
		return nil, err
	}
	out := make([]ProjectTeamEntry, len(rows))
	for i, r := range rows {
		out[i] = ProjectTeamEntry{
			ID:          uuidToString(r.ID),
			Name:        r.Name,
			Description: r.Description,
			CreatedAt:   r.CreatedAt.Time,
			UpdatedAt:   r.UpdatedAt.Time,
			AddedAt:     r.AddedAt.Time,
		}
	}
	return out, nil
}

// AddTeam links a team to a project (idempotent).
func (s *ProjectTeamStore) AddTeam(ctx context.Context, projectID, teamID string) error {
	pid, err := parseUUID(projectID)
	if err != nil {
		return domain.ErrNotFound
	}
	tid, err := parseUUID(teamID)
	if err != nil {
		return domain.ErrNotFound
	}
	return s.q.AddTeamToProject(ctx, dbgen.AddTeamToProjectParams{ProjectID: pid, TeamID: tid})
}

// RemoveTeam unlinks a team from a project.
func (s *ProjectTeamStore) RemoveTeam(ctx context.Context, projectID, teamID string) error {
	pid, err := parseUUID(projectID)
	if err != nil {
		return domain.ErrNotFound
	}
	tid, err := parseUUID(teamID)
	if err != nil {
		return domain.ErrNotFound
	}
	return s.q.RemoveTeamFromProject(ctx, dbgen.RemoveTeamFromProjectParams{ProjectID: pid, TeamID: tid})
}

// UserCanAccess returns true if the user belongs to any team on the project.
func (s *ProjectTeamStore) UserCanAccess(ctx context.Context, projectID, userID string) (bool, error) {
	pid, err := parseUUID(projectID)
	if err != nil {
		return false, nil
	}
	uid, err := parseUUID(userID)
	if err != nil {
		return false, nil
	}
	return s.q.UserCanAccessProject(ctx, dbgen.UserCanAccessProjectParams{ProjectID: pid, UserID: uid})
}
