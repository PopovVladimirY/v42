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

// Sprint is the store-level sprint representation.
type Sprint struct {
	ID            string    `json:"id"`
	ProjectID     string    `json:"project_id"`
	TeamID        *string   `json:"team_id"`
	Name          string    `json:"name"`
	Goal          *string   `json:"goal"`
	Status        string    `json:"status"`
	StartDate     *string   `json:"start_date"`
	EndDate       *string   `json:"end_date"`
	CapacityHours *int16    `json:"capacity_hours"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// SprintItem is a backlog item summarised for sprint view.
type SprintItem struct {
	ID            string    `json:"id"`
	Number        int       `json:"number"`
	Title         string    `json:"title"`
	Status        string    `json:"status"`
	Type          string    `json:"type"`
	Priority      float64   `json:"priority"`
	Estimate      *string   `json:"estimate"`
	AssigneeID    *string   `json:"assignee_id"`
	AssigneeName  *string   `json:"assignee_name"`
	SkillRequired *string   `json:"skill_required"`
	AcSteps       *string   `json:"ac_steps"`
	AcExpected    *string   `json:"ac_expected"`
	AddedAt       time.Time `json:"added_at"`
}

// SprintStore wraps sqlc sprint queries.
type SprintStore struct {
	q    *dbgen.Queries
	pool *pgxpool.Pool
}

// NewSprintStore returns a SprintStore.
func NewSprintStore(q *dbgen.Queries, pool *pgxpool.Pool) *SprintStore {
	return &SprintStore{q: q, pool: pool}
}

func sprintFromRow(r dbgen.Sprint) Sprint {
	s := Sprint{
		ID:            uuidToString(r.ID),
		ProjectID:     uuidToString(r.ProjectID),
		Name:          r.Name,
		Goal:          r.Goal,
		Status:        string(r.Status),
		CapacityHours: r.CapacityHours,
		CreatedAt:     r.CreatedAt.Time,
		UpdatedAt:     r.UpdatedAt.Time,
	}
	if r.TeamID.Valid {
		v := uuidToString(r.TeamID)
		s.TeamID = &v
	}
	if r.StartDate.Valid {
		v := r.StartDate.Time.Format("2006-01-02")
		s.StartDate = &v
	}
	if r.EndDate.Valid {
		v := r.EndDate.Time.Format("2006-01-02")
		s.EndDate = &v
	}
	return s
}

// List returns sprints for a project.
func (s *SprintStore) List(ctx context.Context, projectID string) ([]Sprint, error) {
	pid, err := parseUUID(projectID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.ListSprintsByProject(ctx, pid)
	if err != nil {
		return nil, err
	}
	out := make([]Sprint, len(rows))
	for i, r := range rows {
		out[i] = sprintFromRow(r)
	}
	return out, nil
}

// GetByID returns a sprint or ErrNotFound.
func (s *SprintStore) GetByID(ctx context.Context, id string) (*Sprint, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.GetSprintByID(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	sp := sprintFromRow(r)
	return &sp, nil
}

// Create inserts a new sprint.
func (s *SprintStore) Create(ctx context.Context, projectID string, teamID *string, name string, goal *string, status string, startDate, endDate *string, capacityHours *int16) (*Sprint, error) {
	pid, err := parseUUID(projectID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var tid pgtype.UUID
	if teamID != nil {
		if tid, err = parseUUID(*teamID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	var sd, ed pgtype.Date
	if startDate != nil {
		if err := sd.Scan(*startDate); err != nil {
			return nil, err
		}
	}
	if endDate != nil {
		if err := ed.Scan(*endDate); err != nil {
			return nil, err
		}
	}
	r, err := s.q.CreateSprint(ctx, dbgen.CreateSprintParams{
		ProjectID:     pid,
		TeamID:        tid,
		Name:          name,
		Goal:          goal,
		Status:        dbgen.SprintStatus(status),
		StartDate:     sd,
		EndDate:       ed,
		CapacityHours: capacityHours,
	})
	if err != nil {
		return nil, err
	}
	sp := sprintFromRow(r)
	return &sp, nil
}

// Update partially updates a sprint.
func (s *SprintStore) Update(ctx context.Context, id string, name, goal *string, status *string, startDate, endDate *string, capacityHours *int16) (*Sprint, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var st *dbgen.SprintStatus
	if status != nil {
		v := dbgen.SprintStatus(*status)
		st = &v
	}
	var sd, ed pgtype.Date
	if startDate != nil {
		if err := sd.Scan(*startDate); err != nil {
			return nil, err
		}
	}
	if endDate != nil {
		if err := ed.Scan(*endDate); err != nil {
			return nil, err
		}
	}
	r, err := s.q.UpdateSprint(ctx, dbgen.UpdateSprintParams{
		ID:            uid,
		Name:          name,
		Goal:          goal,
		Status:        st,
		StartDate:     sd,
		EndDate:       ed,
		CapacityHours: capacityHours,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	sp := sprintFromRow(r)
	return &sp, nil
}

// Delete removes a sprint; returns ErrNotFound when the sprint does not exist.
func (s *SprintStore) Delete(ctx context.Context, id string) error {
	uid, err := parseUUID(id)
	if err != nil {
		return domain.ErrNotFound
	}
	// Use GetByID to detect missing sprints — DeleteSprint returns nil even for 0 rows.
	if _, err := s.GetByID(ctx, id); err != nil {
		return err
	}
	return s.q.DeleteSprint(ctx, uid)
}

// AddItem adds a backlog item to a sprint and promotes its status to 'open'
// if it was in a pre-sprint state (planned/request/on_hold/backlog/ready).
func (s *SprintStore) AddItem(ctx context.Context, sprintID, backlogItemID string) error {
	sid, err := parseUUID(sprintID)
	if err != nil {
		return domain.ErrNotFound
	}
	bid, err := parseUUID(backlogItemID)
	if err != nil {
		return domain.ErrNotFound
	}
	err = s.q.AddSprintItem(ctx, dbgen.AddSprintItemParams{
		SprintID:      sid,
		BacklogItemID: bid,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			switch pgErr.Code {
			case "23503": // foreign_key_violation -- sprint or backlog item does not exist
				return domain.ErrNotFound
			case "23505": // unique_violation -- item already committed to this sprint
				return domain.ErrConflict
			}
		}
		return err
	}
	// Promote pre-sprint statuses to 'open' (To Do column on kanban board).
	_, _ = s.pool.Exec(ctx,
		`UPDATE backlog_items SET status = 'open'
		 WHERE id = $1 AND status IN ('planned', 'request', 'on_hold', 'backlog', 'ready')`,
		bid,
	)
	return nil
}

// RemoveItem removes a backlog item from a sprint; returns ErrNotFound when the item is not in the sprint.
func (s *SprintStore) RemoveItem(ctx context.Context, sprintID, backlogItemID string) error {
	sid, err := parseUUID(sprintID)
	if err != nil {
		return domain.ErrNotFound
	}
	bid, err := parseUUID(backlogItemID)
	if err != nil {
		return domain.ErrNotFound
	}
	// RemoveSprintItem now uses RETURNING: pgx.ErrNoRows means item was not in the sprint.
	_, err = s.q.RemoveSprintItem(ctx, dbgen.RemoveSprintItemParams{
		SprintID:      sid,
		BacklogItemID: bid,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		}
		return err
	}
	return nil
}

// ListItems returns backlog items committed to a sprint, with number and assignee name.
func (s *SprintStore) ListItems(ctx context.Context, sprintID string) ([]SprintItem, error) {
	sid, err := parseUUID(sprintID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	const q = `
		SELECT
			bi.id::text, bi.number, bi.title, bi.status::text, bi.type::text,
			bi.priority, bi.estimate, bi.assignee_id::text,
			u.display_name,
			bi.skill_required::text, bi.ac_steps, bi.ac_expected,
			si.added_at
		FROM sprint_items si
		JOIN backlog_items bi ON bi.id = si.backlog_item_id
		LEFT JOIN users u ON u.id = bi.assignee_id
		WHERE si.sprint_id = $1
		ORDER BY bi.priority ASC
	`
	rows, err := s.pool.Query(ctx, q, sid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SprintItem
	for rows.Next() {
		var item SprintItem
		var assigneeID, assigneeName, skillRequired *string
		var addedAt pgtype.Timestamptz
		if err := rows.Scan(
			&item.ID, &item.Number, &item.Title, &item.Status, &item.Type,
			&item.Priority, &item.Estimate, &assigneeID,
			&assigneeName,
			&skillRequired, &item.AcSteps, &item.AcExpected,
			&addedAt,
		); err != nil {
			return nil, err
		}
		item.AssigneeID = assigneeID
		item.AssigneeName = assigneeName
		item.SkillRequired = skillRequired
		item.AddedAt = addedAt.Time
		out = append(out, item)
	}
	return out, nil
}
