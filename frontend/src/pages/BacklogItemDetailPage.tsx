import { useState, useMemo, Fragment, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useBacklogItem, useUpdateBacklogItem, useDeleteBacklogItem, useProjectAncestors, backlogKeys } from '@/hooks/useProjects';
import { useTasks, useCreateTask, useUpdateTask, useDeleteTask, useItemTests, useCreateItemTest, useDeleteItemTest } from '@/hooks/useItemDetails';
import { useSprints } from '@/hooks/useSprints';
import { sprintsApi } from '@/api/endpoints/sprints';
import { projectsApi } from '@/api/endpoints/projects';
import { usersApi } from '@/api/endpoints/users';
import { useAuthStore } from '@/hooks/useAuth';
import { CLARITY_COLOR, CLARITY_LABEL, STATUS_COLOR, STATUS_LABEL } from '@/types';
import type { BacklogItemStatus, Project, Task, TestType } from '@/types';
import { BreakdownModal } from './BreakdownModal';

// ---------------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------------


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

      {/* Open detail */}
      <Link
        to={`/projects/${projectId}/backlog/${itemId}/tasks/${task.id}`}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1 rounded flex-shrink-0"
        style={{ color: 'var(--accent)' }}
        title="Open task details"
      >
        &rarr;
      </Link>

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
//  Markdown builder -- formats all loaded data into a prompt-ready .md block
// ---------------------------------------------------------------------------

function buildMarkdown(
  item: import('@/types').BacklogItem,
  tasks: import('@/types').Task[],
  tests: import('@/types').TestSpec[],
): string {
  const check = (done: boolean) => (done ? '[x]' : '[ ]');
  const lines: string[] = [];

  lines.push(`# B-${item.number}: ${item.title}`);
  lines.push('');
  lines.push(
    `**Type:** ${item.type} | **Status:** ${STATUS_LABEL[item.status]} | **Clarity:** ${CLARITY_LABEL[item.clarity]} | **Complexity:** ${item.estimate ?? '--'}`,
  );
  if (item.sprint_name) lines.push(`**Sprint:** ${item.sprint_name}`);
  lines.push('');

  if (item.description) {
    lines.push('## Description');
    lines.push('');
    lines.push(item.description);
    lines.push('');
  }

  if (item.ac_setup || item.ac_steps || item.ac_expected) {
    lines.push('## Acceptance Criteria');
    lines.push('');
    if (item.ac_setup)    { lines.push('### Given (Setup)');    lines.push(''); lines.push(item.ac_setup);    lines.push(''); }
    if (item.ac_steps)    { lines.push('### When (Steps)');     lines.push(''); lines.push(item.ac_steps);    lines.push(''); }
    if (item.ac_expected) { lines.push('### Then (Expected)');  lines.push(''); lines.push(item.ac_expected); lines.push(''); }
  }

  if (tasks.length > 0) {
    lines.push('## Tasks');
    lines.push('');
    for (const t of tasks) {
      const skill = t.skill_required ? ` *(${t.skill_required})*` : '';
      const est   = t.estimate       ? ` [${t.estimate}]`          : '';
      lines.push(`- ${check(t.status === 'done')} ${t.title}${skill}${est}`);
    }
    lines.push('');
  }

  if (tests.length > 0) {
    lines.push('## Tests');
    lines.push('');
    for (const t of tests) {
      lines.push(`- [ ] **[${t.type}]** ${t.title}`);
      if (t.steps)            lines.push(`  - Steps: ${t.steps}`);
      if (t.expected_results) lines.push(`  - Expected: ${t.expected_results}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Exported from V42 on ${new Date().toISOString().slice(0, 10)}*`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
//  Export menu -- copy to clipboard or download .md file
// ---------------------------------------------------------------------------

function ExportMenu({
  item,
  tasks,
  tests,
}: {
  item: import('@/types').BacklogItem;
  tasks: import('@/types').Task[];
  tests: import('@/types').TestSpec[];
}) {
  const [open, setOpen]     = useState(false);
  const [copied, setCopied] = useState(false);

  function getMd() { return buildMarkdown(item, tasks, tests); }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(getMd());
    } catch {
      // fallback for non-secure contexts
      const el = document.createElement('textarea');
      el.value = getMd();
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setOpen(false);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    const md   = getMd();
    const slug = item.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `B-${item.number}-${slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-2 py-1.5 rounded flex items-center gap-1.5"
        style={{
          color: copied ? 'var(--color-success)' : 'var(--text-2)',
          border: `1px solid ${copied ? 'var(--color-success)' : 'var(--border)'}`,
        }}
        title="Export as Markdown"
      >
        {copied ? 'Copied!' : 'MD'}
        {!copied && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.5 }}>
            <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1 rounded-lg overflow-hidden z-30 py-1 min-w-44"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
          >
            <button
              onClick={() => void handleCopy()}
              className="w-full text-left text-xs px-3 py-2 hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-1)' }}
            >
              Copy to clipboard
            </button>
            <button
              onClick={handleDownload}
              className="w-full text-left text-xs px-3 py-2 hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-1)' }}
            >
              Download .md file
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const STATUS_OPTS: { value: BacklogItemStatus; label: string }[] = [
  { value: 'planned',     label: 'Planned'     },
  { value: 'request',     label: 'Request'     },
  { value: 'open',        label: 'To Do'       },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review',   label: 'In Review'   },
  { value: 'on_hold',     label: 'On Hold'     },
  { value: 'done',        label: 'Done'        },
  { value: 'cancelled',   label: 'Cancelled'   },
  { value: 'rejected',    label: 'Rejected'    },
];

// ---------------------------------------------------------------------------
//  Stage picker -- project subtree dropdown
// ---------------------------------------------------------------------------

interface StageOpt { id: string; name: string; depth: number; }

function buildStageOpts(nodes: Project[]): StageOpt[] {
  const byParent = new Map<string | null, Project[]>();
  for (const n of nodes) {
    const key = n.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(n);
  }
  for (const ch of byParent.values())
    ch.sort((a, b) => a.order_index - b.order_index || a.node_number - b.node_number);
  const result: StageOpt[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const n of byParent.get(parentId) ?? []) {
      result.push({ id: n.id, name: n.name, depth });
      walk(n.id, depth + 1);
    }
  }
  walk(null, 0);
  return result;
}

function StagePicker({
  projectId,
  itemId,
  stageId,
}: {
  projectId: string;
  itemId: string;
  stageId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const updateItem = useUpdateBacklogItem(projectId);

  const { data: stageNodes = [] } = useQuery({
    queryKey: ['project-tree', projectId, false],
    queryFn: async () => {
      const { data } = await projectsApi.getTree(projectId, false);
      return data.data ?? [];
    },
  });

  const opts = useMemo(() => buildStageOpts(stageNodes), [stageNodes]);
  const stageName = stageNodes.find(n => n.id === stageId)?.name ?? null;

  function handlePick(newId: string | null) {
    setOpen(false);
    void updateItem.mutate({ itemId, node_id: newId });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: stageName ? 'var(--text-1)' : 'var(--text-3)' }}
      >
        {stageName ?? 'Stage...'}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.5 }}>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1 rounded-lg overflow-hidden z-30 py-1 min-w-48"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
          >
            <button
              onClick={() => handlePick(null)}
              className="w-full text-left text-xs px-3 py-2 hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-3)' }}
            >
              No stage
            </button>
            {opts.map(({ id, name, depth }) => (
              <button
                key={id}
                onClick={() => handlePick(id)}
                className="w-full text-left text-xs py-2 hover:bg-[var(--bg-hover)] flex items-center gap-1"
                style={{ paddingLeft: `${12 + depth * 16}px`, color: id === stageId ? 'var(--accent)' : 'var(--text-1)' }}
              >
                {depth > 0 && <span style={{ color: 'var(--text-3)', fontSize: 11, flexShrink: 0 }}>{'\u2514'}</span>}
                {name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Assignee picker -- dropdown of all active users
// ---------------------------------------------------------------------------

function AssigneePicker({
  projectId,
  itemId,
  assigneeId,
}: {
  projectId: string;
  itemId: string;
  assigneeId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const updateItem = useUpdateBacklogItem(projectId);
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
    staleTime: 5 * 60_000,
  });

  const current = users.find((u) => u.id === assigneeId);
  const displayName = current ? (current.display_name || current.full_name) : null;

  function handlePick(uid: string) {
    setOpen(false);
    if (uid !== assigneeId) void updateItem.mutate({ itemId, assignee_id: uid });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: displayName ? 'var(--text-1)' : 'var(--text-3)' }}
      >
        {displayName ?? 'Assignee...'}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.5 }}>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-full mt-1 rounded-lg overflow-hidden z-30 py-1 min-w-48"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
          >
            {users.filter((u) => u.is_active).map((u) => (
              <button
                key={u.id}
                onClick={() => handlePick(u.id)}
                className="w-full text-left text-xs px-3 py-2 flex items-center gap-2 hover:bg-[var(--bg-hover)]"
                style={{ color: u.id === assigneeId ? 'var(--accent)' : 'var(--text-1)' }}
              >
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                  style={{ background: 'var(--bg-surface)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
                >
                  {(u.display_name || u.full_name).charAt(0).toUpperCase()}
                </span>
                {u.display_name || u.full_name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

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

  async function handlePick(sid: string | null) {
    setOpen(false);
    if (sid === sprintId) return;
    if (sprintId) await sprintsApi.removeItem(projectId, sprintId, itemId);
    if (sid)     await sprintsApi.addItem(projectId, sid, itemId);
    invalidateBacklog();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: sprintName ? 'var(--text-1)' : 'var(--text-3)' }}
      >
        {sprintName ?? 'Sprint...'}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.5 }}>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-full mt-1 rounded-lg overflow-hidden z-30 py-1 min-w-48"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
          >
            <button
              onClick={() => void handlePick(null)}
              className="w-full text-left text-xs px-3 py-2 hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-3)' }}
            >
              No sprint
            </button>
            {actionable.length === 0 ? (
              <p className="text-xs px-3 py-2" style={{ color: 'var(--text-3)' }}>No planning/active sprints</p>
            ) : (
              actionable.map((s) => (
                <button
                  key={s.id}
                  onClick={() => void handlePick(s.id)}
                  className="w-full text-left text-xs px-3 py-2 flex items-center gap-2 hover:bg-[var(--bg-hover)]"
                  style={{ color: s.id === sprintId ? 'var(--accent)' : 'var(--text-1)' }}
                >
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
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

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') navigate(-1); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [navigate]);

  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === 'admin' || user?.role === 'maintainer';

  const projectChain = useProjectAncestors(projectId);
  const { data: item, isLoading, error } = useBacklogItem(projectId, itemId);
  const { data: tasks = [] } = useTasks(projectId, itemId);
  const { data: tests = [] } = useItemTests(projectId, itemId);

  const updateItem = useUpdateBacklogItem(projectId);
  const deleteItem = useDeleteBacklogItem(projectId);
  const deleteTest = useDeleteItemTest(projectId);

  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateTest, setShowCreateTest] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [editDesc, setEditDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [editAC, setEditAC] = useState(false);
  const [acSetupDraft, setAcSetupDraft] = useState('');
  const [acStepsDraft, setAcStepsDraft] = useState('');
  const [acExpectedDraft, setAcExpectedDraft] = useState('');

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

  const tasksDone = tasks.filter((t) => t.status === 'done').length;
  const testsPassing = tests.length; // no run status at this level, just count

  function startEditDesc() {
    setDescDraft(item!.description ?? '');
    setEditDesc(true);
  }

  function commitDesc() {
    setEditDesc(false);
    void updateItem.mutate({ itemId: item!.id, description: descDraft });
  }

  function startEditAC() {
    setAcSetupDraft(item!.ac_setup ?? '');
    setAcStepsDraft(item!.ac_steps ?? '');
    setAcExpectedDraft(item!.ac_expected ?? '');
    setEditAC(true);
  }

  function commitAC() {
    setEditAC(false);
    void updateItem.mutate({
      itemId: item!.id,
      ac_setup: acSetupDraft,
      ac_steps: acStepsDraft,
      ac_expected: acExpectedDraft,
    });
  }

  async function handleDelete() {
    if (!confirm(`Delete "${item!.title}"? This cannot be undone.`)) return;
    await deleteItem.mutateAsync(item!.id);
    navigate(`/projects/${projectId}/backlog`);
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto flex justify-center pt-8 pb-16 px-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) navigate(-1); }}
    >
      <div
        className="w-full flex-shrink-0 flex flex-col rounded-2xl h-fit"
        style={{ maxWidth: '960px', background: 'var(--bg-active)', border: '1px solid var(--border)' }}
      >
        {/* Modal header */}
        <div className="flex items-center gap-1.5 px-6 py-3 text-xs flex-shrink-0 flex-wrap" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)' }}>
          <Link to="/projects" className="hover:underline">Projects</Link>
          {projectChain.map((p) => (
            <Fragment key={p.id}>
              <span>/</span>
              <Link to={`/projects/${p.id}`} className="hover:underline">{p.name}</Link>
            </Fragment>
          ))}
          <span>/</span>
          <Link to={`/projects/${projectId}/backlog`} className="hover:underline">Backlog</Link>
          <span>/</span>
          <span style={{ color: 'var(--text-1)' }}>B-{item.number}</span>
          <button onClick={() => navigate(-1)} className="ml-auto text-sm" style={{ color: 'var(--text-3)' }} title="Close">&#10007;</button>
        </div>

      <div className="px-6 py-4 flex flex-col gap-5">

      {/* ── Header ── */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>
            {item.title}
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span
              className="text-xs px-2 py-0.5 rounded font-medium text-white"
              style={{ background: CLARITY_COLOR[item.clarity] }}
            >
              {CLARITY_LABEL[item.clarity]}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <ExportMenu item={item} tasks={tasks} tests={tests} />
          {canManage && (
            <>
              <button
                onClick={() => setShowBreakdown(true)}
                className="text-xs px-2 py-1.5 rounded"
                style={{ color: 'var(--accent)', border: '1px solid var(--accent)' }}
                title="Break this item into child items (Life Tree)"
              >
                Break down
              </button>
              <button
                onClick={() => void handleDelete()}
                className="text-xs px-2 py-1.5 rounded"
                style={{ color: 'var(--color-danger)', border: '1px solid var(--border)' }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Controls: Stage, Sprint, Status, SP, Assignee ── */}
      <section className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Stage</span>
        <StagePicker projectId={projectId} itemId={itemId} stageId={item.node_id ?? null} />
        <span className="text-xs font-semibold uppercase tracking-wider ml-3" style={{ color: 'var(--text-3)' }}>Sprint</span>
        <SprintPanel projectId={projectId} itemId={itemId} sprintId={item.sprint_id ?? null} sprintName={item.sprint_name ?? null} />
        <span className="text-xs font-semibold uppercase tracking-wider ml-3" style={{ color: 'var(--text-3)' }}>Status</span>
        <select
          value={item.status}
          onChange={(e) => void updateItem.mutate({ itemId: item.id, status: e.target.value as BacklogItemStatus })}
          className="text-xs px-2 py-1.5 rounded-lg outline-none font-medium"
          style={{
            background: STATUS_COLOR[item.status]?.bg ?? 'var(--bg-surface)',
            color: STATUS_COLOR[item.status]?.fg ?? 'var(--text-1)',
            border: '1px solid transparent',
          }}
        >
          {STATUS_OPTS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <span className="text-xs font-semibold uppercase tracking-wider ml-3" style={{ color: 'var(--text-3)' }}>SP</span>
        <select
          data-testid="sp-selector"
          value={item.estimate ?? ''}
          onChange={(e) => void updateItem.mutate({ itemId: item.id, estimate: e.target.value || null })}
          className="text-xs px-2 py-1.5 rounded-lg outline-none"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: item.estimate ? 'var(--text-1)' : 'var(--text-3)' }}
        >
          <option value="">-- SP</option>
          {SP_OPTS.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <span className="text-xs font-semibold uppercase tracking-wider ml-3" style={{ color: 'var(--text-3)' }}>Assignee</span>
        <AssigneePicker projectId={projectId} itemId={itemId} assigneeId={item.assignee_id ?? null} />
      </section>

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
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
            Acceptance Criteria (ATDD)
          </span>
          {!editAC && (
            <button onClick={startEditAC} className="text-xs" style={{ color: 'var(--accent)' }}>Edit</button>
          )}
        </div>
        {editAC ? (
          <div className="flex flex-col gap-3">
            {[
              { label: 'Setup / Given', value: acSetupDraft, set: setAcSetupDraft },
              { label: 'Steps / When',  value: acStepsDraft, set: setAcStepsDraft },
              { label: 'Expected / Then', value: acExpectedDraft, set: setAcExpectedDraft },
            ].map(({ label, value, set }) => (
              <div key={label} className="flex flex-col gap-1">
                <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{label}</p>
                <textarea
                  rows={3}
                  className="text-sm px-3 py-2 rounded-lg outline-none resize-y font-mono"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  placeholder={`${label}...`}
                />
              </div>
            ))}
            <div className="flex gap-2">
              <button onClick={commitAC} className="text-xs px-3 py-1 rounded font-medium" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Save</button>
              <button onClick={() => setEditAC(false)} className="text-xs px-3 py-1 rounded" style={{ color: 'var(--text-3)' }}>Cancel</button>
            </div>
          </div>
        ) : (item.ac_setup || item.ac_steps || item.ac_expected) ? (
          <div className="flex flex-col gap-3 cursor-text" onClick={startEditAC}>
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
          </div>
        ) : (
          <p
            className="text-sm cursor-text"
            style={{ color: 'var(--text-3)' }}
            onClick={startEditAC}
          >
            Click to add acceptance criteria...
          </p>
        )}
      </section>

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
            <Link
              to={`/projects/${projectId}/tests/${t.id}`}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1 rounded flex-shrink-0"
              style={{ color: 'var(--accent)' }}
              title="Open test details"
            >
              &rarr;
            </Link>
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

      {showBreakdown && (
        <BreakdownModal
          projectId={projectId}
          item={item}
          tasks={tasks}
          tests={tests}
          onClose={() => setShowBreakdown(false)}
        />
      )}
      </div>
      </div>
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
