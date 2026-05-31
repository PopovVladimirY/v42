package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/domain"
)

// BacklogItem is the store-level representation of a backlog item.
type BacklogItem struct {
	ID            string    `json:"id"`
	ProjectID     string    `json:"project_id"`
	Number        int64     `json:"number"`
	EpicID        *string   `json:"epic_id"`
	ReleaseID     *string   `json:"release_id"`
	StageID       *string   `json:"stage_id"`
	NodeID        *string   `json:"node_id"`
	Title         string    `json:"title"`
	Description   *string   `json:"description"`
	Type          string    `json:"type"`
	Status        string    `json:"status"`
	Clarity       string    `json:"clarity"`
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
	// Sprint membership -- nil when not in any sprint.
	SprintID   *string `json:"sprint_id"`
	SprintName *string `json:"sprint_name"`
	// Life Tree: parent item this was broken out of; nil for original items.
	ParentItemID *string `json:"parent_item_id"`
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

// buildBacklogItem assembles a store.BacklogItem from fields shared by all
// sqlc-generated backlog row types.
func buildBacklogItem(id, projectID pgtype.UUID, number int64, epicID, releaseID, stageID, nodeID pgtype.UUID,
	title string, description *string, typ dbgen.ItemType, status dbgen.ItemStatus, clarity string,
	priority float64, estimate *string, assigneeID, skillRequired pgtype.UUID,
	acSetup, acSteps, acExpected *string, parentItemID pgtype.UUID, createdBy pgtype.UUID,
	createdAt, updatedAt pgtype.Timestamptz) BacklogItem {
	b := BacklogItem{
		ID:          uuidToString(id),
		ProjectID:   uuidToString(projectID),
		Number:      number,
		Title:       title,
		Description: description,
		Type:        string(typ),
		Status:      string(status),
		Clarity:     clarity,
		Priority:    priority,
		Estimate:    estimate,
		AcSetup:     acSetup,
		AcSteps:     acSteps,
		AcExpected:  acExpected,
		CreatedBy:   uuidToString(createdBy),
		CreatedAt:   createdAt.Time,
		UpdatedAt:   updatedAt.Time,
	}
	if epicID.Valid       { v := uuidToString(epicID);        b.EpicID = &v }
	if releaseID.Valid    { v := uuidToString(releaseID);     b.ReleaseID = &v }
	if stageID.Valid      { v := uuidToString(stageID);       b.StageID = &v }
	if nodeID.Valid       { v := uuidToString(nodeID);        b.NodeID = &v }
	if assigneeID.Valid   { v := uuidToString(assigneeID);    b.AssigneeID = &v }
	if skillRequired.Valid { v := uuidToString(skillRequired); b.SkillRequired = &v }
	if parentItemID.Valid { v := uuidToString(parentItemID);  b.ParentItemID = &v }
	return b
}

// sprintMembership holds sprint info for a single backlog item.
type sprintMembership struct {
	SprintID   string
	SprintName string
}

// loadSprintMemberships fetches sprint assignments for a set of backlog item IDs
// in one query and returns a map of itemID -> membership.
func (s *BacklogStore) loadSprintMemberships(ctx context.Context, ids []pgtype.UUID) map[string]sprintMembership {
	if len(ids) == 0 {
		return nil
	}
	strIDs := make([]string, 0, len(ids))
	for _, id := range ids {
		if id.Valid {
			strIDs = append(strIDs, uuidToString(id))
		}
	}
	if len(strIDs) == 0 {
		return nil
	}
	out := make(map[string]sprintMembership, len(strIDs))
	rows, err := s.pool.Query(ctx,
		`SELECT si.backlog_item_id::text, sp.id::text, sp.name
		 FROM sprint_items si
		 JOIN sprints sp ON sp.id = si.sprint_id
		 WHERE si.backlog_item_id::text = ANY($1::text[])`,
		strIDs,
	)
	if err != nil {
		return out // non-fatal: sprint info is optional enrichment
	}
	defer rows.Close()
	for rows.Next() {
		var itemID, sprintID, name string
		if rows.Scan(&itemID, &sprintID, &name) == nil {
			out[itemID] = sprintMembership{
				SprintID:   sprintID,
				SprintName: name,
			}
		}
	}
	return out
}

// List returns backlog items for a project, optionally filtered.
func (s *BacklogStore) List(ctx context.Context, projectID string, epicID *string, status *string, clarity *string) ([]BacklogItem, error) {
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
	var st dbgen.NullItemStatus
	if status != nil {
		st = dbgen.NullItemStatus{ItemStatus: dbgen.ItemStatus(*status), Valid: true}
	}
	rows, err := s.q.ListBacklogItems(ctx, dbgen.ListBacklogItemsParams{
		ProjectID: pid,
		EpicID:    eid,
		Status:    st,
		Clarity:   clarity,
	})
	if err != nil {
		return nil, err
	}
	ids := make([]pgtype.UUID, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	sprints := s.loadSprintMemberships(ctx, ids)
	out := make([]BacklogItem, len(rows))
	for i, r := range rows {
		b := buildBacklogItem(r.ID, r.ProjectID, r.Number, r.EpicID, r.ReleaseID, r.StageID, r.NodeID, r.Title, r.Description, r.Type, r.Status, r.Clarity, r.Priority, r.Estimate, r.AssigneeID, r.SkillRequired, r.AcSetup, r.AcSteps, r.AcExpected, r.ParentItemID, r.CreatedBy, r.CreatedAt, r.UpdatedAt)
		if m, ok := sprints[b.ID]; ok {
			b.SprintID = &m.SprintID
			b.SprintName = &m.SprintName
		}
		out[i] = b
	}
	return out, nil
}

// ListChildren returns direct children of a decomposed item (for Life Tree history).
func (s *BacklogStore) ListChildren(ctx context.Context, parentItemID string) ([]BacklogItem, error) {
	uid, err := parseUUID(parentItemID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.ListBacklogItemChildren(ctx, uid)
	if err != nil {
		return nil, err
	}
	ids := make([]pgtype.UUID, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	sprints := s.loadSprintMemberships(ctx, ids)
	out := make([]BacklogItem, len(rows))
	for i, r := range rows {
		b := buildBacklogItem(r.ID, r.ProjectID, r.Number, r.EpicID, r.ReleaseID, r.StageID, r.NodeID, r.Title, r.Description, r.Type, r.Status, r.Clarity, r.Priority, r.Estimate, r.AssigneeID, r.SkillRequired, r.AcSetup, r.AcSteps, r.AcExpected, r.ParentItemID, r.CreatedBy, r.CreatedAt, r.UpdatedAt)
		if m, ok := sprints[b.ID]; ok {
			b.SprintID = &m.SprintID
			b.SprintName = &m.SprintName
		}
		out[i] = b
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
	b := buildBacklogItem(r.ID, r.ProjectID, r.Number, r.EpicID, r.ReleaseID, r.StageID, r.NodeID, r.Title, r.Description, r.Type, r.Status, r.Clarity, r.Priority, r.Estimate, r.AssigneeID, r.SkillRequired, r.AcSetup, r.AcSteps, r.AcExpected, r.ParentItemID, r.CreatedBy, r.CreatedAt, r.UpdatedAt)
	if m := s.loadSprintMemberships(ctx, []pgtype.UUID{uid}); m != nil {
		if info, ok := m[b.ID]; ok {
			b.SprintID = &info.SprintID
			b.SprintName = &info.SprintName
		}
	}
	return &b, nil
}

// CreateBacklogItemRequest holds all fields for creating a backlog item.
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
	// ParentItemID links this item to a decomposed parent for Life Tree history.
	ParentItemID  *string
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
	var eid, rid, sid, aid, skr, pid2 pgtype.UUID
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
	if req.ParentItemID != nil {
		if pid2, err = parseUUID(*req.ParentItemID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	r, err := s.q.CreateBacklogItem(ctx, dbgen.CreateBacklogItemParams{
		ProjectID:    pid,
		EpicID:       eid,
		ReleaseID:    rid,
		StageID:      sid,
		Title:        req.Title,
		Description:  req.Description,
		Type:         dbgen.ItemType(req.Type),
		Status:       dbgen.ItemStatus(req.Status),
		Priority:     req.Priority,
		Estimate:     req.Estimate,
		AssigneeID:   aid,
		SkillRequired: skr,
		AcSetup:      req.AcSetup,
		AcSteps:      req.AcSteps,
		AcExpected:   req.AcExpected,
		CreatedBy:    cby,
		ParentItemID: pid2,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			// FK violation -- project or parent item does not exist
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	b := buildBacklogItem(r.ID, r.ProjectID, r.Number, r.EpicID, r.ReleaseID, r.StageID, r.NodeID, r.Title, r.Description, r.Type, r.Status, r.Clarity, r.Priority, r.Estimate, r.AssigneeID, r.SkillRequired, r.AcSetup, r.AcSteps, r.AcExpected, r.ParentItemID, r.CreatedBy, r.CreatedAt, r.UpdatedAt)
	return &b, nil
}

// UpdateRequest holds PATCH fields for a backlog item.
type UpdateBacklogItemRequest struct {
	ID            string
	Title         *string
	Description   *string
	Type          *string
	Status        *string
	Clarity       *string
	Estimate      *string
	AssigneeID    *string
	SkillRequired *string
	EpicID        *string
	ReleaseID     *string
	StageID       *string
	NodeID        *string
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
	// Empty string estimate means "clear to NULL" -- don't pass to COALESCE.
	clearEstimate := req.Estimate != nil && *req.Estimate == ""
	if clearEstimate {
		req.Estimate = nil
	}
	// Empty string epic_id means "back to Unsorted" -- COALESCE can't null it, so clear explicitly.
	clearEpic := req.EpicID != nil && *req.EpicID == ""
	if clearEpic {
		req.EpicID = nil
	}
	var tp dbgen.NullItemType
	if req.Type != nil {
		tp = dbgen.NullItemType{ItemType: dbgen.ItemType(*req.Type), Valid: true}
	}
	var st dbgen.NullItemStatus
	if req.Status != nil {
		st = dbgen.NullItemStatus{ItemStatus: dbgen.ItemStatus(*req.Status), Valid: true}
	}
	var aid, skr, eid, rid, sid, nid pgtype.UUID
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
	if req.NodeID != nil {
		if nid, err = parseUUID(*req.NodeID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	r, err := s.q.UpdateBacklogItem(ctx, dbgen.UpdateBacklogItemParams{
		ID:            uid,
		Title:         req.Title,
		Description:   req.Description,
		Type:          tp,
		Status:        st,
		Clarity:       req.Clarity,
		Estimate:      req.Estimate,
		AssigneeID:    aid,
		SkillRequired: skr,
		EpicID:        eid,
		ReleaseID:     rid,
		StageID:       sid,
		NodeID:        nid,
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
	b := buildBacklogItem(r.ID, r.ProjectID, r.Number, r.EpicID, r.ReleaseID, r.StageID, r.NodeID, r.Title, r.Description, r.Type, r.Status, r.Clarity, r.Priority, r.Estimate, r.AssigneeID, r.SkillRequired, r.AcSetup, r.AcSteps, r.AcExpected, r.ParentItemID, r.CreatedBy, r.CreatedAt, r.UpdatedAt)
	// Explicitly clear estimate in the DB when empty string was sent.
	if clearEstimate {
		_, _ = s.pool.Exec(ctx, `UPDATE backlog_items SET estimate = NULL, updated_at = now() WHERE id = $1`, uid)
		b.Estimate = nil
	}
	// Explicitly clear epic in the DB when empty string was sent (move to Unsorted).
	if clearEpic {
		_, _ = s.pool.Exec(ctx, `UPDATE backlog_items SET epic_id = NULL, updated_at = now() WHERE id = $1`, uid)
		b.EpicID = nil
	}
	// When status is reset to a pre-sprint value, auto-remove from any active sprint.
	if req.Status != nil && (*req.Status == "planned" || *req.Status == "request" || *req.Status == "on_hold" || *req.Status == "rejected") {
		_, _ = s.pool.Exec(ctx, `DELETE FROM sprint_items WHERE backlog_item_id = $1`, uid)
	}
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
