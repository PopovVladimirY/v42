package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/vpo/v42/internal/db/store"
	"github.com/vpo/v42/internal/domain"
)

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
	respond(w, http.StatusOK, e)
}

// Create handles POST /api/v1/projects/{project_id}/epics
func (h *epicHandlers) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	var req struct {
		Title       string  `json:"title"`
		Description *string `json:"description"`
		Status      string  `json:"status"`
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
	e, err := h.epics.Create(r.Context(), projectID, req.Title, req.Description, req.Status, "", req.TargetDate)
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
	var req struct {
		Title       *string `json:"title"`
		Description *string `json:"description"`
		Status      *string `json:"status"`
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
	e, err := h.epics.Update(r.Context(), id, req.Title, req.Description, req.Status, nil, req.TargetDate)
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
	if err := h.epics.Delete(r.Context(), id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "epic not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete epic")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
