package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/domain"
)

// TimeEntry is the store-level view of a time log row.
type TimeEntry struct {
	ID         string    `json:"id"`
	TaskID     string    `json:"task_id"`
	UserID     string    `json:"user_id"`
	Hours      string    `json:"hours"` // numeric as string to avoid float precision issues
	LoggedDate string    `json:"logged_date"`
	Note       *string   `json:"note,omitempty"`
	UserName   string    `json:"user_name,omitempty"` // only on List by task
	TaskTitle  string    `json:"task_title,omitempty"` // only on List by user
	CreatedAt  time.Time `json:"created_at"`
}

// TimeEntryStore wraps sqlc time_entry queries.
type TimeEntryStore struct {
	q *dbgen.Queries
}

// NewTimeEntryStore returns a TimeEntryStore.
func NewTimeEntryStore(q *dbgen.Queries) *TimeEntryStore {
	return &TimeEntryStore{q: q}
}

// Log creates a time entry. hours is a decimal string, e.g. "1.5".
func (s *TimeEntryStore) Log(ctx context.Context, taskID, userID, hours string, loggedDate time.Time, note *string) (*TimeEntry, error) {
	taskUUID, err := parseUUID(taskID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	userUUID, err := parseUUID(userID)
	if err != nil {
		return nil, domain.ErrNotFound
	}

	var hoursNum pgtype.Numeric
	if err := hoursNum.Scan(hours); err != nil {
		return nil, fmt.Errorf("invalid hours value %q: %w", hours, err)
	}

	date := pgtype.Date{Time: loggedDate, Valid: true}

	row, err := s.q.CreateTimeEntry(ctx, dbgen.CreateTimeEntryParams{
		TaskID:     taskUUID,
		UserID:     userUUID,
		Hours:      hoursNum,
		LoggedDate: date,
		Note:       note,
	})
	if err != nil {
		return nil, err
	}

	return &TimeEntry{
		ID:         uuidToString(row.ID),
		TaskID:     uuidToString(row.TaskID),
		UserID:     uuidToString(row.UserID),
		Hours:      numericToString(row.Hours),
		LoggedDate: dateToString(row.LoggedDate),
		Note:       row.Note,
		CreatedAt:  row.CreatedAt.Time,
	}, nil
}

// ListByTask returns all time entries for a task with user display names.
func (s *TimeEntryStore) ListByTask(ctx context.Context, taskID string) ([]TimeEntry, error) {
	uid, err := parseUUID(taskID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.ListTimeEntriesByTask(ctx, uid)
	if err != nil {
		return nil, err
	}

	out := make([]TimeEntry, len(rows))
	for i, r := range rows {
		out[i] = TimeEntry{
			ID:         uuidToString(r.ID),
			TaskID:     uuidToString(r.TaskID),
			UserID:     uuidToString(r.UserID),
			Hours:      numericToString(r.Hours),
			LoggedDate: dateToString(r.LoggedDate),
			Note:       r.Note,
			UserName:   r.UserName,
			CreatedAt:  r.CreatedAt.Time,
		}
	}
	return out, nil
}

// TotalByTask returns total hours logged to a task as a string.
func (s *TimeEntryStore) TotalByTask(ctx context.Context, taskID string) (string, error) {
	uid, err := parseUUID(taskID)
	if err != nil {
		return "0", domain.ErrNotFound
	}
	total, err := s.q.GetTimeEntryTotalByTask(ctx, uid)
	if err != nil {
		return "0", err
	}
	return numericToString(total), nil
}

// ListByUser returns time entries for a user within a date range.
func (s *TimeEntryStore) ListByUser(ctx context.Context, userID string, from, to time.Time) ([]TimeEntry, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	rows, err := s.q.ListTimeEntriesByUser(ctx, dbgen.ListTimeEntriesByUserParams{
		UserID:   uid,
		FromDate: pgtype.Date{Time: from, Valid: true},
		ToDate:   pgtype.Date{Time: to, Valid: true},
	})
	if err != nil {
		return nil, err
	}

	out := make([]TimeEntry, len(rows))
	for i, r := range rows {
		out[i] = TimeEntry{
			ID:         uuidToString(r.ID),
			TaskID:     uuidToString(r.TaskID),
			UserID:     uuidToString(r.UserID),
			Hours:      numericToString(r.Hours),
			LoggedDate: dateToString(r.LoggedDate),
			Note:       r.Note,
			TaskTitle:  r.TaskTitle,
			CreatedAt:  r.CreatedAt.Time,
		}
	}
	return out, nil
}

// DeleteEntry deletes an entry, owner-scoped (only the user who logged it can delete).
func (s *TimeEntryStore) DeleteEntry(ctx context.Context, entryID, userID string) error {
	entryUUID, err := parseUUID(entryID)
	if err != nil {
		return domain.ErrNotFound
	}
	userUUID, err := parseUUID(userID)
	if err != nil {
		return domain.ErrNotFound
	}
	return s.q.DeleteTimeEntry(ctx, dbgen.DeleteTimeEntryParams{
		ID:     entryUUID,
		UserID: userUUID,
	})
}

// numericToString converts pgtype.Numeric to a decimal string.
func numericToString(n pgtype.Numeric) string {
	if !n.Valid {
		return "0"
	}
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return "0"
	}
	return fmt.Sprintf("%g", f.Float64)
}

// dateToString converts pgtype.Date to YYYY-MM-DD string.
func dateToString(d pgtype.Date) string {
	if !d.Valid {
		return ""
	}
	return d.Time.Format("2006-01-02")
}
