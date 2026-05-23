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

type skillHandlers struct {
	skills *store.SkillStore
}

// List handles GET /api/v1/skills
// Returns visible (non-hidden) skills. Admin GET ?all=true returns all including hidden.
func (h *skillHandlers) List(w http.ResponseWriter, r *http.Request) {
	var skills []store.Skill
	var err error
	if r.URL.Query().Get("all") == "true" {
		skills, err = h.skills.ListAll(r.Context())
	} else {
		skills, err = h.skills.List(r.Context())
	}
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list skills")
		return
	}
	respond(w, http.StatusOK, skills)
}

// Create handles POST /api/v1/skills (admin only)
func (h *skillHandlers) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string  `json:"name"`
		Category *string `json:"category"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2048)
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
	if len(req.Name) > 100 {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "name must not exceed 100 characters")
		return
	}

	skill, err := h.skills.Create(r.Context(), req.Name, req.Category)
	if err != nil {
		if errors.Is(err, domain.ErrConflict) {
			respondErr(w, http.StatusConflict, "CONFLICT", "a skill with this name already exists")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create skill")
		return
	}
	respond(w, http.StatusCreated, skill)
}

// Update handles PATCH /api/v1/skills/{id} (admin only)
func (h *skillHandlers) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Name     *string `json:"name"`
		Category *string `json:"category"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2048)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}

	// Fetch current state to fill in unchanged fields.
	current, err := h.skills.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "skill not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get skill")
		return
	}

	name := current.Name
	if req.Name != nil {
		name = strings.TrimSpace(*req.Name)
		if name == "" {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "name must not be empty")
			return
		}
		if len(name) > 100 {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "name must not exceed 100 characters")
			return
		}
	}
	category := current.Category
	if req.Category != nil {
		category = req.Category
	}

	skill, err := h.skills.Update(r.Context(), id, name, category)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "skill not found")
			return
		}
		if errors.Is(err, domain.ErrConflict) {
			respondErr(w, http.StatusConflict, "CONFLICT", "a skill with this name already exists")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update skill")
		return
	}
	respond(w, http.StatusOK, skill)
}

// SetHidden handles PATCH /api/v1/skills/{id}/hidden (admin only)
func (h *skillHandlers) SetHidden(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Hidden bool `json:"hidden"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 256)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}

	skill, err := h.skills.SetHidden(r.Context(), id, req.Hidden)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "skill not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update skill")
		return
	}
	respond(w, http.StatusOK, skill)
}

// Delete handles DELETE /api/v1/skills/{id} (admin only)
func (h *skillHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	// Prevent deleting builtins.
	current, err := h.skills.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "skill not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get skill")
		return
	}
	if current.IsBuiltin {
		respondErr(w, http.StatusForbidden, "FORBIDDEN", "built-in skills cannot be deleted; hide them instead")
		return
	}
	if err := h.skills.Delete(r.Context(), id); err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete skill")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
