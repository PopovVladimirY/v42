package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/vpo/v42/internal/auth"
)

// contextKey is a private type for context values -- avoids key collisions.
type contextKey string

// UserClaimsKey is the context key for the JWT claims set by JWTAuth middleware.
const UserClaimsKey contextKey = "user_claims"

// JWTAuth returns a middleware that validates the Authorization: Bearer <token> header.
// On success it injects *auth.Claims into the request context.
// On failure it responds 401 and stops the chain.
func JWTAuth(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := r.Header.Get("Authorization")
			if !strings.HasPrefix(raw, "Bearer ") {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				w.Write([]byte(`{"data":null,"meta":null,"error":{"code":"UNAUTHORIZED","message":"missing or invalid authorization header"}}`)) //nolint:errcheck
				return
			}
			tokenStr := strings.TrimPrefix(raw, "Bearer ")
			claims, err := auth.ParseToken(secret, tokenStr)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				w.Write([]byte(`{"data":null,"meta":null,"error":{"code":"UNAUTHORIZED","message":"invalid or expired token"}}`)) //nolint:errcheck
				return
			}
			ctx := context.WithValue(r.Context(), UserClaimsKey, claims)
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
