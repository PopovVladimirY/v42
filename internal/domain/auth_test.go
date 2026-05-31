package domain_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/vpo/v42/internal/auth"
	"github.com/vpo/v42/internal/domain"
)

// ─── Fakes ───────────────────────────────────────────────────────────────────
// In-memory UserRepo / TokenRepo so AuthService can be exercised without a DB.
// They implement just enough of the interface; unused methods are stubs.

type fakeUserRepo struct {
	byEmail   map[string]*domain.StoredUser
	byID      map[string]*domain.User
	emailErr  error // forced error from GetByEmail (DB-down simulation)
	idErr     error // forced error from GetByID
}

func newFakeUserRepo() *fakeUserRepo {
	return &fakeUserRepo{byEmail: map[string]*domain.StoredUser{}, byID: map[string]*domain.User{}}
}

func (r *fakeUserRepo) add(u *domain.StoredUser) {
	r.byEmail[u.Email] = u
	cp := u.User
	r.byID[u.ID] = &cp
}

func (r *fakeUserRepo) GetByEmail(_ context.Context, email string) (*domain.StoredUser, error) {
	if r.emailErr != nil {
		return nil, r.emailErr
	}
	u, ok := r.byEmail[email]
	if !ok {
		return nil, domain.ErrNotFound
	}
	return u, nil
}

func (r *fakeUserRepo) GetByID(_ context.Context, id string) (*domain.User, error) {
	if r.idErr != nil {
		return nil, r.idErr
	}
	u, ok := r.byID[id]
	if !ok {
		return nil, domain.ErrNotFound
	}
	return u, nil
}

func (r *fakeUserRepo) Create(context.Context, string, string, string, string, bool) (*domain.User, error) {
	return nil, errors.New("not implemented")
}
func (r *fakeUserRepo) UpdateTheme(context.Context, string, string) (*domain.User, error) {
	return nil, errors.New("not implemented")
}
func (r *fakeUserRepo) UpdateUserIdleTimeout(context.Context, string, int) (*domain.User, error) {
	return nil, errors.New("not implemented")
}
func (r *fakeUserRepo) ChangePassword(context.Context, string, string, bool) (*domain.User, error) {
	return nil, errors.New("not implemented")
}
func (r *fakeUserRepo) UpdateSettings(context.Context, string, json.RawMessage) (*domain.User, error) {
	return nil, errors.New("not implemented")
}
func (r *fakeUserRepo) UpdateLastActive(context.Context, string) error { return nil }

type fakeTokenRepo struct {
	byHash         map[string]*domain.RefreshToken
	byID           map[string]*domain.RefreshToken
	seq            int
	revokeAllCalls int
	createErr      error
}

func newFakeTokenRepo() *fakeTokenRepo {
	return &fakeTokenRepo{byHash: map[string]*domain.RefreshToken{}, byID: map[string]*domain.RefreshToken{}}
}

func (r *fakeTokenRepo) Create(_ context.Context, userID, hash string, exp time.Time) error {
	if r.createErr != nil {
		return r.createErr
	}
	r.seq++
	tok := &domain.RefreshToken{
		ID:        toID(r.seq),
		UserID:    userID,
		TokenHash: hash,
		ExpiresAt: exp,
	}
	r.byHash[hash] = tok
	r.byID[tok.ID] = tok
	return nil
}

func (r *fakeTokenRepo) GetByHash(_ context.Context, hash string) (*domain.RefreshToken, error) {
	tok, ok := r.byHash[hash]
	if !ok {
		return nil, domain.ErrNotFound
	}
	cp := *tok
	return &cp, nil
}

func (r *fakeTokenRepo) Revoke(_ context.Context, id string) error {
	tok, ok := r.byID[id]
	if !ok {
		return domain.ErrNotFound
	}
	now := time.Now()
	tok.RevokedAt = &now
	return nil
}

func (r *fakeTokenRepo) RevokeAll(_ context.Context, userID string) error {
	r.revokeAllCalls++
	now := time.Now()
	for _, tok := range r.byID {
		if tok.UserID == userID {
			tok.RevokedAt = &now
		}
	}
	return nil
}

// sole returns the only token in the repo -- handy after a single Login.
func (r *fakeTokenRepo) sole(t *testing.T) *domain.RefreshToken {
	t.Helper()
	if len(r.byID) != 1 {
		t.Fatalf("expected exactly 1 stored token, got %d", len(r.byID))
	}
	for _, tok := range r.byID {
		return tok
	}
	return nil
}

func toID(n int) string { return "tok-" + string(rune('0'+n)) }

// ─── Harness ─────────────────────────────────────────────────────────────────

func newService(t *testing.T) (*domain.AuthService, *fakeUserRepo, *fakeTokenRepo) {
	t.Helper()
	users := newFakeUserRepo()
	tokens := newFakeTokenRepo()
	svc := &domain.AuthService{
		Users:      users,
		Tokens:     tokens,
		JWTSecret:  "unit-test-secret",
		AccessTTL:  15 * time.Minute,
		RefreshTTL: 7 * 24 * time.Hour,
	}
	return svc, users, tokens
}

func seedUser(t *testing.T, users *fakeUserRepo, email, password string, active bool) {
	t.Helper()
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	users.add(&domain.StoredUser{
		User: domain.User{
			ID:       "user-1",
			Email:    email,
			Role:     "developer",
			IsActive: active,
		},
		PasswordHash: hash,
	})
}

// ─── Login ───────────────────────────────────────────────────────────────────

func TestLogin_Success(t *testing.T) {
	svc, users, tokens := newService(t)
	seedUser(t, users, "a@test.local", "pw", true)

	res, err := svc.Login(context.Background(), "a@test.local", "pw")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if res.AccessToken == "" || res.RefreshToken == "" {
		t.Fatal("expected both tokens to be non-empty")
	}
	if res.User.Email != "a@test.local" {
		t.Errorf("unexpected user: %+v", res.User)
	}
	if len(tokens.byID) != 1 {
		t.Errorf("expected one refresh token persisted, got %d", len(tokens.byID))
	}
	// Access token must be a valid JWT for our secret.
	claims, err := auth.ParseToken("unit-test-secret", res.AccessToken)
	if err != nil {
		t.Fatalf("access token does not parse: %v", err)
	}
	if claims.UserID != "user-1" {
		t.Errorf("claims UserID: want user-1, got %q", claims.UserID)
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	svc, users, _ := newService(t)
	seedUser(t, users, "a@test.local", "pw", true)
	if _, err := svc.Login(context.Background(), "a@test.local", "nope"); !errors.Is(err, domain.ErrInvalidCredentials) {
		t.Errorf("want ErrInvalidCredentials, got %v", err)
	}
}

func TestLogin_UnknownUser(t *testing.T) {
	svc, _, _ := newService(t)
	if _, err := svc.Login(context.Background(), "ghost@test.local", "pw"); !errors.Is(err, domain.ErrInvalidCredentials) {
		t.Errorf("want ErrInvalidCredentials for unknown user, got %v", err)
	}
}

func TestLogin_InactiveUser(t *testing.T) {
	svc, users, _ := newService(t)
	seedUser(t, users, "a@test.local", "pw", false)
	if _, err := svc.Login(context.Background(), "a@test.local", "pw"); !errors.Is(err, domain.ErrUserInactive) {
		t.Errorf("want ErrUserInactive, got %v", err)
	}
}

func TestLogin_DBErrorPropagates(t *testing.T) {
	svc, users, _ := newService(t)
	boom := errors.New("connection refused")
	users.emailErr = boom
	_, err := svc.Login(context.Background(), "a@test.local", "pw")
	if !errors.Is(err, boom) {
		t.Errorf("want underlying DB error, got %v", err)
	}
}

// ─── Refresh ─────────────────────────────────────────────────────────────────

func TestRefresh_RotatesToken(t *testing.T) {
	svc, users, tokens := newService(t)
	seedUser(t, users, "a@test.local", "pw", true)
	login, _ := svc.Login(context.Background(), "a@test.local", "pw")

	res, err := svc.Refresh(context.Background(), login.RefreshToken)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if res.RefreshToken == login.RefreshToken {
		t.Error("refresh must mint a NEW refresh token, not echo the old one")
	}
	if res.AccessToken == "" {
		t.Error("expected new access token")
	}
	// Old token must now be revoked; a fresh one must exist.
	if len(tokens.byID) != 2 {
		t.Fatalf("expected 2 tokens after rotation, got %d", len(tokens.byID))
	}
}

// The reuse alarm: presenting a rotated (now-revoked) token must nuke all sessions.
func TestRefresh_ReuseDetectionRevokesAll(t *testing.T) {
	svc, users, tokens := newService(t)
	seedUser(t, users, "a@test.local", "pw", true)
	login, _ := svc.Login(context.Background(), "a@test.local", "pw")

	// First refresh rotates and revokes the original token.
	if _, err := svc.Refresh(context.Background(), login.RefreshToken); err != nil {
		t.Fatalf("first refresh: %v", err)
	}
	// Replaying the original (revoked) token = theft signal.
	_, err := svc.Refresh(context.Background(), login.RefreshToken)
	if !errors.Is(err, domain.ErrTokenReuse) {
		t.Errorf("want ErrTokenReuse, got %v", err)
	}
	if tokens.revokeAllCalls != 1 {
		t.Errorf("expected RevokeAll to fire once, got %d", tokens.revokeAllCalls)
	}
}

func TestRefresh_UnknownToken(t *testing.T) {
	svc, _, _ := newService(t)
	if _, err := svc.Refresh(context.Background(), "not-a-real-token"); !errors.Is(err, domain.ErrInvalidCredentials) {
		t.Errorf("want ErrInvalidCredentials, got %v", err)
	}
}

func TestRefresh_ExpiredToken(t *testing.T) {
	svc, users, tokens := newService(t)
	seedUser(t, users, "a@test.local", "pw", true)
	login, _ := svc.Login(context.Background(), "a@test.local", "pw")

	tokens.sole(t).ExpiresAt = time.Now().Add(-time.Hour) // backdate it
	if _, err := svc.Refresh(context.Background(), login.RefreshToken); !errors.Is(err, domain.ErrTokenExpired) {
		t.Errorf("want ErrTokenExpired, got %v", err)
	}
}

func TestRefresh_InactiveUser(t *testing.T) {
	svc, users, _ := newService(t)
	seedUser(t, users, "a@test.local", "pw", true)
	login, _ := svc.Login(context.Background(), "a@test.local", "pw")

	users.byID["user-1"].IsActive = false
	if _, err := svc.Refresh(context.Background(), login.RefreshToken); !errors.Is(err, domain.ErrUserInactive) {
		t.Errorf("want ErrUserInactive, got %v", err)
	}
}

func TestRefresh_UserDeleted(t *testing.T) {
	svc, users, _ := newService(t)
	seedUser(t, users, "a@test.local", "pw", true)
	login, _ := svc.Login(context.Background(), "a@test.local", "pw")

	delete(users.byID, "user-1") // user vanished after token was issued
	if _, err := svc.Refresh(context.Background(), login.RefreshToken); !errors.Is(err, domain.ErrInvalidCredentials) {
		t.Errorf("want ErrInvalidCredentials, got %v", err)
	}
}

// ─── Logout ──────────────────────────────────────────────────────────────────

func TestLogout_RevokesToken(t *testing.T) {
	svc, users, tokens := newService(t)
	seedUser(t, users, "a@test.local", "pw", true)
	login, _ := svc.Login(context.Background(), "a@test.local", "pw")

	if err := svc.Logout(context.Background(), login.RefreshToken); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if tokens.sole(t).RevokedAt == nil {
		t.Error("token should be revoked after logout")
	}
	// A revoked token presented to Refresh trips reuse detection.
	if _, err := svc.Refresh(context.Background(), login.RefreshToken); !errors.Is(err, domain.ErrTokenReuse) {
		t.Errorf("post-logout refresh: want ErrTokenReuse, got %v", err)
	}
}

func TestLogout_IdempotentForUnknownToken(t *testing.T) {
	svc, _, _ := newService(t)
	if err := svc.Logout(context.Background(), "never-existed"); err != nil {
		t.Errorf("logout of unknown token should be a no-op, got %v", err)
	}
}

// ─── End-to-end ──────────────────────────────────────────────────────────────

func TestAuthFlow_LoginRefreshChain(t *testing.T) {
	svc, users, _ := newService(t)
	seedUser(t, users, "a@test.local", "pw", true)

	login, err := svc.Login(context.Background(), "a@test.local", "pw")
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	// Walk a chain of three rotations; each new token must keep working.
	current := login.RefreshToken
	for i := 0; i < 3; i++ {
		res, err := svc.Refresh(context.Background(), current)
		if err != nil {
			t.Fatalf("refresh #%d: %v", i+1, err)
		}
		current = res.RefreshToken
	}
	// The very first token is now ancient history -> reuse detection.
	if _, err := svc.Refresh(context.Background(), login.RefreshToken); !errors.Is(err, domain.ErrTokenReuse) {
		t.Errorf("stale original token: want ErrTokenReuse, got %v", err)
	}
}
