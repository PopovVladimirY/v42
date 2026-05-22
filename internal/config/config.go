package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ServerPort string
	ServerHost string

	DBHost     string
	DBPort     string
	DBName     string
	DBUser     string
	DBPassword string
	DBSSLMode  string

	JWTSecret     string
	JWTAccessTTL  time.Duration
	JWTRefreshTTL time.Duration

	AppEnv            string
	LogLevel          string
	SeedAdminEmail    string
	SeedAdminPassword string

	CORSAllowedOrigins []string
}

// Load reads all config from environment. Fails loudly if required vars are missing.
// No config, no party -- we exit with a clear error, not a nil pointer panic.
func Load() (*Config, error) {
	var missing []string

	required := func(key string) string {
		v := os.Getenv(key)
		if v == "" {
			missing = append(missing, key)
		}
		return v
	}

	opt := func(key, fallback string) string {
		if v := os.Getenv(key); v != "" {
			return v
		}
		return fallback
	}

	cfg := &Config{
		ServerPort: opt("SERVER_PORT", "8080"),
		ServerHost: opt("SERVER_HOST", "0.0.0.0"),

		DBHost:     opt("DB_HOST", "localhost"),
		DBPort:     opt("DB_PORT", "5432"),
		DBName:     required("DB_NAME"),
		DBUser:     required("DB_USER"),
		DBPassword: required("DB_PASSWORD"),
		DBSSLMode:  opt("DB_SSL_MODE", "disable"),

		JWTSecret: required("JWT_SECRET"),

		AppEnv:            opt("APP_ENV", "development"),
		LogLevel:          opt("LOG_LEVEL", "info"),
		SeedAdminEmail:    opt("SEED_ADMIN_EMAIL", ""),
		SeedAdminPassword: opt("SEED_ADMIN_PASSWORD", ""),

		CORSAllowedOrigins: splitTrim(opt("CORS_ALLOWED_ORIGINS", "http://localhost:5173"), ","),
	}

	if len(missing) > 0 {
		return nil, fmt.Errorf("required env vars not set: %s", strings.Join(missing, ", "))
	}

	var err error

	cfg.JWTAccessTTL, err = parseDuration(opt("JWT_ACCESS_TTL", "15m"))
	if err != nil {
		return nil, fmt.Errorf("JWT_ACCESS_TTL: %w", err)
	}

	cfg.JWTRefreshTTL, err = parseDuration(opt("JWT_REFRESH_TTL", "7d"))
	if err != nil {
		return nil, fmt.Errorf("JWT_REFRESH_TTL: %w", err)
	}

	if err := cfg.productionGuards(); err != nil {
		return nil, err
	}

	return cfg, nil
}

// productionGuards blocks obviously insecure configs from reaching production.
// If you deploy with changeme passwords you deserve what you get -- but we still save you.
func (c *Config) productionGuards() error {
	if c.AppEnv != "production" {
		return nil
	}
	var errs []string
	if c.DBPassword == "changeme" {
		errs = append(errs, "DB_PASSWORD=changeme is not allowed in production")
	}
	if c.SeedAdminPassword == "changeme" {
		errs = append(errs, "SEED_ADMIN_PASSWORD=changeme is not allowed in production")
	}
	if c.JWTSecret == "change-this-to-a-long-random-secret-in-production" {
		errs = append(errs, "JWT_SECRET is still the example value -- generate a real secret (openssl rand -hex 32)")
	}
	if len(c.JWTSecret) < 32 {
		errs = append(errs, "JWT_SECRET must be at least 32 characters (256 bits) in production")
	}
	if len(errs) > 0 {
		return fmt.Errorf("production config rejected:\n  %s", strings.Join(errs, "\n  "))
	}
	return nil
}

func (c *Config) IsProduction() bool { return c.AppEnv == "production" }

// parseDuration handles standard Go durations (15m, 1h) plus days (7d).
func parseDuration(s string) (time.Duration, error) {
	if strings.HasSuffix(s, "d") {
		n, err := strconv.Atoi(strings.TrimSuffix(s, "d"))
		if err != nil {
			return 0, fmt.Errorf("invalid duration %q: expected format like 7d", s)
		}
		return time.Duration(n) * 24 * time.Hour, nil
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0, fmt.Errorf("invalid duration %q: %w", s, err)
	}
	return d, nil
}

func splitTrim(s, sep string) []string {
	parts := strings.Split(s, sep)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
