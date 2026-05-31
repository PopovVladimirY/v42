# V.42 Server-Sent Events (SSE) Guide

Real-time event stream for building live dashboards and reactive UIs.

> **Philosophy:** events are **cache-invalidation hints, not data carriers.**
> An event ships an entity *type* and *id* -- never the payload. Clients react by
> re-fetching through the normal authorized API, so a hint can never leak data a
> user could not already request. The broker stays dumb, fast, and free of
> access-control logic.

---

## 1. The Endpoint

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/v1/events` | JWT (query param or Bearer) |

A single long-lived HTTP connection that streams `text/event-stream`.

### Authentication

The browser `EventSource` API **cannot set an `Authorization` header**, so the
access token is passed as a query parameter:

```
GET /api/v1/events?access_token=<JWT>
```

Non-browser clients (curl, Node, Go) may instead send a normal header:

```
Authorization: Bearer <JWT>
```

The JWT is validated **once, at connection time**. The route lives *outside* the
`bearerAuth` middleware group and does its own token check. An invalid or missing
token returns `401 UNAUTHORIZED` with the standard error envelope.

> The token is validated at connect only -- the stream is not torn down when the
> 15-minute access token later expires. The client should reconnect with a fresh
> token after a silent refresh (the reference hook does this automatically; see
> section 4).

### Response headers

```
Content-Type:      text/event-stream
Cache-Control:     no-cache
Connection:        keep-alive
X-Accel-Buffering: no      (tells nginx not to buffer the stream)
```

### Keep-alive

The server emits a heartbeat comment every **25 seconds** so proxies and load
balancers do not reap an idle connection:

```
: ping
```

On connect, the server immediately sends `: connected` so the client `onopen`
fires promptly.

---

## 2. Wire Format

Standard SSE framing. Each event uses a **named** event (`event:` line) plus a
JSON `data:` line:

```
event: backlog.updated
data: {"type":"backlog.updated","project_id":"<uuid>","entity_id":"<uuid>","actor":"<uuid>","at":"2026-05-31T12:09:13Z"}

```

Comment lines (used for connect/heartbeat) start with `:` and carry no data:

```
: connected

: ping

```

Because events are **named**, browser clients must register a listener per event
type (`addEventListener('backlog.updated', ...)`); the generic `onmessage`
handler will **not** fire for them.

---

## 3. Event Catalog

### Payload schema

Every event has the same flat shape (`internal/sse.Event`):

| Field | Type | Notes |
|-------|------|-------|
| `type` | string | `"<entity>.<verb>"`, e.g. `backlog.updated` |
| `project_id` | string (uuid) | scope hint -- filter client-side on this |
| `entity_id` | string (uuid) | the affected entity (omitted for some bulk ops) |
| `actor` | string (uuid) | user id that triggered the change (may be empty) |
| `at` | string (RFC3339) | server timestamp |

`project_id`, `entity_id`, and `actor` are omitted when empty (`omitempty`).

### All event types

| Type | Emitted when | `entity_id` is |
|------|--------------|----------------|
| `backlog.created` | A backlog item is created | the new item |
| `backlog.updated` | A backlog item is edited | the item |
| `backlog.deleted` | A backlog item is deleted | the deleted item |
| `backlog.reordered` | Backlog priorities are re-sorted | *(none -- whole project)* |
| `task.created` | A task is created under an item | the task |
| `task.updated` | A task is edited | the task |
| `task.deleted` | A task is deleted | the deleted task |
| `task.moved` | A task is moved to another item | the task |
| `test.created` | A test spec is created under a project/epic/item | the test |
| `test.updated` | A test spec is edited | the test |
| `test.deleted` | A test spec is deleted | the deleted test |
| `test.moved` | A test spec is moved to another item | the test |
| `epic.created` | An epic is created | the epic |
| `epic.updated` | An epic is edited | the epic |
| `epic.deleted` | An epic is deleted | the deleted epic |
| `sprint.created` | A sprint is created | the sprint |
| `sprint.updated` | A sprint is edited | the sprint |
| `sprint.deleted` | A sprint is deleted | the deleted sprint |
| `sprint.closed` | A sprint is closed | the sprint |
| `sprint.item.added` | A backlog item is committed to a sprint | the backlog item |
| `sprint.item.removed` | A backlog item is pulled from a sprint | the backlog item |
| `comment.created` | A comment is posted on an item or task | the item/task commented on |

> Event constants live in `internal/sse/broker.go`. The frontend mirror list is
> in `frontend/src/hooks/useEventStream.ts` (`EVENT_TYPES`). Keep both in sync
> when adding a new event.

---

## 4. Browser Client (React reference hook)

The app ships a ready hook, [frontend/src/hooks/useEventStream.ts](frontend/src/hooks/useEventStream.ts).
Mount it **once**, high in the tree (it is already wired into
[frontend/src/components/layout/AppShell.tsx](frontend/src/components/layout/AppShell.tsx)):

```tsx
import { useEventStream } from '@/hooks/useEventStream';

export function AppShell() {
  useEventStream(); // live cache invalidation via server-sent events
  // ...
}
```

What it does:

1. Opens `EventSource('/api/v1/events?access_token=<token>')`.
2. Registers a listener for every event type.
3. On each event, calls `queryClient.invalidateQueries` for the matching key
   prefix, so any mounted React Query view re-fetches automatically.
4. Rebuilds the stream when the access token changes (reconnect after refresh).
5. Closes the stream on unmount.

### Invalidation map (event domain -> React Query key)

| Event domain | Invalidated query key prefix |
|--------------|------------------------------|
| `backlog.*` | `['backlog', projectId]` **and** `['sprints', projectId]` (sprint board shows backlog items) |
| `task.*` | `['tasks', projectId]` |
| `test.*` | `['item-tests', projectId]` (inline tests on project & sprint backlog tables) |
| `epic.*` | `['epics', projectId]` |
| `sprint.*` | `['sprints', projectId]` **and** `['backlog', projectId]` (item add/remove moves it in/out of the pool) |
| `comment.*` | `['backlog', projectId]` **and** `['tasks', projectId]` |

TanStack Query matches keys by **prefix**, so invalidating `['backlog', pid]`
refreshes both the list query and every item-detail query nested under it.

---

## 5. Non-browser Client

Quick manual check with curl (Bearer header form):

```bash
curl -N -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/events
```

`-N` disables curl's buffering so events print as they arrive. You will see
`: connected`, periodic `: ping`, and any `event:`/`data:` frames as mutations
happen.

---

## 6. Building Dashboards

The SSE feed is the foundation for live dashboards. Two patterns:

### Pattern A -- "invalidate and refetch" (recommended)

This is what the reference hook does. Your dashboard widgets are normal React
Query (or SWR) views bound to the existing REST endpoints. SSE just tells them
*when* to refetch. You write zero bespoke socket-state code -- the widget's data
source stays the single REST endpoint, and freshness comes for free.

```tsx
// A live sprint burndown widget -- no SSE code here at all.
function SprintBurndown({ projectId, sprintId }: Props) {
  const { data } = useQuery({
    queryKey: ['sprints', projectId, sprintId, 'burndown'],
    queryFn: () => sprintsApi.burndown(projectId, sprintId),
  });
  // useEventStream() (mounted in AppShell) invalidates ['sprints', projectId]
  // whenever a sprint/task/item changes -> this widget refetches by itself.
  return <Chart data={data} />;
}
```

Make a widget live by simply giving its query key a prefix the invalidation map
already covers (`['sprints', projectId, ...]`, `['backlog', projectId, ...]`,
etc.). If you add a new top-level query key, extend `invalidateFor` in the hook.

### Pattern B -- "consume events directly" (activity feeds, counters, toasts)

When the dashboard needs the *events themselves* (not just a freshness signal) --
e.g. a live activity feed, an "X is editing" indicator, or a per-minute event
counter -- subscribe to the raw stream. Keep a small in-memory ring buffer; do
**not** trust event contents as authoritative data (they are hints) -- fetch
detail via the API if you need to render the entity.

```tsx
function useActivityFeed(projectId: string, max = 50) {
  const token = useAuthStore((s) => s.accessToken);
  const [feed, setFeed] = useState<ServerEvent[]>([]);

  useEffect(() => {
    if (!token) return;
    const es = new EventSource(`/api/v1/events?access_token=${encodeURIComponent(token)}`);
    const onAny = (e: MessageEvent) => {
      const ev = JSON.parse(e.data) as ServerEvent;
      if (ev.project_id !== projectId) return;        // filter to this board
      setFeed((prev) => [ev, ...prev].slice(0, max));  // newest first, capped
    };
    EVENT_TYPES.forEach((t) => es.addEventListener(t, onAny as EventListener));
    return () => es.close();
  }, [token, projectId, max]);

  return feed;
}
```

> One EventSource per tab is plenty. Prefer reusing the single AppShell stream
> (Pattern A) and only open a second one when you genuinely need raw events.

### Always filter by `project_id`

Every client receives **every** event (the broker does no server-side scoping).
That is safe -- events carry no data -- but a dashboard should ignore events
whose `project_id` does not match what it is showing. Drop them early.

---

## 7. Reconnection & Reliability

- **Browser auto-reconnect.** `EventSource` reconnects on its own after a drop.
  On reconnect, refetch your dashboard's underlying queries to catch up on any
  events missed during the gap (events are fire-and-forget -- there is no replay).
- **No backfill / no history.** The broker is in-memory and stateless. A client
  that was disconnected will not be told what it missed. Reconcile by refetching,
  not by replaying.
- **Token refresh.** Reconnect with a fresh access token after a silent refresh.
  The reference hook keys its `EventSource` on the token, so this is automatic.
- **Slow clients are protected, not stalled.** Each subscriber has a 64-event
  buffer; if a client cannot keep up, the broker drops events for *that* client
  only and never blocks publishers. The client reconciles on its next refetch.

---

## 8. Operational Notes

- **Single instance only.** The broker is in-process memory. With more than one
  API replica, a client connected to replica A will not see events published on
  replica B. Horizontal scaling needs a shared bus (e.g. Redis pub/sub) -- this
  is deliberately deferred.
- **Write timeout.** The server's global `WriteTimeout` would kill a long-lived
  stream; the handler disables the write deadline for the SSE connection via
  `http.NewResponseController`.
- **nginx.** Production reverse proxy must keep buffering off for `/api/`
  (already configured in [frontend/nginx.conf](frontend/nginx.conf):
  `proxy_buffering off`, long `proxy_read_timeout`). The handler also sends
  `X-Accel-Buffering: no`.
- **Graceful shutdown.** On SIGINT/SIGTERM the API closes the broker, which
  unblocks every open stream so they terminate cleanly before the process exits.

---

## 9. Source Map

| Concern | File |
|---------|------|
| Broker (fan-out hub) | [internal/sse/broker.go](internal/sse/broker.go) |
| Broker `-race` tests | [internal/sse/broker_test.go](internal/sse/broker_test.go) |
| `/events` HTTP handler | [internal/api/events.go](internal/api/events.go) |
| Route + broker wiring | [internal/api/router.go](internal/api/router.go) |
| Event emission (mutations) | `internal/api/handler_*.go` |
| Frontend SSE hook | [frontend/src/hooks/useEventStream.ts](frontend/src/hooks/useEventStream.ts) |
| Proxy config | [frontend/nginx.conf](frontend/nginx.conf) |
