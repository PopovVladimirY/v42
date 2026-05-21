package middleware

import (
	"log/slog"
	"net/http"
	"time"

	chiware "github.com/go-chi/chi/v5/middleware"
)

// Logger returns a chi-compatible middleware that logs each request as structured JSON.
func Logger(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := chiware.NewWrapResponseWriter(w, r.ProtoMajor)

			defer func() {
				log.Info("http",
					"method",     r.Method,
					"path",       r.URL.Path,
					"status",     ww.Status(),
					"bytes",      ww.BytesWritten(),
					"ms",         time.Since(start).Milliseconds(),
					"request_id", chiware.GetReqID(r.Context()),
					"ip",         r.RemoteAddr,
				)
			}()

			next.ServeHTTP(ww, r)
		})
	}
}
