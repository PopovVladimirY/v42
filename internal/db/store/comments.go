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

// Comment is the store-level comment representation.
type Comment struct {
	ID            string     `json:"id"`
	Body          *string    `json:"body"`
	AuthorID      string     `json:"author_id"`
	ParentID      *string    `json:"parent_id"`
	DeletedAt     *time.Time `json:"deleted_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// CommentStore wraps sqlc comment queries.
type CommentStore struct {
	q *dbgen.Queries
}

// NewCommentStore returns a CommentStore.
func NewCommentStore(q *dbgen.Queries) *CommentStore {
	return &CommentStore{q: q}
}

func commentFromListRow(id, authorID, parentID pgtype.UUID, body *string, deletedAt, createdAt, updatedAt pgtype.Timestamptz) Comment {
	c := Comment{
		ID:        uuidToString(id),
		Body:      body,
		AuthorID:  uuidToString(authorID),
		CreatedAt: createdAt.Time,
		UpdatedAt: updatedAt.Time,
	}
	if parentID.Valid {
		v := uuidToString(parentID)
		c.ParentID = &v
	}
	if deletedAt.Valid {
		t := deletedAt.Time
		c.DeletedAt = &t
	}
	return c
}

// ListByBacklogItem returns comments threaded under a backlog item.
func (s *CommentStore) ListByBacklogItem(ctx context.Context, backlogItemID string) ([]Comment, error) {
	bid, err := parseUUID(backlogItemID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.ListCommentsByBacklogItem(ctx, bid)
	if err != nil {
		return nil, err
	}
	out := make([]Comment, len(rows))
	for i, r := range rows {
		out[i] = commentFromListRow(r.ID, r.AuthorID, r.ParentID, r.Body, r.DeletedAt, r.CreatedAt, r.UpdatedAt)
	}
	return out, nil
}

// ListByTask returns comments threaded under a task.
func (s *CommentStore) ListByTask(ctx context.Context, taskID string) ([]Comment, error) {
	tid, err := parseUUID(taskID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.ListCommentsByTask(ctx, tid)
	if err != nil {
		return nil, err
	}
	out := make([]Comment, len(rows))
	for i, r := range rows {
		out[i] = commentFromListRow(r.ID, r.AuthorID, r.ParentID, r.Body, r.DeletedAt, r.CreatedAt, r.UpdatedAt)
	}
	return out, nil
}

// GetByID returns a comment or ErrNotFound.
func (s *CommentStore) GetByID(ctx context.Context, id string) (*Comment, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.GetCommentByID(ctx, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	c := commentFromListRow(r.ID, r.AuthorID, r.ParentID, r.Body, r.DeletedAt, r.CreatedAt, r.UpdatedAt)
	return &c, nil
}

// Create inserts a new comment. Exactly one of backlogItemID, taskID must be non-nil (DB constraint enforces).
func (s *CommentStore) Create(ctx context.Context, projectID string, epicID, backlogItemID, taskID, parentID *string, body string, authorID string) (*Comment, error) {
	// projectID is the "project-level comment" parent — pass empty string to leave it NULL.
	var pid pgtype.UUID
	if projectID != "" {
		var err error
		if pid, err = parseUUID(projectID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	aid, err := parseUUID(authorID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var eid, bid, tid, par pgtype.UUID
	if epicID != nil {
		if eid, err = parseUUID(*epicID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	if backlogItemID != nil {
		if bid, err = parseUUID(*backlogItemID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	if taskID != nil {
		if tid, err = parseUUID(*taskID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	if parentID != nil {
		if par, err = parseUUID(*parentID); err != nil {
			return nil, domain.ErrNotFound
		}
	}
	r, err := s.q.CreateComment(ctx, dbgen.CreateCommentParams{
		ProjectID:     pid,
		EpicID:        eid,
		BacklogItemID: bid,
		TaskID:        tid,
		Body:          &body,
		AuthorID:      aid,
		ParentID:      par,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			// FK violation — parent entity (backlog item, task, etc.) does not exist
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	c := commentFromListRow(r.ID, r.AuthorID, r.ParentID, r.Body, r.DeletedAt, r.CreatedAt, r.UpdatedAt)
	return &c, nil
}

// Update changes the body of a comment.
func (s *CommentStore) Update(ctx context.Context, id, body string) (*Comment, error) {
	uid, err := parseUUID(id)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	r, err := s.q.UpdateComment(ctx, dbgen.UpdateCommentParams{
		ID:   uid,
		Body: &body,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	c := commentFromListRow(r.ID, r.AuthorID, r.ParentID, r.Body, r.DeletedAt, r.CreatedAt, r.UpdatedAt)
	return &c, nil
}

// SoftDelete marks a comment as deleted (body = NULL, deleted_at = now).
func (s *CommentStore) SoftDelete(ctx context.Context, id string) error {
	uid, err := parseUUID(id)
	if err != nil {
		return domain.ErrNotFound
	}
	// GetByID detects missing comments — SoftDeleteComment returns nil for 0 rows affected.
	if _, err := s.GetByID(ctx, id); err != nil {
		return err
	}
	return s.q.SoftDeleteComment(ctx, uid)
}
