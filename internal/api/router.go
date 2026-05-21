package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chiware "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/time/rate"

	"github.com/vpo/v42/internal/api/middleware"
	"github.com/vpo/v42/internal/config"
)

func NewRouter(cfg *config.Config, pool *pgxpool.Pool, log *slog.Logger) *chi.Mux {
	r := chi.NewRouter()

	// global middleware stack -- order matters
	r.Use(chiware.RequestID)
	r.Use(chiware.RealIP) // must be before Logger so we log the real IP
	r.Use(middleware.Logger(log))
	r.Use(middleware.CORS(cfg))
	r.Use(chiware.Recoverer)

	// auth endpoints: 10 requests per minute per IP -- brute force protection from day one
	authLimiter := middleware.NewRateLimiter(rate.Every(6*time.Second), 10)

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/health", healthHandler(pool))

		// auth: rate-limited group
		r.Group(func(r chi.Router) {
			r.Use(authLimiter.Middleware)
			r.Post("/auth/login", notImplemented)
			r.Post("/auth/refresh", notImplemented)
			r.Post("/auth/logout", notImplemented)
			r.Get("/auth/me", notImplemented)
		})

		// future route groups (phases 2-7) will be mounted here
	})

	return r
}

// healthHandler checks db connectivity and reports overall system status.
func healthHandler(pool *pgxpool.Pool) http.HandlerFunc {
	type response struct {
		Status  string `json:"status"`
		DB      string `json:"db"`
		Version string `json:"version"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		dbStatus := "ok"
		if err := pool.Ping(r.Context()); err != nil {
			dbStatus = "unavailable"
		}

		status := "ok"
		code := http.StatusOK
		if dbStatus != "ok" {
			status = "degraded"
			code = http.StatusServiceUnavailable
		}

		respond(w, code, response{Status: status, DB: dbStatus, Version: "0.1.0"})
	}
}

func notImplemented(w http.ResponseWriter, r *http.Request) {
	respondErr(w, http.StatusNotImplemented, "NOT_IMPLEMENTED", "coming soon")
}

// respond writes a successful JSON response in the standard { data, meta, error } envelope.
func respond(w http.ResponseWriter, code int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
		"data":  data,
		"meta":  nil,
		"error": nil,
	})
}

// respondErr writes an error JSON response in the standard envelope.
func respondErr(w http.ResponseWriter, code int, errCode, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
		"data": nil,
		"meta": nil,
		"error": map[string]string{
			"code":    errCode,
			"message": msg,
		},
	})
}
