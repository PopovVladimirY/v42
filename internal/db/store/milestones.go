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

// healthBuffer is the slack window before a milestone's target date. If the
// latest bound stage finishes inside this window we flag "at_risk" -- close
// shave, no cushion. Chosen pragmatically; tune later when capacity lands.
const healthBuffer = 5 * 24 * time.Hour

// Milestone is the store-level representation of a milestone.
// Status is the manual lifecycle (future/target/closed). Health is DERIVED
// from dates and never persisted -- the handler fills it via ComputeHealth.
type Milestone struct {
	ID          string    `json:"id"`
	ProjectID   string    `json:"project_id"`
	Number      int64     `json:"number"`
	Name        string    `json:"name"`
	Description *string   `json:"description"`
	TargetDate  string    `json:"target_date"` // ISO date "2026-12-31"
	Status      string    `json:"status"`
	Health      string    `json:"health"` // derived: on_time|at_risk|delayed|missed|closed
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// TimelineNode is a flattened project-tree node for the Gantt feed.
type TimelineNode struct {
	ID          string  `json:"id"`
	NodeNumber  int64   `json:"node_number"`
	Name        string  `json:"name"`
	ParentID    *string `json:"parent_id"`
	Status      string  `json:"status"`
	StartDate   *string `json:"start_date"`
	EndDate     *string `json:"end_date"`
	MilestoneID *string `json:"milestone_id"`
	Depth       int32   `json:"depth"`
}

// MilestoneStore wraps sqlc milestone queries.
type MilestoneStore struct {
	q *dbgen.Queries
}

// NewMilestoneStore returns a MilestoneStore backed by sqlc Queries.
func NewMilestoneStore(q *dbgen.Queries) *MilestoneStore {
	return &MilestoneStore{q: q}
}

// buildMilestone assembles a store.Milestone from the raw pgtype fields shared
// by every sqlc-generated milestone row type.
func buildMilestone(id, projectID pgtype.UUID, number int64, name string, description *string,
	targetDate pgtype.Date, status dbgen.MilestoneStatus,
	createdAt, updatedAt pgtype.Timestamptz) Milestone {
	m := Milestone{
		ID:          uuidToString(id),
		ProjectID:   uuidToString(projectID),
		Number:      number,
		Name:        name,
		Description: description,
		Status:      string(status),
		CreatedAt:   createdAt.Time,
		UpdatedAt:   updatedAt.Time,
	}
	if targetDate.Valid {
		m.TargetDate = targetDate.Time.Format("2006-01-02")
	}
	return m
}

// List returns all milestones for a project (health left blank -- caller fills).
func (s *MilestoneStore) List(ctx context.Context, projectID string) ([]Milestone, error) {
	pid, err := parseUUID(projectID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.ListMilestonesByProject(ctx, pid)
	if err != nil {
		return nil, err
	}
	out := make([]Milestone, len(rows))
	for i, r := range rows {
		out[i] = buildMilestone(r.ID, r.ProjectID, r.SeqNumber, r.Name, r.Description, r.TargetDate, r.Status, r.CreatedAt, r.UpdatedAt)
	}
	return out, nil
}

// GetByID returns a milestone or ErrNotFound.
func (s *MilestoneStore) GetByID(ctx context.Context, id string) (*Milestone, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.GetMilestoneByID(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	m := buildMilestone(r.ID, r.ProjectID, r.SeqNumber, r.Name, r.Description, r.TargetDate, r.Status, r.CreatedAt, r.UpdatedAt)
	return &m, nil
}

// Create inserts a new milestone.
func (s *MilestoneStore) Create(ctx context.Context, projectID, name string, description *string, targetDate, status string) (*Milestone, error) {
	pid, err := parseUUID(projectID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var td pgtype.Date
	if scanErr := td.Scan(targetDate); scanErr != nil {
		return nil, domain.ErrConflict // bad date format
	}
	if status == "" {
		status = string(dbgen.MilestoneStatusFuture)
	}
	r, err := s.q.CreateMilestone(ctx, dbgen.CreateMilestoneParams{
		ProjectID:   pid,
		Name:        name,
		Description: description,
		TargetDate:  td,
		Status:      dbgen.MilestoneStatus(status),
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			return nil, domain.ErrNotFound // project_id does not exist
		}
		return nil, err
	}
	m := buildMilestone(r.ID, r.ProjectID, r.SeqNumber, r.Name, r.Description, r.TargetDate, r.Status, r.CreatedAt, r.UpdatedAt)
	return &m, nil
}

// Update partially updates a milestone.
func (s *MilestoneStore) Update(ctx context.Context, id string, name, description *string, targetDate, status *string) (*Milestone, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var td pgtype.Date
	if targetDate != nil {
		if scanErr := td.Scan(*targetDate); scanErr != nil {
			return nil, domain.ErrConflict
		}
	}
	var st dbgen.NullMilestoneStatus
	if status != nil {
		st = dbgen.NullMilestoneStatus{MilestoneStatus: dbgen.MilestoneStatus(*status), Valid: true}
	}
	r, err := s.q.UpdateMilestone(ctx, dbgen.UpdateMilestoneParams{
		ID:          uid,
		Name:        name,
		Description: description,
		TargetDate:  td,
		Status:      st,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	m := buildMilestone(r.ID, r.ProjectID, r.SeqNumber, r.Name, r.Description, r.TargetDate, r.Status, r.CreatedAt, r.UpdatedAt)
	return &m, nil
}

// Delete removes a milestone; returns ErrNotFound when it does not exist.
func (s *MilestoneStore) Delete(ctx context.Context, id string) error {
	uid, err := parseUUID(id)
	if err != nil {
		return domain.ErrNotFound
	}
	if _, err := s.GetByID(ctx, id); err != nil {
		return err
	}
	return s.q.DeleteMilestone(ctx, uid)
}

// SetNodeMilestone binds (milestoneID != nil) or unbinds (nil) a project-tree
// node to a milestone. Returns ErrNotFound for a missing node.
func (s *MilestoneStore) SetNodeMilestone(ctx context.Context, nodeID string, milestoneID *string) error {
	nid, err := parseUUID(nodeID)
	if err != nil {
		return domain.ErrNotFound
	}
	var mid pgtype.UUID
	if milestoneID != nil && *milestoneID != "" {
		mid, err = parseUUID(*milestoneID)
		if err != nil {
			return domain.ErrNotFound
		}
	}
	_, err = s.q.SetNodeMilestone(ctx, dbgen.SetNodeMilestoneParams{ID: nid, MilestoneID: mid})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			return domain.ErrNotFound // milestone_id does not exist
		}
		return err
	}
	return nil
}

// ListTimelineNodes returns the flattened project subtree for the Gantt.
func (s *MilestoneStore) ListTimelineNodes(ctx context.Context, projectID string, showArchived bool) ([]TimelineNode, error) {
	pid, err := parseUUID(projectID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.ListTimelineNodes(ctx, dbgen.ListTimelineNodesParams{ID: pid, ShowArchived: showArchived})
	if err != nil {
		return nil, err
	}
	out := make([]TimelineNode, len(rows))
	for i, r := range rows {
		n := TimelineNode{
			ID:         uuidToString(r.ID),
			NodeNumber: r.NodeNumber,
			Name:       r.Name,
			Status:     string(r.Status),
			Depth:      r.Depth,
		}
		if r.ParentID.Valid {
			v := uuidToString(r.ParentID)
			n.ParentID = &v
		}
		if r.MilestoneID.Valid {
			v := uuidToString(r.MilestoneID)
			n.MilestoneID = &v
		}
		if r.StartDate.Valid {
			v := r.StartDate.Time.Format("2006-01-02")
			n.StartDate = &v
		}
		if r.EndDate.Valid {
			v := r.EndDate.Time.Format("2006-01-02")
			n.EndDate = &v
		}
		out[i] = n
	}
	return out, nil
}

// ComputeHealth derives a milestone's health from its lifecycle status, its
// target date, today, and the latest end date among the stages bound to it.
//
//	closed             -> "closed"  (delivered, no alarm)
//	target in the past -> "missed"  (the date came and went)
//	stage overruns     -> "delayed" (plan finishes after the target)
//	finish within buffer -> "at_risk" (no cushion)
//	otherwise          -> "on_time"
//
// latestStageEnd is nil when no bound stage carries an end date.
func ComputeHealth(status, targetDate string, latestStageEnd *time.Time, today time.Time) string {
	if status == string(dbgen.MilestoneStatusClosed) {
		return "closed"
	}
	target, err := time.Parse("2006-01-02", targetDate)
	if err != nil {
		return "on_time" // no date to reason about -- stay calm
	}
	today = today.Truncate(24 * time.Hour)
	if today.After(target) {
		return "missed"
	}
	if latestStageEnd == nil {
		return "on_time"
	}
	end := latestStageEnd.Truncate(24 * time.Hour)
	if end.After(target) {
		return "delayed"
	}
	if target.Sub(end) < healthBuffer {
		return "at_risk"
	}
	return "on_time"
}
