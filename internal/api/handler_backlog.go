package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/vpo/v42/internal/api/middleware"
	"github.com/vpo/v42/internal/db/store"
	"github.com/vpo/v42/internal/domain"
)

// validBacklogItemStatus is the set of accepted item_status enum values.
var validBacklogItemStatus = map[string]bool{
	"planned":     true,
	"request":     true,
	"on_hold":     true,
	"open":        true,
	"in_progress": true,
	"in_review":   true,
	"done":        true,
	"cancelled":   true,
	"rejected":    true,
}

// validBacklogItemType is the set of accepted item_type enum values.
var validBacklogItemType = map[string]bool{
	"story":          true,
	"bug":            true,
	"feature":        true,
	"technical_debt": true,
}

type backlogHandlers struct {
	backlog *store.BacklogStore
}

// List handles GET /api/v1/projects/{project_id}/backlog
func (h *backlogHandlers) List(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	var epicID *string
	var status *string
	var clarity *string
	if v := r.URL.Query().Get("epic_id"); v != "" {
		epicID = &v
	}
	if v := r.URL.Query().Get("status"); v != "" {
		status = &v
	}
	if v := r.URL.Query().Get("clarity"); v != "" {
		clarity = &v
	}
	items, err := h.backlog.List(r.Context(), projectID, epicID, status, clarity)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list backlog items")
		return
	}
	respond(w, http.StatusOK, items)
}

// Get handles GET /api/v1/projects/{project_id}/backlog/{id}
func (h *backlogHandlers) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	item, err := h.backlog.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "backlog item not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get backlog item")
		return
	}
	// Cross-project isolation: item must belong to the project in the URL.
	if item.ProjectID != chi.URLParam(r, "project_id") {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "backlog item not found")
		return
	}
	respond(w, http.StatusOK, item)
}

// Create handles POST /api/v1/projects/{project_id}/backlog
func (h *backlogHandlers) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	claims := middleware.ClaimsFromContext(r.Context())

	var req struct {
		EpicID        *string  `json:"epic_id"`
		ReleaseID     *string  `json:"release_id"`
		StageID       *string  `json:"stage_id"`
		Title         string   `json:"title"`
		Description   *string  `json:"description"`
		Type          string   `json:"type"`
		Status        string   `json:"status"`
		Priority      *float64 `json:"priority"`
		Estimate      *string  `json:"estimate"`
		AssigneeID    *string  `json:"assignee_id"`
		SkillRequired *string  `json:"skill_required"`
		AcSetup       *string  `json:"ac_setup"`
		AcSteps       *string  `json:"ac_steps"`
		AcExpected    *string  `json:"ac_expected"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16384)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "title is required")
		return
	}
	if req.Type == "" {
		req.Type = "story"
	}
	if !validBacklogItemType[req.Type] {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid type value")
		return
	}
	if req.Status == "" {
		req.Status = "planned"
	}
	if !validBacklogItemStatus[req.Status] {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid status value")
		return
	}
	priority := 0.0
	if req.Priority != nil {
		priority = *req.Priority
	}
	item, err := h.backlog.Create(r.Context(), store.CreateBacklogItemRequest{
		ProjectID:     projectID,
		EpicID:        req.EpicID,
		ReleaseID:     req.ReleaseID,
		StageID:       req.StageID,
		Title:         req.Title,
		Description:   req.Description,
		Type:          req.Type,
		Status:        req.Status,
		Priority:      priority,
		Estimate:      req.Estimate,
		AssigneeID:    req.AssigneeID,
		SkillRequired: req.SkillRequired,
		AcSetup:       req.AcSetup,
		AcSteps:       req.AcSteps,
		AcExpected:    req.AcExpected,
		CreatedBy:     claims.UserID,
	})
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create backlog item")
		return
	}
	respond(w, http.StatusCreated, item)
}

// Update handles PATCH /api/v1/projects/{project_id}/backlog/{id}
func (h *backlogHandlers) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		EpicID        *string `json:"epic_id"`
		ReleaseID     *string `json:"release_id"`
		StageID       *string `json:"stage_id"`
		NodeID        *string `json:"node_id"`
		Title         *string `json:"title"`
		Description   *string `json:"description"`
		Type          *string `json:"type"`
		Status        *string `json:"status"`
		Clarity       *string `json:"clarity"`
		Estimate      *string `json:"estimate"`
		AssigneeID    *string `json:"assignee_id"`
		SkillRequired *string `json:"skill_required"`
		AcSetup       *string `json:"ac_setup"`
		AcSteps       *string `json:"ac_steps"`
		AcExpected    *string `json:"ac_expected"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16384)
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
	if req.Type != nil && !validBacklogItemType[*req.Type] {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid type value")
		return
	}
	if req.Status != nil && !validBacklogItemStatus[*req.Status] {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid status value")
		return
	}
	// Cross-project isolation: verify item belongs to the URL's project before updating.
	existing, err := h.backlog.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "backlog item not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update backlog item")
		return
	}
	if existing.ProjectID != chi.URLParam(r, "project_id") {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "backlog item not found")
		return
	}
	item, err := h.backlog.Update(r.Context(), store.UpdateBacklogItemRequest{
		ID:            id,
		EpicID:        req.EpicID,
		ReleaseID:     req.ReleaseID,
		StageID:       req.StageID,
		NodeID:        req.NodeID,
		Title:         req.Title,
		Description:   req.Description,
		Type:          req.Type,
		Status:        req.Status,
		Clarity:       req.Clarity,
		Estimate:      req.Estimate,
		AssigneeID:    req.AssigneeID,
		SkillRequired: req.SkillRequired,
		AcSetup:       req.AcSetup,
		AcSteps:       req.AcSteps,
		AcExpected:    req.AcExpected,
	})
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "backlog item not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update backlog item")
		return
	}
	respond(w, http.StatusOK, item)
}

// Delete handles DELETE /api/v1/projects/{project_id}/backlog/{id}
func (h *backlogHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	// Cross-project isolation: verify item belongs to the URL's project before deleting.
	existing, err := h.backlog.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "backlog item not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete backlog item")
		return
	}
	if existing.ProjectID != chi.URLParam(r, "project_id") {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "backlog item not found")
		return
	}
	if err := h.backlog.Delete(r.Context(), id); err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete backlog item")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Reorder handles POST /api/v1/projects/{project_id}/backlog/reorder
func (h *backlogHandlers) Reorder(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	var req struct {
		Items []struct {
			ID       string  `json:"id"`
			Priority float64 `json:"priority"`
		} `json:"items"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32768)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	if len(req.Items) == 0 {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "items must not be empty")
		return
	}
	reorderItems := make([]store.ReorderItem, len(req.Items))
	for i, it := range req.Items {
		reorderItems[i] = store.ReorderItem{ID: it.ID, Priority: it.Priority}
	}
	if err := h.backlog.Reorder(r.Context(), projectID, reorderItems); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project or item not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to reorder backlog")
		return
	}
	respond(w, http.StatusOK, map[string]string{"status": "ok"})
}
