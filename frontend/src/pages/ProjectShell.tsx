import { useEffect } from 'react';
import { useParams, Link, NavLink, Outlet } from 'react-router-dom';
import { useProject } from '@/hooks/useProjects';
import { useAuthStore } from '@/hooks/useAuth';
import { setLastProject } from '@/hooks/useLastProject';

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
        {project?.team_id && (
          <>
            <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-3)' }}>/</span>
            <Link to={`/teams/${project.team_id}/projects`} className="text-xs hover:underline flex-shrink-0" style={{ color: 'var(--accent)' }}>Projects</Link>
          </>
        )}
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
  const user = useAuthStore((s) => s.user);
  const canEdit = user?.role === 'admin' || user?.role === 'maintainer';

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
    </div>
  );
}
