// Package store: SkillStore adapts sqlc skill/member_skill queries to clean domain types.
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

// Skill is the API representation of a skill catalog entry.
type Skill struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Category  *string   `json:"category"`
	IsBuiltin bool      `json:"is_builtin"`
	CreatedAt time.Time `json:"created_at"`
}

// MemberSkill is a user's skill with proficiency/interest metadata.
type MemberSkill struct {
	SkillID      string    `json:"skill_id"`
	SkillName    string    `json:"skill_name"`
	Category     *string   `json:"category"`
	IsBuiltin    bool      `json:"is_builtin"`
	Level        string    `json:"level"`
	Interest     string    `json:"interest"`
	InterestNote *string   `json:"interest_note"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// SkillStore wraps sqlc skill/member_skill queries.
type SkillStore struct {
	q *dbgen.Queries
}

// NewSkillStore returns a SkillStore backed by sqlc Queries.
func NewSkillStore(q *dbgen.Queries) *SkillStore {
	return &SkillStore{q: q}
}

// List returns all skills, builtins first, then custom alphabetically.
func (s *SkillStore) List(ctx context.Context) ([]Skill, error) {
	rows, err := s.q.ListSkills(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Skill, len(rows))
	for i, r := range rows {
		out[i] = Skill{
			ID:        uuidToString(r.ID),
			Name:      r.Name,
			Category:  r.Category,
			IsBuiltin: r.IsBuiltin,
			CreatedAt: r.CreatedAt.Time,
		}
	}
	return out, nil
}

// GetByID returns a single skill or domain.ErrNotFound if absent or id is malformed.
func (s *SkillStore) GetByID(ctx context.Context, id string) (*Skill, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.GetSkillByID(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return &Skill{
		ID:        uuidToString(r.ID),
		Name:      r.Name,
		Category:  r.Category,
		IsBuiltin: r.IsBuiltin,
		CreatedAt: r.CreatedAt.Time,
	}, nil
}

// Create adds a new custom (non-builtin) skill.
func (s *SkillStore) Create(ctx context.Context, name string, category *string) (*Skill, error) {
	r, err := s.q.CreateSkill(ctx, dbgen.CreateSkillParams{
		Name:     name,
		Category: category,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, domain.ErrConflict
		}
		return nil, err
	}
	return &Skill{
		ID:        uuidToString(r.ID),
		Name:      r.Name,
		Category:  r.Category,
		IsBuiltin: r.IsBuiltin,
		CreatedAt: r.CreatedAt.Time,
	}, nil
}

// ListMemberSkills returns a user's skill profile with full skill details.
func (s *SkillStore) ListMemberSkills(ctx context.Context, userID string) ([]MemberSkill, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.ListMemberSkills(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]MemberSkill, len(rows))
	for i, r := range rows {
		out[i] = MemberSkill{
			SkillID:      uuidToString(r.SkillID),
			SkillName:    r.SkillName,
			Category:     r.SkillCategory,
			IsBuiltin:    r.SkillIsBuiltin,
			Level:        string(r.Level),
			Interest:     string(r.Interest),
			InterestNote: r.InterestNote,
			CreatedAt:    r.CreatedAt.Time,
			UpdatedAt:    r.UpdatedAt.Time,
		}
	}
	return out, nil
}

// UpsertMemberSkill adds or updates a skill in a user's profile.
func (s *SkillStore) UpsertMemberSkill(ctx context.Context, userID, skillID, level, interest string, interestNote *string) (*MemberSkill, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	sid, err := parseUUID(skillID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.UpsertMemberSkill(ctx, dbgen.UpsertMemberSkillParams{
		UserID:       uid,
		SkillID:      sid,
		Level:        dbgen.SkillLevel(level),
		Interest:     dbgen.InterestLevel(interest),
		InterestNote: interestNote,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			return nil, domain.ErrNotFound // user or skill does not exist
		}
		return nil, err
	}
	// Fetch skill details to build full response.
	skill, err := s.GetByID(ctx, skillID)
	if err != nil {
		return nil, err
	}
	return &MemberSkill{
		SkillID:      uuidToString(r.SkillID),
		SkillName:    skill.Name,
		Category:     skill.Category,
		IsBuiltin:    skill.IsBuiltin,
		Level:        string(r.Level),
		Interest:     string(r.Interest),
		InterestNote: r.InterestNote,
		CreatedAt:    r.CreatedAt.Time,
		UpdatedAt:    r.UpdatedAt.Time,
	}, nil
}

// DeleteMemberSkill removes a skill from a user's profile.
func (s *SkillStore) DeleteMemberSkill(ctx context.Context, userID, skillID string) error {
	uid, err := parseUUID(userID)
	if err != nil {
		return domain.ErrNotFound
	}
	sid, err := parseUUID(skillID)
	if err != nil {
		return domain.ErrNotFound
	}
	return s.q.DeleteMemberSkill(ctx, dbgen.DeleteMemberSkillParams{
		UserID:  uid,
		SkillID: sid,
	})
}

// SkillHistoryEntry is a single level-change event from member_skill_history.
type SkillHistoryEntry struct {
	ID        string     `json:"id"`
	SkillID   string     `json:"skill_id"`
	SkillName string     `json:"skill_name"`
	LevelFrom *string    `json:"level_from"`
	LevelTo   string     `json:"level_to"`
	ChangedBy *string    `json:"changed_by"`
	ChangedAt time.Time  `json:"changed_at"`
}

// RecordSkillLevelChange writes an immutable history entry. levelFrom is nil for first entry.
func (s *SkillStore) RecordSkillLevelChange(ctx context.Context, userID, skillID string, levelFrom *string, levelTo, changedByID string) error {
	uid, err := parseUUID(userID)
	if err != nil {
		return domain.ErrNotFound
	}
	sid, err := parseUUID(skillID)
	if err != nil {
		return domain.ErrNotFound
	}
	cby, err := parseUUID(changedByID)
	if err != nil {
		return domain.ErrNotFound
	}
	var lf *dbgen.SkillLevel
	if levelFrom != nil {
		v := dbgen.SkillLevel(*levelFrom)
		lf = &v
	}
	_, err = s.q.CreateSkillHistoryEntry(ctx, dbgen.CreateSkillHistoryEntryParams{
		UserID:    uid,
		SkillID:   sid,
		LevelFrom: lf,
		LevelTo:   dbgen.SkillLevel(levelTo),
		ChangedBy: cby,
	})
	return err
}

// ListSkillHistory returns the full growth timeline for a user, newest first.
func (s *SkillStore) ListSkillHistory(ctx context.Context, userID string) ([]SkillHistoryEntry, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.ListSkillHistory(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]SkillHistoryEntry, len(rows))
	for i, r := range rows {
		var lf *string
		if r.LevelFrom != nil {
			v := string(*r.LevelFrom)
			lf = &v
		}
		var cby *string
		if r.ChangedBy.Valid {
			v := uuidToString(r.ChangedBy)
			cby = &v
		}
		out[i] = SkillHistoryEntry{
			ID:        uuidToString(r.ID),
			SkillID:   uuidToString(r.SkillID),
			SkillName: r.SkillName,
			LevelFrom: lf,
			LevelTo:   string(r.LevelTo),
			ChangedBy: cby,
			ChangedAt: r.ChangedAt.Time,
		}
	}
	return out, nil
}
