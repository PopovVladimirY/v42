package middleware

import (
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type visitor struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// RateLimiter is an IP-based token bucket rate limiter.
// One limiter per unique IP address, stale entries cleaned up every 5 minutes.
type RateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*visitor
	r        rate.Limit
	burst    int
}

func NewRateLimiter(r rate.Limit, burst int) *RateLimiter {
	rl := &RateLimiter{
		visitors: make(map[string]*visitor),
		r:        r,
		burst:    burst,
	}
	go rl.cleanup()
	return rl
}

func (rl *RateLimiter) get(ip string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	v, ok := rl.visitors[ip]
	if !ok {
		v = &visitor{limiter: rate.NewLimiter(rl.r, rl.burst)}
		rl.visitors[ip] = v
	}
	v.lastSeen = time.Now()
	return v.limiter
}

// cleanup removes IPs that have been quiet for 10+ minutes.
// Runs forever in a goroutine -- the limiter lives as long as the process.
func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		rl.mu.Lock()
		for ip, v := range rl.visitors {
			if time.Since(v.lastSeen) > 10*time.Minute {
				delete(rl.visitors, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// Middleware returns a chi-compatible handler that enforces rate limiting.
// Responds with 429 and the standard error envelope when limit is exceeded.
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := realIP(r)
		if !rl.get(ip).Allow() {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "6")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"data":null,"meta":null,"error":{"code":"RATE_LIMIT_EXCEEDED","message":"too many requests, slow down"}}`)) //nolint:errcheck
			return
		}
		next.ServeHTTP(w, r)
	})
}

// realIP extracts the IP address from r.RemoteAddr, stripping the port.
// chi's RealIP middleware already rewrites RemoteAddr from X-Real-IP/X-Forwarded-For
// when behind a proxy -- we just need to strip the port for consistent map keys.
func realIP(r *http.Request) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr // fallback: already just an IP (no port)
	}
	return ip
}
