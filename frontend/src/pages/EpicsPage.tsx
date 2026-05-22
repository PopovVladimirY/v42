import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useEpics, useCreateEpic, useUpdateEpic, useDeleteEpic } from '@/hooks/useProjects';
import type { Epic, EpicStatus } from '@/types';

const STATUS_OPTS: { value: EpicStatus; label: string; color: string }[] = [
  { value: 'open',        label: 'Open',        color: 'var(--text-2)'        },
  { value: 'in_progress', label: 'In Progress', color: 'var(--accent)'        },
  { value: 'done',        label: 'Done',        color: 'var(--color-success)' },
  { value: 'cancelled',   label: 'Cancelled',   color: 'var(--text-3)'        },
];

function statusColor(status: EpicStatus) {
  return STATUS_OPTS.find((s) => s.value === status)?.color ?? 'var(--text-3)';
}

function statusLabel(status: EpicStatus) {
  return STATUS_OPTS.find((s) => s.value === status)?.label ?? status;
}

// -- Epic card ---------------------------------------------------------------

function EpicCard({
  epic,
  projectId,
}: {
  epic: Epic;
  projectId: string;
}) {
  const updateEpic = useUpdateEpic(projectId);
  const deleteEpic = useDeleteEpic(projectId);
  const [statusOpen, setStatusOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(epic.title);

  function handleStatusChange(status: EpicStatus) {
    setStatusOpen(false);
    if (status !== epic.status) void updateEpic.mutate({ epicId: epic.id, status });
  }

  function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (!editTitle.trim() || editTitle === epic.title) { setEditing(false); return; }
    void updateEpic.mutate({ epicId: epic.id, title: editTitle.trim() });
    setEditing(false);
  }

  function handleDelete() {
    if (!confirm(`Delete epic "${epic.title}"?`)) return;
    void deleteEpic.mutate(epic.id);
  }

  return (
    <div
      data-testid={`epic-card-${epic.id}`}
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <form onSubmit={handleRename} className="flex-1 flex gap-2">
            <input
              data-testid="epic-title-input"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="flex-1 rounded-md px-2 py-1 text-sm outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
              autoFocus
              maxLength={255}
            />
            <button
              type="submit"
              className="px-2 py-1 text-xs font-medium rounded-md"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setEditTitle(epic.title); }}
              className="px-2 py-1 text-xs rounded-md"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
            >
              x
            </button>
          </form>
        ) : (
          <h3
            data-testid="epic-title"
            className="font-semibold text-sm cursor-pointer hover:underline"
            style={{ color: 'var(--text-1)' }}
            onClick={() => setEditing(true)}
          >
            {epic.title}
          </h3>
        )}

        {/* Status dropdown */}
        <div className="relative flex-shrink-0">
          <button
            data-testid={`epic-status-${epic.id}`}
            onClick={() => setStatusOpen((v) => !v)}
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ color: statusColor(epic.status), background: 'var(--bg-elevated)' }}
          >
            {statusLabel(epic.status)}
          </button>
          {statusOpen && (
            <div
              className="absolute right-0 top-full mt-1 rounded-lg overflow-hidden z-30 py-1 min-w-32"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 4px 16px rgba(0,0,0,.2)' }}
            >
              {STATUS_OPTS.map((s) => (
                <button
                  key={s.value}
                  data-testid={`epic-status-opt-${s.value}`}
                  onClick={() => handleStatusChange(s.value)}
                  className="w-full text-left text-xs px-3 py-1.5 hover:bg-[var(--bg-elevated)]"
                  style={{ color: s.color }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {epic.description && (
        <p className="text-xs" style={{ color: 'var(--text-2)' }}>{epic.description}</p>
      )}

      <div className="flex justify-end">
        <button
          data-testid={`delete-epic-${epic.id}`}
          onClick={handleDelete}
          className="text-xs px-2 py-0.5 rounded"
          style={{ color: 'var(--color-danger)', background: 'var(--danger-muted)' }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// -- Create form panel -------------------------------------------------------

function CreateEpicPanel({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const createEpic = useCreateEpic(projectId);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await createEpic.mutateAsync({ title: title.trim(), description: desc.trim() || undefined });
    onClose();
  }

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--accent)' }}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          data-testid="new-epic-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
          placeholder="Epic title"
          className="rounded-md px-3 py-1.5 text-sm outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          autoFocus
          required
        />
        <textarea
          data-testid="new-epic-desc"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Description (optional)"
          className="rounded-md px-3 py-1.5 text-sm outline-none resize-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        />
        {createEpic.isError && (
          <p className="text-xs" style={{ color: 'var(--color-danger)' }}>Failed. Try again.</p>
        )}
        <div className="flex gap-2">
          <button
            data-testid="new-epic-submit"
            type="submit"
            disabled={!title.trim() || createEpic.isPending}
            className="px-3 py-1.5 text-sm font-medium rounded-md disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            {createEpic.isPending ? 'Creating...' : 'Create epic'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// -- Main page ---------------------------------------------------------------

export function EpicsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [showCreate, setShowCreate] = useState(false);
  const { data: epics = [], isLoading, isError } = useEpics(projectId ?? '');

  if (!projectId) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
          {epics.length} epic{epics.length !== 1 ? 's' : ''}
        </span>
        <button
          data-testid="add-epic-btn"
          onClick={() => setShowCreate((v) => !v)}
          className="px-3 py-1.5 text-xs font-medium rounded-md"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          + New epic
        </button>
      </div>

      {showCreate && (
        <CreateEpicPanel projectId={projectId} onClose={() => setShowCreate(false)} />
      )}

      {isLoading && (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading...</p>
      )}
      {isError && (
        <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Failed to load epics.</p>
      )}
      {!isLoading && !isError && epics.length === 0 && (
        <div
          className="rounded-xl p-10 text-center"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>No epics yet.</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2" data-testid="epics-grid">
        {epics.map((ep) => (
          <EpicCard key={ep.id} epic={ep} projectId={projectId} />
        ))}
      </div>
    </div>
  );
}
