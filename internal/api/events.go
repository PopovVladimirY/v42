package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/vpo/v42/internal/auth"
	"github.com/vpo/v42/internal/sse"
)

// eventsHandler serves the live SSE stream at GET /api/v1/events.
type eventsHandler struct {
	broker    *sse.Broker
	jwtSecret string
}

// heartbeatInterval keeps proxies and load balancers from reaping an idle stream.
const heartbeatInterval = 25 * time.Second

// Stream is the long-lived SSE handler.
//
// Auth twist: the browser EventSource API cannot set an Authorization header, so
// the access token arrives via the `access_token` query parameter. Non-browser
// clients may still use a normal Bearer header. Either way we validate the JWT
// ourselves -- this route lives OUTSIDE the bearerAuth middleware group.
func (h *eventsHandler) Stream(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("access_token")
	if token == "" {
		if raw := r.Header.Get("Authorization"); strings.HasPrefix(raw, "Bearer ") {
			token = strings.TrimPrefix(raw, "Bearer ")
		}
	}
	if _, err := auth.ParseToken(h.jwtSecret, token); err != nil {
		respondErr(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid access token")
		return
	}

	// This connection is long-lived; the server's global WriteTimeout would
	// guillotine it after a few seconds. NewResponseController lets us disable
	// the write deadline just for this stream (and gives us a Flush that knows
	// how to unwrap chi's wrapped ResponseWriter).
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{}) // best-effort; not all writers support it

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // tell nginx: do not buffer this
	w.WriteHeader(http.StatusOK)

	events, unsub := h.broker.Subscribe()
	defer unsub()

	// Open the stream with a comment line so the client's onopen fires promptly.
	if _, err := w.Write([]byte(": connected\n\n")); err != nil {
		return
	}
	_ = rc.Flush()

	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return // client went away
		case <-h.broker.Done():
			return // server shutting down
		case <-ticker.C:
			if _, err := w.Write([]byte(": ping\n\n")); err != nil {
				return
			}
			if err := rc.Flush(); err != nil {
				return
			}
		case ev, ok := <-events:
			if !ok {
				return
			}
			payload, err := json.Marshal(ev)
			if err != nil {
				continue // should never happen for our flat struct
			}
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, payload); err != nil {
				return
			}
			if err := rc.Flush(); err != nil {
				return
			}
		}
	}
}
