package auth_test

import (
	"testing"

	"github.com/vpo/v42/internal/auth"
)

func TestHashPassword_RoundTrip(t *testing.T) {
	hash, err := auth.HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if hash == "" {
		t.Fatal("expected non-empty hash")
	}
	if hash == "correct horse battery staple" {
		t.Fatal("hash must not equal the plaintext")
	}
	if !auth.VerifyPassword("correct horse battery staple", hash) {
		t.Error("VerifyPassword: correct password rejected")
	}
}

func TestVerifyPassword_WrongPassword(t *testing.T) {
	hash, _ := auth.HashPassword("hunter2")
	if auth.VerifyPassword("hunter3", hash) {
		t.Error("VerifyPassword: wrong password accepted")
	}
}

// TestHashPassword_SaltIsRandom verifies bcrypt salts each hash, so the same
// plaintext never produces the same digest twice -- yet both still verify.
func TestHashPassword_SaltIsRandom(t *testing.T) {
	h1, _ := auth.HashPassword("same-input")
	h2, _ := auth.HashPassword("same-input")
	if h1 == h2 {
		t.Fatal("two hashes of the same password are identical -- salt missing?")
	}
	if !auth.VerifyPassword("same-input", h1) || !auth.VerifyPassword("same-input", h2) {
		t.Error("both salted hashes must verify against the original password")
	}
}

func TestVerifyPassword_GarbageHash(t *testing.T) {
	if auth.VerifyPassword("anything", "not-a-valid-bcrypt-hash") {
		t.Error("VerifyPassword: malformed hash must not verify")
	}
}

func TestHashPassword_Empty(t *testing.T) {
	hash, err := auth.HashPassword("")
	if err != nil {
		t.Fatalf("hashing empty password should still succeed: %v", err)
	}
	if !auth.VerifyPassword("", hash) {
		t.Error("empty password should verify against its own hash")
	}
	if auth.VerifyPassword("x", hash) {
		t.Error("non-empty password must not verify against empty-password hash")
	}
}
