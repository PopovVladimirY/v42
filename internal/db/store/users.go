// Additional UserStore methods for Phase 3: listing and updating users.
// UserStore type is defined in store/auth.go (same package).
package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/domain"
)

// ListAll returns all users (including inactive). Admin/maintainer only.
func (s *UserStore) ListAll(ctx context.Context) ([]*domain.User, error) {
	rows, err := s.q.ListAllUsers(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]*domain.User, len(rows))
	for i, r := range rows {
		out[i] = &domain.User{
			ID:                 uuidToString(r.ID),
			Email:              r.Email,
			DisplayName:        r.DisplayName,
			Role:               string(r.Role),
			IsActive:           r.IsActive,
			MustChangePassword: r.MustChangePassword,
			AvatarURL:          r.AvatarUrl,
			Theme:              r.Theme,
			IdleTimeoutMinutes: int(r.IdleTimeoutMinutes),
			CreatedAt:          r.CreatedAt.Time,
			UpdatedAt:          r.UpdatedAt.Time,
		}
	}
	return out, nil
}

// ListActive returns only active users. For regular (non-admin) callers.
func (s *UserStore) ListActive(ctx context.Context) ([]*domain.User, error) {
	rows, err := s.q.ListActiveUsers(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]*domain.User, len(rows))
	for i, r := range rows {
		out[i] = &domain.User{
			ID:                 uuidToString(r.ID),
			Email:              r.Email,
			DisplayName:        r.DisplayName,
			Role:               string(r.Role),
			IsActive:           r.IsActive,
			MustChangePassword: r.MustChangePassword,
			AvatarURL:          r.AvatarUrl,
			Theme:              r.Theme,
			IdleTimeoutMinutes: int(r.IdleTimeoutMinutes),
			CreatedAt:          r.CreatedAt.Time,
			UpdatedAt:          r.UpdatedAt.Time,
		}
	}
	return out, nil
}

// Update persists a full user update (caller merges partial request before calling).
func (s *UserStore) Update(ctx context.Context, u *domain.User) (*domain.User, error) {
	uid, err := parseUUID(u.ID)
	if err != nil {
		return nil, err
	}
	row, err := s.q.UpdateUser(ctx, dbgen.UpdateUserParams{
		ID:          uid,
		DisplayName: u.DisplayName,
		AvatarUrl:   u.AvatarURL,
		Role:        dbgen.UserRole(u.Role),
		IsActive:    u.IsActive,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return &domain.User{
		ID:                 uuidToString(row.ID),
		Email:              row.Email,
		DisplayName:        row.DisplayName,
		Role:               string(row.Role),
		IsActive:           row.IsActive,
		MustChangePassword: row.MustChangePassword,
		AvatarURL:          row.AvatarUrl,
		Theme:              row.Theme,
		IdleTimeoutMinutes: int(row.IdleTimeoutMinutes),
		CreatedAt:          row.CreatedAt.Time,
		UpdatedAt:          row.UpdatedAt.Time,
	}, nil
}

// GetByIDForUpdate fetches a user by UUID string, returning domain.ErrNotFound if absent.
// Alias for GetByID -- exists to make PATCH handler intent explicit.
func (s *UserStore) GetByIDForUpdate(ctx context.Context, id string) (*domain.User, error) {
	return s.GetByID(ctx, id)
}

// UpdateTheme sets the user's UI theme preference.
func (s *UserStore) UpdateTheme(ctx context.Context, userID, theme string) (*domain.User, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	row, err := s.q.UpdateUserTheme(ctx, dbgen.UpdateUserThemeParams{
		ID:    uid,
		Theme: theme,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return &domain.User{
		ID:                 uuidToString(row.ID),
		Email:              row.Email,
		DisplayName:        row.DisplayName,
		Role:               string(row.Role),
		IsActive:           row.IsActive,
		MustChangePassword: row.MustChangePassword,
		AvatarURL:          row.AvatarUrl,
		Theme:              row.Theme,
		IdleTimeoutMinutes: int(row.IdleTimeoutMinutes),
		CreatedAt:          row.CreatedAt.Time,
		UpdatedAt:          row.UpdatedAt.Time,
	}, nil
}

// ChangePassword updates the user's password hash and must_change_password flag.
func (s *UserStore) ChangePassword(ctx context.Context, userID, passwordHash string, mustChange bool) (*domain.User, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	row, err := s.q.UpdateUserPassword(ctx, dbgen.UpdateUserPasswordParams{
		ID:                 uid,
		PasswordHash:       passwordHash,
		MustChangePassword: mustChange,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return &domain.User{
		ID:                 uuidToString(row.ID),
		Email:              row.Email,
		DisplayName:        row.DisplayName,
		Role:               string(row.Role),
		IsActive:           row.IsActive,
		MustChangePassword: row.MustChangePassword,
		AvatarURL:          row.AvatarUrl,
		Theme:              row.Theme,
		IdleTimeoutMinutes: int(row.IdleTimeoutMinutes),
		CreatedAt:          row.CreatedAt.Time,
		UpdatedAt:          row.UpdatedAt.Time,
	}, nil
}

// UpdateUserIdleTimeout sets the user's idle timeout preference.
func (s *UserStore) UpdateUserIdleTimeout(ctx context.Context, userID string, minutes int) (*domain.User, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	row, err := s.q.UpdateUserIdleTimeout(ctx, dbgen.UpdateUserIdleTimeoutParams{
		ID:                 uid,
		IdleTimeoutMinutes: int32(minutes),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return &domain.User{
		ID:                 uuidToString(row.ID),
		Email:              row.Email,
		DisplayName:        row.DisplayName,
		Role:               string(row.Role),
		IsActive:           row.IsActive,
		MustChangePassword: row.MustChangePassword,
		AvatarURL:          row.AvatarUrl,
		Theme:              row.Theme,
		IdleTimeoutMinutes: int(row.IdleTimeoutMinutes),
		CreatedAt:          row.CreatedAt.Time,
		UpdatedAt:          row.UpdatedAt.Time,
	}, nil
}

// -- pgtype helpers reused from auth.go

// newUUID parses a string UUID into pgtype.UUID for use in queries.
// Wraps parseUUID for callers outside the auth.go context.
func newUUID(s string) (pgtype.UUID, error) {
	return parseUUID(s)
}
