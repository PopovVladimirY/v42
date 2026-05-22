package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/domain"
)

// Task is the store-level representation of a task.
type Task struct {
	ID            string    `json:"id"`
	BacklogItemID string    `json:"backlog_item_id"`
	Title         string    `json:"title"`
	Description   *string   `json:"description"`
	Status        string    `json:"status"`
	Estimate      *string   `json:"estimate"`
	OrderIndex    float64   `json:"order_index"`
	AssigneeID    *string   `json:"assignee_id"`
	SkillRequired *string   `json:"skill_required"`
	ReviewerID    *string   `json:"reviewer_id"`
	CreatedBy     string    `json:"created_by"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// TaskStore wraps sqlc task queries.
type TaskStore struct {
	q *dbgen.Queries
}

// NewTaskStore returns a TaskStore backed by sqlc Queries.
func NewTaskStore(q *dbgen.Queries) *TaskStore {
	return &TaskStore{q: q}
}

func taskFromCreateRow(r dbgen.CreateTaskRow) Task {
	t := Task{
		ID:            uuidToString(r.ID),
		BacklogItemID: uuidToString(r.BacklogItemID),
		Title:         r.Title,
		Description:   r.Description,
		Status:        string(r.Status),
		Estimate:      r.Estimate,
		OrderIndex:    r.OrderIndex,
		CreatedBy:     uuidToString(r.CreatedBy),
		CreatedAt:     r.CreatedAt.Time,
		UpdatedAt:     r.UpdatedAt.Time,
	}
	if r.AssigneeID.Valid {
		v := uuidToString(r.AssigneeID)
		t.AssigneeID = &v
	}
	if r.SkillRequired.Valid {
		v := uuidToString(r.SkillRequired)
		t.SkillRequired = &v
	}
	if r.ReviewerID.Valid {
		v := uuidToString(r.ReviewerID)
		t.ReviewerID = &v
	}
	return t
}

func taskFromListRow(r dbgen.ListTasksByBacklogItemRow) Task {
	t := Task{
		ID:            uuidToString(r.ID),
		BacklogItemID: uuidToString(r.BacklogItemID),
		Title:         r.Title,
		Description:   r.Description,
		Status:        string(r.Status),
		Estimate:      r.Estimate,
		OrderIndex:    r.OrderIndex,
		CreatedBy:     uuidToString(r.CreatedBy),
		CreatedAt:     r.CreatedAt.Time,
		UpdatedAt:     r.UpdatedAt.Time,
	}
	if r.AssigneeID.Valid {
		v := uuidToString(r.AssigneeID)
		t.AssigneeID = &v
	}
	if r.SkillRequired.Valid {
		v := uuidToString(r.SkillRequired)
		t.SkillRequired = &v
	}
	if r.ReviewerID.Valid {
		v := uuidToString(r.ReviewerID)
		t.ReviewerID = &v
	}
	return t
}

func taskFromUpdateRow(r dbgen.UpdateTaskRow) Task {
	t := Task{
		ID:            uuidToString(r.ID),
		BacklogItemID: uuidToString(r.BacklogItemID),
		Title:         r.Title,
		Description:   r.Description,
		Status:        string(r.Status),
		Estimate:      r.Estimate,
		OrderIndex:    r.OrderIndex,
		CreatedBy:     uuidToString(r.CreatedBy),
		CreatedAt:     r.CreatedAt.Time,
		UpdatedAt:     r.UpdatedAt.Time,
	}
	if r.AssigneeID.Valid {
		v := uuidToString(r.AssigneeID)
		t.AssigneeID = &v
	}
	if r.SkillRequired.Valid {
		v := uuidToString(r.SkillRequired)
		t.SkillRequired = &v
	}
	if r.ReviewerID.Valid {
		v := uuidToString(r.ReviewerID)
		t.ReviewerID = &v
	}
	return t
}

func taskFromGetRow(r dbgen.GetTaskByIDRow) Task {
	t := Task{
		ID:            uuidToString(r.ID),
		BacklogItemID: uuidToString(r.BacklogItemID),
		Title:         r.Title,
		Description:   r.Description,
		Status:        string(r.Status),
		Estimate:      r.Estimate,
		OrderIndex:    r.OrderIndex,
		CreatedBy:     uuidToString(r.CreatedBy),
		CreatedAt:     r.CreatedAt.Time,
		UpdatedAt:     r.UpdatedAt.Time,
	}
	if r.AssigneeID.Valid {
		v := uuidToString(r.AssigneeID)
		t.AssigneeID = &v
	}
	if r.SkillRequired.Valid {
		v := uuidToString(r.SkillRequired)
		t.SkillRequired = &v
	}
	if r.ReviewerID.Valid {
		v := uuidToString(r.ReviewerID)
		t.ReviewerID = &v
	}
	return t
}

// List returns tasks for a backlog item.
func (s *TaskStore) List(ctx context.Context, backlogItemID string) ([]Task, error) {
	bid, err := parseUUID(backlogItemID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.ListTasksByBacklogItem(ctx, bid)
	if err != nil {
		return nil, err
	}
	out := make([]Task, len(rows))
	for i, r := range rows {
		out[i] = taskFromListRow(r)
	}
	return out, nil
}

// GetByID returns a task or ErrNotFound.
func (s *TaskStore) GetByID(ctx context.Context, id string) (*Task, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.GetTaskByID(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	t := taskFromGetRow(r)
	return &t, nil
}

// Create inserts a new task.
func (s *TaskStore) Create(ctx context.Context, backlogItemID, title string, description *string, status string, estimate *string, orderIndex float64, assigneeID, skillRequired, reviewerID *string, createdBy string) (*Task, error) {
	bid, err := parseUUID(backlogItemID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	cby, err := parseUUID(createdBy)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var aid, skr, rid pgtype.UUID
	if assigneeID != nil {
		if aid, err = parseUUID(*assigneeID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	if skillRequired != nil {
		if skr, err = parseUUID(*skillRequired); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	if reviewerID != nil {
		if rid, err = parseUUID(*reviewerID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	r, err := s.q.CreateTask(ctx, dbgen.CreateTaskParams{
		BacklogItemID: bid,
		Title:         title,
		Description:   description,
		Status:        dbgen.TaskStatus(status),
		Estimate:      estimate,
		OrderIndex:    orderIndex,
		AssigneeID:    aid,
		SkillRequired: skr,
		ReviewerID:    rid,
		CreatedBy:     cby,
	})
	if err != nil {
		return nil, err
	}
	t := taskFromCreateRow(r)
	return &t, nil
}

// Update partially updates a task.
func (s *TaskStore) Update(ctx context.Context, id string, title, description *string, status, estimate *string, assigneeID, skillRequired, reviewerID *string) (*Task, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var st *dbgen.TaskStatus
	if status != nil {
		v := dbgen.TaskStatus(*status)
		st = &v
	}
	var aid, skr, rid pgtype.UUID
	if assigneeID != nil {
		if aid, err = parseUUID(*assigneeID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	if skillRequired != nil {
		if skr, err = parseUUID(*skillRequired); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	if reviewerID != nil {
		if rid, err = parseUUID(*reviewerID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	r, err := s.q.UpdateTask(ctx, dbgen.UpdateTaskParams{
		ID:            uid,
		Title:         title,
		Description:   description,
		Status:        st,
		Estimate:      estimate,
		AssigneeID:    aid,
		SkillRequired: skr,
		ReviewerID:    rid,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	t := taskFromUpdateRow(r)
	return &t, nil
}

// Delete removes a task.
func (s *TaskStore) Delete(ctx context.Context, id string) error {
	uid, err := parseUUID(id)
	if err != nil {
		return domain.ErrNotFound
	}
	return s.q.DeleteTask(ctx, uid)
}
