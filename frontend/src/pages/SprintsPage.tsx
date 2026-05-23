import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  useSprints,
  useCreateSprint,
  useDeleteSprint,
  SPRINT_STATUS_LABEL,
  SPRINT_STATUS_COLOR,
} from '@/hooks/useSprints';
import type { SprintStatus } from '@/api/endpoints/sprints';
import { useAuthStore } from '@/hooks/useAuth';

// Format "YYYY-MM-DD" to a readable date string
function fmtDate(d?: string) {
  if (!d) return '--';
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Fancy status badge for sprint -- colors pulled from the abyss
function SprintStatusBadge({ status }: { status: SprintStatus }) {
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full ${SPRINT_STATUS_COLOR[status]}`}
    >
      {SPRINT_STATUS_LABEL[status]}
    </span>
  );
}

// Quick card for a single sprint in the list view
function SprintCard({
  sprint,
  projectId,
  canDelete,
  onDelete,
}: {
  sprint: { id: string; name: string; status: SprintStatus; start_date?: string; end_date?: string; goal?: string; capacity_hours?: number };
  projectId: string;
  canDelete: boolean;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      data-testid={`sprint-card-${sprint.id}`}
      className="rounded-xl p-5 flex flex-col gap-3"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <Link
            to={`/projects/${projectId}/sprints/${sprint.id}`}
            className="text-sm font-medium hover:underline truncate"
            style={{ color: 'var(--text-1)' }}
          >
            {sprint.name}
          </Link>
          {sprint.goal && (
            <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>{sprint.goal}</p>
          )}
        </div>
        <SprintStatusBadge status={sprint.status} />
      </div>

      <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-3)' }}>
        <span>{fmtDate(sprint.start_date)} &rarr; {fmtDate(sprint.end_date)}</span>
        {sprint.capacity_hours != null && (
          <span>{sprint.capacity_hours}h capacity</span>
        )}
      </div>

      <div className="flex items-center justify-between">
        <Link
          to={`/projects/${projectId}/sprints/${sprint.id}`}
          className="text-xs font-medium hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          Open board &rarr;
        </Link>
        {canDelete && (
          <button
            data-testid={`delete-sprint-${sprint.id}`}
            onClick={() => onDelete(sprint.id)}
            className="text-xs hover:opacity-80"
            style={{ color: 'var(--color-danger)' }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// Modal for creating a new sprint -- minimum viable, no drama
function CreateSprintModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [capacity, setCapacity] = useState('');
  const create = useCreateSprint(projectId);

  const submit = async () => {
    if (!name.trim()) return;
    await create.mutateAsync({
      name: name.trim(),
      goal: goal.trim() || undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      capacity_hours: capacity ? parseInt(capacity, 10) : undefined,
    });
    onClose();
  };

  const inputCls = 'w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--accent)]';
  const inputStyle = { background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-1)' };
  const labelCls = 'text-xs font-medium mb-1 block';
  const labelStyle = { color: 'var(--text-2)' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="w-full max-w-md rounded-2xl p-6 flex flex-col gap-4"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
      >
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-1)' }}>
          New Sprint
        </h2>

        <div>
          <label className={labelCls} style={labelStyle}>Name *</label>
          <input
            data-testid="sprint-name-input"
            className={inputCls}
            style={inputStyle}
            placeholder="Sprint 1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className={labelCls} style={labelStyle}>Goal</label>
          <input
            data-testid="sprint-goal-input"
            className={inputCls}
            style={inputStyle}
            placeholder="Deliver feature X"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} style={labelStyle}>Start date</label>
            <input
              data-testid="sprint-start-date"
              type="date"
              className={inputCls}
              style={inputStyle}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls} style={labelStyle}>End date</label>
            <input
              data-testid="sprint-end-date"
              type="date"
              className={inputCls}
              style={inputStyle}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className={labelCls} style={labelStyle}>Capacity (hours)</label>
          <input
            data-testid="sprint-capacity"
            type="number"
            min="0"
            className={inputCls}
            style={inputStyle}
            placeholder="80"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ color: 'var(--text-2)', background: 'var(--bg-hover)' }}
          >
            Cancel
          </button>
          <button
            data-testid="create-sprint-submit"
            onClick={submit}
            disabled={!name.trim() || create.isPending}
            className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            {create.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Main sprints list page -- your sprints, captain
export function SprintsPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const { data: sprints = [], isLoading } = useSprints(projectId);
  const deleteSprint = useDeleteSprint(projectId);
  const user = useAuthStore((s) => s.user);
  const canCreate = user?.role === 'admin' || user?.role === 'maintainer';
  const [showModal, setShowModal] = useState(false);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this sprint? Items will be returned to backlog.')) return;
    await deleteSprint.mutateAsync(id);
  };

  const active = sprints.filter((s) => s.status === 'active');
  const planning = sprints.filter((s) => s.status === 'planning');
  const done = sprints.filter((s) => s.status === 'completed' || s.status === 'cancelled');

  return (
    <div className="h-full overflow-y-auto px-6 py-4 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-1)' }}>Sprints</h2>
        {canCreate && (
          <button
            data-testid="new-sprint-btn"
            onClick={() => setShowModal(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium hover:opacity-80"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            + New Sprint
          </button>
        )}
      </div>

      {isLoading && (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading sprints...</p>
      )}

      {!isLoading && sprints.length === 0 && (
        <div
          className="rounded-xl p-8 text-center"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>No sprints yet.</p>
          {canCreate && (
            <button
              onClick={() => setShowModal(true)}
              className="mt-3 text-sm font-medium hover:underline"
              style={{ color: 'var(--accent)' }}
            >
              Create the first sprint
            </button>
          )}
        </div>
      )}

      {/* Active sprints -- starring role */}
      {active.length > 0 && (
        <section>
          <p className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
            Active
          </p>
          <div className="flex flex-col gap-3" data-testid="sprints-active">
            {active.map((s) => (
              <SprintCard
                key={s.id}
                sprint={s}
                projectId={projectId}
                canDelete={canCreate}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </section>
      )}

      {/* Planning -- next up */}
      {planning.length > 0 && (
        <section>
          <p className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
            Planning
          </p>
          <div className="flex flex-col gap-3" data-testid="sprints-planning">
            {planning.map((s) => (
              <SprintCard
                key={s.id}
                sprint={s}
                projectId={projectId}
                canDelete={canCreate}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </section>
      )}

      {/* Done & cancelled -- history lives here */}
      {done.length > 0 && (
        <section>
          <p className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
            Completed / Cancelled
          </p>
          <div className="flex flex-col gap-3" data-testid="sprints-done">
            {done.map((s) => (
              <SprintCard
                key={s.id}
                sprint={s}
                projectId={projectId}
                canDelete={canCreate}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </section>
      )}

      {showModal && (
        <CreateSprintModal projectId={projectId} onClose={() => setShowModal(false)} />
      )}
    </div>
  );
}
