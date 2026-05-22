package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	authpkg "github.com/vpo/v42/internal/auth"
	"github.com/vpo/v42/internal/api/middleware"
	"github.com/vpo/v42/internal/domain"
)

const refreshTokenCookie = "refresh_token"

// authHandlers wires the AuthService to HTTP handlers.
type authHandlers struct {
	svc        *domain.AuthService
	secure     bool // true in production -- Secure flag on cookie
	refreshTTL time.Duration
}

// loginRequest is the body for POST /auth/login.
type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// loginResponse is the data section of a successful login response.
type loginResponse struct {
	AccessToken string      `json:"access_token"`
	User        *domain.User `json:"user"`
}

// Login handles POST /auth/login.
// Validates credentials, returns access token in body + refresh token in httpOnly cookie.
func (h *authHandlers) Login(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096) // 4 KB: more than enough for email+password
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if req.Email == "" || req.Password == "" {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "email and password are required")
		return
	}

	result, err := h.svc.Login(r.Context(), req.Email, req.Password)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrInvalidCredentials):
			respondErr(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "invalid email or password")
		case errors.Is(err, domain.ErrUserInactive):
			respondErr(w, http.StatusForbidden, "ACCOUNT_INACTIVE", "account is disabled")
		default:
			respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "login failed")
		}
		return
	}

	h.setRefreshCookie(w, result.RefreshToken)
	respond(w, http.StatusOK, loginResponse{
		AccessToken: result.AccessToken,
		User:        result.User,
	})
}

// Refresh handles POST /auth/refresh.
// Reads refresh_token cookie, rotates token pair, returns new access token.
func (h *authHandlers) Refresh(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(refreshTokenCookie)
	if err != nil {
		respondErr(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing refresh token")
		return
	}

	result, err := h.svc.Refresh(r.Context(), cookie.Value)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrTokenExpired):
			h.clearRefreshCookie(w)
			respondErr(w, http.StatusUnauthorized, "TOKEN_EXPIRED", "refresh token has expired")
		case errors.Is(err, domain.ErrTokenRevoked), errors.Is(err, domain.ErrTokenReuse):
			h.clearRefreshCookie(w)
			respondErr(w, http.StatusUnauthorized, "TOKEN_REVOKED", "refresh token is no longer valid")
		case errors.Is(err, domain.ErrUserInactive):
			h.clearRefreshCookie(w)
			respondErr(w, http.StatusForbidden, "ACCOUNT_INACTIVE", "account is disabled")
		case errors.Is(err, domain.ErrInvalidCredentials):
			h.clearRefreshCookie(w)
			respondErr(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid refresh token")
		default:
			respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "refresh failed")
		}
		return
	}

	h.setRefreshCookie(w, result.RefreshToken)
	respond(w, http.StatusOK, map[string]string{"access_token": result.AccessToken})
}

// Logout handles POST /auth/logout.
// Revokes the refresh token and clears the cookie.
func (h *authHandlers) Logout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(refreshTokenCookie)
	if err == nil {
		// best-effort -- error is ignored, we always clear the cookie
		_ = h.svc.Logout(r.Context(), cookie.Value)
	}
	h.clearRefreshCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

// Me handles GET /auth/me.
// Returns the authenticated user's profile from the JWT claims context.
func (h *authHandlers) Me(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil {
		respondErr(w, http.StatusUnauthorized, "UNAUTHORIZED", "not authenticated")
		return
	}

	u, err := h.svc.Users.GetByID(r.Context(), claims.UserID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not found")
		} else {
			respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load user")
		}
		return
	}
	respond(w, http.StatusOK, u)
}

// patchMeRequest is the body for PATCH /auth/me.
type patchMeRequest struct {
	Theme string `json:"theme"`
}

// valid themes -- kept in sync with DB CHECK constraint and frontend THEMES const.
var validThemes = map[string]bool{
	"deep-dive": true, "night-sky": true, "classic-dark": true,
	"ocean-blue": true, "paper-white": true, "sunrise": true, "high-contrast": true,
	"new-york": true,
}

// PatchMe handles PATCH /auth/me.
// Lets an authenticated user update their own theme preference.
func (h *authHandlers) PatchMe(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil {
		respondErr(w, http.StatusUnauthorized, "UNAUTHORIZED", "not authenticated")
		return
	}

	var body patchMeRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON")
		return
	}
	if !validThemes[body.Theme] {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "unknown theme")
		return
	}

	u, err := h.svc.Users.UpdateTheme(r.Context(), claims.UserID, body.Theme)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update theme")
		return
	}
	respond(w, http.StatusOK, u)
}

// ChangePassword handles POST /auth/change-password.
// If JWT has MustChangePassword=true, skips current_password check.
// Returns a new access token with MustChangePassword=false.
func (h *authHandlers) ChangePassword(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil {
		respondErr(w, http.StatusUnauthorized, "UNAUTHORIZED", "not authenticated")
		return
	}

	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if len(req.NewPassword) < 8 {
		respondErr(w, http.StatusBadRequest, "WEAK_PASSWORD", "new password must be at least 8 characters")
		return
	}

	// Always verify the current password -- even on a forced change.
	// This confirms the user actually knows their temporary password.
	if req.CurrentPassword == "" {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "current_password is required")
		return
	}
	u, err := h.svc.Users.GetByID(r.Context(), claims.UserID)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to fetch user")
		return
	}
	stored, err := h.svc.Users.GetByEmail(r.Context(), u.Email)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to verify password")
		return
	}
	if !authpkg.VerifyPassword(req.CurrentPassword, stored.PasswordHash) {
		respondErr(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "current password is incorrect")
		return
	}

	newHash, err := authpkg.HashPassword(req.NewPassword)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to hash password")
		return
	}

	u, err = h.svc.Users.ChangePassword(r.Context(), claims.UserID, newHash, false)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to change password")
		return
	}

	// Issue a fresh access token with MustChangePassword=false.
	newToken, err := authpkg.GenerateAccessToken(h.svc.JWTSecret, u.ID, u.Role, false, h.svc.AccessTTL)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to issue token")
		return
	}

	respond(w, http.StatusOK, map[string]any{
		"access_token": newToken,
		"user":         u,
	})
}

// -- cookie helpers ----------------------------------------------------------

func (h *authHandlers) setRefreshCookie(w http.ResponseWriter, raw string) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshTokenCookie,
		Value:    raw,
		Path:     "/api/v1/auth",
		MaxAge:   int(h.refreshTTL.Seconds()),
		HttpOnly: true,
		Secure:   h.secure,
		SameSite: http.SameSiteStrictMode,
	})
}

func (h *authHandlers) clearRefreshCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshTokenCookie,
		Value:    "",
		Path:     "/api/v1/auth",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.secure,
		SameSite: http.SameSiteStrictMode,
	})
}
