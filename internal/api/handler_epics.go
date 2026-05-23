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

// validEpicStatus is the set of accepted epic_status enum values.
var validEpicStatus = map[string]bool{"open": true, "in_progress": true, "done": true, "cancelled": true}
var validEpicClarity = map[string]bool{"clear": true, "scoped": true, "tacit": true, "foggy": true, "unknown": true}

type epicHandlers struct {
	epics *store.EpicStore
}

// List handles GET /api/v1/projects/{project_id}/epics
func (h *epicHandlers) List(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	epics, err := h.epics.List(r.Context(), projectID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list epics")
		return
	}
	respond(w, http.StatusOK, epics)
}

// Get handles GET /api/v1/projects/{project_id}/epics/{id}
func (h *epicHandlers) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	e, err := h.epics.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "epic not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get epic")
		return
	}
	// Cross-project isolation: epic must belong to the project in the URL.
	if e.ProjectID != chi.URLParam(r, "project_id") {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "epic not found")
		return
	}
	respond(w, http.StatusOK, e)
}

// Create handles POST /api/v1/projects/{project_id}/epics
func (h *epicHandlers) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	claims := middleware.ClaimsFromContext(r.Context())
	var req struct {
		Title       string  `json:"title"`
		Description *string `json:"description"`
		Status      string  `json:"status"`
		Clarity     string  `json:"clarity"`
		TargetDate  *string `json:"target_date"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "title is required")
		return
	}
	if len(req.Title) > 200 {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "title must not exceed 200 characters")
		return
	}
	if req.Status == "" {
		req.Status = "open"
	}
	if !validEpicStatus[req.Status] {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid status value")
		return
	}
	if req.Clarity == "" {
		req.Clarity = "unknown"
	}
	if !validEpicClarity[req.Clarity] {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid clarity value")
		return
	}
	e, err := h.epics.Create(r.Context(), projectID, req.Title, req.Description, req.Status, claims.UserID, req.TargetDate)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create epic")
		return
	}
	respond(w, http.StatusCreated, e)
}

// Update handles PATCH /api/v1/projects/{project_id}/epics/{id}
func (h *epicHandlers) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	projectID := chi.URLParam(r, "project_id")
	var req struct {
		Title       *string `json:"title"`
		Description *string `json:"description"`
		Status      *string `json:"status"`
		Clarity     *string `json:"clarity"`
		TargetDate  *string `json:"target_date"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
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
		if len(*req.Title) > 200 {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "title must not exceed 200 characters")
			return
		}
	}
	if req.Status != nil && !validEpicStatus[*req.Status] {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid status value")
		return
	}
	if req.Clarity != nil && !validEpicClarity[*req.Clarity] {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid clarity value")
		return
	}
	// Cross-project isolation: verify epic belongs to the URL's project before updating.
	existing, err := h.epics.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "epic not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update epic")
		return
	}
	if existing.ProjectID != projectID {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "epic not found")
		return
	}
	e, err := h.epics.Update(r.Context(), id, req.Title, req.Description, req.Status, nil, req.Clarity, req.TargetDate)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "epic not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update epic")
		return
	}
	respond(w, http.StatusOK, e)
}

// Delete handles DELETE /api/v1/projects/{project_id}/epics/{id}
func (h *epicHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	// Cross-project isolation + ErrNotFound: pre-fetch the epic before deleting.
	existing, err := h.epics.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "epic not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete epic")
		return
	}
	if existing.ProjectID != chi.URLParam(r, "project_id") {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "epic not found")
		return
	}
	if err := h.epics.Delete(r.Context(), id); err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete epic")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
