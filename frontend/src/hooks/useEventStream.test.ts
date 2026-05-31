import { describe, it, expect, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { invalidateFor, type ServerEvent } from './useEventStream';

// A featherweight QueryClient stand-in: we only care which queryKeys got
// nudged. No real cache, no network, just a spy with a good memory.
function makeSpyClient() {
  const calls: unknown[][] = [];
  const qc = {
    invalidateQueries: (arg: { queryKey: unknown[] }) => {
      calls.push(arg.queryKey);
      return Promise.resolve();
    },
  } as unknown as QueryClient;
  return { qc, calls };
}

// Compare the set of invalidated keys regardless of order.
function keySet(calls: unknown[][]): Set<string> {
  return new Set(calls.map((k) => JSON.stringify(k)));
}

const PID = 'proj-123';

describe('invalidateFor', () => {
  it('does nothing without a project_id', () => {
    const { qc, calls } = makeSpyClient();
    invalidateFor(qc, { type: 'backlog.updated' } as ServerEvent);
    expect(calls).toHaveLength(0);
  });

  it('backlog event refreshes both backlog and sprints', () => {
    const { qc, calls } = makeSpyClient();
    invalidateFor(qc, { type: 'backlog.updated', project_id: PID });
    expect(keySet(calls)).toEqual(
      keySet([
        ['backlog', PID],
        ['sprints', PID],
      ])
    );
  });

  it('task event refreshes only tasks', () => {
    const { qc, calls } = makeSpyClient();
    invalidateFor(qc, { type: 'task.moved', project_id: PID });
    expect(keySet(calls)).toEqual(keySet([['tasks', PID]]));
  });

  it('test event refreshes item-tests', () => {
    const { qc, calls } = makeSpyClient();
    invalidateFor(qc, { type: 'test.created', project_id: PID });
    expect(keySet(calls)).toEqual(keySet([['item-tests', PID]]));
  });

  it('epic event refreshes epics', () => {
    const { qc, calls } = makeSpyClient();
    invalidateFor(qc, { type: 'epic.deleted', project_id: PID });
    expect(keySet(calls)).toEqual(keySet([['epics', PID]]));
  });

  it('sprint event refreshes sprints and backlog pool', () => {
    const { qc, calls } = makeSpyClient();
    invalidateFor(qc, { type: 'sprint.item.added', project_id: PID });
    expect(keySet(calls)).toEqual(
      keySet([
        ['sprints', PID],
        ['backlog', PID],
      ])
    );
  });

  it('comment event refreshes backlog and tasks', () => {
    const { qc, calls } = makeSpyClient();
    invalidateFor(qc, { type: 'comment.created', project_id: PID });
    expect(keySet(calls)).toEqual(
      keySet([
        ['backlog', PID],
        ['tasks', PID],
      ])
    );
  });

  it('ignores unknown domains without throwing', () => {
    const { qc, calls } = makeSpyClient();
    expect(() =>
      invalidateFor(qc, { type: 'unicorn.summoned', project_id: PID })
    ).not.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('always scopes invalidation to the event project', () => {
    const { qc, calls } = makeSpyClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    invalidateFor(qc, { type: 'backlog.created', project_id: 'other-proj' });
    for (const key of calls) {
      expect((key as string[])[1]).toBe('other-proj');
    }
    spy.mockRestore();
  });
});
