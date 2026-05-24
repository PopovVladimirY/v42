import { useState, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useBacklogItem, useUpdateBacklogItem, useDeleteBacklogItem, useEpics, backlogKeys } from '@/hooks/useProjects';
import { useTasks, useCreateTask, useUpdateTask, useDeleteTask, useItemTests, useCreateItemTest, useDeleteItemTest } from '@/hooks/useItemDetails';
import { useSprints } from '@/hooks/useSprints';
import { sprintsApi } from '@/api/endpoints/sprints';
import { useAuthStore } from '@/hooks/useAuth';
import { CLARITY_COLOR, CLARITY_LABEL, STATUS_COLOR, STATUS_LABEL } from '@/types';
import type { BacklogItemStatus, ClarityQuadrant, Task, TestType } from '@/types';

// ---------------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------------

const STATUS_OPTS: BacklogItemStatus[] = [
  'planned', 'request', 'on_hold', 'open', 'in_progress', 'in_review', 'done', 'cancelled', 'rejected',
];

const TASK_STATUS_OPTS: { value: Task['status']; label: string }[] = [
  { value: 'todo',        label: 'Todo'        },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done',        label: 'Done'        },
  { value: 'cancelled',   label: 'Cancelled'   },
];

const TEST_TYPE_OPTS: { value: TestType; label: string }[] = [
  { value: 'acceptance',  label: 'Acceptance'  },
  { value: 'manual',      label: 'Manual'      },
  { value: 'integration', label: 'Integration' },
  { value: 'unit',        label: 'Unit'        },
];

// ---------------------------------------------------------------------------
//  Skill load bar -- aggregated from task.skill_required
// ---------------------------------------------------------------------------

function SkillLoadBar({ tasks }: { tasks: Task[] }) {
  const counts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const t of tasks) {
      const key = t.skill_required ?? '(unassigned)';
      acc[key] = (acc[key] ?? 0) + 1;
    }
    return Object.entries(acc).sort((a, b) => b[1] - a[1]);
  }, [tasks]);

  if (counts.length === 0) return null;

  const total = tasks.length;
  // Palette: rotate through CSS color vars
  const colors = [
    'var(--accent)',
    'var(--color-info)',
    'var(--color-warning)',
    'var(--color-success)',
    'var(--color-danger)',
  ];

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
        Skill Load Distribution
      </h3>
      {/* Stacked bar */}
      <div className="flex h-3 rounded overflow-hidden gap-px">
        {counts.map(([skill, count], i) => (
          <div
            key={skill}
            title={`${skill}: ${count} task${count > 1 ? 's' : ''}`}
            style={{ width: `${(count / total) * 100}%`, background: colors[i % colors.length] }}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {counts.map(([skill, count], i) => (
          <span key={skill} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-2)' }}>
            <span className="inline-block w-2 h-2 rounded-sm flex-shrink-0" style={{ background: colors[i % colors.length] }} />
            {skill}
            <span className="font-mono" style={{ color: 'var(--text-3)' }}>×{count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Task row
// ---------------------------------------------------------------------------

function TaskRow({
  task,
  projectId,
  itemId,
}: {
  task: Task;
  projectId: string;
  itemId: string;
}) {
  const updateTask = useUpdateTask(projectId, itemId);
  const deleteTask = useDeleteTask(projectId, itemId);
  const [editingSkill, setEditingSkill] = useState(false);
  const [skillDraft, setSkillDraft] = useState(task.skill_required ?? '');

  const isDone = task.status === 'done';
  const statusColor = isDone ? 'var(--color-success)' : task.status === 'in_progress' ? 'var(--accent)' : 'var(--text-3)';

  function cycleStatus() {
    const order: Task['status'][] = ['todo', 'in_progress', 'done', 'cancelled'];
    const next = order[(order.indexOf(task.status) + 1) % order.length];
    void updateTask.mutate({ taskId: task.id, status: next });
  }

  function commitSkill() {
    setEditingSkill(false);
    const val = skillDraft.trim() || undefined;
    if ((val ?? '') !== (task.skill_required ?? '')) {
      void updateTask.mutate({ taskId: task.id, skill_required: val ?? null as unknown as undefined });
    }
  }

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg group text-sm"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      {/* Status toggle */}
      <button
        onClick={cycleStatus}
        className="flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center text-[8px] font-bold"
        style={{ borderColor: statusColor, color: isDone ? '#fff' : 'transparent', background: isDone ? statusColor : 'transparent' }}
        title={`Status: ${task.status} -- click to cycle`}
      >
        {isDone ? '✓' : ''}
      </button>

      {/* Title */}
      <span
        className="flex-1 truncate"
        style={{ color: isDone ? 'var(--text-3)' : 'var(--text-1)', textDecoration: isDone ? 'line-through' : 'none' }}
      >
        {task.title}
      </span>

      {/* Skill chip -- click to edit inline */}
      {editingSkill ? (
        <input
          className="text-xs px-2 py-0.5 rounded w-28 outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
          value={skillDraft}
          autoFocus
          onChange={(e) => setSkillDraft(e.target.value)}
          onBlur={commitSkill}
          onKeyDown={(e) => { if (e.key === 'Enter') commitSkill(); if (e.key === 'Escape') { setEditingSkill(false); setSkillDraft(task.skill_required ?? ''); } }}
          placeholder="skill..."
        />
      ) : (
        <button
          onClick={() => setEditingSkill(true)}
          className="text-xs px-2 py-0.5 rounded flex-shrink-0"
          style={{ background: 'var(--bg-elevated)', color: task.skill_required ? 'var(--color-info)' : 'var(--text-3)' }}
          title="Click to set required skill"
        >
          {task.skill_required ?? '+ skill'}
        </button>
      )}

      {/* Estimate */}
      {task.estimate && (
        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-3)' }}>
          {task.estimate}
        </span>
      )}

      {/* Status label (small) */}
      <span className="text-[10px] flex-shrink-0" style={{ color: statusColor }}>
        {task.status.replace('_', ' ')}
      </span>

      {/* Delete */}
      <button
        onClick={() => void deleteTask.mutate(task.id)}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1 rounded"
        style={{ color: 'var(--color-danger)' }}
        title="Delete task"
      >
        x
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Create task inline form
// ---------------------------------------------------------------------------

function CreateTaskForm({
  projectId,
  itemId,
  onClose,
}: {
  projectId: string;
  itemId: string;
  onClose: () => void;
}) {
  const create = useCreateTask(projectId, itemId);
  const [title, setTitle] = useState('');
  const [skill, setSkill] = useState('');
  const [estimate, setEstimate] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await create.mutateAsync({
      title: title.trim(),
      skill_required: skill.trim() || undefined,
      estimate: estimate.trim() || undefined,
    });
    onClose();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 p-3 rounded-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--accent)' }}>
      <div className="flex gap-2">
        <input
          className="flex-1 text-sm px-3 py-1.5 rounded outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          placeholder="Task title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <input
          className="w-24 text-xs px-2 py-1.5 rounded outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          placeholder="Skill..."
          value={skill}
          onChange={(e) => setSkill(e.target.value)}
        />
        <input
          className="w-16 text-xs px-2 py-1.5 rounded outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          placeholder="Est."
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="text-xs px-3 py-1 rounded" style={{ color: 'var(--text-3)' }}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={create.isPending || !title.trim()}
          className="text-xs px-3 py-1 rounded font-medium"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          {create.isPending ? 'Adding...' : 'Add Task'}
        </button>
      </div>
    </form>
  );
}

const SP_OPTS = ['1', '3', '8', '20', '50'] as const;

// ---------------------------------------------------------------------------
//  Sprint panel -- shows current sprint and allows add/remove/change
// ---------------------------------------------------------------------------

function SprintPanel({
  projectId,
  itemId,
  sprintId,
  sprintName,
}: {
  projectId: string;
  itemId: string;
  sprintId: string | null;
  sprintName: string | null;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: sprints = [] } = useSprints(projectId);
  const actionable = sprints.filter((s) => s.status === 'planning' || s.status === 'active');

  function invalidateBacklog() {
    void qc.invalidateQueries({ queryKey: ['backlog', projectId] });
    void qc.invalidateQueries({ queryKey: backlogKeys.detail(projectId, itemId) });
  }

  const addMutation = useMutation({
    mutationFn: ({ sid }: { sid: string }) => sprintsApi.addItem(projectId, sid, itemId),
    onSuccess: invalidateBacklog,
  });

  const removeMutation = useMutation({
    mutationFn: () => sprintsApi.removeItem(projectId, sprintId!, itemId),
    onSuccess: invalidateBacklog,
  });

  if (sprintId) {
    // Currently in a sprint -- show badge + remove + move-to
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="text-xs px-2 py-1 rounded font-medium"
          style={{ background: 'var(--bg-elevated)', color: 'var(--color-success)', border: '1px solid var(--border)' }}
        >
          {sprintName ?? sprintId}
        </span>
        <button
          onClick={() => void removeMutation.mutate()}
          disabled={removeMutation.isPending}
          className="text-xs px-2 py-1 rounded"
          style={{ color: 'var(--color-danger)', border: '1px solid var(--border)' }}
        >
          {removeMutation.isPending ? '...' : 'Remove'}
        </button>
        {/* Move to another sprint */}
        {actionable.filter((s) => s.id !== sprintId).length > 0 && (
          <div className="relative">
            <button
              onClick={() => setOpen((v) => !v)}
              className="text-xs px-2 py-1 rounded"
              style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
            >
              Move to...
            </button>
            {open && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
                <div
                  className="absolute left-0 top-full mt-1 rounded-lg overflow-hidden z-30 py-1 min-w-40"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
                >
                  {actionable.filter((s) => s.id !== sprintId).map((s) => (
                    <button
                      key={s.id}
                      disabled={addMutation.isPending || removeMutation.isPending}
                      onClick={async () => {
                        setOpen(false);
                        await sprintsApi.removeItem(projectId, sprintId, itemId);
                        await sprintsApi.addItem(projectId, s.id, itemId);
                        invalidateBacklog();
                      }}
                      className="w-full text-left text-xs px-3 py-2 hover:bg-[var(--bg-hover)] disabled:opacity-50"
                      style={{ color: 'var(--text-1)' }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // Not in any sprint -- show picker
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-3 py-1.5 rounded-lg font-medium"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
      >
        + Sprint
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1 rounded-lg overflow-hidden z-30 py-1 min-w-48"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
          >
            {actionable.length === 0 ? (
              <p className="text-xs px-3 py-2" style={{ color: 'var(--text-3)' }}>No planning/active sprints</p>
            ) : (
              actionable.map((s) => (
                <button
                  key={s.id}
                  disabled={addMutation.isPending}
                  onClick={() => { setOpen(false); void addMutation.mutate({ sid: s.id }); }}
                  className="w-full text-left text-xs px-3 py-2 flex items-center gap-2 hover:bg-[var(--bg-hover)] disabled:opacity-50"
                  style={{ color: 'var(--text-1)' }}
                >
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: s.status === 'active' ? 'rgba(16,184,154,.15)' : 'rgba(59,130,246,.15)', color: s.status === 'active' ? 'var(--color-success)' : 'var(--color-info)' }}
                  >
                    {s.status}
                  </span>
                  {s.name}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Main page
// ---------------------------------------------------------------------------

export function BacklogItemDetailPage() {
  const { projectId = '', itemId = '' } = useParams<{ projectId: string; itemId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === 'admin' || user?.role === 'maintainer';

  const { data: item, isLoading, error } = useBacklogItem(projectId, itemId);
  const { data: epics = [] } = useEpics(projectId);
  const { data: tasks = [] } = useTasks(projectId, itemId);
  const { data: tests = [] } = useItemTests(projectId, itemId);

  const updateItem = useUpdateBacklogItem(projectId);
  const deleteItem = useDeleteBacklogItem(projectId);
  const deleteTest = useDeleteItemTest(projectId);

  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateTest, setShowCreateTest] = useState(false);
  const [editDesc, setEditDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading...</p>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="h-full flex items-center justify-center flex-col gap-2">
        <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Item not found.</p>
        <Link to={`/projects/${projectId}/backlog`} className="text-xs hover:underline" style={{ color: 'var(--accent)' }}>
          &larr; Back to backlog
        </Link>
      </div>
    );
  }

  const epic = epics.find((e) => e.id === item.epic_id);
  const statusCol = STATUS_COLOR[item.status] ?? { bg: '#6B7280', fg: '#fff' };

  function startEditDesc() {
    setDescDraft(item.description ?? '');
    setEditDesc(true);
  }

  function commitDesc() {
    setEditDesc(false);
    void updateItem.mutate({ itemId: item.id, description: descDraft });
  }

  async function handleDelete() {
    if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    await deleteItem.mutateAsync(item.id);
    navigate(`/projects/${projectId}/backlog`);
  }

  const tasksDone = tasks.filter((t) => t.status === 'done').length;
  const testsPassing = tests.length; // no run status at this level, just count

  return (
    <div className="px-6 py-4 flex flex-col gap-5">

      {/* ── Header ── */}
      <div className="flex items-start gap-3 flex-wrap">
        <Link
          to={`/projects/${projectId}/backlog`}
          className="text-xs mt-1 flex-shrink-0 hover:underline"
          style={{ color: 'var(--text-3)' }}
        >
          &larr; Backlog
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>
            {item.title}
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs font-mono uppercase" style={{ color: 'var(--text-3)' }}>{item.type}</span>
            {epic && (
              <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--color-info)' }}>
                {epic.title}
              </span>
            )}
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: statusCol.bg, color: statusCol.fg }}
            >
              {STATUS_LABEL[item.status] ?? item.status}
            </span>
            <span
              className="text-xs px-2 py-0.5 rounded font-medium text-white"
              style={{ background: CLARITY_COLOR[item.clarity] }}
            >
              {CLARITY_LABEL[item.clarity]}
            </span>
            {item.estimate && (
              <span className="text-xs font-mono font-semibold" style={{ color: 'var(--accent)' }}>
                {item.estimate} SP
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* SP selector */}
          <select
            data-testid="sp-selector"
            value={item.estimate ?? ''}
            onChange={(e) => void updateItem.mutate({ itemId: item.id, estimate: e.target.value || '' })}
            title="Story points"
            className="text-xs px-2 py-1.5 rounded-lg outline-none"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          >
            <option value="">-- SP</option>
            {SP_OPTS.map((v) => (
              <option key={v} value={v}>{v} SP</option>
            ))}
          </select>
          <SprintPanel projectId={projectId} itemId={itemId} sprintId={item.sprint_id ?? null} sprintName={item.sprint_name ?? null} />
          {canManage && (
            <button
              onClick={() => void handleDelete()}
              className="text-xs px-2 py-1.5 rounded"
              style={{ color: 'var(--color-danger)', border: '1px solid var(--border)' }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* ── Description ── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Description</span>
          {!editDesc && (
            <button onClick={startEditDesc} className="text-xs" style={{ color: 'var(--accent)' }}>Edit</button>
          )}
        </div>
        {editDesc ? (
          <div className="flex flex-col gap-2">
            <textarea
              rows={4}
              className="text-sm px-3 py-2 rounded-lg outline-none resize-y"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
              value={descDraft}
              autoFocus
              onChange={(e) => setDescDraft(e.target.value)}
            />
            <div className="flex gap-2">
              <button onClick={commitDesc} className="text-xs px-3 py-1 rounded font-medium" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Save</button>
              <button onClick={() => setEditDesc(false)} className="text-xs px-3 py-1 rounded" style={{ color: 'var(--text-3)' }}>Cancel</button>
            </div>
          </div>
        ) : (
          <p
            className="text-sm leading-relaxed whitespace-pre-wrap cursor-text"
            style={{ color: item.description ? 'var(--text-1)' : 'var(--text-3)' }}
            onClick={startEditDesc}
          >
            {item.description ?? 'Click to add description...'}
          </p>
        )}
      </section>

      {/* ── Acceptance Criteria (ATDD) ── */}
      {(item.ac_setup || item.ac_steps || item.ac_expected) && (
        <section className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
            Acceptance Criteria (ATDD)
          </span>
          {item.ac_setup && (
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Setup / Given</p>
              <pre className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-1)' }}>{item.ac_setup}</pre>
            </div>
          )}
          {item.ac_steps && (
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Steps / When</p>
              <pre className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-1)' }}>{item.ac_steps}</pre>
            </div>
          )}
          {item.ac_expected && (
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Expected / Then</p>
              <pre className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-1)' }}>{item.ac_expected}</pre>
            </div>
          )}
        </section>
      )}

      {/* ── Skill Load ── */}
      {tasks.length > 0 && (
        <section
          className="rounded-xl p-4"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <SkillLoadBar tasks={tasks} />
          <div className="mt-3 flex gap-4 text-xs" style={{ color: 'var(--text-3)' }}>
            <span>Tasks: <strong style={{ color: 'var(--text-1)' }}>{tasks.length}</strong></span>
            <span>Done: <strong style={{ color: 'var(--color-success)' }}>{tasksDone}</strong></span>
            <span>Open: <strong style={{ color: 'var(--accent)' }}>{tasks.length - tasksDone}</strong></span>
          </div>
        </section>
      )}

      {/* ── Tasks ── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
            Tasks
          </span>
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>{tasksDone}/{tasks.length}</span>
          <button
            onClick={() => setShowCreateTask((v) => !v)}
            className="ml-auto text-xs px-2 py-0.5 rounded"
            style={{ background: 'var(--bg-elevated)', color: 'var(--accent)', border: '1px solid var(--border)' }}
          >
            + Task
          </button>
        </div>
        {showCreateTask && (
          <CreateTaskForm projectId={projectId} itemId={itemId} onClose={() => setShowCreateTask(false)} />
        )}
        {tasks.length === 0 && !showCreateTask && (
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>No tasks yet. Break down the work.</p>
        )}
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} projectId={projectId} itemId={itemId} />
        ))}
      </section>

      {/* ── Tests ── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
            Tests
          </span>
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>{testsPassing}</span>
          <button
            onClick={() => setShowCreateTest((v) => !v)}
            className="ml-auto text-xs px-2 py-0.5 rounded"
            style={{ background: 'var(--bg-elevated)', color: 'var(--accent)', border: '1px solid var(--border)' }}
          >
            + Test
          </button>
        </div>
        {showCreateTest && (
          <CreateTestForm projectId={projectId} itemId={itemId} onClose={() => setShowCreateTest(false)} />
        )}
        {tests.length === 0 && !showCreateTest && (
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>No tests defined yet.</p>
        )}
        {tests.map((t) => (
          <div
            key={t.id}
            className="flex items-start gap-2 px-3 py-2 rounded-lg group text-sm"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
          >
            <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5" style={{ background: 'var(--bg-elevated)', color: 'var(--color-info)' }}>
              {t.type}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: 'var(--text-1)' }}>{t.title}</p>
              {t.steps && (
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>{t.steps}</p>
              )}
            </div>
            <button
              onClick={() => void deleteTest.mutate({ testId: t.id, itemId })}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1 rounded flex-shrink-0"
              style={{ color: 'var(--color-danger)' }}
              title="Delete test"
            >
              x
            </button>
          </div>
        ))}
      </section>

      {/* Bottom padding for scroll comfort */}
      <div className="h-8" />
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Create test inline form
// ---------------------------------------------------------------------------

function CreateTestForm({
  projectId,
  itemId,
  onClose,
}: {
  projectId: string;
  itemId: string;
  onClose: () => void;
}) {
  const create = useCreateItemTest(projectId, itemId);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<TestType>('acceptance');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await create.mutateAsync({
      title: title.trim(),
      type,
      steps: steps.trim() || undefined,
      expected_results: expected.trim() || undefined,
    });
    onClose();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 p-3 rounded-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--accent)' }}>
      <div className="flex gap-2">
        <input
          className="flex-1 text-sm px-3 py-1.5 rounded outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          placeholder="Test title / scenario..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as TestType)}
          className="text-xs px-2 rounded outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        >
          {TEST_TYPE_OPTS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <textarea
        rows={2}
        className="text-xs px-3 py-1.5 rounded outline-none resize-none"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        placeholder="Steps (optional)..."
        value={steps}
        onChange={(e) => setSteps(e.target.value)}
      />
      <textarea
        rows={2}
        className="text-xs px-3 py-1.5 rounded outline-none resize-none"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        placeholder="Expected result (optional)..."
        value={expected}
        onChange={(e) => setExpected(e.target.value)}
      />
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="text-xs px-3 py-1 rounded" style={{ color: 'var(--text-3)' }}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={create.isPending || !title.trim()}
          className="text-xs px-3 py-1 rounded font-medium"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          {create.isPending ? 'Adding...' : 'Add Test'}
        </button>
      </div>
    </form>
  );
}
