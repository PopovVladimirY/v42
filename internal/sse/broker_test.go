package sse

import (
	"sync"
	"testing"
	"time"
)

// TestBroker_DeliversToSubscribers verifies a published event reaches a live subscriber.
func TestBroker_DeliversToSubscribers(t *testing.T) {
	b := NewBroker(nil)
	ch, unsub := b.Subscribe()
	defer unsub()

	b.Publish(Event{Type: EventBacklogUpdated, ProjectID: "p1", EntityID: "i1"})

	select {
	case ev := <-ch:
		if ev.Type != EventBacklogUpdated || ev.ProjectID != "p1" || ev.EntityID != "i1" {
			t.Fatalf("unexpected event: %+v", ev)
		}
		if ev.At.IsZero() {
			t.Error("expected At to be auto-stamped")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
	}
}

// TestBroker_UnsubscribeStopsDelivery ensures a removed subscriber gets a closed channel.
func TestBroker_UnsubscribeStopsDelivery(t *testing.T) {
	b := NewBroker(nil)
	ch, unsub := b.Subscribe()

	if got := b.Count(); got != 1 {
		t.Fatalf("expected 1 subscriber, got %d", got)
	}
	unsub()
	unsub() // idempotent -- must not panic

	if got := b.Count(); got != 0 {
		t.Fatalf("expected 0 subscribers after unsub, got %d", got)
	}
	if _, open := <-ch; open {
		t.Error("expected channel closed after unsubscribe")
	}
}

// TestBroker_PublishNeverBlocksOnSlowClient floods a subscriber past its buffer
// and asserts Publish still returns promptly (drops excess instead of stalling).
func TestBroker_PublishNeverBlocksOnSlowClient(t *testing.T) {
	b := NewBroker(nil)
	_, unsub := b.Subscribe() // never drained
	defer unsub()

	done := make(chan struct{})
	go func() {
		for i := 0; i < subBuffer*10; i++ {
			b.Publish(Event{Type: EventTaskMoved})
		}
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Publish blocked on a slow client")
	}
}

// TestBroker_NilSafe verifies nil-receiver calls are no-ops (handlers without a broker).
func TestBroker_NilSafe(t *testing.T) {
	var b *Broker
	b.Publish(Event{Type: "x"}) // must not panic
	b.Close()                    // must not panic
}

// TestBroker_ConcurrentSubscribePublishUnsubscribe is the -race stress test:
// many goroutines subscribe, publish, and unsubscribe simultaneously.
func TestBroker_ConcurrentSubscribePublishUnsubscribe(t *testing.T) {
	b := NewBroker(nil)

	var wg sync.WaitGroup

	// Publishers
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 500; j++ {
				b.Publish(Event{Type: EventBacklogUpdated, ProjectID: "p"})
			}
		}()
	}

	// Subscribers that churn: subscribe, drain a bit, unsubscribe.
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				ch, unsub := b.Subscribe()
				go func() {
					for range ch {
						// drain until closed
					}
				}()
				time.Sleep(time.Millisecond)
				unsub()
			}
		}()
	}

	wg.Wait()
}
