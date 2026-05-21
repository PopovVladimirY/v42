package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/vpo/v42/internal/api"
	"github.com/vpo/v42/internal/config"
	"github.com/vpo/v42/internal/db"
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

	router := api.NewRouter(cfg, pool, log)

	srv := &http.Server{
		Addr:         fmt.Sprintf("%s:%s", cfg.ServerHost, cfg.ServerPort),
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
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
