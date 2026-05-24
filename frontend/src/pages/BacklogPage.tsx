import React, { useState, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  useBacklog,
  useCreateBacklogItem,
  useUpdateBacklogItem,
  useDeleteBacklogItem,
} from '@/hooks/useProjects';
import { useSprints } from '@/hooks/useSprints';
import { sprintsApi, type Sprint } from '@/api/endpoints/sprints';
import { projectsApi } from '@/api/endpoints/projects';
import {
  useTasks, useItemTests, useMoveTask, useMoveItemTest,
  useCreateTask, useCreateItemTest, useDeleteTask, useDeleteItemTest, useUpdateTask, useUpdateItemTest,
} from '@/hooks/useItemDetails';
import { CLARITY_COLOR, CLARITY_LABEL, STATUS_COLOR, STATUS_LABEL } from '@/types';
import type { BacklogItem, BacklogItemStatus, BacklogItemType, ClarityQuadrant, Project, Task, TestSpec } from '@/types';
import { usePaginationStore } from '@/stores/usePagination';
import { Paginator } from '@/components/Paginator';

// -- Stage option (flat list built from project tree) -----------------------
interface StageOption { id: string; name: string; depth: number; }

function buildStageOptions(nodes: Project[]): StageOption[] {
  const byParent = new Map<string | null, Project[]>();
  for (const n of nodes) {
    const key = n.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(n);
  }
  for (const ch of byParent.values())
    ch.sort((a, b) => a.order_index - b.order_index || a.node_number - b.node_number);
  const result: StageOption[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const n of byParent.get(parentId) ?? []) {
      result.push({ id: n.id, name: n.name, depth });
      walk(n.id, depth + 1);
    }
  }
  walk(null, 0);
  return result;
}

// -- Constants ---------------------------------------------------------------

const TYPE_OPTS: { value: BacklogItemType; label: string }[] = [
  { value: 'story', label: 'Story' },
  { value: 'bug',   label: 'Bug'   },
  { value: 'task',  label: 'Task'  },
  { value: 'spike', label: 'Spike' },
];

const STATUS_OPTS: BacklogItemStatus[] = [
  'planned', 'request', 'on_hold', 'open', 'in_progress', 'in_review', 'done', 'cancelled', 'rejected',
];

const CLARITY_OPTS: { value: ClarityQuadrant; label: string }[] = [
  { value: 'clear',   label: CLARITY_LABEL.clear   },
  { value: 'scoped',  label: CLARITY_LABEL.scoped  },
  { value: 'tacit',   label: CLARITY_LABEL.tacit   },
  { value: 'foggy',   label: CLARITY_LABEL.foggy   },
  { value: 'unknown', label: CLARITY_LABEL.unknown  },
];

const ESTIMATE_OPTS = ['', '1', '3', '8', '20', '50'];

// -- EditDraft for inline editing backlog item rows --------------------------

interface EditDraft {
  title: string;
  node_id: string;
  estimate: string;
  sprint_id: string;
}

// -- Inline status selector --------------------------------------------------

function StatusPill({
  item,
  projectId,
}: {
  item: BacklogItem;
  projectId: string;
}) {
  const update = useUpdateBacklogItem(projectId);
  const [open, setOpen] = useState(false);
  const col = STATUS_COLOR[item.status] ?? { bg: '#6B7280', fg: '#fff' };

  return (
    <div className="relative">
      <button
        data-testid={`status-pill-${item.id}`}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: col.bg, color: col.fg }}
      >
        {STATUS_LABEL[item.status] ?? item.status}
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 rounded-lg overflow-hidden z-30 py-1 min-w-32"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 4px 16px rgba(0,0,0,.2)' }}
        >
          {STATUS_OPTS.map((s) => {
            const c = STATUS_COLOR[s];
            return (
              <button
                key={s}
                data-testid={`status-opt-${s}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  if (s !== item.status) {
                    void update.mutate({ itemId: item.id, status: s });
                  }
                }}
                className="w-full text-left text-xs px-3 py-1.5 flex items-center gap-2 hover:bg-[var(--bg-elevated)]"
              >
                <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.bg }} />
                <span style={{ color: 'var(--text-1)' }}>{STATUS_LABEL[s]}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// -- Clarity badge -----------------------------------------------------------

function ClarityBadge({ clarity }: { clarity: ClarityQuadrant }) {
  return (
    <span
      data-testid={`clarity-badge-${clarity}`}
      className="text-xs px-2 py-0.5 rounded font-medium"
      style={{ background: CLARITY_COLOR[clarity], color: '#fff' }}
    >
      {CLARITY_LABEL[clarity]}
    </span>
  );
}



// -- Inline edit row for a backlog item -------------------------------------

function BacklogItemEditRow({
  item,
  stageOptions,
  sprints,
  draft,
  onChange,
  onSave,
  onCancel,
  isSaving,
}: {
  item: BacklogItem;
  stageOptions: StageOption[];
  sprints: Sprint[];
  draft: EditDraft;
  onChange: (patch: Partial<EditDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const sel: React.CSSProperties = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--accent)',
    color: 'var(--text-1)',
    borderRadius: '0.25rem',
    fontSize: '0.75rem',
    padding: '0.125rem 0.25rem',
    outline: 'none',
    maxWidth: '100%',
  };
  return (
    <tr style={{ background: 'var(--bg-elevated)', outline: '2px solid var(--accent)', outlineOffset: '-2px' }}>
      <td className="px-2 py-1.5" style={{ width: '2rem' }} />
      <td className="px-3 py-1.5" style={{ width: '4rem' }}>
        <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>B-{item.number}</span>
      </td>
      <td className="px-3 py-1.5" style={{ width: '5rem' }}>
        <span className="text-xs font-mono uppercase opacity-60" style={{ color: 'var(--text-3)' }}>{item.type}</span>
      </td>
      <td className="px-3 py-1.5">
        <input
          autoFocus
          value={draft.title}
          onChange={(e) => onChange({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onSave(); }
            if (e.key === 'Escape') onCancel();
          }}
          className="w-full text-sm rounded px-2 py-0.5 outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
        />
      </td>
      <td className="px-3 py-1.5" style={{ width: '8rem' }}>
        <select value={draft.node_id} onChange={(e) => onChange({ node_id: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }} style={sel}>
          <option value="">No stage</option>
          {stageOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.depth > 0 ? '\u00A0\u00A0'.repeat(s.depth) + '\u2514 ' : ''}{s.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-1.5" style={{ width: '6rem' }}>
        <ClarityBadge clarity={item.clarity} />
      </td>
      <td className="px-3 py-1.5" style={{ width: '8rem' }}>
        <StatusPill item={item} projectId={item.project_id} />
      </td>
      <td className="px-3 py-1.5" style={{ width: '3.5rem' }}>
        <select value={draft.estimate} onChange={(e) => onChange({ estimate: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }} style={sel}>
          {ESTIMATE_OPTS.map((v) => <option key={v} value={v}>{v || '--'}</option>)}
        </select>
      </td>
      <td className="px-3 py-1.5" style={{ width: '8rem' }}>
        <select value={draft.sprint_id} onChange={(e) => onChange({ sprint_id: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }} style={sel}>
          <option value="">No sprint</option>
          {sprints.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
        </select>
      </td>
      <td className="px-3 py-1.5" style={{ width: '2rem' }}>
        <div className="flex gap-0.5">
          <button
            onClick={onSave}
            disabled={isSaving || !draft.title.trim()}
            title="Save (Enter)"
            className="text-sm px-1 rounded disabled:opacity-40"
            style={{ color: '#22C55E' }}
          >&#10003;</button>
          <button
            onClick={onCancel}
            title="Cancel (Escape)"
            className="text-sm px-1 rounded"
            style={{ color: 'var(--color-danger)' }}
          >&#10007;</button>
        </div>
      </td>
    </tr>
  );
}

// -- Droppable backlog row wrapper -------------------------------------------

function DroppableBacklogRow({
  item,
  isExpanded,
  children,
  onDoubleClick,
}: {
  item: BacklogItem;
  isExpanded: boolean;
  children: React.ReactNode;
  onDoubleClick?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: item.id });
  return (
    <tr
      ref={setNodeRef}
      data-testid={`backlog-row-${item.id}`}
      className="group transition-colors"
      style={{
        outline: isOver ? '2px solid var(--accent)' : undefined,
        outlineOffset: isOver ? '-2px' : undefined,
      }}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </tr>
  );
}

// -- Draggable task / test rows ----------------------------------------------

const TASK_STATUS_COLOR: Record<string, string> = {
  todo: '#6B7280',
  in_progress: '#3B82F6',
  done: '#22C55E',
  cancelled: '#EF4444',
};

function DraggableTaskRow({
  task,
  projectId,
  item,
  allItems,
  moveTask,
  onDelete,
  onUpdate,
}: {
  task: Task;
  projectId: string;
  item: BacklogItem;
  allItems: BacklogItem[];
  moveTask: ReturnType<typeof useMoveTask>;
  onDelete: () => void;
  onUpdate: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { type: 'task', fromItemId: item.id, title: task.title },
  });

  function commitEdit() {
    const t = draft.trim();
    if (t && t !== task.title) onUpdate(t);
    setEditing(false);
  }

  function startEdit() {
    setDraft(task.title);
    setEditing(true);
  }

  return (
    <div
      ref={setNodeRef}
      className="group/row flex items-center gap-2 py-1 rounded px-1 hover:bg-[var(--bg-surface)] transition-colors"
      style={{ opacity: isDragging ? 0.3 : 1 }}
      onDoubleClick={() => { if (!editing) startEdit(); }}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing flex-shrink-0 opacity-0 group-hover/row:opacity-50 transition-opacity select-none"
        style={{ color: 'var(--text-3)', lineHeight: 1, padding: '0 2px', fontSize: '1rem' }}
        title="Drag to move"
        onDoubleClick={(e) => e.stopPropagation()}
      >
        &#8942;
      </div>
      <span
        className="text-xs font-mono px-1 py-0.5 rounded flex-shrink-0"
        style={{ background: '#1D4ED8', color: '#BFDBFE', fontSize: '0.65rem' }}
      >
        Z-{task.id.slice(0, 4).toUpperCase()}
      </span>
      <span
        className="text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
        style={{ background: TASK_STATUS_COLOR[task.status] ?? '#6B7280', color: '#fff' }}
      >
        {task.status.replace('_', ' ')}
      </span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
            if (e.key === 'Escape') setEditing(false);
          }}
          className="flex-1 text-xs rounded px-1.5 py-0.5 outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="flex-1 text-xs truncate"
          style={{ color: 'var(--text-1)' }}
          title={task.title}
        >
          {task.title}
        </span>
      )}
      {task.estimate && !editing && (
        <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--accent)' }}>
          {task.estimate}
        </span>
      )}
      {!editing && (
        <>
          <Link
            to={`/projects/${projectId}/backlog/${item.id}`}
            className="text-xs flex-shrink-0 opacity-0 group-hover/row:opacity-60 transition-opacity hover:opacity-100"
            style={{ color: 'var(--accent)' }}
            title="Open details"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            &#8599;
          </Link>
          <MoveDropdown
            label="task"
            items={allItems}
            currentItemId={item.id}
            isPending={moveTask.isPending}
            onMove={(toItemId) => moveTask.mutate({ taskId: task.id, fromItemId: item.id, toItemId })}
          />
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover/row:opacity-100 transition-opacity text-xs px-1 rounded flex-shrink-0"
            style={{ color: 'var(--color-danger)' }}
            title="Delete task"
            onDoubleClick={(e) => e.stopPropagation()}
          >
            x
          </button>
        </>
      )}
    </div>
  );
}

function DraggableTestRow({
  test,
  projectId,
  item,
  allItems,
  moveTest,
  onDelete,
  onUpdate,
}: {
  test: TestSpec;
  projectId: string;
  item: BacklogItem;
  allItems: BacklogItem[];
  moveTest: ReturnType<typeof useMoveItemTest>;
  onDelete: () => void;
  onUpdate: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: test.id,
    data: { type: 'test', fromItemId: item.id, title: test.title },
  });

  function commitEdit() {
    const t = draft.trim();
    if (t && t !== test.title) onUpdate(t);
    setEditing(false);
  }

  function startEdit() {
    setDraft(test.title);
    setEditing(true);
  }

  return (
    <div
      ref={setNodeRef}
      className="group/row flex items-center gap-2 py-1 rounded px-1 hover:bg-[var(--bg-surface)] transition-colors"
      style={{ opacity: isDragging ? 0.3 : 1 }}
      onDoubleClick={() => { if (!editing) startEdit(); }}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing flex-shrink-0 opacity-0 group-hover/row:opacity-50 transition-opacity select-none"
        style={{ color: 'var(--text-3)', lineHeight: 1, padding: '0 2px', fontSize: '1rem' }}
        title="Drag to move"
        onDoubleClick={(e) => e.stopPropagation()}
      >
        &#8942;
      </div>
      <span
        className="text-xs font-mono px-1 py-0.5 rounded flex-shrink-0"
        style={{ background: '#064E3B', color: '#6EE7B7', fontSize: '0.65rem' }}
      >
        T-{test.id.slice(0, 4).toUpperCase()}
      </span>
      <span
        className="text-xs px-1.5 py-0.5 rounded font-mono flex-shrink-0"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-3)' }}
      >
        {test.type}
      </span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
            if (e.key === 'Escape') setEditing(false);
          }}
          className="flex-1 text-xs rounded px-1.5 py-0.5 outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="flex-1 text-xs truncate"
          style={{ color: 'var(--text-1)' }}
          title={test.title}
        >
          {test.title}
        </span>
      )}
      {!editing && (
        <>
          <Link
            to={`/projects/${projectId}/backlog/${item.id}`}
            className="text-xs flex-shrink-0 opacity-0 group-hover/row:opacity-60 transition-opacity hover:opacity-100"
            style={{ color: 'var(--accent)' }}
            title="Open details"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            &#8599;
          </Link>
          <MoveDropdown
            label="test"
            items={allItems}
            currentItemId={item.id}
            isPending={moveTest.isPending}
            onMove={(toItemId) => moveTest.mutate({ testId: test.id, fromItemId: item.id, toItemId })}
          />
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover/row:opacity-100 transition-opacity text-xs px-1 rounded flex-shrink-0"
            style={{ color: 'var(--color-danger)' }}
            title="Delete test"
            onDoubleClick={(e) => e.stopPropagation()}
          >
            x
          </button>
        </>
      )}
    </div>
  );
}

// -- Move dropdown -----------------------------------------------------------

function MoveDropdown({
  label,
  items,
  currentItemId,
  onMove,
  isPending,
}: {
  label: string;
  items: BacklogItem[];
  currentItemId: string;
  onMove: (targetId: string) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const targets = items.filter((it) => it.id !== currentItemId && it.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="relative">
      <button
        disabled={isPending}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title={`Move ${label}`}
        className="text-xs px-1.5 py-0.5 rounded opacity-30 group-hover/row:opacity-100 transition-opacity"
        style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
      >
        {isPending ? '...' : 'Move'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1 z-40 rounded-lg overflow-hidden py-1 w-64"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,.25)' }}
          >
            <div className="px-2 pb-1">
              <input
                autoFocus
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items..."
                className="w-full rounded px-2 py-1 text-xs outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div className="max-h-48 overflow-y-auto">
              {targets.length === 0 && (
                <p className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>No other items</p>
              )}
              {targets.map((it) => (
                <button
                  key={it.id}
                  onClick={(e) => { e.stopPropagation(); setOpen(false); onMove(it.id); }}
                  className="w-full text-left text-xs px-3 py-1.5 hover:bg-[var(--bg-elevated)] truncate"
                  style={{ color: 'var(--text-1)' }}
                  title={it.title}
                >
                  <span style={{ color: 'var(--text-3)' }}>B-{it.number} </span>{it.title}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// -- Expanded panel: unified tasks + tests for a single backlog item ---------

type UnifiedRow =
  | { kind: 'task'; data: Task }
  | { kind: 'test'; data: TestSpec };

function ExpandedItemPanel({
  projectId,
  item,
  allItems,
  moveTask,
  moveTest,
}: {
  projectId: string;
  item: BacklogItem;
  allItems: BacklogItem[];
  moveTask: ReturnType<typeof useMoveTask>;
  moveTest: ReturnType<typeof useMoveItemTest>;
}) {
  const { data: tasks = [], isLoading: loadingTasks } = useTasks(projectId, item.id);
  const { data: tests = [], isLoading: loadingTests } = useItemTests(projectId, item.id);
  const createTask   = useCreateTask(projectId, item.id);
  const createTest   = useCreateItemTest(projectId, item.id);
  const deleteTask   = useDeleteTask(projectId, item.id);
  const deleteTest   = useDeleteItemTest(projectId);
  const updateTask   = useUpdateTask(projectId, item.id);
  const updateTest   = useUpdateItemTest(projectId, item.id);

  const [addingType, setAddingType] = useState<'task' | 'test' | null>(null);
  const [addingTitle, setAddingTitle] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);

  const unified = useMemo<UnifiedRow[]>(() => {
    const rows: UnifiedRow[] = [
      ...tasks.map((t): UnifiedRow => ({ kind: 'task', data: t })),
      ...tests.map((t): UnifiedRow => ({ kind: 'test', data: t })),
    ];
    return rows.sort((a, b) =>
      new Date(a.data.created_at).getTime() - new Date(b.data.created_at).getTime()
    );
  }, [tasks, tests]);

  function startAdding(type: 'task' | 'test') {
    setAddingTitle('');
    setAddingType(type);
    setTimeout(() => addInputRef.current?.focus(), 50);
  }

  function commitAdd() {
    const t = addingTitle.trim();
    if (!t) { setAddingType(null); return; }
    if (addingType === 'task') createTask.mutate({ title: t });
    else if (addingType === 'test') createTest.mutate({ title: t });
    setAddingTitle('');
    setAddingType(null);
  }

  const isLoading = loadingTasks || loadingTests;

  return (
    <tr style={{ background: 'var(--bg-elevated)' }}>
      <td colSpan={10} className="px-0 pb-0 pt-0">
        <div className="px-8 py-3 flex flex-col gap-1" style={{ borderTop: '1px solid var(--border)' }}>
          {isLoading && <p className="text-xs" style={{ color: 'var(--text-3)' }}>Loading...</p>}

          {!isLoading && unified.length === 0 && !addingType && (
            <p className="text-xs py-1" style={{ color: 'var(--text-3)' }}>No tasks or tests yet. Add below.</p>
          )}

          {/* Unified rows */}
          {unified.map((row) =>
            row.kind === 'task' ? (
              <DraggableTaskRow
                key={row.data.id}
                task={row.data}
                projectId={projectId}
                item={item}
                allItems={allItems}
                moveTask={moveTask}
                onDelete={() => deleteTask.mutate(row.data.id)}
                onUpdate={(title) => updateTask.mutate({ taskId: row.data.id, title })}
              />
            ) : (
              <DraggableTestRow
                key={row.data.id}
                test={row.data}
                projectId={projectId}
                item={item}
                allItems={allItems}
                moveTest={moveTest}
                onDelete={() => deleteTest.mutate({ testId: row.data.id, itemId: item.id })}
                onUpdate={(title) => updateTest.mutate({ testId: row.data.id, title })}
              />
            )
          )}

          {/* Inline add row */}
          {addingType && (
            <div className="flex items-center gap-2 py-0.5">
              <span
                className="text-xs font-mono px-1 py-0.5 rounded flex-shrink-0"
                style={addingType === 'task'
                  ? { background: '#1D4ED8', color: '#BFDBFE', fontSize: '0.65rem' }
                  : { background: '#064E3B', color: '#6EE7B7', fontSize: '0.65rem' }}
              >
                {addingType === 'task' ? 'Z' : 'T'}
              </span>
              <input
                ref={addInputRef}
                value={addingTitle}
                onChange={(e) => setAddingTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitAdd(); }
                  if (e.key === 'Escape') { setAddingType(null); setAddingTitle(''); }
                }}
                onBlur={commitAdd}
                placeholder={`New ${addingType} title...`}
                className="flex-1 text-xs rounded px-1.5 py-0.5 outline-none"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
              />
              <button
                onClick={() => { setAddingType(null); setAddingTitle(''); }}
                className="text-xs flex-shrink-0"
                style={{ color: 'var(--text-3)' }}
              >
                &#10007;
              </button>
            </div>
          )}

          {/* Add buttons */}
          <div className="flex gap-2 mt-1.5">
            <button
              onClick={() => startAdding('task')}
              disabled={!!addingType}
              className="text-xs px-2 py-0.5 rounded disabled:opacity-40"
              style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
            >
              + Task
            </button>
            <button
              onClick={() => startAdding('test')}
              disabled={!!addingType}
              className="text-xs px-2 py-0.5 rounded disabled:opacity-40"
              style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
            >
              + Test
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}
// -- Create item panel -------------------------------------------------------

function CreateItemPanel({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const createItem = useCreateBacklogItem(projectId);

  const [title, setTitle] = useState('');
  const [type, setType] = useState<BacklogItemType>('story');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await createItem.mutateAsync({
      title: title.trim(),
      type,
    });
    onClose();
  }

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--accent)' }}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            data-testid="new-item-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={255}
            placeholder="Item title"
            className="flex-1 rounded-md px-3 py-1.5 text-sm outline-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            autoFocus
            required
          />
          <select
            data-testid="new-item-type"
            value={type}
            onChange={(e) => setType(e.target.value as BacklogItemType)}
            className="rounded-md px-2 py-1.5 text-sm outline-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          >
            {TYPE_OPTS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        {createItem.isError && (
          <p className="text-xs" style={{ color: 'var(--color-danger)' }}>Failed. Try again.</p>
        )}
        <div className="flex gap-2">
          <button
            data-testid="new-item-submit"
            type="submit"
            disabled={!title.trim() || createItem.isPending}
            className="px-3 py-1.5 text-sm font-medium rounded-md disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            {createItem.isPending ? 'Adding...' : 'Add item'}
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

// Persist backlog filters per project in localStorage
function _filtersKey(projectId: string) { return `v42-backlog-filters-${projectId}`; }
type SavedFilters = { status: BacklogItemStatus | ''; clarity: ClarityQuadrant | ''; sprintId: string; text: string };
function _loadFilters(projectId: string): SavedFilters | null {
  try {
    const raw = localStorage.getItem(_filtersKey(projectId));
    return raw ? (JSON.parse(raw) as SavedFilters) : null;
  } catch { return null; }
}
function _saveFilters(projectId: string, f: SavedFilters) {
  try { localStorage.setItem(_filtersKey(projectId), JSON.stringify(f)); } catch { /* quota */ }
}

type SortField = 'title' | 'type' | 'clarity' | 'status' | 'sprint';
type SortDir   = 'asc' | 'desc' | null;

// Cycle: null -> asc -> desc -> null
function nextSort(cur: SortDir): SortDir {
  if (cur === null)   return 'asc';
  if (cur === 'asc')  return 'desc';
  return null;
}

interface ActiveDrag {
  id: string;
  type: 'task' | 'test';
  fromItemId: string;
  title: string;
}

export function BacklogPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(1);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const pageSize = usePaginationStore((s) => s.getPageSize('backlog'));
  const moveTaskDnd = useMoveTask(projectId ?? '');
  const moveTestDnd = useMoveItemTest(projectId ?? '');
  const updateItem = useUpdateBacklogItem(projectId ?? '');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function startEditItem(item: BacklogItem) {
    setEditingItemId(item.id);
    setEditDraft({
      title: item.title,
      node_id: item.node_id ?? '',
      estimate: item.estimate ?? '',
      sprint_id: item.sprint_id ?? '',
    });
  }

  function cancelEditItem() {
    setEditingItemId(null);
    setEditDraft(null);
  }

  async function saveEditItem() {
    if (!editingItemId || !editDraft || !projectId) return;
    const current = items.find((it) => it.id === editingItemId);
    if (!current) { cancelEditItem(); return; }

    try {
      // Collect field changes (skip sprint -- handled separately)
      const changes: { title?: string; node_id?: string | null; estimate?: string | null } = {};
      if (editDraft.title.trim() && editDraft.title.trim() !== current.title)
        changes.title = editDraft.title.trim();
      if (editDraft.node_id !== (current.node_id ?? ''))
        changes.node_id = editDraft.node_id || null;
      if (editDraft.estimate !== (current.estimate ?? ''))
        changes.estimate = editDraft.estimate || null;

      if (Object.keys(changes).length > 0)
        await updateItem.mutateAsync({ itemId: editingItemId, ...changes });

      // Sprint change
      const newSprintId = editDraft.sprint_id;
      const oldSprintId = current.sprint_id ?? '';
      if (newSprintId !== oldSprintId) {
        if (oldSprintId)
          await sprintsApi.removeItem(projectId, oldSprintId, editingItemId);
        if (newSprintId)
          await sprintsApi.addItem(projectId, newSprintId, editingItemId);
        await queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
      }
    } catch (err) {
      console.error('saveEditItem failed:', err);
    } finally {
      cancelEditItem();
    }
  }

  function toggleExpand(id: string) {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Filter state -- persisted per project
  const saved = projectId ? _loadFilters(projectId) : null;
  const [filterStatus,   setFilterStatusRaw]   = useState<BacklogItemStatus | ''>(saved?.status ?? '');
  const [filterClarity,  setFilterClarityRaw]  = useState<ClarityQuadrant | ''>(saved?.clarity ?? '');
  const [filterSprintId, setFilterSprintIdRaw] = useState(saved?.sprintId ?? '');
  const [filterText,     setFilterTextRaw]     = useState(saved?.text ?? '');
  const [sortField,      setSortField]          = useState<SortField | null>(null);
  const [sortDir,        setSortDir]            = useState<SortDir>(null);

  function _save(overrides: Partial<SavedFilters>) {
    if (projectId) _saveFilters(projectId, { status: filterStatus, clarity: filterClarity, sprintId: filterSprintId, text: filterText, ...overrides });
  }
  function setFilterStatus(v: BacklogItemStatus | '')   { setFilterStatusRaw(v);   setPage(1); _save({ status: v }); }
  function setFilterClarity(v: ClarityQuadrant | '')    { setFilterClarityRaw(v);  setPage(1); _save({ clarity: v }); }
  function setFilterSprintId(v: string)                 { setFilterSprintIdRaw(v); setPage(1); _save({ sprintId: v }); }
  function setFilterText(v: string)                     { setFilterTextRaw(v);     setPage(1); _save({ text: v }); }
  function toggleSort(field: SortField) {
    if (sortField !== field) { setSortField(field); setSortDir('asc'); }
    else { const d = nextSort(sortDir); setSortDir(d); if (d === null) setSortField(null); }
    setPage(1);
  }
  // Sort indicator ASCII: [^] asc, [v] desc, nothing for neutral
  function sortMark(field: SortField) {
    if (sortField !== field || sortDir === null) return '';
    return sortDir === 'asc' ? ' [^]' : ' [v]';
  }

  const { data: sprints = [] } = useSprints(projectId ?? '');

  // Load the project tree to build the stage picker options
  const { data: stageNodes = [] } = useQuery({
    queryKey: ['project-tree', projectId, false],
    queryFn: async () => {
      const { data } = await projectsApi.getTree(projectId!, false);
      return data.data ?? [];
    },
    enabled: !!projectId,
  });
  const stageOptions = useMemo(() => buildStageOptions(stageNodes), [stageNodes]);
  const stageNameById = useMemo(() => new Map(stageNodes.map(n => [n.id, n.name])), [stageNodes]);

  const { data: backlog = [], isLoading, isError } = useBacklog(projectId ?? '', {
    status: filterStatus || undefined,
    clarity: filterClarity || undefined,
  });
  const deleteItem = useDeleteBacklogItem(projectId ?? '');

  // Client-side text + sprint filter + sort (server handles status/clarity/epic)
  const items = useMemo(() => {
    let list = backlog;
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      list = list.filter((it) =>
        it.title.toLowerCase().includes(q) ||
        (it.description ?? '').toLowerCase().includes(q)
      );
    }
    if (filterSprintId === '__none__') {
      list = list.filter((it) => !it.sprint_id);
    } else if (filterSprintId) {
      list = list.filter((it) => it.sprint_id === filterSprintId);
    }
    if (sortField && sortDir) {
      list = [...list].sort((a, b) => {
        let cmp = 0;
        if (sortField === 'title')   cmp = a.title.localeCompare(b.title);
        if (sortField === 'type')    cmp = a.type.localeCompare(b.type);
        if (sortField === 'clarity') cmp = (a.clarity ?? '').localeCompare(b.clarity ?? '');
        if (sortField === 'status')  cmp = a.status.localeCompare(b.status);
        if (sortField === 'sprint') {
          const sa = a.sprint_name ?? '';
          const sb = b.sprint_name ?? '';
          if (!sa && !sb) cmp = 0;
          else if (!sa) cmp = 1;   // nulls last
          else if (!sb) cmp = -1;
          else cmp = sa.localeCompare(sb);
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [backlog, filterText, filterSprintId, sortField, sortDir]);

  const total     = items.length;
  const pageItems = items.slice((page - 1) * pageSize, page * pageSize);

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as Omit<ActiveDrag, 'id'>;
    setActiveDrag({ id: String(event.active.id), ...data });
  }

  function handleDragEnd(event: DragEndEvent) {
    const drag = activeDrag;
    setActiveDrag(null);
    if (!event.over || !drag) return;
    const toItemId = String(event.over.id);
    if (toItemId === drag.fromItemId) return;
    if (drag.type === 'task') {
      moveTaskDnd.mutate({ taskId: drag.id, fromItemId: drag.fromItemId, toItemId });
    } else {
      moveTestDnd.mutate({ testId: drag.id, fromItemId: drag.fromItemId, toItemId });
    }
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this backlog item?')) return;
    void deleteItem.mutate(id);
  }

  if (!projectId) return null;

  return (
    <div className="px-6 py-4 flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          data-testid="filter-status"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as BacklogItemStatus | '')}
          className="rounded-md px-2 py-1.5 text-xs outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        >
          <option value="">All statuses</option>
          {STATUS_OPTS.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>

        <select
          data-testid="filter-clarity"
          value={filterClarity}
          onChange={(e) => setFilterClarity(e.target.value as ClarityQuadrant | '')}
          className="rounded-md px-2 py-1.5 text-xs outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        >
          <option value="">All clarity</option>
          {CLARITY_OPTS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>

        {sprints.length > 0 && (
          <select
            data-testid="filter-sprint"
            value={filterSprintId}
            onChange={(e) => setFilterSprintId(e.target.value)}
            className="rounded-md px-2 py-1.5 text-xs outline-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          >
            <option value="">All sprints</option>
            <option value="__none__">No sprint</option>
            {sprints.map((sp) => (
              <option key={sp.id} value={sp.id}>{sp.name}</option>
            ))}
          </select>
        )}

        <input
          data-testid="filter-backlog-text"
          type="search"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Search title or description..."
          className="rounded-md px-3 py-1.5 text-xs outline-none flex-1 min-w-40"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        />

        <span className="text-xs" style={{ color: 'var(--text-3)' }}>{total} item{total !== 1 ? 's' : ''}</span>

        <button
          data-testid="add-item-btn"
          onClick={() => setShowCreate((v) => !v)}
          className="px-3 py-1.5 text-xs font-medium rounded-md"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          + Add item
        </button>
      </div>

      {/* Inline create panel */}
      {showCreate && (
        <CreateItemPanel projectId={projectId} onClose={() => setShowCreate(false)} />
      )}

      {/* List */}
      {isLoading && <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading...</p>}
      {isError   && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Failed to load backlog.</p>}

      {!isLoading && !isError && (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="rounded-xl" style={{ border: '1px solid var(--border)', overflow: 'clip' }}>
            <table className="w-full border-collapse" data-testid="backlog-list">
              <thead style={{ background: 'var(--bg-elevated)' }}>
                <tr>
                  <th className="text-xs font-medium text-left px-2 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '2rem' }}></th>
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '4rem' }}>ID</th>
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '5rem' }}>
                    <button onClick={() => toggleSort('type')} className="hover:opacity-80">Type{sortMark('type')}</button>
                  </th>
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>
                    <button onClick={() => toggleSort('title')} className="hover:opacity-80">Title{sortMark('title')}</button>
                  </th>
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '8rem' }}>Stage</th>
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '6rem' }}>
                    <button onClick={() => toggleSort('clarity')} className="hover:opacity-80">Clarity{sortMark('clarity')}</button>
                  </th>
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '8rem' }}>
                    <button onClick={() => toggleSort('status')} className="hover:opacity-80">Status{sortMark('status')}</button>
                  </th>
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '3.5rem' }} title="Story points">SP</th>
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '8rem' }}>
                    <button onClick={() => toggleSort('sprint')} className="hover:opacity-80">Sprint{sortMark('sprint')}</button>
                  </th>
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '2rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--text-3)' }}>
                      {total === 0 ? 'Backlog is empty. Add something!' : 'No items on this page.'}
                    </td>
                  </tr>
                )}
                {pageItems.map((item) => {
                  const stageName = item.node_id ? stageNameById.get(item.node_id) : undefined;
                  const isExpanded = expandedItems.has(item.id);
                  const isEditing = editingItemId === item.id;
                  return (
                    <React.Fragment key={item.id}>
                      {isEditing && editDraft ? (
                        <BacklogItemEditRow
                          item={item}
                          stageOptions={stageOptions}
                          sprints={sprints}
                          draft={editDraft}
                          onChange={(patch) => setEditDraft((d) => d ? { ...d, ...patch } : d)}
                          onSave={() => { void saveEditItem(); }}
                          onCancel={cancelEditItem}
                          isSaving={updateItem.isPending}
                        />
                      ) : (
                        <DroppableBacklogRow item={item} isExpanded={isExpanded} onDoubleClick={() => startEditItem(item)}>
                          <td className="px-2 py-1 align-middle" style={{ width: '2rem' }}>
                            <button
                              onClick={() => toggleExpand(item.id)}
                              title={isExpanded ? 'Collapse' : 'Expand tasks & tests'}
                              className="flex items-center justify-center select-none transition-colors hover:bg-[var(--bg-elevated)] rounded"
                              style={{ color: 'var(--text-2)', fontSize: '1.5rem', lineHeight: 1, width: '1.5rem' }}
                            >
                              {isExpanded ? '▾' : '▸'}
                            </button>
                          </td>
                          <td className="px-3 py-1 align-middle" style={{ width: '4rem' }}>
                            <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>B-{item.number}</span>
                          </td>
                        <td className="px-3 py-1 align-middle">
                          <span className="text-xs font-mono uppercase opacity-60" style={{ color: 'var(--text-3)' }}>
                            {item.type}
                          </span>
                        </td>
                        <td className="px-3 py-1 align-middle" style={{ maxWidth: 0 }}>
                          <Link
                            to={`/projects/${projectId}/backlog/${item.id}`}
                            className="block truncate hover:underline text-sm"
                            style={{ color: 'var(--text-1)' }}
                            title={item.title}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {item.title}
                          </Link>
                        </td>
                        <td className="px-3 py-1 align-middle">
                          {stageName && (
                            <span className="text-xs truncate block" style={{ color: 'var(--text-3)', maxWidth: '7rem' }} title={stageName}>
                              {stageName}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1 align-middle">
                          <ClarityBadge clarity={item.clarity} />
                        </td>
                        <td className="px-3 py-1 align-middle">
                          <StatusPill item={item} projectId={projectId} />
                        </td>
                        <td className="px-3 py-1 align-middle">
                          {item.estimate && (
                            <span className="text-xs font-mono font-semibold" style={{ color: 'var(--accent)' }}>{item.estimate}</span>
                          )}
                        </td>
                        <td className="px-3 py-1 align-middle">
                          {item.sprint_name ? (
                            <span
                              className="text-xs px-2 py-0.5 rounded font-medium truncate block"
                              style={{ background: 'var(--bg-elevated)', color: 'var(--text-2)', border: '1px solid var(--border)', maxWidth: '7.5rem' }}
                              title={item.sprint_name}
                            >
                              {item.sprint_name}
                            </span>
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--text-3)' }}>--</span>
                          )}
                        </td>
                        <td className="px-3 py-1 align-middle">
                          <button
                            data-testid={`delete-item-${item.id}`}
                            onClick={() => handleDelete(item.id)}
                            title="Delete"
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1 py-0.5 rounded"
                            style={{ color: 'var(--color-danger)' }}
                          >
                            x
                          </button>
                        </td>
                      </DroppableBacklogRow>
                      )}
                      {isExpanded && (
                        <ExpandedItemPanel
                          projectId={projectId}
                          item={item}
                          allItems={items}
                          moveTask={moveTaskDnd}
                          moveTest={moveTestDnd}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <DragOverlay dropAnimation={null}>
            {activeDrag && (
              <div
                className="px-3 py-2 rounded-lg text-xs shadow-xl"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--accent)', color: 'var(--text-1)', maxWidth: '20rem', pointerEvents: 'none' }}
              >
                <span className="font-medium" style={{ color: 'var(--text-3)' }}>{activeDrag.type}: </span>
                {activeDrag.title}
              </div>
            )}
          </DragOverlay>
          <Paginator page={page} pageSize={pageSize} total={total} onChange={setPage} />
        </DndContext>
      )}
    </div>
  );
}
