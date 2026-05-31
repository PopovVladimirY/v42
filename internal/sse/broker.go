// Package sse is a tiny in-memory Server-Sent Events fan-out hub.
//
// Philosophy note: events are cache-invalidation HINTS, not data carriers.
// They ship entity IDs and a type -- never the payload itself. Clients react by
// re-fetching through the normal authorized API, so a hint leaks nothing a user
// could not already see. This keeps the broker dumb, fast, and access-control-free.
package sse

import (
	"log/slog"
	"sync"
	"time"
)

// Event is a single broadcast notification. It travels to every connected
// client; the client decides whether it cares (usually by ProjectID).
type Event struct {
	Type      string    `json:"type"`                 // e.g. "backlog.updated"
	ProjectID string    `json:"project_id,omitempty"` // scope hint for client-side filtering
	EntityID  string    `json:"entity_id,omitempty"`  // the affected entity (item/task/sprint/...)
	Actor     string    `json:"actor,omitempty"`      // user id that triggered the change
	At        time.Time `json:"at"`                   // server timestamp
}

// subBuffer is how many events a single subscriber may lag behind before we
// start dropping for it. A slow reader must never stall a writer.
const subBuffer = 64

type subscriber struct {
	ch chan Event
}

// Broker is a concurrency-safe SSE fan-out hub. The zero value is NOT usable;
// build one with NewBroker.
type Broker struct {
	mu   sync.RWMutex
	subs map[*subscriber]struct{}
	log  *slog.Logger
	done chan struct{}
	once sync.Once
}

// NewBroker returns a ready-to-use broker.
func NewBroker(log *slog.Logger) *Broker {
	return &Broker{
		subs: make(map[*subscriber]struct{}),
		log:  log,
		done: make(chan struct{}),
	}
}

// Subscribe registers a new listener and returns its read-only channel plus an
// unsubscribe func that MUST be called (defer it) when the listener leaves.
// Unsubscribe is idempotent.
func (b *Broker) Subscribe() (<-chan Event, func()) {
	s := &subscriber{ch: make(chan Event, subBuffer)}

	b.mu.Lock()
	b.subs[s] = struct{}{}
	b.mu.Unlock()

	var once sync.Once
	unsub := func() {
		once.Do(func() {
			b.mu.Lock()
			delete(b.subs, s)
			close(s.ch)
			b.mu.Unlock()
		})
	}
	return s.ch, unsub
}

// Publish fan-outs an event to every subscriber without ever blocking. A
// subscriber whose buffer is full is skipped -- it will reconcile on its next
// full refetch. Nil-safe so handlers wired without a broker (tests) can call it
// unconditionally.
//
// The send happens under RLock while unsubscribe deletes+closes under the
// exclusive Lock, so a send can never race a close (no send-on-closed panic).
func (b *Broker) Publish(e Event) {
	if b == nil {
		return
	}
	if e.At.IsZero() {
		e.At = time.Now()
	}

	b.mu.RLock()
	defer b.mu.RUnlock()
	for s := range b.subs {
		select {
		case s.ch <- e:
		default:
			// Slow client -- drop this one event for it. No drama.
		}
	}
}

// Done returns a channel closed when the broker shuts down. SSE handlers select
// on it to terminate their streams during graceful shutdown.
func (b *Broker) Done() <-chan struct{} { return b.done }

// Close signals shutdown to all streams. Idempotent and nil-safe.
func (b *Broker) Close() {
	if b == nil {
		return
	}
	b.once.Do(func() { close(b.done) })
}

// Count reports the number of live subscribers. Handy for tests and metrics.
func (b *Broker) Count() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.subs)
}

// Event type constants. Naming: "<entity>.<verb>".
const (
	EventBacklogCreated   = "backlog.created"
	EventBacklogUpdated   = "backlog.updated"
	EventBacklogDeleted   = "backlog.deleted"
	EventBacklogReordered = "backlog.reordered"

	EventTaskCreated = "task.created"
	EventTaskUpdated = "task.updated"
	EventTaskDeleted = "task.deleted"
	EventTaskMoved   = "task.moved"

	EventTestCreated = "test.created"
	EventTestUpdated = "test.updated"
	EventTestDeleted = "test.deleted"
	EventTestMoved   = "test.moved"

	EventEpicCreated = "epic.created"
	EventEpicUpdated = "epic.updated"
	EventEpicDeleted = "epic.deleted"

	EventMilestoneCreated = "milestone.created"
	EventMilestoneUpdated = "milestone.updated"
	EventMilestoneDeleted = "milestone.deleted"
	EventMilestoneBound   = "milestone.bound" // stage <-> milestone binding changed

	EventSprintCreated     = "sprint.created"
	EventSprintUpdated     = "sprint.updated"
	EventSprintDeleted     = "sprint.deleted"
	EventSprintClosed      = "sprint.closed"
	EventSprintItemAdded   = "sprint.item.added"
	EventSprintItemRemoved = "sprint.item.removed"

	EventCommentCreated = "comment.created"
)
