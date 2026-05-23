import { Link, useNavigate } from 'react-router-dom';
import { useAllProjects } from '@/hooks/useProjects';
import type { Project } from '@/types';

const STATUS_BADGE: Record<Project['status'], { label: string; color: string; bg: string }> = {
  active:    { label: 'Active',    color: 'var(--color-success)', bg: 'var(--success-muted)' },
  on_hold:   { label: 'On Hold',   color: 'var(--color-warning)', bg: 'var(--warning-muted)' },
  completed: { label: 'Done',      color: 'var(--text-3)',        bg: 'var(--bg-elevated)'   },
  archived:  { label: 'Archived',  color: 'var(--text-3)',        bg: 'var(--bg-elevated)'   },
};

function ProjectCard({ project }: { project: Project }) {
  const badge = STATUS_BADGE[project.status];
  const navigate = useNavigate();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/projects/${project.id}`)}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/projects/${project.id}`)}
      className="block rounded-xl p-4 transition-colors hover:border-[var(--accent)] cursor-pointer"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-semibold text-sm truncate" style={{ color: 'var(--text-1)' }}>
          {project.name}
        </h3>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
          style={{ color: badge.color, background: badge.bg }}
        >
          {badge.label}
        </span>
      </div>
      {project.description && (
        <p className="text-xs line-clamp-2 mb-3" style={{ color: 'var(--text-3)' }}>
          {project.description}
        </p>
      )}
      <div className="flex items-center gap-3 mt-auto">
        <Link
          to={`/projects/${project.id}/backlog`}
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 text-xs transition-colors hover:underline"
          style={{ color: 'var(--text-3)' }}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <rect x="1" y="1" width="10" height="2" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="1" y="5" width="7" height="2" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="1" y="9" width="5" height="2" rx="1" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          Backlog
        </Link>
        <Link
          to={`/projects/${project.id}/sprints`}
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 text-xs transition-colors hover:underline"
          style={{ color: 'var(--text-3)' }}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M2 10 C2 6 4 2 10 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M8 1l2 1-1 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Sprints
        </Link>
      </div>
    </div>
  );
}

export function AllProjectsPage() {
  const { data: projects = [], isLoading, isError } = useAllProjects();

  const active = projects.filter((p) => p.status === 'active');
  const rest = projects.filter((p) => p.status !== 'active');

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <h1 className="text-xl font-semibold mb-6" style={{ color: 'var(--text-1)' }}>
        Projects
      </h1>

      {isLoading && (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading...</p>
      )}
      {isError && (
        <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Failed to load projects.</p>
      )}

      {!isLoading && !isError && projects.length === 0 && (
        <div
          className="rounded-xl p-10 text-center"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>No projects yet.</p>
        </div>
      )}

      {active.length > 0 && (
        <section className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
            Active
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((p) => <ProjectCard key={p.id} project={p} />)}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
            Other
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((p) => <ProjectCard key={p.id} project={p} />)}
          </div>
        </section>
      )}
    </div>
  );
}
