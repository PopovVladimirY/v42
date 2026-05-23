import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { teamsApi } from '@/api/endpoints/teams';
import { projectsApi } from '@/api/endpoints/projects';

// ── Tab type ──────────────────────────────────────────────
type Tab = 'teams' | 'projects';

// ── Icon: restore arrow (counter-clockwise) ───────────────
function RestoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M2 7a5 5 0 105-5H5.5"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"
      />
      <path
        d="M5.5 2.5L3.5 4.5l2 2"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Archived Teams list ───────────────────────────────────
function ArchivedTeams() {
  const qc = useQueryClient();

  const { data: teams, isLoading } = useQuery({
    queryKey: ['teams', 'archived'],
    queryFn: () => teamsApi.listArchived(),
  });

  const restore = useMutation({
    mutationFn: (id: string) => teamsApi.unarchive(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['teams', 'archived'] });
      void qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 mt-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: 'var(--bg-surface)' }} />
        ))}
      </div>
    );
  }

  if (!teams || teams.length === 0) {
    return (
      <p className="text-sm mt-6 text-center" style={{ color: 'var(--text-3)' }}>
        No archived teams. The archive is clear.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 mt-4">
      {teams.map((t) => (
        <div
          key={t.id}
          className="flex items-center justify-between px-4 py-3 rounded-lg"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <div className="min-w-0">
            <span className="text-sm font-medium block truncate" style={{ color: 'var(--text-1)' }}>{t.name}</span>
            {t.description && (
              <span className="text-xs block truncate" style={{ color: 'var(--text-3)' }}>{t.description}</span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0 ml-4">
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              {new Date(t.updated_at).toLocaleDateString()}
            </span>
            <button
              onClick={() => restore.mutate(t.id)}
              disabled={restore.isPending}
              title="Restore team"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-40"
              style={{
                background: 'var(--accent-muted)',
                color: 'var(--accent)',
                border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
              }}
            >
              <RestoreIcon />
              Restore
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Archived Projects list ────────────────────────────────
function ArchivedProjects() {
  const qc = useQueryClient();

  const { data: res, isLoading } = useQuery({
    queryKey: ['projects', 'archived'],
    queryFn: () => projectsApi.listArchived(),
  });

  const projects = res?.data.data ?? [];

  const restore = useMutation({
    mutationFn: (id: string) => projectsApi.unarchive(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects', 'archived'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 mt-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: 'var(--bg-surface)' }} />
        ))}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <p className="text-sm mt-6 text-center" style={{ color: 'var(--text-3)' }}>
        No archived projects. The archive is clear.
      </p>
    );
  }

  const STATUS_COLOR: Record<string, string> = {
    active:    'var(--color-info)',
    on_hold:   'var(--color-warning)',
    completed: 'var(--color-success)',
    archived:  'var(--text-3)',
  };

  return (
    <div className="flex flex-col gap-2 mt-4">
      {projects.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between px-4 py-3 rounded-lg"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium block truncate" style={{ color: 'var(--text-1)' }}>{p.name}</span>
              <span
                className="text-xs px-1.5 py-0.5 rounded capitalize flex-shrink-0"
                style={{
                  background: 'var(--bg-elevated)',
                  color: STATUS_COLOR[p.status] ?? 'var(--text-3)',
                }}
              >
                {p.status.replace('_', ' ')}
              </span>
            </div>
            {p.description && (
              <span className="text-xs block truncate" style={{ color: 'var(--text-3)' }}>{p.description}</span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0 ml-4">
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              {new Date(p.updated_at).toLocaleDateString()}
            </span>
            <button
              onClick={() => restore.mutate(p.id)}
              disabled={restore.isPending}
              title="Restore project"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-40"
              style={{
                background: 'var(--accent-muted)',
                color: 'var(--accent)',
                border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
              }}
            >
              <RestoreIcon />
              Restore
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────
export function AdminArchivePage() {
  const [tab, setTab] = useState<Tab>('teams');

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div style={{ maxWidth: 820 }}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            to="/admin/settings"
            className="p-1.5 rounded-md transition-colors"
            style={{ color: 'var(--text-3)', background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
            title="Back to Settings"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--text-1)' }}>Archive</h1>
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>
              Soft-deleted teams and projects. Restore to make them active again.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-2" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
          {(['teams', 'projects'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-2 text-sm font-medium capitalize transition-colors"
              style={{
                color: tab === t ? 'var(--accent)' : 'var(--text-3)',
                borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
                background: 'transparent',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'teams' && <ArchivedTeams />}
        {tab === 'projects' && <ArchivedProjects />}
      </div>
    </div>
  );
}
