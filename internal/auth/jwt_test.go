package auth_test

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/vpo/v42/internal/auth"
)

const testSecret = "test-secret-do-not-use-in-prod"

func TestGenerateAndParse_RoundTrip(t *testing.T) {
	tok, err := auth.GenerateAccessToken(testSecret, "user-123", "admin", true, time.Hour)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if tok == "" {
		t.Fatal("expected non-empty token")
	}

	claims, err := auth.ParseToken(testSecret, tok)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if claims.UserID != "user-123" {
		t.Errorf("UserID: want user-123, got %q", claims.UserID)
	}
	if claims.Role != "admin" {
		t.Errorf("Role: want admin, got %q", claims.Role)
	}
	if !claims.MustChangePassword {
		t.Error("MustChangePassword: want true, got false")
	}
	if claims.Subject != "user-123" {
		t.Errorf("Subject: want user-123, got %q", claims.Subject)
	}
}

func TestParse_WrongSecret(t *testing.T) {
	tok, _ := auth.GenerateAccessToken(testSecret, "u", "dev", false, time.Hour)
	if _, err := auth.ParseToken("a-completely-different-secret", tok); err == nil {
		t.Fatal("expected error for token signed with a different secret")
	}
}

func TestParse_Expired(t *testing.T) {
	// Negative TTL -> token is born already expired.
	tok, _ := auth.GenerateAccessToken(testSecret, "u", "dev", false, -time.Minute)
	_, err := auth.ParseToken(testSecret, tok)
	if err == nil {
		t.Fatal("expected error for expired token")
	}
	if !strings.Contains(err.Error(), "expired") {
		t.Errorf("expected expiry error, got %v", err)
	}
}

func TestParse_TamperedPayload(t *testing.T) {
	tok, _ := auth.GenerateAccessToken(testSecret, "u", "dev", false, time.Hour)
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		t.Fatalf("expected 3 JWT parts, got %d", len(parts))
	}
	// Flip the payload segment to a different (valid base64) blob.
	parts[1] = parts[1][:len(parts[1])-2] + "AA"
	tampered := strings.Join(parts, ".")
	if _, err := auth.ParseToken(testSecret, tampered); err == nil {
		t.Fatal("expected error for tampered payload")
	}
}

func TestParse_Garbage(t *testing.T) {
	for _, s := range []string{"", "not-a-token", "a.b", "a.b.c.d"} {
		if _, err := auth.ParseToken(testSecret, s); err == nil {
			t.Errorf("expected error for garbage token %q", s)
		}
	}
}

// TestParse_RejectsNoneAlg guards against the classic alg=none downgrade:
// a token forged with SigningMethodNone must never be accepted.
func TestParse_RejectsNoneAlg(t *testing.T) {
	claims := auth.Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "attacker",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
		UserID: "attacker",
		Role:   "admin",
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	signed, err := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("sign none: %v", err)
	}
	if _, err := auth.ParseToken(testSecret, signed); err == nil {
		t.Fatal("alg=none token was accepted -- downgrade attack possible")
	}
}
