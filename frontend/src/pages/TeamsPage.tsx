import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { teamsApi } from '@/api/endpoints/teams';
import { useAuthStore } from '@/hooks/useAuth';
import type { Team } from '@/types/teams';

// Formats "2024-01-15T..." to "Jan 2024"
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en', { month: 'short', year: 'numeric' });
}

function TeamCard({ team }: { team: Team }) {
  return (
    <Link
      to={`/teams/${team.id}`}
      className="block rounded-lg p-4 transition-colors hover:bg-[var(--bg-hover)]"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3
            className="font-semibold text-sm truncate"
            style={{ color: 'var(--text-1)' }}
            title={team.name}
          >
            {team.name}
          </h3>
          {team.description && (
            <p
              className="text-xs mt-1 truncate"
              style={{ color: 'var(--text-2)' }}
              title={team.description}
            >
              {team.description}
            </p>
          )}
        </div>
        <span
          className="text-xs flex-shrink-0 pt-0.5"
          style={{ color: 'var(--text-3)' }}
        >
          {fmtDate(team.created_at)}
        </span>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        style={{ color: 'var(--text-3)' }}
      >
        <circle cx="13" cy="13" r="6" stroke="currentColor" strokeWidth="2" />
        <circle cx="27" cy="13" r="6" stroke="currentColor" strokeWidth="2" />
        <path
          d="M2 34c0-6.075 4.925-11 11-11s11 4.925 11 11"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M24 28c1.5-2.5 4.2-4 6.5-4 6.075 0 11 4.925 11 11"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <p className="text-sm" style={{ color: 'var(--text-2)' }}>
        No teams yet
      </p>
      <p className="text-xs" style={{ color: 'var(--text-3)' }}>
        Ask an admin to create your first team.
      </p>
    </div>
  );
}

export function TeamsPage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const { data: teams, isLoading, isError, error } = useQuery({
    queryKey: ['teams'],
    queryFn: teamsApi.list,
  });

  const createTeam = useMutation({
    mutationFn: () => teamsApi.create(newName.trim(), newDesc.trim() || undefined),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['teams'] });
      setCreating(false);
      setNewName('');
      setNewDesc('');
    },
  });

  const canCreate = user?.role === 'admin' || user?.role === 'maintainer';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div
        className="px-6 py-4 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <h1 className="text-base font-semibold" style={{ color: 'var(--text-1)' }}>
          Teams
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-sm" style={{ color: 'var(--text-3)' }}>
            {teams ? `${teams.length} team${teams.length !== 1 ? 's' : ''}` : ''}
          </span>
          {canCreate && (
            <button
              onClick={() => setCreating((v) => !v)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors"
              style={{
                background: creating ? 'var(--bg-active)' : 'var(--accent)',
                color: creating ? 'var(--text-1)' : 'var(--accent-fg)',
                border: creating ? '1px solid var(--border)' : 'none',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              New team
            </button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Create team form */}
        {creating && (
          <div
            className="rounded-lg p-4 mb-4 flex flex-col gap-3 max-w-2xl"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
          >
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>New team</p>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-2)' }}>Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Platform Engineering"
                maxLength={120}
                className="w-full text-sm rounded-md px-2.5 py-2 outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) void createTeam.mutate(); }}
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-2)' }}>Description <span style={{ color: 'var(--text-3)' }}>(optional)</span></label>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="What does this team own?"
                maxLength={500}
                className="w-full text-sm rounded-md px-2.5 py-2 outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
              />
            </div>
            {createTeam.isError && (
              <p className="text-xs" style={{ color: 'var(--color-danger)' }}>Failed to create team. Try again.</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => void createTeam.mutate()}
                disabled={!newName.trim() || createTeam.isPending}
                className="flex-1 py-2 text-sm font-medium rounded-md disabled:opacity-40"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
              >
                {createTeam.isPending ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => { setCreating(false); setNewName(''); setNewDesc(''); }}
                className="px-4 py-2 text-sm rounded-md"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div
              className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
            />
          </div>
        )}

        {isError && (
          <div
            className="px-4 py-3 rounded-lg text-sm"
            style={{
              background: 'rgba(239 68 68 / 0.1)',
              color: 'var(--color-danger)',
              border: '1px solid rgba(239 68 68 / 0.2)',
            }}
          >
            Failed to load teams:{' '}
            {error instanceof Error ? error.message : 'unknown error'}
          </div>
        )}

        {teams && teams.length === 0 && <EmptyState />}

        {teams && teams.length > 0 && (
          <div className="grid gap-3 max-w-2xl">
            {teams.map((team) => (
              <TeamCard key={team.id} team={team} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
