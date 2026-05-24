package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	authpkg "github.com/vpo/v42/internal/auth"
	"github.com/vpo/v42/internal/api/middleware"
	"github.com/vpo/v42/internal/db/store"
	"github.com/vpo/v42/internal/domain"
)

// validRoles is the set of role values accepted by the API.
var validRoles = map[string]bool{
	"admin": true, "maintainer": true, "developer": true,
	"tester": true, "observer": true,
}

type userHandlers struct {
	users  *store.UserStore
	skills *store.SkillStore
	auth   *domain.AuthService
}

// List handles GET /api/v1/users
// Admin/maintainer: all users. Others: only active.
func (h *userHandlers) List(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())

	var (
		users []*domain.User
		err   error
	)
	if claims.Role == "admin" || claims.Role == "maintainer" {
		users, err = h.users.ListAll(r.Context())
	} else {
		users, err = h.users.ListActive(r.Context())
	}
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list users")
		return
	}
	respond(w, http.StatusOK, users)
}

// Get handles GET /api/v1/users/{id}
func (h *userHandlers) Get(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	id := chi.URLParam(r, "id")

	user, err := h.users.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "user not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to fetch user")
		return
	}

	// Non-admin cannot see inactive users other than themselves.
	if !user.IsActive && claims.Role != "admin" && claims.Role != "maintainer" && claims.UserID != id {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "user not found")
		return
	}

	respond(w, http.StatusOK, user)
}

// Update handles PATCH /api/v1/users/{id}
// User: own display_name + avatar_url. Admin: all fields including role and is_active.
func (h *userHandlers) Update(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	id := chi.URLParam(r, "id")

	isAdmin := claims.Role == "admin"
	isSelf := claims.UserID == id

	if !isAdmin && !isSelf {
		respondErr(w, http.StatusForbidden, "FORBIDDEN", "insufficient permissions")
		return
	}

	var req struct {
		DisplayName *string `json:"display_name"`
		AvatarURL   *string `json:"avatar_url"`
		Role        *string `json:"role"`
		IsActive    *bool   `json:"is_active"`
		Email       *string `json:"email"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}

	// Only admin may change role or active status.
	if !isAdmin && (req.Role != nil || req.IsActive != nil) {
		respondErr(w, http.StatusForbidden, "FORBIDDEN", "only admin can change role or account status")
		return
	}

	// Admin cannot demote their own account -- must be done by another admin.
	// Prevents accidental lockout when there is a single admin in the system.
	if isAdmin && isSelf && req.Role != nil && *req.Role != claims.Role {
		respondErr(w, http.StatusForbidden, "FORBIDDEN", "admin cannot change their own role; ask another admin")
		return
	}

	// Admin cannot deactivate their own account -- same lockout risk as self-demotion.
	if isAdmin && isSelf && req.IsActive != nil && !*req.IsActive {
		respondErr(w, http.StatusForbidden, "FORBIDDEN", "admin cannot deactivate their own account; ask another admin")
		return
	}

	if req.Role != nil {
		*req.Role = strings.TrimSpace(*req.Role) // normalise accidental whitespace
	}
	if req.Role != nil && !validRoles[*req.Role] {
		respondErr(w, http.StatusBadRequest, "INVALID_ROLE", "role must be one of: admin, maintainer, developer, tester, observer")
		return
	}

	// Fetch current state to merge (PATCH semantics: only send what changed).
	current, err := h.users.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "user not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to fetch user")
		return
	}

	if req.DisplayName != nil {
		trimmed := strings.TrimSpace(*req.DisplayName)
		if trimmed == "" {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "display_name cannot be empty")
			return
		}
		if strings.ContainsRune(trimmed, 0) {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "display_name must not contain null bytes")
			return
		}
		if len(trimmed) > 200 {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "display_name must not exceed 200 characters")
			return
		}
		current.DisplayName = trimmed
	}
	if req.AvatarURL != nil {
		if len(*req.AvatarURL) > 2048 {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "avatar_url must not exceed 2048 characters")
			return
		}
		current.AvatarURL = req.AvatarURL
	}
	if req.Email != nil {
		trimmedEmail := strings.ToLower(strings.TrimSpace(*req.Email))
		if trimmedEmail == "" {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "email cannot be empty")
			return
		}
		if len(trimmedEmail) > 254 {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "email must not exceed 254 characters")
			return
		}
		current.Email = trimmedEmail
	}
	if req.Role != nil {
		current.Role = *req.Role
	}
	if req.IsActive != nil {
		current.IsActive = *req.IsActive
	}

	updated, err := h.users.Update(r.Context(), current)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update user")
		return
	}
	respond(w, http.StatusOK, updated)
}

// ListSkills handles GET /api/v1/users/{id}/skills
func (h *userHandlers) ListSkills(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	// Validate that the user exists first.
	if _, err := h.users.GetByID(r.Context(), id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "user not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to fetch user")
		return
	}

	skills, err := h.skills.ListMemberSkills(r.Context(), id)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list skills")
		return
	}
	respond(w, http.StatusOK, skills)
}

// UpsertSkill handles PUT /api/v1/users/{id}/skills/{skill_id}
// User: own profile. Admin: any user.
func (h *userHandlers) UpsertSkill(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	id := chi.URLParam(r, "id")
	skillID := chi.URLParam(r, "skill_id")

	if claims.Role != "admin" && claims.UserID != id {
		respondErr(w, http.StatusForbidden, "FORBIDDEN", "insufficient permissions")
		return
	}

	var req struct {
		Level        string  `json:"level"`
		Interest     string  `json:"interest"`
		InterestNote *string `json:"interest_note"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}

	validLevels := map[string]bool{"novice": true, "beginner": true, "competent": true, "proficient": true, "expert": true}
	validInterests := map[string]bool{"low": true, "medium": true, "high": true}

	if !validLevels[req.Level] {
		respondErr(w, http.StatusBadRequest, "INVALID_LEVEL", "level must be one of: novice, beginner, competent, proficient, expert")
		return
	}
	if !validInterests[req.Interest] {
		respondErr(w, http.StatusBadRequest, "INVALID_INTEREST", "interest must be one of: low, medium, high")
		return
	}
	if req.InterestNote != nil && len(*req.InterestNote) > 500 {
		respondErr(w, http.StatusBadRequest, "NOTE_TOO_LONG", "interest_note must be 500 characters or less")
		return
	}

	ms, err := h.skills.UpsertMemberSkill(r.Context(), id, skillID, req.Level, req.Interest, req.InterestNote)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "skill not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to upsert skill")
		return
	}
	respond(w, http.StatusOK, ms)
}

// DeleteSkill handles DELETE /api/v1/users/{id}/skills/{skill_id}
// User: own profile. Admin: any user.
func (h *userHandlers) DeleteSkill(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	id := chi.URLParam(r, "id")
	skillID := chi.URLParam(r, "skill_id")

	if claims.Role != "admin" && claims.UserID != id {
		respondErr(w, http.StatusForbidden, "FORBIDDEN", "insufficient permissions")
		return
	}

	if err := h.skills.DeleteMemberSkill(r.Context(), id, skillID); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "user or skill not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete skill")
		return
	}
	respond(w, http.StatusNoContent, nil)
}

// Create handles POST /api/v1/users (admin only).
// Creates a new user account with a hashed password.
func (h *userHandlers) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
		Role        string `json:"role"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	req.Role = strings.TrimSpace(req.Role)

	if req.Email == "" || req.Password == "" || req.DisplayName == "" {
		respondErr(w, http.StatusBadRequest, "MISSING_FIELDS", "email, password, and display_name are required")
		return
	}
	if len(req.Password) < 8 {
		respondErr(w, http.StatusBadRequest, "WEAK_PASSWORD", "password must be at least 8 characters")
		return
	}
	if req.Role == "" {
		req.Role = "developer"
	}
	if !validRoles[req.Role] {
		respondErr(w, http.StatusBadRequest, "INVALID_ROLE", "role must be one of: admin, maintainer, developer, tester, observer")
		return
	}

	hash, err := authpkg.HashPassword(req.Password)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to process password")
		return
	}

	user, err := h.users.Create(r.Context(), req.Email, hash, req.DisplayName, req.Role, true)
	if err != nil {
		// SQLSTATE 23505: unique_violation -- email already taken
		if strings.Contains(err.Error(), "23505") || strings.Contains(err.Error(), "unique") {
			respondErr(w, http.StatusConflict, "EMAIL_TAKEN", "a user with this email already exists")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create user")
		return
	}
	respond(w, http.StatusCreated, user)
}

// ResetPassword handles PATCH /api/v1/users/{id}/reset-password (admin only).
// Sets a new password and forces the user to change it on next login.
func (h *userHandlers) ResetPassword(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req struct {
		Password string `json:"password"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	if len(req.Password) < 8 {
		respondErr(w, http.StatusBadRequest, "WEAK_PASSWORD", "password must be at least 8 characters")
		return
	}

	hash, err := authpkg.HashPassword(req.Password)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to process password")
		return
	}

	user, err := h.users.ChangePassword(r.Context(), id, hash, true)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "user not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to reset password")
		return
	}

	// Revoke all active sessions -- forces re-login with new password.
	if h.auth != nil {
		_ = h.auth.Tokens.RevokeAll(r.Context(), id)
	}

	respond(w, http.StatusOK, user)
}
