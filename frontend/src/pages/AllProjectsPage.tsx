import { useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { teamsApi } from '@/api/endpoints/teams';

// Sidebar "Projects" link -- routes to the full project tree for the user's team(s).
// Single team: redirect straight to /teams/:id/projects.
// Multiple teams: show a team picker; each card navigates to that team's project tree.
export function AllProjectsPage() {
  const navigate = useNavigate();
  const { data: myTeams = [], isLoading } = useQuery({
    queryKey: ['teams', 'mine'],
    queryFn: teamsApi.mine,
  });

  // Redirect immediately when there's exactly one team
  if (!isLoading && myTeams.length === 1) {
    return <Navigate to={`/teams/${myTeams[0].id}/projects`} replace />;
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-1)' }}>Projects</h1>
      {!isLoading && myTeams.length > 1 && (
        <p className="text-sm mb-6" style={{ color: 'var(--text-3)' }}>Select a team to view its project tree.</p>
      )}

      {isLoading && (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading...</p>
      )}

      {!isLoading && myTeams.length === 0 && (
        <div className="rounded-xl p-10 text-center mt-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>You are not a member of any team yet.</p>
        </div>
      )}

      {!isLoading && myTeams.length > 1 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {myTeams.map((team) => (
            <button
              key={team.id}
              onClick={() => navigate(`/teams/${team.id}/projects`)}
              className="rounded-xl p-5 text-left transition-all hover:shadow-md"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{team.name}</p>
              {team.description && (
                <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-3)' }}>{team.description}</p>
              )}
              <p className="text-xs mt-3 font-medium" style={{ color: 'var(--accent)' }}>
                Open project tree →
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
