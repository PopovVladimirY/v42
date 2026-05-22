package middleware

import (
	"net/http"
	"slices"
)

// RequireRole returns a middleware that checks whether the authenticated user
// has one of the allowed roles. Must be chained AFTER JWTAuth.
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := ClaimsFromContext(r.Context())
			if claims == nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				w.Write([]byte(`{"data":null,"meta":null,"error":{"code":"UNAUTHORIZED","message":"authentication required"}}`)) //nolint:errcheck
				return
			}
			if !slices.Contains(roles, claims.Role) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				w.Write([]byte(`{"data":null,"meta":null,"error":{"code":"FORBIDDEN","message":"insufficient permissions"}}`)) //nolint:errcheck
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
