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
	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/db/store"
	"github.com/vpo/v42/internal/domain"
)

func NewRouter(cfg *config.Config, pool *pgxpool.Pool, log *slog.Logger, authSvc *domain.AuthService, queries *dbgen.Queries) *chi.Mux {
	r := chi.NewRouter()

	// global middleware stack -- order matters
	// NOTE: chiware.RealIP is intentionally absent -- it would rewrite r.RemoteAddr from
	// X-Forwarded-For/X-Real-IP before the rate limiter runs, letting anyone spoof their IP
	// and bypass brute-force protection. Rate limiting must use the unforgeable TCP address.
	// If deployed behind a trusted reverse proxy, handle IP extraction at the proxy layer.
	r.Use(chiware.RequestID)
	r.Use(middleware.Logger(log))
	r.Use(middleware.CORS(cfg))
	r.Use(chiware.Recoverer)

	// auth endpoints: burst of 10 then 1 per 6s per IP -- brute force protection from day one
	authLimiter := middleware.NewRateLimiter(rate.Every(6*time.Second), 10)
	jwtAuth := middleware.JWTAuth(cfg.JWTSecret)

	auth := &authHandlers{
		svc:        authSvc,
		secure:     cfg.IsProduction(),
		refreshTTL: cfg.JWTRefreshTTL,
	}

	// Phase 3 handlers: wire stores to handlers inside the router.
	// SkillStore is shared between userH and skillH -- no need for two instances.
	skillStore := store.NewSkillStore(queries)
	userH := &userHandlers{
		users:  store.NewUserStore(queries),
		skills: skillStore,
	}
	skillH := &skillHandlers{skills: skillStore}
	teamH := &teamHandlers{teams: store.NewTeamStore(queries)}

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/health", healthHandler(pool))

		// rate-limited: brute-force targets (login + refresh share the limiter)
		r.Group(func(r chi.Router) {
			r.Use(authLimiter.Middleware)
			r.Post("/auth/login", auth.Login)
			r.Post("/auth/refresh", auth.Refresh)
		})

		// JWT-protected group: all endpoints below require a valid access token.
		r.Group(func(r chi.Router) {
			r.Use(jwtAuth)

			// Auth
			r.Post("/auth/logout", auth.Logout)
			r.Get("/auth/me", auth.Me)

			// Users + member skills (any authenticated user can read; writes are permission-checked in handler)
			r.Get("/users", userH.List)
			r.Get("/users/{id}", userH.Get)
			r.Patch("/users/{id}", userH.Update)
			r.Get("/users/{id}/skills", userH.ListSkills)
			r.Put("/users/{id}/skills/{skill_id}", userH.UpsertSkill)
			r.Delete("/users/{id}/skills/{skill_id}", userH.DeleteSkill)

			// Skills: read for all, write for admin only
			r.Get("/skills", skillH.List)
			r.With(middleware.RequireRole("admin")).Post("/skills", skillH.Create)

			// Teams: read for all authenticated users
			r.Get("/teams", teamH.List)
			r.Get("/teams/{id}", teamH.Get)

			// Teams: write for admin/maintainer
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRole("admin", "maintainer"))
				r.Post("/teams", teamH.Create)
				r.Patch("/teams/{id}", teamH.Update)
				r.Post("/teams/{id}/members", teamH.AddMember)
				r.Delete("/teams/{id}/members/{user_id}", teamH.RemoveMember)
			})

			// Teams: delete for admin only
			r.With(middleware.RequireRole("admin")).Delete("/teams/{id}", teamH.Delete)
		})
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
