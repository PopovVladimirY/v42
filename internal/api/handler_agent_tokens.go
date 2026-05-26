package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/vpo/v42/internal/api/middleware"
	"github.com/vpo/v42/internal/domain"
)

// agentTokenHandlers wires the AgentTokenRepo to HTTP handlers.
type agentTokenHandlers struct {
	tokens domain.AgentTokenRepo
	users  domain.UserRepo
}

type createAgentTokenRequest struct {
	UserID    string  `json:"user_id"`    // which user the token acts as
	Name      string  `json:"name"`       // human label, e.g. "Claude on dev machine"
	ProjectID *string `json:"project_id"` // optional scope; omit for all projects
}

type agentTokenResponse struct {
	*domain.AgentToken
	// RawToken is only present in the Create response -- the ONE time the raw value is visible.
	RawToken string `json:"raw_token,omitempty"`
}

// Create handles POST /api/v1/agent-tokens.
// Admin-only. Returns the raw token once; only the hash is stored in the DB.
func (h *agentTokenHandlers) Create(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil {
		respondErr(w, http.StatusUnauthorized, "UNAUTHORIZED", "not authenticated")
		return
	}

	var req createAgentTokenRequest
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		respondErr(w, http.StatusBadRequest, "VALIDATION_ERROR", "name is required")
		return
	}
	if req.UserID == "" {
		respondErr(w, http.StatusBadRequest, "VALIDATION_ERROR", "user_id is required")
		return
	}

	// Verify target user exists.
	if _, err := h.users.GetByID(r.Context(), req.UserID); err != nil {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "user not found")
		return
	}

	raw, hash, err := generateAgentToken()
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "token generation failed")
		return
	}

	token, err := h.tokens.Create(r.Context(), req.UserID, claims.UserID, req.Name, hash, req.ProjectID)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create token")
		return
	}

	respond(w, http.StatusCreated, agentTokenResponse{
		AgentToken: token,
		RawToken:   raw,
	})
}

// List handles GET /api/v1/agent-tokens.
// Admin-only. Does NOT return raw tokens -- only metadata.
func (h *agentTokenHandlers) List(w http.ResponseWriter, r *http.Request) {
	tokens, err := h.tokens.List(r.Context())
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list tokens")
		return
	}
	respond(w, http.StatusOK, tokens)
}

// Revoke handles DELETE /api/v1/agent-tokens/{id}.
// Admin-only. Sets revoked_at; does not delete the row (audit trail).
func (h *agentTokenHandlers) Revoke(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.tokens.Revoke(r.Context(), id); err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to revoke token")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// generateAgentToken generates 32 random bytes, encodes as hex with a "v42_" prefix.
// Returns (rawToken, sha256HexHash, error).
// Format: v42_<64 hex chars> -- 256 bits of entropy, easily identifiable in logs.
func generateAgentToken() (raw, hash string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", "", err
	}
	raw = "v42_" + hex.EncodeToString(b)
	h := sha256.Sum256([]byte(raw))
	hash = hex.EncodeToString(h[:])
	return raw, hash, nil
}
