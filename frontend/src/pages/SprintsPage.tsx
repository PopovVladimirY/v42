import { useState, useEffect } from 'react';
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
import { usePaginationStore } from '@/stores/usePagination';
import { Paginator } from '@/components/Paginator';

// Format "YYYY-MM-DD" to a readable date string
function fmtDate(d?: string) {
  if (!d) return '--';
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Status badge -- reused in table cell
function SprintStatusBadge({ status }: { status: SprintStatus }) {
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full ${SPRINT_STATUS_COLOR[status]}`}
    >
      {SPRINT_STATUS_LABEL[status]}
    </span>
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

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

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
  const [page, setPage] = useState(1);
  const pageSize = usePaginationStore((s) => s.getPageSize('sprints'));

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this sprint? Items will be returned to backlog.')) return;
    await deleteSprint.mutateAsync(id);
  };

  // Sort: active first, planning second, then the graveyard
  const sorted = [...sprints].sort((a, b) => {
    const order: Record<SprintStatus, number> = { active: 0, planning: 1, completed: 2, cancelled: 3 };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
  });
  const total     = sorted.length;
  const pageItems = sorted.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="px-6 py-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
          {total} sprint{total !== 1 ? 's' : ''}
        </span>
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

      {isLoading && <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading sprints...</p>}

      {!isLoading && (
        <>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full border-collapse" data-testid="sprints-list">
              <thead style={{ background: 'var(--bg-elevated)' }}>
                <tr>
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '7rem' }}>Status</th>
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>Name</th>
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>Goal</th>
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '8rem' }}>Start</th>
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '8rem' }}>End</th>
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '5rem' }} title="Capacity hours">Cap.</th>
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '2rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--text-3)' }}>
                      {total === 0 ? (
                        <>
                          No sprints yet.{' '}
                          {canCreate && (
                            <button onClick={() => setShowModal(true)} className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>Create the first sprint</button>
                          )}
                        </>
                      ) : 'No items on this page.'}
                    </td>
                  </tr>
                )}
                {pageItems.map((s) => (
                  <tr
                    key={s.id}
                    data-testid={`sprint-row-${s.id}`}
                    className="group transition-colors"
                  >
                    <td className="px-3 py-1 align-middle">
                      <SprintStatusBadge status={s.status} />
                    </td>
                    <td className="px-3 py-1 align-middle" style={{ maxWidth: 0 }}>
                      <Link
                        to={`/projects/${projectId}/sprints/${s.id}`}
                        className="block truncate text-sm font-medium hover:underline"
                        style={{ color: 'var(--text-1)' }}
                        title={s.name}
                      >
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-3 py-1 align-middle" style={{ maxWidth: 0 }}>
                      {s.goal && (
                        <span className="block truncate text-xs" style={{ color: 'var(--text-3)' }} title={s.goal}>{s.goal}</span>
                      )}
                    </td>
                    <td className="px-3 py-1 align-middle">
                      <span className="text-xs" style={{ color: 'var(--text-3)' }}>{fmtDate(s.start_date)}</span>
                    </td>
                    <td className="px-3 py-1 align-middle">
                      <span className="text-xs" style={{ color: 'var(--text-3)' }}>{fmtDate(s.end_date)}</span>
                    </td>
                    <td className="px-3 py-1 align-middle">
                      {s.capacity_hours != null && (
                        <span className="text-xs" style={{ color: 'var(--text-3)' }}>{s.capacity_hours}h</span>
                      )}
                    </td>
                    <td className="px-3 py-1 align-middle">
                      {canCreate && (
                        <button
                          data-testid={`delete-sprint-${s.id}`}
                          onClick={() => void handleDelete(s.id)}
                          title="Delete"
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1 py-0.5 rounded"
                          style={{ color: 'var(--color-danger)' }}
                        >
                          x
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginator page={page} pageSize={pageSize} total={total} onChange={setPage} />
        </>
      )}

      {showModal && (
        <CreateSprintModal projectId={projectId} onClose={() => setShowModal(false)} />
      )}
    </div>
  );
}
