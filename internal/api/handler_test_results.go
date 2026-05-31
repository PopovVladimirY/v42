package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/vpo/v42/internal/api/middleware"
	"github.com/vpo/v42/internal/db/store"
	"github.com/vpo/v42/internal/domain"
)

// timeEntryHandlers serves time-logging endpoints for tasks.
type timeEntryHandlers struct {
	entries *store.TimeEntryStore
	backlog *store.BacklogStore
	tasks   *store.TaskStore
}

type logTimeRequest struct {
	Hours      string  `json:"hours"`
	LoggedDate string  `json:"logged_date"` // YYYY-MM-DD
	Note       *string `json:"note"`
}

// Log handles POST /projects/{project_id}/backlog/{backlog_item_id}/tasks/{task_id}/time
func (h *timeEntryHandlers) Log(w http.ResponseWriter, r *http.Request) {
	if !ensureItemInProject(w, r, h.backlog) || !ensureTaskInItem(w, r, h.tasks) {
		return
	}
	taskID := chi.URLParam(r, "task_id")
	claims := middleware.ClaimsFromContext(r.Context())

	var req logTimeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON")
		return
	}
	if req.Hours == "" {
		respondErr(w, http.StatusBadRequest, "VALIDATION_ERROR", "hours is required")
		return
	}
	loggedDate := time.Now()
	if req.LoggedDate != "" {
		d, err := time.Parse("2006-01-02", req.LoggedDate)
		if err != nil {
			respondErr(w, http.StatusBadRequest, "VALIDATION_ERROR", "logged_date must be YYYY-MM-DD")
			return
		}
		loggedDate = d
	}

	entry, err := h.entries.Log(r.Context(), taskID, claims.Subject, req.Hours, loggedDate, req.Note)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "task not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to log time")
		return
	}
	respond(w, http.StatusCreated, entry)
}

// ListByTask handles GET /projects/{project_id}/backlog/{backlog_item_id}/tasks/{task_id}/time
func (h *timeEntryHandlers) ListByTask(w http.ResponseWriter, r *http.Request) {
	if !ensureItemInProject(w, r, h.backlog) || !ensureTaskInItem(w, r, h.tasks) {
		return
	}
	taskID := chi.URLParam(r, "task_id")
	entries, err := h.entries.ListByTask(r.Context(), taskID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "task not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list time entries")
		return
	}
	respond(w, http.StatusOK, entries)
}

// DeleteEntry handles DELETE
// /projects/{project_id}/backlog/{backlog_item_id}/tasks/{task_id}/time/{entry_id}
func (h *timeEntryHandlers) DeleteEntry(w http.ResponseWriter, r *http.Request) {
	if !ensureItemInProject(w, r, h.backlog) || !ensureTaskInItem(w, r, h.tasks) {
		return
	}
	entryID := chi.URLParam(r, "entry_id")
	claims := middleware.ClaimsFromContext(r.Context())

	if err := h.entries.DeleteEntry(r.Context(), entryID, claims.Subject); err != nil {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "time entry not found or not yours")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// -- Sprint test result handlers ---------------------------------------------

// sprintResultHandlers serves sprint test result endpoints.
type sprintResultHandlers struct {
	results *store.SprintTestStore
	sprints *store.SprintStore
}

type updateResultRequest struct {
	Status     string  `json:"status"`
	SkipReason *string `json:"skip_reason"`
	Notes      *string `json:"notes"`
}

// InitResults handles POST /projects/{project_id}/sprints/{sprint_id}/test-results/init
func (h *sprintResultHandlers) InitResults(w http.ResponseWriter, r *http.Request) {
	if !ensureSprintInProject(w, r, h.sprints) {
		return
	}
	sprintID := chi.URLParam(r, "id")
	if err := h.results.InitResults(r.Context(), sprintID); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "sprint not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to init test results")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListResults handles GET /projects/{project_id}/sprints/{sprint_id}/test-results
func (h *sprintResultHandlers) ListResults(w http.ResponseWriter, r *http.Request) {
	if !ensureSprintInProject(w, r, h.sprints) {
		return
	}
	sprintID := chi.URLParam(r, "id")
	rows, err := h.results.ListResults(r.Context(), sprintID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "sprint not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list test results")
		return
	}
	respond(w, http.StatusOK, rows)
}

// UpdateResult handles PATCH /projects/{project_id}/sprints/{sprint_id}/test-results/{result_id}
func (h *sprintResultHandlers) UpdateResult(w http.ResponseWriter, r *http.Request) {
	if !ensureSprintInProject(w, r, h.sprints) {
		return
	}
	sprintID := chi.URLParam(r, "id")
	resultID := chi.URLParam(r, "result_id")
	claims := middleware.ClaimsFromContext(r.Context())

	var req updateResultRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON")
		return
	}

	executedBy := claims.Subject
	row, err := h.results.UpdateResult(r.Context(), sprintID, resultID, req.Status,
		req.SkipReason, req.Notes, &executedBy)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "result not found")
			return
		}
		if errors.Is(err, domain.ErrConflict) {
			respondErr(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "invalid status value")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update result")
		return
	}
	respond(w, http.StatusOK, row)
}
