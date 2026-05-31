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
	"github.com/vpo/v42/internal/sse"
)

// validTaskStatus is the set of accepted task_status enum values.
var validTaskStatus = map[string]bool{"todo": true, "in_progress": true, "done": true, "cancelled": true}

// validSprintStatus is the set of accepted sprint_status enum values.
var validSprintStatus = map[string]bool{"planning": true, "active": true, "completed": true, "cancelled": true}

type taskHandlers struct {
	tasks   *store.TaskStore
	backlog *store.BacklogStore
	events  *sse.Broker
}

// List handles GET /api/v1/projects/{project_id}/backlog/{backlog_item_id}/tasks
func (h *taskHandlers) List(w http.ResponseWriter, r *http.Request) {
	if !ensureItemInProject(w, r, h.backlog) {
		return
	}
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
	if !ensureItemInProject(w, r, h.backlog) {
		return
	}
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
	if !ensureItemInProject(w, r, h.backlog) {
		return
	}
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
	h.events.Publish(sse.Event{Type: sse.EventTaskCreated, ProjectID: chi.URLParam(r, "project_id"), EntityID: t.ID, Actor: claims.UserID})
	respond(w, http.StatusCreated, t)
}

// Update handles PATCH .../{backlog_item_id}/tasks/{id}
func (h *taskHandlers) Update(w http.ResponseWriter, r *http.Request) {
	if !ensureItemInProject(w, r, h.backlog) {
		return
	}
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
	h.events.Publish(sse.Event{Type: sse.EventTaskUpdated, ProjectID: chi.URLParam(r, "project_id"), EntityID: t.ID, Actor: actorID(r)})
	respond(w, http.StatusOK, t)
}

// Delete handles DELETE .../{backlog_item_id}/tasks/{id}
func (h *taskHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	if !ensureItemInProject(w, r, h.backlog) {
		return
	}
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
	h.events.Publish(sse.Event{Type: sse.EventTaskDeleted, ProjectID: chi.URLParam(r, "project_id"), EntityID: id, Actor: actorID(r)})
	w.WriteHeader(http.StatusNoContent)
}

// Move handles POST .../{backlog_item_id}/tasks/{id}/move
func (h *taskHandlers) Move(w http.ResponseWriter, r *http.Request) {
	if !ensureItemInProject(w, r, h.backlog) {
		return
	}
	id := chi.URLParam(r, "id")
	var req struct {
		TargetItemID string `json:"target_item_id"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	if req.TargetItemID == "" {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "target_item_id is required")
		return
	}
	// Verify task belongs to the URL's backlog item.
	existing, err := h.tasks.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "task not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to move task")
		return
	}
	if existing.BacklogItemID != chi.URLParam(r, "backlog_item_id") {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "task not found")
		return
	}
	// Cross-project isolation: the move target must live in the same project,
	// otherwise a task could be smuggled out into someone else's backlog.
	target, err := h.backlog.GetByID(r.Context(), req.TargetItemID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "target item not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to move task")
		return
	}
	if target.ProjectID != chi.URLParam(r, "project_id") {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "target item not found")
		return
	}
	t, err := h.tasks.MoveTo(r.Context(), id, req.TargetItemID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "task or target item not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to move task")
		return
	}
	h.events.Publish(sse.Event{Type: sse.EventTaskMoved, ProjectID: chi.URLParam(r, "project_id"), EntityID: t.ID, Actor: actorID(r)})
	respond(w, http.StatusOK, t)
}

// --- Sprint handlers ---

type sprintHandlers struct {
	sprints *store.SprintStore
	backlog *store.BacklogStore
	results *store.SprintTestStore
	events  *sse.Broker
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
	h.events.Publish(sse.Event{Type: sse.EventSprintCreated, ProjectID: projectID, EntityID: s.ID, Actor: actorID(r)})
	respond(w, http.StatusCreated, s)
}

// Update handles PATCH /api/v1/projects/{project_id}/sprints/{id}
func (h *sprintHandlers) Update(w http.ResponseWriter, r *http.Request) {
	if !ensureSprintInProject(w, r, h.sprints) {
		return
	}
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

	h.events.Publish(sse.Event{Type: sse.EventSprintUpdated, ProjectID: s.ProjectID, EntityID: s.ID, Actor: actorID(r)})
	respond(w, http.StatusOK, s)
}

// Delete handles DELETE /api/v1/projects/{project_id}/sprints/{id}
func (h *sprintHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	if !ensureSprintInProject(w, r, h.sprints) {
		return
	}
	id := chi.URLParam(r, "id")
	if err := h.sprints.Delete(r.Context(), id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "sprint not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete sprint")
		return
	}
	h.events.Publish(sse.Event{Type: sse.EventSprintDeleted, ProjectID: chi.URLParam(r, "project_id"), EntityID: id, Actor: actorID(r)})
	w.WriteHeader(http.StatusNoContent)
}

// ListItems handles GET /api/v1/projects/{project_id}/sprints/{id}/items
func (h *sprintHandlers) ListItems(w http.ResponseWriter, r *http.Request) {
	if !ensureSprintInProject(w, r, h.sprints) {
		return
	}
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
	if !ensureSprintInProject(w, r, h.sprints) {
		return
	}
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
	// Cross-project isolation: only items from this project may join the sprint.
	item, err := h.backlog.GetByID(r.Context(), req.BacklogItemID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "backlog item not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to add item to sprint")
		return
	}
	if item.ProjectID != chi.URLParam(r, "project_id") {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "backlog item not found")
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
	h.events.Publish(sse.Event{Type: sse.EventSprintItemAdded, ProjectID: chi.URLParam(r, "project_id"), EntityID: req.BacklogItemID, Actor: actorID(r)})
	w.WriteHeader(http.StatusNoContent)
}

// RemoveItem handles DELETE /api/v1/projects/{project_id}/sprints/{id}/items/{backlog_item_id}
func (h *sprintHandlers) RemoveItem(w http.ResponseWriter, r *http.Request) {
	if !ensureSprintInProject(w, r, h.sprints) {
		return
	}
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
	h.events.Publish(sse.Event{Type: sse.EventSprintItemRemoved, ProjectID: chi.URLParam(r, "project_id"), EntityID: backlogItemID, Actor: actorID(r)})
	w.WriteHeader(http.StatusNoContent)
}

// Close handles POST /api/v1/projects/{project_id}/sprints/{id}/close.
// Body (optional): { "carry_to_sprint_id": "uuid" }
// Moves unclosed items to the target sprint and marks current sprint as completed.
func (h *sprintHandlers) Close(w http.ResponseWriter, r *http.Request) {
	if !ensureSprintInProject(w, r, h.sprints) {
		return
	}
	id := chi.URLParam(r, "id")
	var body struct {
		CarryToSprintID string `json:"carry_to_sprint_id"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 512)
	_ = json.NewDecoder(r.Body).Decode(&body) // body is optional

	carried, err := h.sprints.Close(r.Context(), id, body.CarryToSprintID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "sprint or target sprint not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to carry over items")
		return
	}

	completed := "completed"
	s, err := h.sprints.Update(r.Context(), id, nil, nil, &completed, nil, nil, nil)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to mark sprint as completed")
		return
	}

	h.events.Publish(sse.Event{Type: sse.EventSprintClosed, ProjectID: s.ProjectID, EntityID: id, Actor: actorID(r)})
	respond(w, http.StatusOK, map[string]any{
		"sprint":              s,
		"carried_over":        carried,
		"carry_to_sprint_id":  body.CarryToSprintID,
	})
}

// ListGlobal handles GET /api/v1/sprints -- cross-project sprint dashboard.
// Admins and maintainers see all sprints; regular users see only their teams' sprints.
func (h *sprintHandlers) ListGlobal(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil {
		respondErr(w, http.StatusUnauthorized, "UNAUTHORIZED", "not authenticated")
		return
	}
	status := r.URL.Query().Get("status")
	if status == "" {
		status = "active"
	}
	if !validSprintStatus[status] {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid status")
		return
	}
	var (
		sprints []*store.GlobalSprint
		err     error
	)
	if claims.Role == "admin" || claims.Role == "maintainer" {
		sprints, err = h.sprints.ListGlobalAdmin(r.Context(), status)
	} else {
		sprints, err = h.sprints.ListGlobalForUser(r.Context(), status, claims.UserID)
	}
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list sprints")
		return
	}
	respond(w, http.StatusOK, sprints)
}
