import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/hooks/useAuth';

// Server event payload -- mirrors internal/sse.Event. We only need the type and
// the project scope to know which cached queries to nudge.
interface ServerEvent {
  type: string;
  project_id?: string;
  entity_id?: string;
  actor?: string;
  at?: string;
}

// Every event type the backend can emit. EventSource delivers named events to
// per-name listeners (not onmessage), so we must register each one explicitly.
const EVENT_TYPES = [
  'backlog.created',
  'backlog.updated',
  'backlog.deleted',
  'backlog.reordered',
  'task.created',
  'task.updated',
  'task.deleted',
  'task.moved',
  'test.created',
  'test.updated',
  'test.deleted',
  'test.moved',
  'epic.created',
  'epic.updated',
  'epic.deleted',
  'sprint.created',
  'sprint.updated',
  'sprint.deleted',
  'sprint.closed',
  'sprint.item.added',
  'sprint.item.removed',
  'comment.created',
] as const;

// Map an event's first segment to the React Query key prefixes it should
// invalidate. Keys are partial -- TanStack matches by prefix, so invalidating
// ['backlog', projectId] catches both the list and every item detail under it.
function invalidateFor(qc: QueryClient, ev: ServerEvent) {
  const pid = ev.project_id;
  if (!pid) return;
  const domain = ev.type.split('.')[0];

  switch (domain) {
    case 'backlog':
      void qc.invalidateQueries({ queryKey: ['backlog', pid] });
      // The sprint board renders backlog items as cards -- a status/priority
      // change must refresh sprint views too, or the kanban goes stale.
      void qc.invalidateQueries({ queryKey: ['sprints', pid] });
      break;
    case 'task':
      void qc.invalidateQueries({ queryKey: ['tasks', pid] });
      break;
    case 'test':
      // Item tests are shown inline on both the project backlog and the sprint
      // backlog tables -- one prefix covers every item under the project.
      void qc.invalidateQueries({ queryKey: ['item-tests', pid] });
      break;
    case 'epic':
      void qc.invalidateQueries({ queryKey: ['epics', pid] });
      break;
    case 'sprint':
      void qc.invalidateQueries({ queryKey: ['sprints', pid] });
      // Adding/removing an item moves it in/out of the backlog pool too.
      void qc.invalidateQueries({ queryKey: ['backlog', pid] });
      break;
    case 'comment':
      // Comments hang off items and tasks -- refresh both to be safe.
      void qc.invalidateQueries({ queryKey: ['backlog', pid] });
      void qc.invalidateQueries({ queryKey: ['tasks', pid] });
      break;
  }
}

/**
 * useEventStream wires the browser to the server's SSE feed. Mount it ONCE,
 * high in the tree (AppShell). It opens an EventSource to /api/v1/events,
 * authenticating via the access_token query param (EventSource can't set
 * headers), and invalidates affected React Query caches as events arrive.
 *
 * The stream is rebuilt whenever the access token changes (e.g. after a silent
 * refresh), so a fresh token is always used on reconnect.
 */
export function useEventStream() {
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!token) return;

    const es = new EventSource(`/api/v1/events?access_token=${encodeURIComponent(token)}`);

    const handler = (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data) as ServerEvent;
        invalidateFor(qc, ev);
      } catch {
        // Malformed payload -- ignore. A bad hint is not worth a crash.
      }
    };

    for (const type of EVENT_TYPES) {
      es.addEventListener(type, handler as EventListener);
    }

    return () => {
      es.close();
    };
  }, [token, qc]);
}
