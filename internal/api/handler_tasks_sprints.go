package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/vpo/v42/internal/api/middleware"
	"github.com/vpo/v42/internal/db/store"
	"github.com/vpo/v42/internal/domain"
)

// validTaskStatus is the set of accepted task_status enum values.
var validTaskStatus = map[string]bool{"todo": true, "in_progress": true, "done": true, "cancelled": true}

// validSprintStatus is the set of accepted sprint_status enum values.
var validSprintStatus = map[string]bool{"planning": true, "active": true, "completed": true, "cancelled": true}

type taskHandlers struct {
	tasks *store.TaskStore
}

// List handles GET /api/v1/projects/{project_id}/backlog/{backlog_item_id}/tasks
func (h *taskHandlers) List(w http.ResponseWriter, r *http.Request) {
	backlogItemID := chi.URLParam(r, "backlog_item_id")
	items, err := h.tasks.List(r.Context(), backlogItemID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "backlog item not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list tasks")
		return
	}
	respond(w, http.StatusOK, items)
}

// Get handles GET .../{backlog_item_id}/tasks/{id}
func (h *taskHandlers) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	t, err := h.tasks.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "task not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get task")
		return
	}
	// Cross-backlog-item isolation: task must belong to the backlog item in the URL.
	if t.BacklogItemID != chi.URLParam(r, "backlog_item_id") {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "task not found")
		return
	}
	respond(w, http.StatusOK, t)
}

// Create handles POST .../{backlog_item_id}/tasks
func (h *taskHandlers) Create(w http.ResponseWriter, r *http.Request) {
	backlogItemID := chi.URLParam(r, "backlog_item_id")
	claims := middleware.ClaimsFromContext(r.Context())
	var req struct {
		Title         string   `json:"title"`
		Description   *string  `json:"description"`
		Status        string   `json:"status"`
		Estimate      *string  `json:"estimate"`
		OrderIndex    *float64 `json:"order_index"`
		AssigneeID    *string  `json:"assignee_id"`
		SkillRequired *string  `json:"skill_required"`
		ReviewerID    *string  `json:"reviewer_id"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "title is required")
		return
	}
	if req.Status == "" {
		req.Status = "todo"
	}
	orderIndex := 0.0
	if req.OrderIndex != nil {
		orderIndex = *req.OrderIndex
	}
	t, err := h.tasks.Create(r.Context(), backlogItemID, req.Title, req.Description, req.Status, req.Estimate, orderIndex, req.AssigneeID, req.SkillRequired, req.ReviewerID, claims.UserID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "backlog item not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create task")
		return
	}
	respond(w, http.StatusCreated, t)
}

// Update handles PATCH .../{backlog_item_id}/tasks/{id}
func (h *taskHandlers) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Title         *string `json:"title"`
		Description   *string `json:"description"`
		Status        *string `json:"status"`
		Estimate      *string `json:"estimate"`
		AssigneeID    *string `json:"assignee_id"`
		SkillRequired *string `json:"skill_required"`
		ReviewerID    *string `json:"reviewer_id"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	if req.Title != nil {
		*req.Title = strings.TrimSpace(*req.Title)
		if *req.Title == "" {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "title must not be empty")
			return
		}
	}
	if req.Status != nil && !validTaskStatus[*req.Status] {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid status value")
		return
	}
	// Cross-backlog-item isolation: verify task belongs to the URL's backlog item before updating.
	existingTask, err := h.tasks.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "task not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update task")
		return
	}
	if existingTask.BacklogItemID != chi.URLParam(r, "backlog_item_id") {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "task not found")
		return
	}
	t, err := h.tasks.Update(r.Context(), id, req.Title, req.Description, req.Status, req.Estimate, req.AssigneeID, req.SkillRequired, req.ReviewerID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "task not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update task")
		return
	}
	respond(w, http.StatusOK, t)
}

// Delete handles DELETE .../{backlog_item_id}/tasks/{id}
func (h *taskHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	// Cross-backlog-item isolation: verify task belongs to the URL's backlog item before deleting.
	existing, err := h.tasks.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "task not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete task")
		return
	}
	if existing.BacklogItemID != chi.URLParam(r, "backlog_item_id") {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "task not found")
		return
	}
	if err := h.tasks.Delete(r.Context(), id); err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete task")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Sprint handlers ---

type sprintHandlers struct {
	sprints *store.SprintStore
	results *store.SprintTestStore
}

// List handles GET /api/v1/projects/{project_id}/sprints
func (h *sprintHandlers) List(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	sprints, err := h.sprints.List(r.Context(), projectID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list sprints")
		return
	}
	respond(w, http.StatusOK, sprints)
}

// Get handles GET /api/v1/projects/{project_id}/sprints/{id}
func (h *sprintHandlers) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	s, err := h.sprints.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "sprint not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get sprint")
		return
	}
	// Cross-project isolation: sprint must belong to the project in the URL.
	if s.ProjectID != chi.URLParam(r, "project_id") {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "sprint not found")
		return
	}
	respond(w, http.StatusOK, s)
}

// Create handles POST /api/v1/projects/{project_id}/sprints
func (h *sprintHandlers) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	var req struct {
		TeamID        *string `json:"team_id"`
		Name          string  `json:"name"`
		Goal          *string `json:"goal"`
		Status        string  `json:"status"`
		StartDate     *string `json:"start_date"`
		EndDate       *string `json:"end_date"`
		CapacityHours *int16  `json:"capacity_hours"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "name is required")
		return
	}
	if req.Status == "" {
		req.Status = "planning"
	}
	if !validSprintStatus[req.Status] {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid status value")
		return
	}
	// Validate date formats before hitting the store (prevents raw pgtype errors bubbling up).
	if req.StartDate != nil {
		if _, err := time.Parse("2006-01-02", *req.StartDate); err != nil {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "start_date must be in YYYY-MM-DD format")
			return
		}
	}
	if req.EndDate != nil {
		if _, err := time.Parse("2006-01-02", *req.EndDate); err != nil {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "end_date must be in YYYY-MM-DD format")
			return
		}
	}
	s, err := h.sprints.Create(r.Context(), projectID, req.TeamID, req.Name, req.Goal, req.Status, req.StartDate, req.EndDate, req.CapacityHours)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create sprint")
		return
	}
	respond(w, http.StatusCreated, s)
}

// Update handles PATCH /api/v1/projects/{project_id}/sprints/{id}
func (h *sprintHandlers) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Name          *string `json:"name"`
		Goal          *string `json:"goal"`
		Status        *string `json:"status"`
		StartDate     *string `json:"start_date"`
		EndDate       *string `json:"end_date"`
		CapacityHours *int16  `json:"capacity_hours"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	if req.Name != nil {
		*req.Name = strings.TrimSpace(*req.Name)
		if *req.Name == "" {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "name must not be empty")
			return
		}
	}
	if req.Status != nil && !validSprintStatus[*req.Status] {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid status value")
		return
	}
	if req.StartDate != nil {
		if _, err := time.Parse("2006-01-02", *req.StartDate); err != nil {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "start_date must be in YYYY-MM-DD format")
			return
		}
	}
	if req.EndDate != nil {
		if _, err := time.Parse("2006-01-02", *req.EndDate); err != nil {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "end_date must be in YYYY-MM-DD format")
			return
		}
	}
	s, err := h.sprints.Update(r.Context(), id, req.Name, req.Goal, req.Status, req.StartDate, req.EndDate, req.CapacityHours)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "sprint not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update sprint")
		return
	}

	// Activation hook: when sprint transitions to active, seed test result rows.
	if req.Status != nil && *req.Status == "active" {
		go func() {
			_ = h.results.InitResults(context.Background(), id)
		}()
	}

	respond(w, http.StatusOK, s)
}

// Delete handles DELETE /api/v1/projects/{project_id}/sprints/{id}
func (h *sprintHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.sprints.Delete(r.Context(), id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "sprint not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete sprint")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListItems handles GET /api/v1/projects/{project_id}/sprints/{id}/items
func (h *sprintHandlers) ListItems(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	items, err := h.sprints.ListItems(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "sprint not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list sprint items")
		return
	}
	respond(w, http.StatusOK, items)
}

// AddItem handles POST /api/v1/projects/{project_id}/sprints/{id}/items
func (h *sprintHandlers) AddItem(w http.ResponseWriter, r *http.Request) {
	sprintID := chi.URLParam(r, "id")
	var req struct {
		BacklogItemID string `json:"backlog_item_id"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 512)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	if req.BacklogItemID == "" {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "backlog_item_id is required")
		return
	}
	if err := h.sprints.AddItem(r.Context(), sprintID, req.BacklogItemID); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "sprint or backlog item not found")
			return
		}
		if errors.Is(err, domain.ErrConflict) {
			respondErr(w, http.StatusConflict, "CONFLICT", "backlog item already in sprint")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to add item to sprint")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RemoveItem handles DELETE /api/v1/projects/{project_id}/sprints/{id}/items/{backlog_item_id}
func (h *sprintHandlers) RemoveItem(w http.ResponseWriter, r *http.Request) {
	sprintID := chi.URLParam(r, "id")
	backlogItemID := chi.URLParam(r, "backlog_item_id")
	if err := h.sprints.RemoveItem(r.Context(), sprintID, backlogItemID); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "sprint item not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to remove item from sprint")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
