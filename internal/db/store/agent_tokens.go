package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/domain"
)

// AgentTokenStore implements domain.AgentTokenRepo using sqlc-generated queries.
type AgentTokenStore struct {
	q     *dbgen.Queries
	users *UserStore
}

// NewAgentTokenStore returns an AgentTokenStore backed by the given sqlc Queries.
func NewAgentTokenStore(q *dbgen.Queries) *AgentTokenStore {
	return &AgentTokenStore{q: q, users: NewUserStore(q)}
}

func (s *AgentTokenStore) Create(ctx context.Context, userID, createdBy, name, tokenHash string, projectID *string) (*domain.AgentToken, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, fmt.Errorf("invalid user_id: %w", err)
	}
	cbid, err := parseUUID(createdBy)
	if err != nil {
		return nil, fmt.Errorf("invalid created_by: %w", err)
	}
	var pid pgtype.UUID
	if projectID != nil {
		pid, err = parseUUID(*projectID)
		if err != nil {
			return nil, fmt.Errorf("invalid project_id: %w", err)
		}
	}
	row, err := s.q.CreateAgentToken(ctx, dbgen.CreateAgentTokenParams{
		UserID:    uid,
		CreatedBy: cbid,
		Name:      name,
		TokenHash: tokenHash,
		ProjectID: pid,
	})
	if err != nil {
		return nil, err
	}
	return rowToAgentToken(row), nil
}

func (s *AgentTokenStore) GetByHash(ctx context.Context, hash string) (*domain.AgentToken, error) {
	row, err := s.q.GetAgentTokenByHash(ctx, hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return rowToAgentToken(row), nil
}

func (s *AgentTokenStore) List(ctx context.Context) ([]*domain.AgentToken, error) {
	rows, err := s.q.ListAgentTokens(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]*domain.AgentToken, len(rows))
	for i, r := range rows {
		out[i] = rowToAgentToken(r)
	}
	return out, nil
}

func (s *AgentTokenStore) Revoke(ctx context.Context, id string) error {
	uid, err := parseUUID(id)
	if err != nil {
		return fmt.Errorf("invalid id: %w", err)
	}
	return s.q.RevokeAgentToken(ctx, uid)
}

func (s *AgentTokenStore) Touch(ctx context.Context, id string) error {
	uid, err := parseUUID(id)
	if err != nil {
		return nil // malformed id -- ignore, best-effort
	}
	return s.q.TouchAgentToken(ctx, uid)
}

// ValidateAndTouch looks up an active agent token by hash, fetches the user's role,
// updates last_used_at as a fire-and-forget side effect, and returns (userID, role).
// Satisfies middleware.AgentTokenRepo.
func (s *AgentTokenStore) ValidateAndTouch(ctx context.Context, tokenHash string) (userID, role string, err error) {
	token, err := s.GetByHash(ctx, tokenHash)
	if err != nil {
		return "", "", err // ErrNotFound or DB error
	}
	user, err := s.users.GetByID(ctx, token.UserID)
	if err != nil {
		return "", "", err
	}
	if !user.IsActive {
		return "", "", domain.ErrUserInactive
	}
	// Touch in background -- fire-and-forget, a missed update just leaves last_used_at stale.
	go func() {
		_ = s.Touch(context.Background(), token.ID)
	}()
	return token.UserID, user.Role, nil
}

func rowToAgentToken(r dbgen.AgentToken) *domain.AgentToken {
	t := &domain.AgentToken{
		ID:        uuidToString(r.ID),
		UserID:    uuidToString(r.UserID),
		CreatedBy: uuidToString(r.CreatedBy),
		Name:      r.Name,
		CreatedAt: r.CreatedAt.Time,
	}
	if r.ProjectID.Valid {
		s := uuidToString(r.ProjectID)
		t.ProjectID = &s
	}
	if r.LastUsedAt.Valid {
		tt := r.LastUsedAt.Time
		t.LastUsedAt = &tt
	}
	if r.RevokedAt.Valid {
		tt := r.RevokedAt.Time
		t.RevokedAt = &tt
	}
	return t
}
