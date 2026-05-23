import { useEffect, useState } from 'react';
import { useParams, Link, NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useProject, useProjectTeams, useAddProjectTeam, useRemoveProjectTeam } from '@/hooks/useProjects';
import { useAuthStore } from '@/hooks/useAuth';
import { setLastProject } from '@/hooks/useLastProject';
import { teamsApi } from '@/api/endpoints/teams';

// Sub-nav tabs for a project
const TABS = [
  { label: 'Overview', to: '' },
  { label: 'Backlog', to: 'backlog' },
  { label: 'Epics', to: 'epics' },
  { label: 'Sprints', to: 'sprints' },
];

const STATUS_BADGE = {
  active:    { label: 'Active',   color: 'var(--color-success)' },
  on_hold:   { label: 'On Hold',  color: 'var(--color-warning)' },
  completed: { label: 'Done',     color: 'var(--text-3)'        },
  archived:  { label: 'Archived', color: 'var(--text-3)'        },
} as const;

// Shared project layout: header + tab nav + <Outlet />
export function ProjectShell() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading } = useProject(projectId ?? '');

  // Record last visited project for sidebar quick-nav
  useEffect(() => {
    if (project) setLastProject(project.id, project.name);
  }, [project?.id]);

  if (isLoading) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-shrink-0 flex items-center gap-2 px-4 border-b" style={{ height: 40, borderColor: 'var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Loading...</p>
        </div>
        <div className="flex-shrink-0 flex border-b px-4" style={{ borderColor: 'var(--border)' }}>
          {TABS.map((tab) => (
            <span key={tab.label} data-testid={`project-tab-${tab.label.toLowerCase()}`} className="px-4 py-2 text-sm font-medium" style={{ color: 'var(--text-3)' }}>
              {tab.label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  const badge = project ? STATUS_BADGE[project.status] : null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Compact header: breadcrumb + name + status on one line */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 border-b" style={{ height: 40, borderColor: 'var(--border)' }}>
        <Link to="/teams" className="text-xs hover:underline flex-shrink-0" style={{ color: 'var(--accent)' }}>Teams</Link>
        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-3)' }}>/</span>
        <h1 className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
          {project?.name}
        </h1>
        {badge && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ color: badge.color, background: 'var(--bg-elevated)' }}>
            {badge.label}
          </span>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex-shrink-0 flex border-b px-4" style={{ borderColor: 'var(--border)' }}>
        {TABS.map((tab) => (
          <NavLink
            key={tab.label}
            to={tab.to}
            end={tab.to === ''}
            data-testid={`project-tab-${tab.label.toLowerCase()}`}
            className={({ isActive }) =>
              `px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive ? 'border-[var(--accent)]' : 'border-transparent'
              }`
            }
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent)' : 'var(--text-2)',
            })}
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      {/* Routed content -- full height, each child owns its scroll */}
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}

// Overview tab -- the default child route
export function ProjectOverviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId ?? '');
  const { data: projectTeams = [], isLoading: teamsLoading } = useProjectTeams(projectId ?? '');
  const addTeam = useAddProjectTeam(projectId ?? '');
  const removeTeam = useRemoveProjectTeam(projectId ?? '');
  const { data: allTeams = [] } = useQuery({ queryKey: ['teams'], queryFn: teamsApi.list });
  const user = useAuthStore((s) => s.user);
  const canEdit = user?.role === 'admin' || user?.role === 'maintainer';
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState('');

  const linkedTeamIds = new Set(projectTeams.map((t) => t.id));
  const availableTeams = allTeams.filter((t) => !linkedTeamIds.has(t.id));

  async function handleAddTeam() {
    if (!selectedTeamId) return;
    await addTeam.mutateAsync(selectedTeamId);
    setSelectedTeamId('');
    setShowAddTeam(false);
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-4 flex flex-col gap-6">
      {project?.description && (
        <section
          className="rounded-xl p-4"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>{project.description}</p>
        </section>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <Link
          to="backlog"
          className="rounded-xl p-5 hover:border-[var(--accent)] transition-colors"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-3)' }}>Backlog</p>
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>View all items</p>
        </Link>
        <Link
          to="epics"
          className="rounded-xl p-5 hover:border-[var(--accent)] transition-colors"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-3)' }}>Epics</p>
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>Group your work</p>
        </Link>
        <Link
          to="sprints"
          className="rounded-xl p-5 hover:border-[var(--accent)] transition-colors"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-3)' }}>Sprints</p>
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>Plan iterations</p>
        </Link>
      </div>

      {canEdit && (
        <section
          className="rounded-xl p-4"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
            Danger Zone
          </p>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            Status management and archiving coming soon.
          </p>
        </section>
      )}

      {/* Teams section */}
      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
            Teams
          </p>
          {canEdit && !showAddTeam && availableTeams.length > 0 && (
            <button
              onClick={() => setShowAddTeam(true)}
              className="text-xs px-2 py-1 rounded"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--accent)' }}
            >
              + Add team
            </button>
          )}
        </div>

        {showAddTeam && (
          <div className="flex gap-2 mb-3">
            <select
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="flex-1 text-sm rounded px-2 py-1"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            >
              <option value="">Select a team...</option>
              {availableTeams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button
              onClick={handleAddTeam}
              disabled={!selectedTeamId || addTeam.isPending}
              className="text-xs px-3 py-1 rounded disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              {addTeam.isPending ? '...' : 'Add'}
            </button>
            <button
              onClick={() => { setShowAddTeam(false); setSelectedTeamId(''); }}
              className="text-xs px-3 py-1 rounded"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
            >
              Cancel
            </button>
          </div>
        )}

        {teamsLoading ? (
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Loading...</p>
        ) : projectTeams.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>No teams linked yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {projectTeams.map((t) => (
              <li key={t.id} className="flex items-center justify-between text-sm py-1">
                <Link
                  to={`/teams/${t.id}`}
                  className="hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  {t.name}
                </Link>
                {canEdit && (
                  <button
                    onClick={() => removeTeam.mutate(t.id)}
                    disabled={removeTeam.isPending}
                    className="text-xs px-2 py-0.5 rounded opacity-60 hover:opacity-100 disabled:opacity-30"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--color-danger)' }}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
