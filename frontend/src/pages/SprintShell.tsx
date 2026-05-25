import { useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useNavigate, useParams } from 'react-router-dom';
import {
  useSprint,
  useSprints,
  useUpdateSprint,
  useCloseSprint,
  SPRINT_STATUS_LABEL,
  SPRINT_STATUS_COLOR,
} from '@/hooks/useSprints';
import { useAuthStore } from '@/hooks/useAuth';
import type { Sprint, SprintStatus } from '@/api/endpoints/sprints';

const TABS = [
  { to: 'board',    label: 'Board'         },
  { to: 'backlog',  label: 'Backlog'       },
  { to: 'tests',    label: 'Tests'         },
  { to: 'capacity', label: 'Capacity'      },
  { to: 'retro',    label: 'Retrospective' },
];

function SprintStatusSelect({
  projectId,
  sprintId,
  current,
}: {
  projectId: string;
  sprintId: string;
  current: SprintStatus;
}) {
  const update = useUpdateSprint(projectId, sprintId);
  const statuses: SprintStatus[] = ['planning', 'active', 'completed', 'cancelled'];
  return (
    <select
      data-testid="sprint-status-select"
      value={current}
      onChange={(e) => update.mutate({ status: e.target.value as SprintStatus })}
      className="text-xs rounded-lg px-2 py-1 cursor-pointer"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
    >
      {statuses.map((s) => (
        <option key={s} value={s}>{SPRINT_STATUS_LABEL[s]}</option>
      ))}
    </select>
  );
}

// -- CloseSprintModal --------------------------------------------------------

function CloseSprintModal({
  projectId,
  sprintId,
  onCancel,
}: {
  projectId: string;
  sprintId: string;
  onCancel: () => void;
}) {
  const navigate = useNavigate();
  const { data: allSprints = [] } = useSprints(projectId);
  const closeSprint = useCloseSprint(projectId, sprintId);
  const [targetId, setTargetId] = useState('');

  const targets = allSprints.filter(
    (s: Sprint) => s.id !== sprintId && s.status !== 'completed' && s.status !== 'cancelled'
  );

  function handleClose() {
    closeSprint.mutate(targetId || undefined, {
      onSuccess: () => {
        onCancel();
        navigate(`/projects/${projectId}/sprints/${sprintId}/retro`);
      },
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onCancel}
    >
      <div
        className="rounded-xl p-6 w-96 flex flex-col gap-4"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,.4)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-1)' }}>Close Sprint</h2>
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>
          All unfinished items (not&nbsp;<em>done</em> or&nbsp;<em>cancelled</em>) will move to the selected sprint.
        </p>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Carry unfinished items to</label>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          >
            <option value="">No sprint (leave unscheduled)</option>
            {targets.map((s: Sprint) => (
              <option key={s.id} value={s.id}>
                {s.name} ({SPRINT_STATUS_LABEL[s.status]})
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-3 justify-end mt-2">
          <button
            onClick={onCancel}
            className="text-sm px-4 py-1.5 rounded-lg"
            style={{ color: 'var(--text-2)', border: '1px solid var(--border)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleClose}
            disabled={closeSprint.isPending}
            className="text-sm px-4 py-1.5 rounded-lg font-medium disabled:opacity-50"
            style={{ background: 'var(--color-danger)', color: '#fff' }}
          >
            {closeSprint.isPending ? 'Closing...' : 'Close Sprint'}
          </button>
        </div>
        {closeSprint.isError && (
          <p className="text-xs" style={{ color: 'var(--color-danger)' }}>Failed to close sprint. Please try again.</p>
        )}
      </div>
    </div>
  );
}

// Persistent sprint layout: compact header + tab bar + routed child content.
export function SprintShell() {
  const { projectId = '', sprintId = '' } = useParams<{ projectId: string; sprintId: string }>();
  const { data: sprint, isLoading } = useSprint(projectId, sprintId);
  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === 'admin' || user?.role === 'maintainer';
  const [closeModalOpen, setCloseModalOpen] = useState(false);

  const baseUrl = `/projects/${projectId}/sprints/${sprintId}`;

  if (isLoading) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-shrink-0 flex items-center gap-3 px-4 border-b" style={{ height: 44, borderColor: 'var(--border)' }}>
          <div className="h-4 w-32 rounded animate-pulse" style={{ background: 'var(--bg-surface)' }} />
        </div>
        <div className="flex-shrink-0 flex border-b px-4" style={{ borderColor: 'var(--border)' }}>
          {TABS.map((tab) => (
            <span key={tab.to} className="px-4 py-2 text-sm font-medium" style={{ color: 'var(--text-3)' }}>
              {tab.label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (!sprint) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Sprint not found.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden min-h-0" data-testid="sprint-shell">
      {/* Compact header strip */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 border-b"
        style={{ height: 44, borderColor: 'var(--border)' }}
      >
        <Link
          to={`/projects/${projectId}/sprints`}
          className="text-xs hover:underline flex-shrink-0 flex items-center gap-1"
          style={{ color: 'var(--text-3)' }}
        >
          &larr; Sprints
        </Link>
        <span className="flex-shrink-0" style={{ color: 'var(--border)' }}>|</span>
        <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
          {sprint.name}
        </span>
        {sprint.goal && (
          <span className="text-xs truncate hidden sm:block" style={{ color: 'var(--text-3)', maxWidth: '20rem' }}>
            {sprint.goal}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3 flex-shrink-0">
          {sprint.start_date && sprint.end_date && (
            <span className="text-xs hidden md:block" style={{ color: 'var(--text-3)' }}>
              {sprint.start_date} &rarr; {sprint.end_date}
            </span>
          )}
          {/* Show badge only for read-only users; admins see the select which already shows current status */}
          {!canManage && (
            <span
              data-testid="sprint-status-badge"
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${SPRINT_STATUS_COLOR[sprint.status]}`}
            >
              {SPRINT_STATUS_LABEL[sprint.status]}
            </span>
          )}
          {canManage && (
            <SprintStatusSelect projectId={projectId} sprintId={sprintId} current={sprint.status} />
          )}
          {canManage && sprint.status === 'active' && (
            <button
              onClick={() => setCloseModalOpen(true)}
              className="text-xs px-3 py-1 rounded-lg font-medium"
              style={{ background: 'var(--color-danger)', color: '#fff', opacity: 0.85 }}
            >
              Close Sprint
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex-shrink-0 flex border-b px-2" style={{ borderColor: 'var(--border)' }}>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={`${baseUrl}/${tab.to}`}
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

      {/* Routed tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Outlet />
      </div>

      {closeModalOpen && (
        <CloseSprintModal
          projectId={projectId}
          sprintId={sprintId}
          onCancel={() => setCloseModalOpen(false)}
        />
      )}
    </div>
  );
}

// Default export so router can also do lazy imports if needed.
export default SprintShell;

// Redirect bare sprint URL to board tab.
export function SprintRedirect() {
  const { projectId = '', sprintId = '' } = useParams<{ projectId: string; sprintId: string }>();
  return <Navigate to={`/projects/${projectId}/sprints/${sprintId}/board`} replace />;
}
