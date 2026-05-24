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

// Project is the store-level representation of a project or stage node.
type Project struct {
	ID             string     `json:"id"`
	NodeNumber     int64      `json:"node_number"`
	Name           string     `json:"name"`
	Description    *string    `json:"description"`
	Status         string     `json:"status"`
	OwnerID        string     `json:"owner_id"`
	ParentID       *string    `json:"parent_id"`
	StartDate      *string    `json:"start_date"`
	EndDate        *string    `json:"end_date"`
	OrderIndex     float64    `json:"order_index"`
	IsArchived     bool       `json:"is_archived"`
	OpenItems      int32      `json:"open_items"`
	TotalItems     int32      `json:"total_items"`
	ClarityScore   string     `json:"clarity_score"`
	StatsDirty     bool       `json:"stats_dirty"`
	StatsUpdatedAt *time.Time `json:"stats_updated_at"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// ProjectStore wraps sqlc project queries.
type ProjectStore struct {
	q *dbgen.Queries
}

// NewProjectStore returns a ProjectStore backed by sqlc Queries.
func NewProjectStore(q *dbgen.Queries) *ProjectStore {
	return &ProjectStore{q: q}
}

// buildProject assembles a store.Project from raw pgtype fields shared by all generated row types.
func buildProject(
	id pgtype.UUID, nodeNumber int64, name string, desc *string,
	status dbgen.ProjectStatus, ownerID, parentID pgtype.UUID,
	startDate, endDate pgtype.Date, orderIndex float64, isArchived bool,
	openItems, totalItems int32, clarityScore pgtype.Numeric, statsDirty bool,
	statsUpdatedAt, createdAt, updatedAt pgtype.Timestamptz,
) Project {
	p := Project{
		ID:           uuidToString(id),
		NodeNumber:   nodeNumber,
		Name:         name,
		Description:  desc,
		Status:       string(status),
		OwnerID:      uuidToString(ownerID),
		OrderIndex:   orderIndex,
		IsArchived:   isArchived,
		OpenItems:    openItems,
		TotalItems:   totalItems,
		ClarityScore: numericToString(clarityScore),
		StatsDirty:   statsDirty,
		CreatedAt:    createdAt.Time,
		UpdatedAt:    updatedAt.Time,
	}
	if parentID.Valid {
		v := uuidToString(parentID)
		p.ParentID = &v
	}
	if startDate.Valid {
		v := startDate.Time.Format("2006-01-02")
		p.StartDate = &v
	}
	if endDate.Valid {
		v := endDate.Time.Format("2006-01-02")
		p.EndDate = &v
	}
	if statsUpdatedAt.Valid {
		v := statsUpdatedAt.Time
		p.StatsUpdatedAt = &v
	}
	return p
}

func projectFromCreateRow(r dbgen.CreateProjectRow) Project {
	return buildProject(r.ID, r.NodeNumber, r.Name, r.Description, r.Status, r.OwnerID, r.ParentID,
		r.StartDate, r.EndDate, r.OrderIndex, r.IsArchived, r.OpenItems, r.TotalItems,
		r.ClarityScore, r.StatsDirty, r.StatsUpdatedAt, r.CreatedAt, r.UpdatedAt)
}
func projectFromCreateChildRow(r dbgen.CreateChildNodeRow) Project {
	return buildProject(r.ID, r.NodeNumber, r.Name, r.Description, r.Status, r.OwnerID, r.ParentID,
		r.StartDate, r.EndDate, r.OrderIndex, r.IsArchived, r.OpenItems, r.TotalItems,
		r.ClarityScore, r.StatsDirty, r.StatsUpdatedAt, r.CreatedAt, r.UpdatedAt)
}
func projectFromGetRow(r dbgen.GetProjectByIDRow) Project {
	return buildProject(r.ID, r.NodeNumber, r.Name, r.Description, r.Status, r.OwnerID, r.ParentID,
		r.StartDate, r.EndDate, r.OrderIndex, r.IsArchived, r.OpenItems, r.TotalItems,
		r.ClarityScore, r.StatsDirty, r.StatsUpdatedAt, r.CreatedAt, r.UpdatedAt)
}
func projectFromUpdateRow(r dbgen.UpdateProjectRow) Project {
	return buildProject(r.ID, r.NodeNumber, r.Name, r.Description, r.Status, r.OwnerID, r.ParentID,
		r.StartDate, r.EndDate, r.OrderIndex, r.IsArchived, r.OpenItems, r.TotalItems,
		r.ClarityScore, r.StatsDirty, r.StatsUpdatedAt, r.CreatedAt, r.UpdatedAt)
}
func projectFromArchiveRow(r dbgen.ArchiveProjectRow) Project {
	return buildProject(r.ID, r.NodeNumber, r.Name, r.Description, r.Status, r.OwnerID, r.ParentID,
		r.StartDate, r.EndDate, r.OrderIndex, r.IsArchived, r.OpenItems, r.TotalItems,
		r.ClarityScore, r.StatsDirty, r.StatsUpdatedAt, r.CreatedAt, r.UpdatedAt)
}
func projectFromUnarchiveRow(r dbgen.UnarchiveProjectRow) Project {
	return buildProject(r.ID, r.NodeNumber, r.Name, r.Description, r.Status, r.OwnerID, r.ParentID,
		r.StartDate, r.EndDate, r.OrderIndex, r.IsArchived, r.OpenItems, r.TotalItems,
		r.ClarityScore, r.StatsDirty, r.StatsUpdatedAt, r.CreatedAt, r.UpdatedAt)
}
func projectFromListRow(r dbgen.ListProjectsRow) Project {
	return buildProject(r.ID, r.NodeNumber, r.Name, r.Description, r.Status, r.OwnerID, r.ParentID,
		r.StartDate, r.EndDate, r.OrderIndex, r.IsArchived, r.OpenItems, r.TotalItems,
		r.ClarityScore, r.StatsDirty, r.StatsUpdatedAt, r.CreatedAt, r.UpdatedAt)
}
func projectFromTeamRow(r dbgen.ListProjectsByTeamRow) Project {
	return buildProject(r.ID, r.NodeNumber, r.Name, r.Description, r.Status, r.OwnerID, r.ParentID,
		r.StartDate, r.EndDate, r.OrderIndex, r.IsArchived, r.OpenItems, r.TotalItems,
		r.ClarityScore, r.StatsDirty, r.StatsUpdatedAt, r.CreatedAt, r.UpdatedAt)
}
func projectFromRootRow(r dbgen.ListRootProjectsRow) Project {
	return buildProject(r.ID, r.NodeNumber, r.Name, r.Description, r.Status, r.OwnerID, r.ParentID,
		r.StartDate, r.EndDate, r.OrderIndex, r.IsArchived, r.OpenItems, r.TotalItems,
		r.ClarityScore, r.StatsDirty, r.StatsUpdatedAt, r.CreatedAt, r.UpdatedAt)
}
func projectFromArchivedRow(r dbgen.ListArchivedProjectsRow) Project {
	return buildProject(r.ID, r.NodeNumber, r.Name, r.Description, r.Status, r.OwnerID, r.ParentID,
		r.StartDate, r.EndDate, r.OrderIndex, r.IsArchived, r.OpenItems, r.TotalItems,
		r.ClarityScore, r.StatsDirty, r.StatsUpdatedAt, r.CreatedAt, r.UpdatedAt)
}
func projectFromChildRow(r dbgen.ListChildNodesRow) Project {
	return buildProject(r.ID, r.NodeNumber, r.Name, r.Description, r.Status, r.OwnerID, r.ParentID,
		r.StartDate, r.EndDate, r.OrderIndex, r.IsArchived, r.OpenItems, r.TotalItems,
		r.ClarityScore, r.StatsDirty, r.StatsUpdatedAt, r.CreatedAt, r.UpdatedAt)
}
func projectFromMoveRow(r dbgen.MoveNodeRow) Project {
	return buildProject(r.ID, r.NodeNumber, r.Name, r.Description, r.Status, r.OwnerID, r.ParentID,
		r.StartDate, r.EndDate, r.OrderIndex, r.IsArchived, r.OpenItems, r.TotalItems,
		r.ClarityScore, r.StatsDirty, r.StatsUpdatedAt, r.CreatedAt, r.UpdatedAt)
}

// nullProjectStatus converts *string to dbgen.NullProjectStatus.
func nullProjectStatus(s *string) dbgen.NullProjectStatus {
	if s == nil {
		return dbgen.NullProjectStatus{}
	}
	return dbgen.NullProjectStatus{ProjectStatus: dbgen.ProjectStatus(*s), Valid: true}
}

// optDate parses an optional YYYY-MM-DD string into pgtype.Date.
func optDate(s *string) pgtype.Date {
	if s == nil || *s == "" {
		return pgtype.Date{}
	}
	var d pgtype.Date
	if err := d.Scan(*s); err != nil {
		return pgtype.Date{}
	}
	return d
}

// ListRoots returns all root nodes with archived visibility control.
func (s *ProjectStore) ListRoots(ctx context.Context, showArchived bool, status *string) ([]Project, error) {
	rows, err := s.q.ListRootProjects(ctx, dbgen.ListRootProjectsParams{
		ShowArchived: showArchived,
		Status:       nullProjectStatus(status),
	})
	if err != nil {
		return nil, err
	}
	out := make([]Project, len(rows))
	for i, r := range rows {
		out[i] = projectFromRootRow(r)
	}
	return out, nil
}

// ListChildren returns direct children of a node ordered by order_index.
func (s *ProjectStore) ListChildren(ctx context.Context, parentID string, showArchived bool) ([]Project, error) {
	pid, err := parseUUID(parentID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.ListChildNodes(ctx, dbgen.ListChildNodesParams{ParentID: pid, ShowArchived: showArchived})
	if err != nil {
		return nil, err
	}
	out := make([]Project, len(rows))
	for i, r := range rows {
		out[i] = projectFromChildRow(r)
	}
	return out, nil
}

// GetSubtree returns a node and all its descendants ordered depth-first.
func (s *ProjectStore) GetSubtree(ctx context.Context, rootID string, showArchived bool) ([]Project, error) {
	uid, err := parseUUID(rootID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.GetProjectSubtree(ctx, dbgen.GetProjectSubtreeParams{ID: uid, ShowArchived: showArchived})
	if err != nil {
		return nil, err
	}
	out := make([]Project, len(rows))
	for i, r := range rows {
		out[i] = buildProject(r.ID, r.NodeNumber, r.Name, r.Description, r.Status, r.OwnerID, r.ParentID,
			r.StartDate, r.EndDate, r.OrderIndex, r.IsArchived, r.OpenItems, r.TotalItems,
			r.ClarityScore, r.StatsDirty, r.StatsUpdatedAt, r.CreatedAt, r.UpdatedAt)
	}
	return out, nil
}

// MoveNode changes a node's parent and order_index (DnD).
func (s *ProjectStore) MoveNode(ctx context.Context, id string, newParentID *string, orderIndex float64) (*Project, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var parentPgID pgtype.UUID
	if newParentID != nil {
		parentPgID, err = parseUUID(*newParentID)
		if err != nil {
			return nil, fmt.Errorf("invalid parent_id: %w", err)
		}
	}
	r, err := s.q.MoveNode(ctx, dbgen.MoveNodeParams{ID: uid, OrderIndex: orderIndex, ParentID: parentPgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	p := projectFromMoveRow(r)
	return &p, nil
}

// List returns root-level projects (backward-compatible, used by existing handlers).
func (s *ProjectStore) List(ctx context.Context, teamID *string, status *string) ([]Project, error) {
	st := nullProjectStatus(status)
	if teamID != nil {
		tid, err := parseUUID(*teamID)
		if err != nil {
			return nil, domain.ErrNotFound
		}
		rows, err := s.q.ListProjectsByTeam(ctx, dbgen.ListProjectsByTeamParams{TeamID: tid, Status: st})
		if err != nil {
			return nil, err
		}
		out := make([]Project, len(rows))
		for i, r := range rows {
			out[i] = projectFromTeamRow(r)
		}
		return out, nil
	}
	rows, err := s.q.ListProjects(ctx, st)
	if err != nil {
		return nil, err
	}
	out := make([]Project, len(rows))
	for i, r := range rows {
		out[i] = projectFromListRow(r)
	}
	return out, nil
}

// GetByID returns a project or ErrNotFound.
func (s *ProjectStore) GetByID(ctx context.Context, id string) (*Project, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.GetProjectByID(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	p := projectFromGetRow(r)
	return &p, nil
}

// CreateInput holds all params for Create / CreateChild.
type CreateInput struct {
	Name        string
	Description *string
	Status      string
	OwnerID     string
	StartDate   *string
	EndDate     *string
	OrderIndex  float64
	TeamID      *string
}

// Create inserts a new root-level project.
func (s *ProjectStore) Create(ctx context.Context, in CreateInput) (*Project, error) {
	oid, err := parseUUID(in.OwnerID)
	if err != nil {
		return nil, fmt.Errorf("invalid owner_id: %w", err)
	}
	r, err := s.q.CreateProject(ctx, dbgen.CreateProjectParams{
		Name:        in.Name,
		Description: in.Description,
		Status:      dbgen.ProjectStatus(in.Status),
		OwnerID:     oid,
		StartDate:   optDate(in.StartDate),
		EndDate:     optDate(in.EndDate),
		OrderIndex:  in.OrderIndex,
	})
	if err != nil {
		return nil, err
	}
	p := projectFromCreateRow(r)
	if in.TeamID != nil {
		tid, err := parseUUID(*in.TeamID)
		if err == nil {
			_ = s.q.AddTeamToProject(ctx, dbgen.AddTeamToProjectParams{ProjectID: r.ID, TeamID: tid})
		}
	}
	return &p, nil
}

// CreateChild inserts a child node under parentID.
func (s *ProjectStore) CreateChild(ctx context.Context, parentID string, in CreateInput) (*Project, error) {
	pid, err := parseUUID(parentID)
	if err != nil {
		return nil, fmt.Errorf("invalid parent_id: %w", err)
	}
	oid, err := parseUUID(in.OwnerID)
	if err != nil {
		return nil, fmt.Errorf("invalid owner_id: %w", err)
	}
	r, err := s.q.CreateChildNode(ctx, dbgen.CreateChildNodeParams{
		Name:        in.Name,
		Description: in.Description,
		Status:      dbgen.ProjectStatus(in.Status),
		OwnerID:     oid,
		ParentID:    pid,
		StartDate:   optDate(in.StartDate),
		EndDate:     optDate(in.EndDate),
		OrderIndex:  in.OrderIndex,
	})
	if err != nil {
		return nil, err
	}
	p := projectFromCreateChildRow(r)
	return &p, nil
}

// UpdateInput holds PATCH-able project fields.
type UpdateInput struct {
	Name        *string
	Description *string
	Status      *string
	StartDate   *string
	EndDate     *string
}

// Update partially updates a project (PATCH semantics).
func (s *ProjectStore) Update(ctx context.Context, id string, in UpdateInput) (*Project, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.UpdateProject(ctx, dbgen.UpdateProjectParams{
		ID:          uid,
		Name:        in.Name,
		Description: in.Description,
		Status:      nullProjectStatus(in.Status),
		StartDate:   optDate(in.StartDate),
		EndDate:     optDate(in.EndDate),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	p := projectFromUpdateRow(r)
	return &p, nil
}

// Delete removes a project and all its children (cascade).
func (s *ProjectStore) Delete(ctx context.Context, id string) error {
	uid, err := parseUUID(id)
	if err != nil {
		return domain.ErrNotFound
	}
	// GetByID detects missing rows -- DeleteProject returns nil even for 0 rows deleted.
	if _, err := s.GetByID(ctx, id); err != nil {
		return err
	}
	return s.q.DeleteProject(ctx, uid)
}

// Archive sets is_archived = true on a project.
func (s *ProjectStore) Archive(ctx context.Context, id string) (*Project, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.ArchiveProject(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	p := projectFromArchiveRow(r)
	return &p, nil
}

// ListArchived returns all soft-deleted projects.
func (s *ProjectStore) ListArchived(ctx context.Context) ([]Project, error) {
	rows, err := s.q.ListArchivedProjects(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Project, len(rows))
	for i, r := range rows {
		out[i] = projectFromArchivedRow(r)
	}
	return out, nil
}

// Unarchive restores a soft-deleted project.
func (s *ProjectStore) Unarchive(ctx context.Context, id string) (*Project, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.UnarchiveProject(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	p := projectFromUnarchiveRow(r)
	return &p, nil
}
