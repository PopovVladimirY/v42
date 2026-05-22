//go:build integration

package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vpo/v42/internal/api"
	"github.com/vpo/v42/internal/auth"
	"github.com/vpo/v42/internal/config"
	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/db/store"
	"github.com/vpo/v42/internal/domain"
	"github.com/vpo/v42/internal/testutil"
)

// testEnv groups everything needed to make HTTP requests against the auth API.
type testEnv struct {
	srv    *httptest.Server
	client *http.Client
	q      *dbgen.Queries
	pool   *pgxpool.Pool
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()

	pool := testutil.NewDB(t)
	q := dbgen.New(pool)

	cfg := &config.Config{
		JWTSecret:     "test-secret-not-used-in-production-aaaaaa",
		JWTAccessTTL:  time.Hour,
		JWTRefreshTTL: 7 * 24 * time.Hour,
		AppEnv:        "test",
	}

	authSvc := &domain.AuthService{
		Users:      store.NewUserStore(q),
		Tokens:     store.NewTokenStore(q),
		JWTSecret:  cfg.JWTSecret,
		AccessTTL:  cfg.JWTAccessTTL,
		RefreshTTL: cfg.JWTRefreshTTL,
	}

	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	router := api.NewRouter(cfg, pool, log, authSvc, q)
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	// Client that stores cookies between requests.
	jar, _ := newCookieJar()
	client := &http.Client{Jar: jar}

	return &testEnv{srv: srv, client: client, q: q, pool: pool}
}

// seed creates a test user and registers cleanup to remove it after the test.
// The user is unique per test to avoid state bleed.
func (e *testEnv) seedUser(t *testing.T, email, password, role string) {
	t.Helper()

	// Remove any stale data from a previous failed run. Order matters: children first.
	e.pool.Exec(context.Background(), "DELETE FROM projects WHERE owner_id = (SELECT id FROM users WHERE email = $1)", email) //nolint:errcheck
	e.pool.Exec(context.Background(), "DELETE FROM backlog_items WHERE created_by = (SELECT id FROM users WHERE email = $1)", email) //nolint:errcheck
	e.pool.Exec(context.Background(), "DELETE FROM users WHERE email = $1", email) //nolint:errcheck

	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("seedUser: hash: %v", err)
	}
	_, err = e.q.CreateUser(context.Background(), dbgen.CreateUserParams{
		Email:        email,
		PasswordHash: hash,
		DisplayName:  "Test User",
		Role:         dbgen.UserRole(role),
	})
	if err != nil {
		t.Fatalf("seedUser: create: %v", err)
	}
	t.Cleanup(func() {
		e.pool.Exec(context.Background(), "DELETE FROM users WHERE email = $1", email) //nolint:errcheck
	})
}

// post sends a POST request with a JSON body and returns the response.
func (e *testEnv) post(t *testing.T, path string, body any) *http.Response {
	t.Helper()
	b, _ := json.Marshal(body)
	resp, err := e.client.Post(e.srv.URL+path, "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	return resp
}

// get sends a GET request with an Authorization header.
func (e *testEnv) get(t *testing.T, path, token string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, e.srv.URL+path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	return resp
}

// decodeBody reads the full {data, meta, error} envelope and returns the data section as raw JSON.
func decodeBody(t *testing.T, resp *http.Response) map[string]json.RawMessage {
	t.Helper()
	defer resp.Body.Close()
	var env map[string]json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	return env
}

// -- Test cases --------------------------------------------------------------

func TestAuth_Login_Success(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "login_ok@test.local", "hunter2", "developer")

	resp := e.post(t, "/api/v1/auth/login", map[string]string{
		"email": "login_ok@test.local", "password": "hunter2",
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	env := decodeBody(t, resp)
	var data struct {
		AccessToken string       `json:"access_token"`
		User        *domain.User `json:"user"`
	}
	if err := json.Unmarshal(env["data"], &data); err != nil {
		t.Fatalf("unmarshal data: %v", err)
	}
	if data.AccessToken == "" {
		t.Error("expected non-empty access_token")
	}
	if data.User == nil || data.User.Email != "login_ok@test.local" {
		t.Error("expected user in response")
	}

	// Refresh token cookie must be set.
	var found bool
	for _, c := range resp.Cookies() {
		if c.Name == "refresh_token" && c.HttpOnly {
			found = true
		}
	}
	if !found {
		t.Error("expected httpOnly refresh_token cookie")
	}
}

func TestAuth_Login_WrongPassword(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "login_bad@test.local", "correctpassword", "developer")

	resp := e.post(t, "/api/v1/auth/login", map[string]string{
		"email": "login_bad@test.local", "password": "wrongpassword",
	})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestAuth_Login_UnknownUser(t *testing.T) {
	e := newTestEnv(t)

	resp := e.post(t, "/api/v1/auth/login", map[string]string{
		"email": "nobody@test.local", "password": "whatever",
	})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestAuth_Refresh_TokenRotation(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "refresh@test.local", "password123", "developer")

	// Login to get the cookie.
	loginResp := e.post(t, "/api/v1/auth/login", map[string]string{
		"email": "refresh@test.local", "password": "password123",
	})
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("login: expected 200, got %d", loginResp.StatusCode)
	}
	loginResp.Body.Close()

	// Refresh -- cookie is forwarded automatically by the jar.
	refreshResp := e.post(t, "/api/v1/auth/refresh", nil)
	if refreshResp.StatusCode != http.StatusOK {
		t.Fatalf("refresh: expected 200, got %d", refreshResp.StatusCode)
	}

	env := decodeBody(t, refreshResp)
	var data map[string]string
	if err := json.Unmarshal(env["data"], &data); err != nil {
		t.Fatalf("unmarshal data: %v", err)
	}
	if data["access_token"] == "" {
		t.Error("expected new access_token after refresh")
	}
}

func TestAuth_Me_WithValidToken(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "me_valid@test.local", "mypassword", "admin")

	loginResp := e.post(t, "/api/v1/auth/login", map[string]string{
		"email": "me_valid@test.local", "password": "mypassword",
	})
	env := decodeBody(t, loginResp)

	var data struct {
		AccessToken string `json:"access_token"`
	}
	json.Unmarshal(env["data"], &data) //nolint:errcheck

	meResp := e.get(t, "/api/v1/auth/me", data.AccessToken)
	if meResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", meResp.StatusCode)
	}

	meEnv := decodeBody(t, meResp)
	var user domain.User
	json.Unmarshal(meEnv["data"], &user) //nolint:errcheck

	if user.Email != "me_valid@test.local" {
		t.Errorf("expected email me_valid@test.local, got %q", user.Email)
	}
}

func TestAuth_Me_NoToken(t *testing.T) {
	e := newTestEnv(t)

	resp := e.get(t, "/api/v1/auth/me", "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestAuth_Me_ExpiredToken(t *testing.T) {
	e := newTestEnv(t)

	// Generate a token that expired 1 second ago.
	expired, err := auth.GenerateAccessToken("test-secret-not-used-in-production-aaaaaa", "fake-id", "developer", -time.Second)
	if err != nil {
		t.Fatal(err)
	}

	resp := e.get(t, "/api/v1/auth/me", expired)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestAuth_Logout(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "logout@test.local", "byebye", "developer")

	// Login.
	loginResp := e.post(t, "/api/v1/auth/login", map[string]string{
		"email": "logout@test.local", "password": "byebye",
	})
	loginResp.Body.Close()

	// Logout -- needs JWT in Authorization (logout is a JWT-protected endpoint).
	// First get the access token.
	loginResp2 := e.post(t, "/api/v1/auth/login", map[string]string{
		"email": "logout@test.local", "password": "byebye",
	})
	env := decodeBody(t, loginResp2)
	var data struct {
		AccessToken string `json:"access_token"`
	}
	json.Unmarshal(env["data"], &data) //nolint:errcheck

	req, _ := http.NewRequest(http.MethodPost, e.srv.URL+"/api/v1/auth/logout", nil)
	req.Header.Set("Authorization", "Bearer "+data.AccessToken)
	// Forward cookies from jar.
	for _, cookie := range e.client.Jar.Cookies(req.URL) {
		req.AddCookie(cookie)
	}
	logoutResp, _ := e.client.Do(req)
	if logoutResp.StatusCode != http.StatusNoContent {
		logoutResp.Body.Close()
		t.Fatalf("expected 204, got %d", logoutResp.StatusCode)
	}
	logoutResp.Body.Close()

	// After logout, refresh should fail.
	refreshResp := e.post(t, "/api/v1/auth/refresh", nil)
	if refreshResp.StatusCode != http.StatusUnauthorized {
		refreshResp.Body.Close()
		t.Fatalf("expected 401 after logout, got %d", refreshResp.StatusCode)
	}
	refreshResp.Body.Close()
}

// -- regression tests --------------------------------------------------------

// Regression: email was case-sensitive before normalization was added.
func TestAuth_Login_EmailNormalization(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "normal@test.local", "password1", "developer")

	resp := e.post(t, "/api/v1/auth/login", map[string]string{
		"email": "NORMAL@TEST.LOCAL", "password": "password1",
	})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 with uppercased email, got %d", resp.StatusCode)
	}
}

// Regression: no MaxBytesReader meant a large body could tie up the goroutine.
func TestAuth_Login_BodyTooLarge(t *testing.T) {
	e := newTestEnv(t)

	// 5 KB > 4 KB limit; pack it into a valid-looking JSON key so the decoder
	// hits the limit rather than a JSON syntax error first.
	big := make([]byte, 5120)
	for i := range big {
		big[i] = 'a'
	}
	body := `{"email":"x@test.local","password":"` + string(big) + `"}`
	req, _ := http.NewRequest(http.MethodPost, e.srv.URL+"/api/v1/auth/login",
		bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for oversized body, got %d", resp.StatusCode)
	}
}

// Regression: middleware error responses were missing data/meta envelope fields.
func TestAuth_ErrorEnvelope_HasDataAndMeta(t *testing.T) {
	e := newTestEnv(t)

	// No token → 401 from JWT middleware.
	resp := e.get(t, "/api/v1/auth/me", "")
	if resp.StatusCode != http.StatusUnauthorized {
		resp.Body.Close()
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
	env := decodeBody(t, resp)

	// Both "data" and "meta" must be present (even as null) per the API contract.
	if _, ok := env["data"]; !ok {
		t.Error("response envelope is missing the 'data' field")
	}
	if _, ok := env["meta"]; !ok {
		t.Error("response envelope is missing the 'meta' field")
	}
	if _, ok := env["error"]; !ok {
		t.Error("response envelope is missing the 'error' field")
	}
}

// Regression: after token rotation, the old refresh token must be revoked.
func TestAuth_TokenReuse_OldTokenRevoked(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "rotate@test.local", "rotatepass", "developer")

	// Login without the shared jar so we can capture the raw cookie value.
	loginReq, _ := http.NewRequest(http.MethodPost, e.srv.URL+"/api/v1/auth/login",
		bytes.NewReader(mustJSON(t, map[string]string{"email": "rotate@test.local", "password": "rotatepass"})))
	loginReq.Header.Set("Content-Type", "application/json")
	plainClient := &http.Client{} // no jar
	loginResp, err := plainClient.Do(loginReq)
	if err != nil || loginResp.StatusCode != http.StatusOK {
		t.Fatalf("login failed: %v / status %d", err, loginResp.StatusCode)
	}
	loginResp.Body.Close()

	var oldCookieVal string
	for _, c := range loginResp.Cookies() {
		if c.Name == "refresh_token" {
			oldCookieVal = c.Value
		}
	}
	if oldCookieVal == "" {
		t.Fatal("no refresh_token cookie after login")
	}

	// Rotate the token (first refresh).
	refreshResp := postWithCookie(t, plainClient, e.srv.URL+"/api/v1/auth/refresh", oldCookieVal)
	if refreshResp.StatusCode != http.StatusOK {
		t.Fatalf("first refresh: expected 200, got %d", refreshResp.StatusCode)
	}
	refreshResp.Body.Close()

	// Attempt to reuse the OLD token -- must be rejected.
	replayResp := postWithCookie(t, plainClient, e.srv.URL+"/api/v1/auth/refresh", oldCookieVal)
	defer replayResp.Body.Close()
	if replayResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 for revoked token replay, got %d", replayResp.StatusCode)
	}
}

// Regression: inactive users must be blocked at login, not after JWT is issued.
func TestAuth_Login_InactiveUser(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "inactive@test.local", "activepass", "developer")

	// Deactivate the user directly in the DB.
	_, err := e.pool.Exec(context.Background(),
		"UPDATE users SET is_active = false WHERE email = $1", "inactive@test.local")
	if err != nil {
		t.Fatalf("deactivate user: %v", err)
	}

	resp := e.post(t, "/api/v1/auth/login", map[string]string{
		"email": "inactive@test.local", "password": "activepass",
	})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for inactive user, got %d", resp.StatusCode)
	}

	env := decodeBody(t, resp)
	var errObj map[string]string
	if err := json.Unmarshal(env["error"], &errObj); err != nil {
		t.Fatalf("unmarshal error field: %v", err)
	}
	if errObj["code"] != "ACCOUNT_INACTIVE" {
		t.Errorf("expected ACCOUNT_INACTIVE error code, got %q", errObj["code"])
	}
}

// Regression: http.Error sets Content-Type: text/plain -- middleware must use application/json.
func TestAuth_ErrorResponse_ContentTypeIsJSON(t *testing.T) {
	e := newTestEnv(t)

	cases := []struct {
		name   string
		doReq  func() *http.Response
		wantStatus int
	}{
		{
			name: "JWT_missing_bearer",
			doReq: func() *http.Response {
				resp := e.get(t, "/api/v1/auth/me", "")
				return resp
			},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "JWT_invalid_token",
			doReq: func() *http.Response {
				resp := e.get(t, "/api/v1/auth/me", "not-a-valid-jwt")
				return resp
			},
			wantStatus: http.StatusUnauthorized,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp := tc.doReq()
			defer resp.Body.Close()

			if resp.StatusCode != tc.wantStatus {
				t.Fatalf("expected %d, got %d", tc.wantStatus, resp.StatusCode)
			}
			ct := resp.Header.Get("Content-Type")
			if !strings.HasPrefix(ct, "application/json") {
				t.Errorf("expected Content-Type application/json on error response, got %q", ct)
			}
		})
	}
}

// Regression: chiware.RealIP rewrote r.RemoteAddr from X-Forwarded-For before the
// rate limiter ran, letting anyone spoof their client IP and bypass brute-force protection.
// After fix: rate limiter uses the unforgeable TCP address; X-Forwarded-For is ignored.
func TestAuth_RateLimit_XForwardedFor_CannotBypass(t *testing.T) {
	e := newTestEnv(t)
	plainClient := &http.Client{} // no jar, no cookie carry-over

	sendLogin := func(fwdFor string) *http.Response {
		req, _ := http.NewRequest(http.MethodPost, e.srv.URL+"/api/v1/auth/login",
			bytes.NewReader(mustJSON(t, map[string]string{"email": "nobody@test.local", "password": "x"})))
		req.Header.Set("Content-Type", "application/json")
		if fwdFor != "" {
			req.Header.Set("X-Forwarded-For", fwdFor)
		}
		resp, err := plainClient.Do(req)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		return resp
	}

	// Exhaust the burst (10 tokens) from 127.0.0.1.
	for i := 0; i < 10; i++ {
		resp := sendLogin("")
		resp.Body.Close()
	}

	// 11th request: attacker tries to appear as a different IP via X-Forwarded-For.
	// Must still be rate-limited -- spoofed header must not reset the bucket.
	resp := sendLogin("203.0.113.42")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("expected 429 (IP spoofing via X-Forwarded-For must not bypass rate limit), got %d", resp.StatusCode)
	}
}

// postWithCookie sends POST with a single cookie and no shared jar.
func postWithCookie(t *testing.T, client *http.Client, rawURL, cookieVal string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, rawURL, nil)
	req.AddCookie(&http.Cookie{Name: "refresh_token", Value: cookieVal})
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", rawURL, err)
	}
	return resp
}

// mustJSON marshals v to JSON bytes, fatally failing the test on error.
func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("mustJSON: %v", err)
	}
	return b
}

// -- cookie jar helper -------------------------------------------------------

type simpleCookieJar struct {
	cookies map[string][]*http.Cookie
}

func newCookieJar() (http.CookieJar, error) {
	return &simpleCookieJar{cookies: make(map[string][]*http.Cookie)}, nil
}

func (j *simpleCookieJar) SetCookies(u *url.URL, cookies []*http.Cookie) {
	key := u.Host
	for _, nc := range cookies {
		found := false
		for i, c := range j.cookies[key] {
			if c.Name == nc.Name {
				j.cookies[key][i] = nc
				found = true
				break
			}
		}
		if !found {
			j.cookies[key] = append(j.cookies[key], nc)
		}
	}
}

func (j *simpleCookieJar) Cookies(u *url.URL) []*http.Cookie {
	return j.cookies[u.Host]
}
