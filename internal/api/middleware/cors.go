package middleware

import (
	"net/http"

	"github.com/go-chi/cors"
	"github.com/vpo/v42/internal/config"
)

// CORS returns a middleware that handles cross-origin requests.
// In dev: allows localhost:5173 (Vite). In prod: whatever CORS_ALLOWED_ORIGINS says.
func CORS(cfg *config.Config) func(http.Handler) http.Handler {
	return cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSAllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300, // 5 minutes -- browsers can cache preflight
	})
}
