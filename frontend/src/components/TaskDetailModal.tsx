import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTask, useUpdateTask, useDeleteTask } from '@/hooks/useItemDetails';
import { useAuthStore } from '@/hooks/useAuth';
import type { TaskStatus } from '@/types';

// -- constants ---------------------------------------------------------------

const TASK_STATUS_OPTS: { value: TaskStatus; label: string }[] = [
  { value: 'todo',        label: 'To Do'       },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done',        label: 'Done'        },
  { value: 'cancelled',   label: 'Cancelled'   },
];

const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  todo:        'var(--text-3)',
  in_progress: 'var(--accent)',
  done:        'var(--color-success)',
  cancelled:   'var(--color-danger)',
};

const ESTIMATE_OPTS = ['', '1', '2', '3', '5', '8', '13', '20', '40'];

// -- TaskDetailModal ---------------------------------------------------------

export function TaskDetailModal({
  projectId,
  itemId,
  taskId,
  onClose,
}: {
  projectId: string;
  itemId: string;
  taskId: string;
  onClose: () => void;
}) {
  const user = useAuthStore((s) => s.user);
  const canEdit = !!user;

  const { data: task, isLoading } = useTask(projectId, itemId, taskId);
  const updateTask = useUpdateTask(projectId, itemId);
  const deleteTask = useDeleteTask(projectId, itemId);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');

  // ESC closes this modal first, stops propagation so parent modal keeps open
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKey, true); // capture phase = fires first
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [onClose]);

  function commitTitle() {
    const t = titleDraft.trim();
    if (t && task && t !== task.title) updateTask.mutate({ taskId, title: t });
    setEditingTitle(false);
  }

  function commitDesc() {
    if (task) updateTask.mutate({ taskId, description: descDraft.trim() || undefined });
    setEditingDesc(false);
  }

  function handleDelete() {
    if (!task || !window.confirm('Delete this task?')) return;
    deleteTask.mutate(taskId, { onSuccess: onClose });
  }

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto flex justify-center pt-8 pb-16 px-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full flex-shrink-0 flex flex-col rounded-2xl h-fit"
        style={{ maxWidth: '680px', background: 'var(--bg-active)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-6 py-3 text-xs flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)' }}
        >
          <span className="font-mono" style={{ color: '#60A5FA' }}>Z</span>
          <span style={{ color: 'var(--text-3)' }}>Task</span>
          <div className="ml-auto flex items-center gap-3">
            <Link
              to={`/projects/${projectId}/backlog/${itemId}/tasks/${taskId}`}
              className="text-xs hover:underline"
              style={{ color: 'var(--accent)' }}
              title="Open full page"
            >
              Open &#8599;
            </Link>
            <button onClick={onClose} className="text-sm" style={{ color: 'var(--text-3)' }} title="Close (Esc)">&#10007;</button>
          </div>
        </div>

        <div className="px-6 py-6 flex flex-col gap-5">
          {isLoading && <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading...</p>}
          {!isLoading && !task && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Task not found.</p>}
          {task && (
            <>
              {/* Title */}
              {editingTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitTitle(); }
                    if (e.key === 'Escape') { e.stopPropagation(); setEditingTitle(false); }
                  }}
                  className="w-full text-xl font-semibold rounded px-2 py-1 outline-none"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
                />
              ) : (
                <h2
                  className="text-xl font-semibold italic cursor-pointer rounded px-1 -mx-1 hover:bg-[var(--bg-elevated)] transition-colors"
                  style={{
                    color: 'var(--text-1)',
                    textDecoration: (task.status === 'done' || task.status === 'cancelled') ? 'line-through' : undefined,
                    opacity: task.status === 'cancelled' ? 0.6 : 1,
                  }}
                  onClick={() => { if (canEdit) { setTitleDraft(task.title); setEditingTitle(true); } }}
                  title={canEdit ? 'Click to edit' : undefined}
                >
                  {task.title}
                </h2>
              )}

              {/* Fields */}
              <div className="grid grid-cols-2 gap-4">
                {/* Status */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Status</label>
                  <select
                    value={task.status}
                    disabled={!canEdit}
                    onChange={(e) => updateTask.mutate({ taskId, status: e.target.value as TaskStatus })}
                    className="rounded-lg px-3 py-2 text-sm outline-none"
                    style={{
                      background: 'var(--bg-elevated)',
                      border: `1px solid ${TASK_STATUS_COLOR[task.status]}55`,
                      color: TASK_STATUS_COLOR[task.status],
                    }}
                  >
                    {TASK_STATUS_OPTS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                {/* Estimate */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Estimate (SP)</label>
                  <select
                    value={task.estimate ?? ''}
                    disabled={!canEdit}
                    onChange={(e) => updateTask.mutate({ taskId, estimate: e.target.value || undefined })}
                    className="rounded-lg px-3 py-2 text-sm outline-none"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                  >
                    {ESTIMATE_OPTS.map((o) => <option key={o} value={o}>{o || '-- none --'}</option>)}
                  </select>
                </div>
              </div>

              {/* Description */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Description</label>
                {editingDesc ? (
                  <textarea
                    autoFocus
                    rows={5}
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    onBlur={commitDesc}
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditingDesc(false); } }}
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
                  />
                ) : (
                  <div
                    className="rounded-lg px-3 py-2 text-sm cursor-pointer min-h-[3.5rem] hover:bg-[var(--bg-elevated)] transition-colors"
                    style={{ color: task.description ? 'var(--text-1)' : 'var(--text-3)', border: '1px solid var(--border)', whiteSpace: 'pre-wrap' }}
                    onClick={() => { if (canEdit) { setDescDraft(task.description ?? ''); setEditingDesc(true); } }}
                    title={canEdit ? 'Click to edit description' : undefined}
                  >
                    {task.description ?? 'No description. Click to add.'}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                  Created {new Date(task.created_at).toLocaleDateString()}
                </span>
                {canEdit && (
                  <button
                    onClick={handleDelete}
                    disabled={deleteTask.isPending}
                    className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50"
                    style={{ color: 'var(--color-danger)', border: '1px solid var(--color-danger)' }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
