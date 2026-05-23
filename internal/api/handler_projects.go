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
	teams    *store.ProjectTeamStore
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
	p, err := h.projects.Update(r.Context(), id, req.Name, req.Description, req.Status)
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

// ListTeams handles GET /api/v1/projects/{project_id}/teams
func (h *projectHandlers) ListTeams(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "project_id")
	teams, err := h.teams.ListTeams(r.Context(), id)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list teams")
		return
	}
	respond(w, http.StatusOK, teams)
}

// AddTeam handles POST /api/v1/projects/{project_id}/teams
func (h *projectHandlers) AddTeam(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "project_id")
	var req struct {
		TeamID string `json:"team_id"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	if req.TeamID == "" {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "team_id is required")
		return
	}
	if err := h.teams.AddTeam(r.Context(), id, req.TeamID); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project or team not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to add team")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RemoveTeam handles DELETE /api/v1/projects/{project_id}/teams/{team_id}
func (h *projectHandlers) RemoveTeam(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	teamID := chi.URLParam(r, "team_id")
	if err := h.teams.RemoveTeam(r.Context(), projectID, teamID); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project or team not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to remove team")
		return
	}
	w.WriteHeader(http.StatusNoContent)
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

// Archive handles PATCH /api/v1/projects/{project_id}/archive (admin only).
// Soft-deletes the project by setting is_archived = true.
func (h *projectHandlers) Archive(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "project_id")
	p, err := h.projects.Archive(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to archive project")
		return
	}
	respond(w, http.StatusOK, p)
}

// ListArchived handles GET /api/v1/projects/archived (admin only).
func (h *projectHandlers) ListArchived(w http.ResponseWriter, r *http.Request) {
	projects, err := h.projects.ListArchived(r.Context())
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list archived projects")
		return
	}
	respond(w, http.StatusOK, projects)
}

// Unarchive handles PATCH /api/v1/projects/{project_id}/unarchive (admin only).
// Restores a previously archived project.
func (h *projectHandlers) Unarchive(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "project_id")
	p, err := h.projects.Unarchive(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to unarchive project")
		return
	}
	respond(w, http.StatusOK, p)
}
