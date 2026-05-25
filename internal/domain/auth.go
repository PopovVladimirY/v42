// Package domain contains auth business logic, isolated from HTTP and DB layers.
package domain

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/vpo/v42/internal/auth"
)

// dummyPasswordHash is a valid bcrypt-12 hash used for constant-time comparison
// when the login email is not found, preventing user enumeration via timing.
// Computed once at init to guarantee it parses correctly (invalid format = no bcrypt time spent).
var dummyPasswordHash string

func init() {
	h, err := auth.HashPassword("v42-dummy-not-a-real-password-xxxxxxxxxxx")
	if err != nil {
		panic(fmt.Sprintf("domain: failed to compute dummy password hash: %v", err))
	}
	dummyPasswordHash = h
}

// Sentinel errors returned by AuthService -- map to specific HTTP responses.
var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrTokenExpired       = errors.New("token expired")
	ErrTokenRevoked       = errors.New("token revoked")
	ErrTokenReuse         = errors.New("token reuse detected -- all sessions revoked")
	ErrUserInactive       = errors.New("user account is inactive")
	ErrNotFound           = errors.New("not found")  // storage-layer sentinel; never returned as HTTP error directly
	ErrConflict           = errors.New("conflict")   // unique constraint violated; caller maps to 409
)

// User is the domain user without the password hash (safe to pass to handlers).
type User struct {
	ID                  string          `json:"id"`
	Email               string          `json:"email"`
	DisplayName         string          `json:"display_name"`
	Role                string          `json:"role"`
	IsActive            bool            `json:"is_active"`
	MustChangePassword  bool            `json:"must_change_password"`
	AvatarURL           *string         `json:"avatar_url"`
	Theme               string          `json:"theme"`
	IdleTimeoutMinutes  int             `json:"idle_timeout_minutes"`
	UiSettings          json.RawMessage `json:"ui_settings,omitempty"`
	LastActiveAt        *time.Time      `json:"last_active_at,omitempty"`
	CreatedAt           time.Time       `json:"created_at"`
	UpdatedAt           time.Time       `json:"updated_at"`
}

// StoredUser includes the password hash -- only used inside Login for verification.
type StoredUser struct {
	User
	PasswordHash string
}

// RefreshToken is the domain token record.
type RefreshToken struct {
	ID        string
	UserID    string
	TokenHash string
	ExpiresAt time.Time
	RevokedAt *time.Time
}

// UserRepo is the storage interface for user operations.
// Implemented by internal/db/store, never imported from domain directly.
type UserRepo interface {
	GetByEmail(ctx context.Context, email string) (*StoredUser, error)
	GetByID(ctx context.Context, id string) (*User, error)
	Create(ctx context.Context, email, passwordHash, displayName, role string, mustChangePassword bool) (*User, error)
	UpdateTheme(ctx context.Context, userID, theme string) (*User, error)
	UpdateUserIdleTimeout(ctx context.Context, userID string, minutes int) (*User, error)
	ChangePassword(ctx context.Context, userID, passwordHash string, mustChange bool) (*User, error)
	UpdateSettings(ctx context.Context, userID string, settings json.RawMessage) (*User, error)
	UpdateLastActive(ctx context.Context, userID string) error
}

// TokenRepo is the storage interface for refresh token operations.
type TokenRepo interface {
	Create(ctx context.Context, userID, tokenHash string, expiresAt time.Time) error
	GetByHash(ctx context.Context, hash string) (*RefreshToken, error)
	Revoke(ctx context.Context, id string) error
	RevokeAll(ctx context.Context, userID string) error
}

// AuthService orchestrates login, token refresh, and logout flows.
type AuthService struct {
	Users      UserRepo
	Tokens     TokenRepo
	JWTSecret  string
	AccessTTL  time.Duration
	RefreshTTL time.Duration
}

// LoginResult holds the tokens issued after a successful login.
type LoginResult struct {
	AccessToken  string
	RefreshToken string // raw token sent to client; SHA-256 hash stored in DB
	User         *User
}

// Login authenticates a user by email/password and returns a token pair.
// Uses a dummy bcrypt call when the user is not found to prevent timing attacks.
func (s *AuthService) Login(ctx context.Context, email, password string) (*LoginResult, error) {
	u, err := s.Users.GetByEmail(ctx, email)
	if err != nil {
		if !errors.Is(err, ErrNotFound) {
			return nil, err // DB or network error -- propagate, do not mask as 401
		}
		// User not found -- do dummy bcrypt to match the timing of a real failed login.
		// dummyPasswordHash is a valid bcrypt-12 hash -- ensures full bcrypt time is spent.
		auth.VerifyPassword(password, dummyPasswordHash)
		return nil, ErrInvalidCredentials
	}
	if !auth.VerifyPassword(password, u.PasswordHash) {
		return nil, ErrInvalidCredentials
	}
	if !u.IsActive {
		return nil, ErrUserInactive
	}

	accessToken, err := auth.GenerateAccessToken(s.JWTSecret, u.ID, u.Role, u.MustChangePassword, s.AccessTTL)
	if err != nil {
		return nil, err
	}

	raw, hash, err := generateRefreshToken()
	if err != nil {
		return nil, err
	}
	if err := s.Tokens.Create(ctx, u.ID, hash, time.Now().Add(s.RefreshTTL)); err != nil {
		return nil, err
	}

	return &LoginResult{
		AccessToken:  accessToken,
		RefreshToken: raw,
		User:         &u.User,
	}, nil
}

// RefreshResult holds the new token pair after a successful refresh.
type RefreshResult struct {
	AccessToken  string
	RefreshToken string
}

// Refresh rotates the refresh token and issues a new access token.
// Detects token reuse: if the presented token was already revoked, all user sessions are nuked.
func (s *AuthService) Refresh(ctx context.Context, rawToken string) (*RefreshResult, error) {
	hash := hashRefreshToken(rawToken)

	stored, err := s.Tokens.GetByHash(ctx, hash)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, ErrInvalidCredentials // unknown token -- treat as invalid, not a server error
		}
		return nil, err // DB or network error -- propagate
	}

	// Reuse detection: revoked token presented again = stolen token, kill everything.
	if stored.RevokedAt != nil {
		_ = s.Tokens.RevokeAll(ctx, stored.UserID)
		return nil, ErrTokenReuse
	}

	if time.Now().After(stored.ExpiresAt) {
		return nil, ErrTokenExpired
	}

	u, err := s.Users.GetByID(ctx, stored.UserID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, ErrInvalidCredentials // user deleted after token issued
		}
		return nil, err
	}
	if !u.IsActive {
		return nil, ErrUserInactive
	}

	// Rotate: revoke old, issue new.
	if err := s.Tokens.Revoke(ctx, stored.ID); err != nil {
		return nil, err
	}

	accessToken, err := auth.GenerateAccessToken(s.JWTSecret, u.ID, u.Role, u.MustChangePassword, s.AccessTTL)
	if err != nil {
		return nil, err
	}

	newRaw, newHash, err := generateRefreshToken()
	if err != nil {
		return nil, err
	}
	if err := s.Tokens.Create(ctx, u.ID, newHash, time.Now().Add(s.RefreshTTL)); err != nil {
		return nil, err
	}

	return &RefreshResult{
		AccessToken:  accessToken,
		RefreshToken: newRaw,
	}, nil
}

// Logout revokes the given refresh token. Idempotent: unknown token is not an error.
func (s *AuthService) Logout(ctx context.Context, rawToken string) error {
	hash := hashRefreshToken(rawToken)
	stored, err := s.Tokens.GetByHash(ctx, hash)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil // already logged out or token never existed
		}
		return err
	}
	return s.Tokens.Revoke(ctx, stored.ID)
}

// generateRefreshToken creates 32 cryptographically random bytes and returns
// the hex-encoded raw value (sent to client) and its SHA-256 hash (stored in DB).
func generateRefreshToken() (raw, hash string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", "", err
	}
	raw = hex.EncodeToString(b)
	hash = hashRefreshToken(raw)
	return raw, hash, nil
}

// hashRefreshToken returns the hex-encoded SHA-256 hash of the raw token.
// SHA-256 is deterministic, so the hash can be used as a DB lookup key.
// (bcrypt is NOT used here because it's non-deterministic -- can't lookup by hash.)
func hashRefreshToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}
