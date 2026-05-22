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

// validProjectStatus is the set of accepted project_status enum values.
var validProjectStatus = map[string]bool{"active": true, "on_hold": true, "archived": true}

type projectHandlers struct {
	projects *store.ProjectStore
}

// List handles GET /api/v1/projects
func (h *projectHandlers) List(w http.ResponseWriter, r *http.Request) {
	var teamID *string
	var status *string
	if v := r.URL.Query().Get("team_id"); v != "" {
		teamID = &v
	}
	if v := r.URL.Query().Get("status"); v != "" {
		status = &v
	}
	projects, err := h.projects.List(r.Context(), teamID, status)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list projects")
		return
	}
	respond(w, http.StatusOK, projects)
}

// Get handles GET /api/v1/projects/{project_id}
func (h *projectHandlers) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "project_id")
	p, err := h.projects.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get project")
		return
	}
	respond(w, http.StatusOK, p)
}

// Create handles POST /api/v1/projects
func (h *projectHandlers) Create(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	var req struct {
		TeamID      *string `json:"team_id"`
		Name        string  `json:"name"`
		Description *string `json:"description"`
		Status      string  `json:"status"`
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
	if len(req.Name) > 200 {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "name must not exceed 200 characters")
		return
	}
	if req.Status == "" {
		req.Status = "active"
	}
	if !validProjectStatus[req.Status] {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid status value")
		return
	}
	p, err := h.projects.Create(r.Context(), req.Name, req.Description, req.Status, claims.UserID, req.TeamID)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create project")
		return
	}
	respond(w, http.StatusCreated, p)
}

// Update handles PATCH /api/v1/projects/{project_id}
func (h *projectHandlers) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "project_id")
	var req struct {
		TeamID      *string `json:"team_id"`
		Name        *string `json:"name"`
		Description *string `json:"description"`
		Status      *string `json:"status"`
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
		if len(*req.Name) > 200 {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "name must not exceed 200 characters")
			return
		}
	}
	if req.Status != nil && !validProjectStatus[*req.Status] {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid status value")
		return
	}
	p, err := h.projects.Update(r.Context(), id, req.Name, req.Description, req.Status, req.TeamID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update project")
		return
	}
	respond(w, http.StatusOK, p)
}

// Delete handles DELETE /api/v1/projects/{project_id}
func (h *projectHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "project_id")
	if err := h.projects.Delete(r.Context(), id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete project")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
