import { useParams, Link, NavLink, Outlet } from 'react-router-dom';
import { useProject } from '@/hooks/useProjects';
import { useAuthStore } from '@/hooks/useAuth';

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

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading...</p>
        {/* Tab nav rendered even during load so tests / deep links don't 404 */}
        <div className="flex gap-1 mt-4 border-b" style={{ borderColor: 'var(--border)' }}>
          {TABS.map((tab) => (
            <span key={tab.label} data-testid={`project-tab-${tab.label.toLowerCase()}`} className="px-4 py-2 text-sm font-medium text-[var(--text-3)]">
              {tab.label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  const badge = project ? STATUS_BADGE[project.status] : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs mb-4" style={{ color: 'var(--text-3)' }}>
        <Link to="/teams" className="hover:underline" style={{ color: 'var(--accent)' }}>Teams</Link>
        <span>/</span>
        {project?.team_id && (
          <>
            <Link to={`/teams/${project.team_id}/projects`} className="hover:underline" style={{ color: 'var(--accent)' }}>
              Projects
            </Link>
            <span>/</span>
          </>
        )}
        <span style={{ color: 'var(--text-1)' }}>{project?.name ?? '...'}</span>
      </nav>

      {/* Project title + status */}
      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-1)' }}>
          {project?.name}
        </h1>
        {badge && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: badge.color, background: 'var(--bg-elevated)' }}>
            {badge.label}
          </span>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 mb-6 border-b" style={{ borderColor: 'var(--border)' }}>
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

      {/* Routed content */}
      <Outlet />
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
    <div className="flex flex-col gap-6">
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
