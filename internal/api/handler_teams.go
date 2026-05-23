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

type teamHandlers struct {
	teams *store.TeamStore
}

// List handles GET /api/v1/teams
func (h *teamHandlers) List(w http.ResponseWriter, r *http.Request) {
	teams, err := h.teams.List(r.Context())
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list teams")
		return
	}
	respond(w, http.StatusOK, teams)
}

// Create handles POST /api/v1/teams (admin/maintainer only -- RequireRole in router)
func (h *teamHandlers) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string  `json:"name"`
		Description *string `json:"description"`
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
	if strings.ContainsRune(req.Name, 0) {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "name must not contain null bytes")
		return
	}
	if len(req.Name) > 200 {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "name must not exceed 200 characters")
		return
	}

	team, err := h.teams.Create(r.Context(), req.Name, req.Description)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create team")
		return
	}
	respond(w, http.StatusCreated, team)
}

// Get handles GET /api/v1/teams/{id}
// Returns team + current members list.
func (h *teamHandlers) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	team, err := h.teams.GetWithMembers(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "team not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to fetch team")
		return
	}
	respond(w, http.StatusOK, team)
}

// Update handles PATCH /api/v1/teams/{id} (admin/maintainer only)
func (h *teamHandlers) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	// Fetch only team fields for merge -- members are not needed here.
	current, err := h.teams.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "team not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to fetch team")
		return
	}

	var req struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}

	name := current.Name
	if req.Name != nil {
		trimmed := strings.TrimSpace(*req.Name)
		if trimmed == "" {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "name cannot be empty")
			return
		}
		if strings.ContainsRune(trimmed, 0) {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "name must not contain null bytes")
			return
		}
		if len(trimmed) > 200 {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "name must not exceed 200 characters")
			return
		}
		name = trimmed
	}
	desc := current.Description
	if req.Description != nil {
		desc = req.Description
	}

	team, err := h.teams.Update(r.Context(), id, name, desc)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update team")
		return
	}
	respond(w, http.StatusOK, team)
}

// Delete handles DELETE /api/v1/teams/{id} (admin only)
func (h *teamHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	if err := h.teams.Delete(r.Context(), id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "team not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete team")
		return
	}
	respond(w, http.StatusNoContent, nil)
}

// Archive handles PATCH /api/v1/teams/{id}/archive (admin only).
// Soft-deletes the team by setting is_archived = true.
func (h *teamHandlers) Archive(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	team, err := h.teams.Archive(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "team not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to archive team")
		return
	}
	respond(w, http.StatusOK, team)
}

// ListArchived handles GET /api/v1/teams/archived (admin only).
func (h *teamHandlers) ListArchived(w http.ResponseWriter, r *http.Request) {
	teams, err := h.teams.ListArchived(r.Context())
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list archived teams")
		return
	}
	respond(w, http.StatusOK, teams)
}

// Unarchive handles PATCH /api/v1/teams/{id}/unarchive (admin only).
// Restores a previously archived team.
func (h *teamHandlers) Unarchive(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	team, err := h.teams.Unarchive(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "team not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to unarchive team")
		return
	}
	respond(w, http.StatusOK, team)
}

// AddMember handles POST /api/v1/teams/{id}/members (admin/maintainer only)
func (h *teamHandlers) AddMember(w http.ResponseWriter, r *http.Request) {
	teamID := chi.URLParam(r, "id")

	var req struct {
		UserID        string `json:"user_id"`
		CapacityHours *int16 `json:"capacity_hours"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	if strings.TrimSpace(req.UserID) == "" {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "user_id is required")
		return
	}

	capacity := int16(32) // default weekly capacity
	if req.CapacityHours != nil {
		if *req.CapacityHours < 0 || *req.CapacityHours > 168 {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "capacity_hours must be between 0 and 168")
			return
		}
		capacity = *req.CapacityHours
	}

	member, err := h.teams.AddMember(r.Context(), teamID, req.UserID, capacity)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "team or user not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to add member")
		return
	}
	respond(w, http.StatusOK, member)
}

// RemoveMember handles DELETE /api/v1/teams/{id}/members/{user_id} (admin/maintainer only)
func (h *teamHandlers) RemoveMember(w http.ResponseWriter, r *http.Request) {
	teamID := chi.URLParam(r, "id")
	userID := chi.URLParam(r, "user_id")

	if err := h.teams.RemoveMember(r.Context(), teamID, userID); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "team or user not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to remove member")
		return
	}
	respond(w, http.StatusNoContent, nil)
}
