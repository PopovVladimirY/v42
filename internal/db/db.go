package db

import (
	"context"
	"fmt"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vpo/v42/internal/config"
)

// Connect opens a connection pool and verifies it with a ping.
// Returns an error instead of panicking -- we respect the caller's right to handle it.
func Connect(ctx context.Context, cfg *config.Config) (*pgxpool.Pool, error) {
	// Use URL format so url.UserPassword properly percent-encodes special chars in credentials.
	// fmt.Sprintf into a DSN string would silently break on passwords containing '=', ' ', or '\'.
	dsn := (&url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(cfg.DBUser, cfg.DBPassword),
		Host:   fmt.Sprintf("%s:%s", cfg.DBHost, cfg.DBPort),
		Path:   "/" + cfg.DBName,
		RawQuery: url.Values{
			"sslmode":        {cfg.DBSSLMode},
			"pool_max_conns": {"25"},
		}.Encode(),
	}).String()

	poolCfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse db config: %w", err)
	}

	poolCfg.MaxConnLifetime = 1 * time.Hour
	poolCfg.MaxConnIdleTime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("create connection pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}

	return pool, nil
}
