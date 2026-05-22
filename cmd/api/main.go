package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/joho/godotenv"
	"github.com/vpo/v42/internal/api"
	"github.com/vpo/v42/internal/auth"
	"github.com/vpo/v42/internal/config"
	"github.com/vpo/v42/internal/db"
	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/db/store"
	"github.com/vpo/v42/internal/domain"
)

func main() {
	// load .env (best-effort -- real env vars always win over file)
	_ = godotenv.Load()

	// bootstrap logger before config -- startup errors need somewhere to go
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		log.Error("config validation failed", "err", err)
		os.Exit(1)
	}

	// upgrade to configured log level
	log = newLogger(cfg.LogLevel)
	log.Info("v42 starting", "env", cfg.AppEnv, "version", "0.1.0")

	pool, err := db.Connect(context.Background(), cfg)
	if err != nil {
		log.Error("db connection failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	log.Info("db connected", "host", cfg.DBHost, "db", cfg.DBName)

	queries := dbgen.New(pool)
	userStore := store.NewUserStore(queries)
	tokenStore := store.NewTokenStore(queries)

	authSvc := &domain.AuthService{
		Users:      userStore,
		Tokens:     tokenStore,
		JWTSecret:  cfg.JWTSecret,
		AccessTTL:  cfg.JWTAccessTTL,
		RefreshTTL: cfg.JWTRefreshTTL,
	}

	if err := seedAdmin(context.Background(), cfg, queries, log); err != nil {
		log.Error("seed admin failed", "err", err)
		os.Exit(1)
	}

	router, stopLimiter := api.NewRouter(cfg, pool, log, authSvc, queries)
	defer stopLimiter()

	srv := &http.Server{
		Addr:              fmt.Sprintf("%s:%s", cfg.ServerHost, cfg.ServerPort),
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,  // Slowloris: cap header delivery time independently
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// graceful shutdown on SIGINT / SIGTERM
	done := make(chan struct{})
	go func() {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
		sig := <-quit
		log.Info("shutdown signal received", "signal", fmt.Sprintf("%v", sig))

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := srv.Shutdown(ctx); err != nil {
			log.Error("graceful shutdown failed", "err", err)
		}
		close(done)
	}()

	log.Info("server listening", "addr", srv.Addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Error("server error", "err", err)
		os.Exit(1)
	}

	<-done // wait for graceful shutdown to complete
	log.Info("server stopped")
}

// seedAdmin creates the initial admin user if SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are set.
// Idempotent: does nothing if the user already exists.
func seedAdmin(ctx context.Context, cfg *config.Config, q *dbgen.Queries, log *slog.Logger) error {
	if cfg.SeedAdminEmail == "" || cfg.SeedAdminPassword == "" {
		return nil // seed disabled -- skip silently
	}

	// Check if user already exists.
	_, err := q.GetUserByEmail(ctx, cfg.SeedAdminEmail)
	if err == nil {
		log.Info("seed admin already exists", "email", cfg.SeedAdminEmail)
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("seed admin check: %w", err)
	}

	hash, err := auth.HashPassword(cfg.SeedAdminPassword)
	if err != nil {
		return fmt.Errorf("seed admin hash: %w", err)
	}

	_, err = q.CreateUser(ctx, dbgen.CreateUserParams{
		Email:        cfg.SeedAdminEmail,
		PasswordHash: hash,
		DisplayName:  "Admin",
		Role:         dbgen.UserRoleAdmin,
	})
	if err != nil {
		return fmt.Errorf("seed admin create: %w", err)
	}

	log.Info("seed admin created", "email", cfg.SeedAdminEmail)
	return nil
}

func newLogger(level string) *slog.Logger {
	var l slog.Level
	switch level {
	case "debug":
		l = slog.LevelDebug
	case "warn":
		l = slog.LevelWarn
	case "error":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: l}))
}
