import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { teamsApi } from '@/api/endpoints/teams';
import type { TeamMember } from '@/types/teams';

// Formats "2024-01-15T..." to "Jan 2024"
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en', { month: 'short', year: 'numeric' });
}

// Formats capacity hours: 40 -> "40 h/wk", 0 -> "--"
function fmtCapacity(h: number) {
  return h > 0 ? `${h} h/wk` : '--';
}

// Initials from display_name or email
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// Role badge colors -- uses CSS tokens
const ROLE_COLOR: Record<string, string> = {
  admin: 'var(--accent)',
  maintainer: 'var(--success)',
  member: 'var(--text-3)',
};

function MemberCard({ m }: { m: TeamMember }) {
  const label = m.display_name || m.email;
  const color = ROLE_COLOR[m.role] ?? 'var(--text-3)';

  return (
    <div
      className="flex items-center gap-3 rounded-lg p-3"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
      }}
    >
      {/* Avatar or initials bubble */}
      {m.avatar_url ? (
        <img
          src={m.avatar_url}
          alt={label}
          className="w-9 h-9 rounded-full flex-shrink-0 object-cover"
        />
      ) : (
        <div
          className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-semibold"
          style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
        >
          {initials(label)}
        </div>
      )}

      {/* Name + email */}
      <div className="min-w-0 flex-1">
        <p
          className="text-sm font-medium truncate"
          style={{ color: 'var(--text-1)' }}
          title={label}
        >
          {label}
        </p>
        {m.display_name && (
          <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
            {m.email}
          </p>
        )}
      </div>

      {/* Role + capacity */}
      <div className="flex-shrink-0 flex flex-col items-end gap-0.5">
        <span className="text-xs font-medium capitalize" style={{ color }}>
          {m.role}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          {fmtCapacity(m.capacity_hours)}
        </span>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div
      className="h-16 rounded-lg animate-pulse"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    />
  );
}

export function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: team, isLoading, isError } = useQuery({
    queryKey: ['team', id],
    queryFn: () => teamsApi.get(id!),
    enabled: !!id,
  });

  if (isError) {
    return (
      <div className="p-6 flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-sm" style={{ color: 'var(--error, #ef4444)' }}>
          Failed to load team.
        </p>
        <Link to="/teams" className="text-xs" style={{ color: 'var(--accent)' }}>
          Back to teams
        </Link>
      </div>
    );
  }

  const totalCapacity = team?.members.reduce((s, m) => s + m.capacity_hours, 0) ?? 0;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Back link */}
      <Link
        to="/teams"
        className="inline-flex items-center gap-1.5 text-xs mb-6"
        style={{ color: 'var(--text-3)' }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Teams
      </Link>

      {/* Header */}
      <div className="mb-6">
        {isLoading ? (
          <div className="h-7 w-48 rounded animate-pulse" style={{ background: 'var(--bg-surface)' }} />
        ) : (
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-1)' }}>
            {team?.name}
          </h1>
        )}
        {isLoading ? (
          <div className="h-4 w-72 rounded mt-2 animate-pulse" style={{ background: 'var(--bg-surface)' }} />
        ) : (
          team?.description && (
            <p className="mt-1 text-sm" style={{ color: 'var(--text-2)' }}>
              {team.description}
            </p>
          )
        )}
      </div>

      {/* Stats row */}
      <div className="flex gap-6 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
            Members
          </p>
          <p className="text-lg font-semibold mt-0.5" style={{ color: 'var(--text-1)' }}>
            {isLoading ? '--' : (team?.members.length ?? 0)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
            Total capacity
          </p>
          <p className="text-lg font-semibold mt-0.5" style={{ color: 'var(--text-1)' }}>
            {isLoading ? '--' : fmtCapacity(totalCapacity)}
          </p>
        </div>
        {!isLoading && team && (
          <div>
            <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
              Created
            </p>
            <p className="text-lg font-semibold mt-0.5" style={{ color: 'var(--text-1)' }}>
              {fmtDate(team.created_at)}
            </p>
          </div>
        )}
      </div>

      {/* Members grid */}
      <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-2)' }}>
        Members
      </h2>
      <div className="flex flex-col gap-2">
        {isLoading
          ? Array.from({ length: 3 }, (_, i) => <SkeletonCard key={i} />)
          : team?.members.length === 0
          ? (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--text-3)' }}>
              No members yet.
            </p>
          )
          : team?.members.map((m) => <MemberCard key={m.user_id} m={m} />)
        }
      </div>
    </div>
  );
}
