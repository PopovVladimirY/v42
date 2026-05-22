package store

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/domain"
)

// RadarSkill represents one skill entry for a personal radar.
type RadarSkill struct {
	SkillID      string  `json:"skill_id"`
	SkillName    string  `json:"skill_name"`
	Category     *string `json:"category"`
	Level        string  `json:"level"`
	Interest     string  `json:"interest"`
	InterestNote *string `json:"interest_note"`
	LevelRank    int     `json:"level_rank"`
}

// MatrixEntry is one user x skill cell in the team skill matrix.
type MatrixEntry struct {
	UserID       string  `json:"user_id"`
	SkillID      string  `json:"skill_id"`
	SkillName    string  `json:"skill_name"`
	Category     *string `json:"category"`
	Level        string  `json:"level"`
	Interest     string  `json:"interest"`
	InterestNote *string `json:"interest_note"`
	LevelRank    int     `json:"level_rank"`
}

// TandemPair is a learner-mentor match for a specific skill.
type TandemPair struct {
	LearnerID       string `json:"learner_id"`
	LearnerLevel    string `json:"learner_level"`
	LearnerInterest string `json:"learner_interest"`
	MentorID        string `json:"mentor_id"`
	MentorLevel     string `json:"mentor_level"`
	SkillID         string `json:"skill_id"`
	SkillName       string `json:"skill_name"`
}

// LearningAppetite holds curiosity signals for a user.
type LearningAppetite struct {
	ReachingCount  int32 `json:"reaching_count"`
	CuriousBreadth int32 `json:"curious_breadth"`
	TotalSkills    int32 `json:"total_skills"`
	RecentLevelUps int32 `json:"recent_level_ups"`
}

// TeamMemberAppetite is one team member's appetite row.
type TeamMemberAppetite struct {
	UserID         string `json:"user_id"`
	ReachingCount  int32  `json:"reaching_count"`
	CuriousBreadth int32  `json:"curious_breadth"`
}

// EngagementScore holds authenticity calibration for a user.
type EngagementScore struct {
	EngagedSkills       int32 `json:"engaged_skills"`
	DeclaredExpertCount int32 `json:"declared_expert_count"`
	GroundedExpertCount int32 `json:"grounded_expert_count"`
}

// CapacityStore wraps sqlc skills_capacity queries (all read-only).
type CapacityStore struct {
	q *dbgen.Queries
}

// NewCapacityStore returns a CapacityStore.
func NewCapacityStore(q *dbgen.Queries) *CapacityStore {
	return &CapacityStore{q: q}
}

func toInt(v interface{}) int {
	// CASE expressions come back as int64 from pgx.
	switch x := v.(type) {
	case int64:
		return int(x)
	case int32:
		return int(x)
	case int:
		return x
	}
	return 0
}

// PersonalRadar returns radar data for a single user.
func (s *CapacityStore) PersonalRadar(ctx context.Context, userID string) ([]RadarSkill, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.GetPersonalRadar(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]RadarSkill, len(rows))
	for i, r := range rows {
		out[i] = RadarSkill{
			SkillID:      uuidToString(r.SkillID),
			SkillName:    r.SkillName,
			Category:     r.Category,
			Level:        string(r.Level),
			Interest:     string(r.Interest),
			InterestNote: r.InterestNote,
			LevelRank:    toInt(r.LevelRank),
		}
	}
	return out, nil
}

// TeamSkillMatrix returns the full team x skill grid.
func (s *CapacityStore) TeamSkillMatrix(ctx context.Context, teamID string) ([]MatrixEntry, error) {
	tid, err := parseUUID(teamID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.GetTeamSkillMatrix(ctx, tid)
	if err != nil {
		return nil, err
	}
	out := make([]MatrixEntry, len(rows))
	for i, r := range rows {
		out[i] = MatrixEntry{
			UserID:       uuidToString(r.UserID),
			SkillID:      uuidToString(r.SkillID),
			SkillName:    r.SkillName,
			Category:     r.Category,
			Level:        string(r.Level),
			Interest:     string(r.Interest),
			InterestNote: r.InterestNote,
			LevelRank:    toInt(r.LevelRank),
		}
	}
	return out, nil
}

// TandemOpportunities returns learner-mentor pairs for a team.
func (s *CapacityStore) TandemOpportunities(ctx context.Context, teamID string) ([]TandemPair, error) {
	tid, err := parseUUID(teamID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.GetTandemOpportunities(ctx, tid)
	if err != nil {
		return nil, err
	}
	out := make([]TandemPair, len(rows))
	for i, r := range rows {
		out[i] = TandemPair{
			LearnerID:       uuidToString(r.LearnerID),
			LearnerLevel:    string(r.LearnerLevel),
			LearnerInterest: string(r.LearnerInterest),
			MentorID:        uuidToString(r.MentorID),
			MentorLevel:     string(r.MentorLevel),
			SkillID:         uuidToString(r.SkillID),
			SkillName:       r.SkillName,
		}
	}
	return out, nil
}

// LearningAppetiteForUser returns curiosity signals + momentum for a user.
func (s *CapacityStore) LearningAppetiteForUser(ctx context.Context, userID string) (*LearningAppetite, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	ap, err := s.q.GetLearningAppetite(ctx, uid)
	if err != nil {
		return nil, err
	}
	momentum, err := s.q.GetLearningMomentum(ctx, uid)
	if err != nil {
		return nil, err
	}
	return &LearningAppetite{
		ReachingCount:  ap.ReachingCount,
		CuriousBreadth: ap.CuriousBreadth,
		TotalSkills:    ap.TotalSkills,
		RecentLevelUps: momentum,
	}, nil
}

// TeamLearningAppetite returns per-member appetite rows for a team.
func (s *CapacityStore) TeamLearningAppetite(ctx context.Context, teamID string) ([]TeamMemberAppetite, error) {
	tid, err := parseUUID(teamID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.GetTeamLearningAppetite(ctx, tid)
	if err != nil {
		return nil, err
	}
	out := make([]TeamMemberAppetite, len(rows))
	for i, r := range rows {
		out[i] = TeamMemberAppetite{
			UserID:         uuidToString(r.UserID),
			ReachingCount:  r.ReachingCount,
			CuriousBreadth: r.CuriousBreadth,
		}
	}
	return out, nil
}

// EngagementScore returns authentic engagement score for a user.
func (s *CapacityStore) EngagementScore(ctx context.Context, userID string) (*EngagementScore, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.GetAuthenticEngagement(ctx, uid)
	if err != nil {
		return nil, err
	}
	return &EngagementScore{
		EngagedSkills:       r.EngagedSkills,
		DeclaredExpertCount: r.DeclaredExpertCount,
		GroundedExpertCount: r.GroundedExpertCount,
	}, nil
}

// SkillCoverage returns how many team members cover a skill at competent+ level.
func (s *CapacityStore) SkillCoverage(ctx context.Context, teamID, skillID string) (int64, error) {
	tid, err := parseUUID(teamID)
	if err != nil {
		return 0, domain.ErrNotFound
	}
	sid, err := parseUUID(skillID)
	if err != nil {
		return 0, domain.ErrNotFound
	}
	return s.q.GetSkillCoverage(ctx, dbgen.GetSkillCoverageParams{
		TeamID:  tid,
		SkillID: pgtype.UUID(sid),
	})
}
