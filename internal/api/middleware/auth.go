package middleware

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/vpo/v42/internal/auth"
)

// contextKey is a private type for context values -- avoids key collisions.
type contextKey string

// UserClaimsKey is the context key for the JWT claims set by JWTAuth middleware.
const UserClaimsKey contextKey = "user_claims"

// AgentTokenRepo is the minimal interface the middleware needs to validate opaque agent tokens.
// Implemented by internal/db/store.AgentTokenStore.ValidateAndTouch.
type AgentTokenRepo interface {
	// ValidateAndTouch returns the user_id and role for an active (non-revoked) agent token.
	// Updates last_used_at as a fire-and-forget side effect.
	// Returns a non-nil error if the token is not found, revoked, or the DB is down.
	ValidateAndTouch(ctx context.Context, tokenHash string) (userID, role string, err error)
}

// JWTAuth returns a middleware that validates the Authorization: Bearer <token> header.
// On success it injects *auth.Claims into the request context.
// On failure it responds 401 and stops the chain.
func JWTAuth(secret string) func(http.Handler) http.Handler {
	return BearerAuth(secret, nil)
}

// BearerAuth returns a middleware that tries JWT validation first.
// If the token is not a valid JWT and agentTokens is non-nil, it falls back to
// an opaque agent token lookup (SHA-256 hash match in the DB).
// This lets the MCP server use a long-lived token while the browser uses short-lived JWTs.
func BearerAuth(jwtSecret string, agentTokens AgentTokenRepo) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := r.Header.Get("Authorization")
			if !strings.HasPrefix(raw, "Bearer ") {
				writeUnauthorized(w, "missing or invalid authorization header")
				return
			}
			tokenStr := strings.TrimPrefix(raw, "Bearer ")

			// Fast path: try JWT.
			claims, err := auth.ParseToken(jwtSecret, tokenStr)
			if err == nil {
				ctx := context.WithValue(r.Context(), UserClaimsKey, claims)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			// Slow path: try opaque agent token if a store was provided.
			if agentTokens == nil {
				writeUnauthorized(w, "invalid or expired token")
				return
			}
			hash := hashToken(tokenStr)
			userID, role, lookupErr := agentTokens.ValidateAndTouch(r.Context(), hash)
			if lookupErr != nil {
				writeUnauthorized(w, "invalid or expired token")
				return
			}

			// Synthesize claims so the rest of the handler stack needs no changes.
			synth := &auth.Claims{
				UserID: userID,
				Role:   role,
			}
			ctx := context.WithValue(r.Context(), UserClaimsKey, synth)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ClaimsFromContext extracts JWT claims from the request context.
// Returns nil if no claims are present (request went through a non-auth path).
func ClaimsFromContext(ctx context.Context) *auth.Claims {
	v := ctx.Value(UserClaimsKey)
	if v == nil {
		return nil
	}
	c, _ := v.(*auth.Claims)
	return c
}

// RequirePasswordChanged blocks all requests when the JWT has MustChangePassword=true.
// Exempt routes (change-password, logout, me) should be registered BEFORE this middleware.
func RequirePasswordChanged() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := ClaimsFromContext(r.Context())
			if claims != nil && claims.MustChangePassword {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				w.Write([]byte(`{"data":null,"meta":null,"error":{"code":"PASSWORD_CHANGE_REQUIRED","message":"you must change your password before continuing"}}`)) //nolint:errcheck
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func writeUnauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	w.Write([]byte(`{"data":null,"meta":null,"error":{"code":"UNAUTHORIZED","message":"` + msg + `"}}`)) //nolint:errcheck
}

// hashToken returns the SHA-256 hex digest of the raw token string.
// Matches the hashing done in the agent token creation path.
func hashToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

