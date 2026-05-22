import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useProjects, useCreateProject } from '@/hooks/useProjects';
import { useAuthStore } from '@/hooks/useAuth';
import type { Project } from '@/types';

const STATUS_BADGE: Record<Project['status'], { label: string; color: string; bg: string }> = {
  active:    { label: 'Active',    color: 'var(--color-success)', bg: 'var(--success-muted)' },
  on_hold:   { label: 'On Hold',   color: 'var(--color-warning)', bg: 'var(--warning-muted)' },
  completed: { label: 'Done',      color: 'var(--text-3)',        bg: 'var(--bg-elevated)'   },
  archived:  { label: 'Archived',  color: 'var(--text-3)',        bg: 'var(--bg-elevated)'   },
};

function CreateProjectModal({
  teamId,
  onClose,
}: {
  teamId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const createProject = useCreateProject(teamId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await createProject.mutateAsync({ name: name.trim(), description: desc.trim() || undefined });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-md rounded-xl p-6 flex flex-col gap-4"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
      >
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-1)' }}>New Project</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>
              Project name <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              data-testid="project-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="e.g. Platform v2.0"
              className="w-full rounded-md px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>
              Description
            </label>
            <textarea
              data-testid="project-desc-input"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="What are we building?"
              className="w-full rounded-md px-3 py-2 text-sm outline-none resize-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            />
          </div>
          {createProject.isError && (
            <p className="text-xs" style={{ color: 'var(--color-danger)' }}>
              Failed to create project. Try again.
            </p>
          )}
          <div className="flex gap-2 justify-end mt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-sm rounded-md"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
            >
              Cancel
            </button>
            <button
              data-testid="create-project-submit"
              type="submit"
              disabled={!name.trim() || createProject.isPending}
              className="px-4 py-1.5 text-sm font-medium rounded-md disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              {createProject.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const badge = STATUS_BADGE[project.status];
  return (
    <Link
      to={`/projects/${project.id}`}
      data-testid={`project-card-${project.id}`}
      className="block rounded-xl p-5 transition-colors hover:border-[var(--accent)]"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-2">
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
        <p className="mt-1.5 text-xs line-clamp-2" style={{ color: 'var(--text-2)' }}>
          {project.description}
        </p>
      )}
    </Link>
  );
}

export function ProjectsPage() {
  const { id: teamId } = useParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const [showCreate, setShowCreate] = useState(false);
  const { data: projects = [], isLoading, isError } = useProjects(teamId ?? '');

  const canCreate = user?.role === 'admin' || user?.role === 'maintainer';

  if (!teamId) return null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs mb-6" style={{ color: 'var(--text-3)' }}>
        <Link to="/teams" className="hover:underline" style={{ color: 'var(--accent)' }}>Teams</Link>
        <span>/</span>
        <Link to={`/teams/${teamId}`} className="hover:underline" style={{ color: 'var(--accent)' }}>Team</Link>
        <span>/</span>
        <span>Projects</span>
      </nav>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-1)' }}>Projects</h1>
        {canCreate && (
          <button
            data-testid="new-project-btn"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            + New project
          </button>
        )}
      </div>

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
          {canCreate && (
            <button
              data-testid="new-project-btn-empty"
              onClick={() => setShowCreate(true)}
              className="mt-3 text-sm font-medium"
              style={{ color: 'var(--accent)' }}
            >
              Create the first one &rarr;
            </button>
          )}
        </div>
      )}

      {projects.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateProjectModal teamId={teamId} onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
