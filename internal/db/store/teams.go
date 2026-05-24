// Package store: TeamStore adapts sqlc team queries to clean domain types.
package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/domain"
)

// Team is the API representation of a team.
type Team struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description *string   `json:"description"`
	IsArchived  bool      `json:"is_archived"`
	Category    string    `json:"category"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// TeamMember is a user's membership in a team.
type TeamMember struct {
	UserID        string    `json:"user_id"`
	Email         string    `json:"email"`
	DisplayName   string    `json:"display_name"`
	Role          string    `json:"role"`
	IsActive      bool      `json:"is_active"`
	AvatarURL     *string   `json:"avatar_url"`
	CapacityHours int16     `json:"capacity_hours"`
	JoinedAt      time.Time `json:"joined_at"`
}

// TeamWithMembers is a team response that embeds its members list.
type TeamWithMembers struct {
	Team
	Members []TeamMember `json:"members"`
}

// TeamStore wraps sqlc team queries.
type TeamStore struct {
	q *dbgen.Queries
}

// NewTeamStore returns a TeamStore backed by sqlc Queries.
func NewTeamStore(q *dbgen.Queries) *TeamStore {
	return &TeamStore{q: q}
}

// List returns all teams ordered by name.
func (s *TeamStore) List(ctx context.Context) ([]Team, error) {
	rows, err := s.q.ListTeams(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Team, len(rows))
	for i, r := range rows {
		out[i] = teamFromListRow(r)
	}
	return out, nil
}

// GetMyTeams returns teams the given user is a member of.
func (s *TeamStore) GetMyTeams(ctx context.Context, userID string) ([]Team, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.ListTeamsByMember(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]Team, len(rows))
	for i, r := range rows {
		out[i] = Team{
			ID:          uuidToString(r.ID),
			Name:        r.Name,
			Description: r.Description,
			IsArchived:  r.IsArchived,
			Category:    string(r.Category),
			CreatedAt:   r.CreatedAt.Time,
			UpdatedAt:   r.UpdatedAt.Time,
		}
	}
	return out, nil
}

// Create adds a new team.
func (s *TeamStore) Create(ctx context.Context, name string, description *string) (*Team, error) {
	r, err := s.q.CreateTeam(ctx, dbgen.CreateTeamParams{Name: name, Description: description})
	if err != nil {
		return nil, err
	}
	t := teamFromCreateRow(r)
	return &t, nil
}

// Get returns a team by ID without fetching members. Use for merge-then-update patterns.
// Use GetWithMembers when the full member list is needed for the response.
func (s *TeamStore) Get(ctx context.Context, id string) (*Team, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	row, err := s.q.GetTeamByID(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	t := teamFromGetRow(row)
	return &t, nil
}

// GetWithMembers returns a team plus its current members.
func (s *TeamStore) GetWithMembers(ctx context.Context, id string) (*TeamWithMembers, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	row, err := s.q.GetTeamByID(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	members, err := s.q.ListTeamMembers(ctx, uid)
	if err != nil {
		return nil, err
	}
	t := teamFromGetRow(row)
	ms := make([]TeamMember, len(members))
	for i, m := range members {
		ms[i] = TeamMember{
			UserID:        uuidToString(m.UserID),
			Email:         m.Email,
			DisplayName:   m.DisplayName,
			Role:          string(m.Role),
			IsActive:      m.IsActive,
			AvatarURL:     m.AvatarUrl,
			CapacityHours: m.CapacityHours,
			JoinedAt:      m.JoinedAt.Time,
		}
	}
	return &TeamWithMembers{Team: t, Members: ms}, nil
}

// Update changes name/description of a team.
func (s *TeamStore) Update(ctx context.Context, id, name string, description *string) (*Team, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.UpdateTeam(ctx, dbgen.UpdateTeamParams{ID: uid, Name: name, Description: description})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	t := teamFromUpdateRow(r)
	return &t, nil
}

// Delete removes a team (cascades to team_members).
func (s *TeamStore) Delete(ctx context.Context, id string) error {
	uid, err := parseUUID(id)
	if err != nil {
		return domain.ErrNotFound
	}
	return s.q.DeleteTeam(ctx, uid)
}

// Archive sets is_archived = true on a team.
func (s *TeamStore) Archive(ctx context.Context, id string) (*Team, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.ArchiveTeam(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	t := teamFromArchiveRow(r)
	return &t, nil
}

// ListArchived returns all soft-deleted teams.
func (s *TeamStore) ListArchived(ctx context.Context) ([]Team, error) {
	rows, err := s.q.ListArchivedTeams(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Team, len(rows))
	for i, r := range rows {
		out[i] = teamFromArchivedRow(r)
	}
	return out, nil
}

// Unarchive restores a soft-deleted team.
func (s *TeamStore) Unarchive(ctx context.Context, id string) (*Team, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.UnarchiveTeam(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	t := teamFromUnarchiveRow(r)
	return &t, nil
}

// AddMember adds a user to a team, or updates capacity_hours if already a member.
// Returns a fully populated TeamMember with user details.
func (s *TeamStore) AddMember(ctx context.Context, teamID, userID string, capacityHours int16) (*TeamMember, error) {
	tid, err := parseUUID(teamID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.AddTeamMember(ctx, dbgen.AddTeamMemberParams{
		TeamID:        tid,
		UserID:        uid,
		CapacityHours: capacityHours,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			return nil, domain.ErrNotFound // team or user does not exist
		}
		return nil, err
	}
	// Fetch user details to return a complete member object.
	user, err := s.q.GetUserByID(ctx, uid)
	if err != nil {
		return nil, err
	}
	return &TeamMember{
		UserID:        uuidToString(r.UserID),
		Email:         user.Email,
		DisplayName:   user.DisplayName,
		Role:          string(user.Role),
		IsActive:      user.IsActive,
		AvatarURL:     user.AvatarUrl,
		CapacityHours: r.CapacityHours,
		JoinedAt:      r.JoinedAt.Time,
	}, nil
}

// RemoveMember removes a user from a team.
func (s *TeamStore) RemoveMember(ctx context.Context, teamID, userID string) error {
	tid, err := parseUUID(teamID)
	if err != nil {
		return domain.ErrNotFound
	}
	uid, err := parseUUID(userID)
	if err != nil {
		return domain.ErrNotFound
	}
	return s.q.RemoveTeamMember(ctx, dbgen.RemoveTeamMemberParams{TeamID: tid, UserID: uid})
}

// UpdateCategory sets the org-hierarchy category (normal/admin_team/management_team) for a team.
func (s *TeamStore) UpdateCategory(ctx context.Context, id, category string) (*Team, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.UpdateTeamCategory(ctx, dbgen.UpdateTeamCategoryParams{
		ID:       uid,
		Category: dbgen.TeamCategory(category),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	t := Team{
		ID:          uuidToString(r.ID),
		Name:        r.Name,
		Description: r.Description,
		IsArchived:  r.IsArchived,
		Category:    string(r.Category),
		CreatedAt:   r.CreatedAt.Time,
		UpdatedAt:   r.UpdatedAt.Time,
	}
	return &t, nil
}

// rowToTeam converts a sqlc Team row to store.Team.
// Works for both dbgen.Team and UpdateTeam/CreateTeam return values since they share the same fields.
func rowToTeam(r dbgen.Team) Team {
	return Team{
		ID:          uuidToString(r.ID),
		Name:        r.Name,
		Description: r.Description,
		IsArchived:  r.IsArchived,
		Category:    string(r.Category),
		CreatedAt:   r.CreatedAt.Time,
		UpdatedAt:   r.UpdatedAt.Time,
	}
}
func teamFromListRow(r dbgen.ListTeamsRow) Team {
	return Team{ID: uuidToString(r.ID), Name: r.Name, Description: r.Description, IsArchived: r.IsArchived, Category: string(r.Category), CreatedAt: r.CreatedAt.Time, UpdatedAt: r.UpdatedAt.Time}
}
func teamFromCreateRow(r dbgen.CreateTeamRow) Team {
	return Team{ID: uuidToString(r.ID), Name: r.Name, Description: r.Description, IsArchived: r.IsArchived, Category: string(r.Category), CreatedAt: r.CreatedAt.Time, UpdatedAt: r.UpdatedAt.Time}
}
func teamFromGetRow(r dbgen.GetTeamByIDRow) Team {
	return Team{ID: uuidToString(r.ID), Name: r.Name, Description: r.Description, IsArchived: r.IsArchived, Category: string(r.Category), CreatedAt: r.CreatedAt.Time, UpdatedAt: r.UpdatedAt.Time}
}
func teamFromUpdateRow(r dbgen.UpdateTeamRow) Team {
	return Team{ID: uuidToString(r.ID), Name: r.Name, Description: r.Description, IsArchived: r.IsArchived, Category: string(r.Category), CreatedAt: r.CreatedAt.Time, UpdatedAt: r.UpdatedAt.Time}
}
func teamFromArchiveRow(r dbgen.ArchiveTeamRow) Team {
	return Team{ID: uuidToString(r.ID), Name: r.Name, Description: r.Description, IsArchived: r.IsArchived, Category: string(r.Category), CreatedAt: r.CreatedAt.Time, UpdatedAt: r.UpdatedAt.Time}
}
func teamFromArchivedRow(r dbgen.ListArchivedTeamsRow) Team {
	return Team{ID: uuidToString(r.ID), Name: r.Name, Description: r.Description, IsArchived: r.IsArchived, Category: string(r.Category), CreatedAt: r.CreatedAt.Time, UpdatedAt: r.UpdatedAt.Time}
}
func teamFromUnarchiveRow(r dbgen.UnarchiveTeamRow) Team {
	return Team{ID: uuidToString(r.ID), Name: r.Name, Description: r.Description, IsArchived: r.IsArchived, Category: string(r.Category), CreatedAt: r.CreatedAt.Time, UpdatedAt: r.UpdatedAt.Time}
}