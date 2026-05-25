import { useState, Fragment } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTask, useUpdateTask, useDeleteTask } from '@/hooks/useItemDetails';
import { useBacklogItem, useProjectAncestors } from '@/hooks/useProjects';
import { useAuthStore } from '@/hooks/useAuth';
import { CLARITY_LABEL, STATUS_LABEL } from '@/types';
import type { TaskStatus } from '@/types';
import client from '@/api/client';
import type { ApiResponse, Skill } from '@/types';

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

const CLARITY_HEX: Record<string, string> = {
  clear:   '#10B981',
  scoped:  '#FBBF24',
  tacit:   '#F97316',
  foggy:   '#EF4444',
  unknown: '#6B7280',
};

// -- useSkills ---------------------------------------------------------------

function useSkills() {
  return useQuery({
    queryKey: ['skills'],
    queryFn: async () => {
      const res = await client.get<ApiResponse<Skill[]>>('/skills');
      return res.data.data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

// -- TaskDetailPage ----------------------------------------------------------

export function TaskDetailPage() {
  const { projectId = '', itemId = '', taskId = '' } = useParams<{
    projectId: string;
    itemId: string;
    taskId: string;
  }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canEdit = !!user;

  const { data: task, isLoading: loadingTask } = useTask(projectId, itemId, taskId);
  const { data: backlogItem } = useBacklogItem(projectId, itemId);
  const projectChain = useProjectAncestors(projectId);
  const { data: skills = [] } = useSkills();
  const updateTask = useUpdateTask(projectId, itemId);
  const deleteTask = useDeleteTask(projectId, itemId);

  const [titleDraft, setTitleDraft] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);

  if (loadingTask) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading...</p>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Task not found.</p>
      </div>
    );
  }

  const isDone = task.status === 'done';
  const isCancelled = task.status === 'cancelled';

  function commitTitle() {
    const t = titleDraft.trim();
    if (t && t !== task!.title) updateTask.mutate({ taskId, title: t });
    setEditingTitle(false);
  }

  function commitDesc() {
    updateTask.mutate({ taskId, description: descDraft.trim() || undefined });
    setEditingDesc(false);
  }

  function handleDelete() {
    if (!window.confirm('Delete this task?')) return;
    deleteTask.mutate(taskId, {
      onSuccess: () => navigate(`/projects/${projectId}/backlog/${itemId}`),
    });
  }

  const clarityHex = CLARITY_HEX[backlogItem?.clarity ?? 'unknown'] ?? CLARITY_HEX.unknown;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 flex flex-col gap-6">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-3)' }}>
          <Link to="/projects" className="hover:underline" style={{ color: 'var(--text-3)' }}>Projects</Link>
          {projectChain.map((p) => (
            <Fragment key={p.id}>
              <span>/</span>
              <Link to={`/projects/${p.id}`} className="hover:underline" style={{ color: 'var(--text-3)' }}>{p.name}</Link>
            </Fragment>
          ))}
          <span>/</span>
          <Link to={`/projects/${projectId}/backlog`} className="hover:underline">Backlog</Link>
          <span>/</span>
          <Link to={`/projects/${projectId}/backlog/${itemId}`} className="hover:underline">
            B-{backlogItem?.number ?? '?'}{backlogItem?.title ? ` — ${backlogItem.title}` : ''}
          </Link>
          <span>/</span>
          <span style={{ color: 'var(--text-1)' }}>Task</span>
        </nav>

        {/* Title */}
        <div>
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitTitle(); }
                if (e.key === 'Escape') setEditingTitle(false);
              }}
              className="w-full text-xl font-semibold rounded px-2 py-1 outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
            />
          ) : (
            <h1
              className="text-xl font-semibold cursor-pointer rounded px-1 -mx-1 hover:bg-[var(--bg-elevated)] transition-colors"
              style={{
                color: 'var(--text-1)',
                textDecoration: isDone ? 'line-through' : isCancelled ? 'line-through' : undefined,
                opacity: isCancelled ? 0.6 : 1,
              }}
              onClick={() => { if (canEdit) { setTitleDraft(task.title); setEditingTitle(true); } }}
              title={canEdit ? 'Click to edit' : undefined}
            >
              {task.title}
            </h1>
          )}
        </div>

        {/* Parent item clarity context */}
        {backlogItem && (
          <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-3)' }}>
            <span>Parent clarity:</span>
            <span
              className="px-2 py-0.5 rounded font-medium"
              style={{ background: clarityHex + '22', color: clarityHex, border: `1px solid ${clarityHex}55` }}
            >
              {CLARITY_LABEL[backlogItem.clarity] ?? backlogItem.clarity}
            </span>
            <span>{STATUS_LABEL[backlogItem.status] ?? backlogItem.status}</span>
          </div>
        )}

        {/* Fields grid */}
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

          {/* Skill required */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Skill Required</label>
            <select
              value={task.skill_required ?? ''}
              disabled={!canEdit}
              onChange={(e) => updateTask.mutate({ taskId, skill_required: e.target.value || null as unknown as undefined })}
              className="rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            >
              <option value="">-- none --</option>
              {skills.filter((s) => !s.is_hidden).map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Reviewer (read-only info) */}
          {task.reviewer_id && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Reviewer</label>
              <p className="text-sm px-3 py-2" style={{ color: 'var(--text-2)' }}>
                {task.reviewer_id}
              </p>
            </div>
          )}
        </div>

        {/* Description */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Description</label>
          {editingDesc ? (
            <textarea
              autoFocus
              rows={6}
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={commitDesc}
              onKeyDown={(e) => { if (e.key === 'Escape') { setEditingDesc(false); } }}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
            />
          ) : (
            <div
              className="rounded-lg px-3 py-2 text-sm cursor-pointer min-h-[4rem] hover:bg-[var(--bg-elevated)] transition-colors"
              style={{ color: task.description ? 'var(--text-1)' : 'var(--text-3)', border: '1px solid var(--border)', whiteSpace: 'pre-wrap' }}
              onClick={() => { if (canEdit) { setDescDraft(task.description ?? ''); setEditingDesc(true); } }}
              title={canEdit ? 'Click to edit description' : undefined}
            >
              {task.description ?? 'No description. Click to add.'}
            </div>
          )}
        </div>

        {/* Danger zone */}
        {canEdit && (
          <div className="flex items-center justify-between pt-4" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              Created {new Date(task.created_at).toLocaleDateString()}
            </span>
            <button
              onClick={handleDelete}
              disabled={deleteTask.isPending}
              className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50"
              style={{ color: 'var(--color-danger)', border: '1px solid var(--color-danger)' }}
            >
              Delete Task
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default TaskDetailPage;
