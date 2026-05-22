package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/domain"
)

// BacklogItem is the store-level representation of a backlog item.
type BacklogItem struct {
	ID            string    `json:"id"`
	ProjectID     string    `json:"project_id"`
	EpicID        *string   `json:"epic_id"`
	ReleaseID     *string   `json:"release_id"`
	StageID       *string   `json:"stage_id"`
	Title         string    `json:"title"`
	Description   *string   `json:"description"`
	Type          string    `json:"type"`
	Status        string    `json:"status"`
	Priority      float64   `json:"priority"`
	Estimate      *string   `json:"estimate"`
	AssigneeID    *string   `json:"assignee_id"`
	SkillRequired *string   `json:"skill_required"`
	AcSetup       *string   `json:"ac_setup"`
	AcSteps       *string   `json:"ac_steps"`
	AcExpected    *string   `json:"ac_expected"`
	CreatedBy     string    `json:"created_by"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// ReorderItem is a single priority update in a reorder request.
type ReorderItem struct {
	ID       string
	Priority float64
}

// BacklogStore wraps sqlc backlog queries.
type BacklogStore struct {
	q    *dbgen.Queries
	pool *pgxpool.Pool
}

// NewBacklogStore returns a BacklogStore. Pool is needed for reorder transactions.
func NewBacklogStore(q *dbgen.Queries, pool *pgxpool.Pool) *BacklogStore {
	return &BacklogStore{q: q, pool: pool}
}

func backlogItemFromRow(r dbgen.BacklogItem) BacklogItem {
	b := BacklogItem{
		ID:          uuidToString(r.ID),
		ProjectID:   uuidToString(r.ProjectID),
		Title:       r.Title,
		Description: r.Description,
		Type:        string(r.Type),
		Status:      string(r.Status),
		Priority:    r.Priority,
		Estimate:    r.Estimate,
		AcSetup:     r.AcSetup,
		AcSteps:     r.AcSteps,
		AcExpected:  r.AcExpected,
		CreatedBy:   uuidToString(r.CreatedBy),
		CreatedAt:   r.CreatedAt.Time,
		UpdatedAt:   r.UpdatedAt.Time,
	}
	if r.EpicID.Valid {
		v := uuidToString(r.EpicID)
		b.EpicID = &v
	}
	if r.ReleaseID.Valid {
		v := uuidToString(r.ReleaseID)
		b.ReleaseID = &v
	}
	if r.StageID.Valid {
		v := uuidToString(r.StageID)
		b.StageID = &v
	}
	if r.AssigneeID.Valid {
		v := uuidToString(r.AssigneeID)
		b.AssigneeID = &v
	}
	if r.SkillRequired.Valid {
		v := uuidToString(r.SkillRequired)
		b.SkillRequired = &v
	}
	return b
}

// List returns backlog items for a project, optionally filtered.
func (s *BacklogStore) List(ctx context.Context, projectID string, epicID *string, status *string) ([]BacklogItem, error) {
	pid, err := parseUUID(projectID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var eid pgtype.UUID
	if epicID != nil {
		eid, err = parseUUID(*epicID)
		if err != nil {
			return nil, domain.ErrNotFound
		}
	}
	var st *dbgen.ItemStatus
	if status != nil {
		v := dbgen.ItemStatus(*status)
		st = &v
	}
	rows, err := s.q.ListBacklogItems(ctx, dbgen.ListBacklogItemsParams{
		ProjectID: pid,
		EpicID:    eid,
		Status:    st,
	})
	if err != nil {
		return nil, err
	}
	out := make([]BacklogItem, len(rows))
	for i, r := range rows {
		out[i] = backlogItemFromRow(r)
	}
	return out, nil
}

// GetByID returns a backlog item or ErrNotFound.
func (s *BacklogStore) GetByID(ctx context.Context, id string) (*BacklogItem, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.GetBacklogItemByID(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	b := backlogItemFromRow(r)
	return &b, nil
}

// CreateRequest holds all fields for creating a backlog item.
type CreateBacklogItemRequest struct {
	ProjectID     string
	EpicID        *string
	ReleaseID     *string
	StageID       *string
	Title         string
	Description   *string
	Type          string
	Status        string
	Priority      float64
	Estimate      *string
	AssigneeID    *string
	SkillRequired *string
	AcSetup       *string
	AcSteps       *string
	AcExpected    *string
	CreatedBy     string
}

// Create inserts a new backlog item.
func (s *BacklogStore) Create(ctx context.Context, req CreateBacklogItemRequest) (*BacklogItem, error) {
	pid, err := parseUUID(req.ProjectID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	cby, err := parseUUID(req.CreatedBy)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var eid, rid, sid, aid, skr pgtype.UUID
	if req.EpicID != nil {
		if eid, err = parseUUID(*req.EpicID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	if req.ReleaseID != nil {
		if rid, err = parseUUID(*req.ReleaseID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	if req.StageID != nil {
		if sid, err = parseUUID(*req.StageID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	if req.AssigneeID != nil {
		if aid, err = parseUUID(*req.AssigneeID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	if req.SkillRequired != nil {
		if skr, err = parseUUID(*req.SkillRequired); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	r, err := s.q.CreateBacklogItem(ctx, dbgen.CreateBacklogItemParams{
		ProjectID:     pid,
		EpicID:        eid,
		ReleaseID:     rid,
		StageID:       sid,
		Title:         req.Title,
		Description:   req.Description,
		Type:          dbgen.ItemType(req.Type),
		Status:        dbgen.ItemStatus(req.Status),
		Priority:      req.Priority,
		Estimate:      req.Estimate,
		AssigneeID:    aid,
		SkillRequired: skr,
		AcSetup:       req.AcSetup,
		AcSteps:       req.AcSteps,
		AcExpected:    req.AcExpected,
		CreatedBy:     cby,
	})
	if err != nil {
		return nil, err
	}
	b := backlogItemFromRow(r)
	return &b, nil
}

// UpdateRequest holds PATCH fields for a backlog item.
type UpdateBacklogItemRequest struct {
	ID            string
	Title         *string
	Description   *string
	Type          *string
	Status        *string
	Estimate      *string
	AssigneeID    *string
	SkillRequired *string
	EpicID        *string
	ReleaseID     *string
	StageID       *string
	AcSetup       *string
	AcSteps       *string
	AcExpected    *string
}

// Update partially updates a backlog item.
func (s *BacklogStore) Update(ctx context.Context, req UpdateBacklogItemRequest) (*BacklogItem, error) {
	uid, err := parseUUID(req.ID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var tp *dbgen.ItemType
	if req.Type != nil {
		v := dbgen.ItemType(*req.Type)
		tp = &v
	}
	var st *dbgen.ItemStatus
	if req.Status != nil {
		v := dbgen.ItemStatus(*req.Status)
		st = &v
	}
	var aid, skr, eid, rid, sid pgtype.UUID
	if req.AssigneeID != nil {
		if aid, err = parseUUID(*req.AssigneeID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	if req.SkillRequired != nil {
		if skr, err = parseUUID(*req.SkillRequired); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	if req.EpicID != nil {
		if eid, err = parseUUID(*req.EpicID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	if req.ReleaseID != nil {
		if rid, err = parseUUID(*req.ReleaseID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	if req.StageID != nil {
		if sid, err = parseUUID(*req.StageID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	r, err := s.q.UpdateBacklogItem(ctx, dbgen.UpdateBacklogItemParams{
		ID:            uid,
		Title:         req.Title,
		Description:   req.Description,
		Type:          tp,
		Status:        st,
		Estimate:      req.Estimate,
		AssigneeID:    aid,
		SkillRequired: skr,
		EpicID:        eid,
		ReleaseID:     rid,
		StageID:       sid,
		AcSetup:       req.AcSetup,
		AcSteps:       req.AcSteps,
		AcExpected:    req.AcExpected,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	b := backlogItemFromRow(r)
	return &b, nil
}

// Delete removes a backlog item.
func (s *BacklogStore) Delete(ctx context.Context, id string) error {
	uid, err := parseUUID(id)
	if err != nil {
		return domain.ErrNotFound
	}
	return s.q.DeleteBacklogItem(ctx, uid)
}

// Reorder applies new priorities to backlog items in a single transaction.
// If any adjacent gap falls below 1e-9, all items in the project are renormalized.
func (s *BacklogStore) Reorder(ctx context.Context, projectID string, items []ReorderItem) error {
	pid, err := parseUUID(projectID)
	if err != nil {
		return domain.ErrNotFound
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	q := dbgen.New(tx)

	// Apply requested priority updates.
	for _, item := range items {
		uid, err := parseUUID(item.ID)
		if err != nil {
			return domain.ErrNotFound
		}
		if err := q.UpdateBacklogItemPriority(ctx, dbgen.UpdateBacklogItemPriorityParams{
			ID:       uid,
			Priority: item.Priority,
		}); err != nil {
			return err
		}
	}

	// Check if renormalization is needed (O(n) but rare).
	allItems, err := q.ListBacklogItemsByProject(ctx, pid)
	if err != nil {
		return err
	}
	needsRenorm := false
	for i := 1; i < len(allItems); i++ {
		if allItems[i].Priority-allItems[i-1].Priority < 1e-9 {
			needsRenorm = true
			break
		}
	}
	if needsRenorm {
		for i, item := range allItems {
			if err := q.UpdateBacklogItemPriority(ctx, dbgen.UpdateBacklogItemPriorityParams{
				ID:       item.ID,
				Priority: float64(i),
			}); err != nil {
				return err
			}
		}
	}

	return tx.Commit(ctx)
}
