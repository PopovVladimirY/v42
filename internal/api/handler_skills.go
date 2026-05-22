package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/vpo/v42/internal/db/store"
	"github.com/vpo/v42/internal/domain"
)

type skillHandlers struct {
	skills *store.SkillStore
}

// List handles GET /api/v1/skills
// Returns all skills: builtins first, then custom alphabetically.
func (h *skillHandlers) List(w http.ResponseWriter, r *http.Request) {
	skills, err := h.skills.List(r.Context())
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list skills")
		return
	}
	respond(w, http.StatusOK, skills)
}

// Create handles POST /api/v1/skills (admin only -- enforced via RequireRole in router)
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
