// Package store adapts sqlc-generated code to domain repository interfaces.
package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/domain"
)

// UserStore implements domain.UserRepo using sqlc-generated queries.
type UserStore struct {
	q *dbgen.Queries
}

// NewUserStore returns a UserStore backed by the given sqlc Queries.
func NewUserStore(q *dbgen.Queries) *UserStore {
	return &UserStore{q: q}
}

func (s *UserStore) GetByEmail(ctx context.Context, email string) (*domain.StoredUser, error) {
	row, err := s.q.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return &domain.StoredUser{
		User: domain.User{
			ID:          uuidToString(row.ID),
			Email:       row.Email,
			DisplayName: row.DisplayName,
			Role:        string(row.Role),
			IsActive:    row.IsActive,
			AvatarURL:   row.AvatarUrl,
			CreatedAt:   row.CreatedAt.Time,
			UpdatedAt:   row.UpdatedAt.Time,
		},
		PasswordHash: row.PasswordHash,
	}, nil
}

func (s *UserStore) GetByID(ctx context.Context, id string) (*domain.User, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound // malformed UUID can never refer to an existing resource
	}
	row, err := s.q.GetUserByID(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return &domain.User{
		ID:          uuidToString(row.ID),
		Email:       row.Email,
		DisplayName: row.DisplayName,
		Role:        string(row.Role),
		IsActive:    row.IsActive,
		AvatarURL:   row.AvatarUrl,
		CreatedAt:   row.CreatedAt.Time,
		UpdatedAt:   row.UpdatedAt.Time,
	}, nil
}

func (s *UserStore) Create(ctx context.Context, email, passwordHash, displayName, role string) (*domain.User, error) {
	row, err := s.q.CreateUser(ctx, dbgen.CreateUserParams{
		Email:        email,
		PasswordHash: passwordHash,
		DisplayName:  displayName,
		Role:         dbgen.UserRole(role),
	})
	if err != nil {
		return nil, err
	}
	return &domain.User{
		ID:          uuidToString(row.ID),
		Email:       row.Email,
		DisplayName: row.DisplayName,
		Role:        string(row.Role),
		IsActive:    row.IsActive,
		AvatarURL:   row.AvatarUrl,
		CreatedAt:   row.CreatedAt.Time,
		UpdatedAt:   row.UpdatedAt.Time,
	}, nil
}

// TokenStore implements domain.TokenRepo using sqlc-generated queries.
type TokenStore struct {
	q *dbgen.Queries
}

// NewTokenStore returns a TokenStore backed by the given sqlc Queries.
func NewTokenStore(q *dbgen.Queries) *TokenStore {
	return &TokenStore{q: q}
}

func (s *TokenStore) Create(ctx context.Context, userID, tokenHash string, expiresAt time.Time) error {
	uid, err := parseUUID(userID)
	if err != nil {
		return fmt.Errorf("invalid user id: %w", err)
	}
	_, err = s.q.CreateRefreshToken(ctx, dbgen.CreateRefreshTokenParams{
		UserID:    uid,
		TokenHash: tokenHash,
		ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
	})
	return err
}

func (s *TokenStore) GetByHash(ctx context.Context, hash string) (*domain.RefreshToken, error) {
	row, err := s.q.GetRefreshTokenByHash(ctx, hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	var revokedAt *time.Time
	if row.RevokedAt.Valid {
		t := row.RevokedAt.Time
		revokedAt = &t
	}
	return &domain.RefreshToken{
		ID:        uuidToString(row.ID),
		UserID:    uuidToString(row.UserID),
		TokenHash: row.TokenHash,
		ExpiresAt: row.ExpiresAt.Time,
		RevokedAt: revokedAt,
	}, nil
}

func (s *TokenStore) Revoke(ctx context.Context, id string) error {
	uid, err := parseUUID(id)
	if err != nil {
		return fmt.Errorf("invalid token id: %w", err)
	}
	return s.q.RevokeRefreshToken(ctx, uid)
}

func (s *TokenStore) RevokeAll(ctx context.Context, userID string) error {
	uid, err := parseUUID(userID)
	if err != nil {
		return fmt.Errorf("invalid user id: %w", err)
	}
	return s.q.RevokeAllUserRefreshTokens(ctx, uid)
}

// -- pgtype helpers ----------------------------------------------------------

// uuidToString converts a pgtype.UUID to the standard hyphenated UUID string.
func uuidToString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// parseUUID parses a hyphenated UUID string into pgtype.UUID.
func parseUUID(s string) (pgtype.UUID, error) {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return pgtype.UUID{}, err
	}
	return u, nil
}

