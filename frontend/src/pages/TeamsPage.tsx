import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { teamsApi } from '@/api/endpoints/teams';
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
  const { data: teams, isLoading, isError, error } = useQuery({
    queryKey: ['teams'],
    queryFn: teamsApi.list,
  });

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
        <span className="text-sm" style={{ color: 'var(--text-3)' }}>
          {teams ? `${teams.length} team${teams.length !== 1 ? 's' : ''}` : ''}
        </span>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-6">
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
