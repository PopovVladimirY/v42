import React, { useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TaskDetailModal } from '@/components/TaskDetailModal';
import { TestDetailModal } from '@/components/TestDetailModal';
import { useParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useSprintItems, useRemoveSprintItem, useSprint, sprintKeys } from '@/hooks/useSprints';
import {
  useTasks, useItemTests, useMoveTask, useMoveItemTest,
  useCreateTask, useCreateItemTest, useDeleteTask, useDeleteItemTest,
  useUpdateTask, useUpdateItemTest,
} from '@/hooks/useItemDetails';
import { useUpdateBacklogItem } from '@/hooks/useProjects';
import { useAuthStore } from '@/hooks/useAuth';
import type { SprintItem } from '@/api/endpoints/sprints';
import type { Task, TestSpec, ClarityQuadrant } from '@/types';

// -- Constants ---------------------------------------------------------------

const TASK_STATUS_COLOR: Record<string, string> = {
  todo:        '#6B7280',
  in_progress: '#3B82F6',
  done:        '#22C55E',
  cancelled:   '#EF4444',
};

const ITEM_STATUS_COLOR: Record<string, string> = {
  open:        'var(--text-3)',
  planned:     'var(--text-3)',
  in_progress: 'var(--accent)',
  in_review:   '#a78bfa',
  done:        'var(--color-success)',
  cancelled:   'var(--color-danger)',
  on_hold:     'var(--text-3)',
};

// Hex values for inline styles -- CLARITY_COLOR in types uses Tailwind classes
const CLARITY_HEX: Record<string, string> = {
  clear:   '#10B981',
  scoped:  '#FBBF24',
  tacit:   '#F97316',
  foggy:   '#EF4444',
  unknown: '#6B7280',
};

const CLARITY_LABEL: Record<string, string> = {
  clear:   'Clear',
  scoped:  'Scoped',
  tacit:   'Tacit',
  foggy:   'Foggy',
  unknown: 'Unknown',
};

const CLARITY_OPTIONS = ['clear', 'scoped', 'tacit', 'foggy', 'unknown'] as const;
const ESTIMATE_OPTIONS = ['', '1', '2', '3', '5', '8', '13', '20', '40'];

// -- Active drag state -------------------------------------------------------

interface ActiveDrag {
  id: string;
  type: 'task' | 'test';
  title: string;
  fromItemId: string;
}

// -- MoveDropdown ------------------------------------------------------------

function MoveDropdown({
  label,
  items,
  currentItemId,
  onMove,
  isPending,
}: {
  label: string;
  items: SprintItem[];
  currentItemId: string;
  onMove: (targetId: string) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const targets = items.filter(
    (it) => it.id !== currentItemId && it.title.toLowerCase().includes(search.toLowerCase())
  );

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

// -- DraggableTaskRow --------------------------------------------------------

function DraggableTaskRow({
  task,
  projectId,
  item,
  allItems,
  moveTask,
  onDelete,
  onUpdate,
  canManage,
  onTitleClick,
}: {
  task: Task;
  projectId: string;
  item: SprintItem;
  allItems: SprintItem[];
  moveTask: ReturnType<typeof useMoveTask>;
  onDelete: () => void;
  onUpdate: (title: string) => void;
  canManage: boolean;
  onTitleClick: () => void;
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

  return (
    <tr
      ref={setNodeRef}
      className="group/row"
      style={{ background: 'var(--bg-elevated)', opacity: isDragging ? 0.3 : 1, borderTop: '1px solid var(--border)' }}
      onDoubleClick={() => { if (!editing) { setDraft(task.title); setEditing(true); } }}
    >
      <td className="px-2 py-1 align-middle w-8">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing opacity-0 group-hover/row:opacity-50 transition-opacity select-none flex items-center justify-center"
          style={{ color: 'var(--text-3)', fontSize: '0.9rem', width: '1.25rem' }}
          title="Drag to move"
          onDoubleClick={(e) => e.stopPropagation()}
        >&#8942;</div>
      </td>
      <td className="pl-5 pr-3 py-1 align-middle w-16">
        <span className="font-mono" style={{ color: '#60A5FA', fontSize: '0.65rem' }}>Z-{task.number}</span>
      </td>
      <td className="pl-5 pr-3 py-1 align-middle w-20">
        <span className="text-xs font-mono uppercase" style={{ color: '#60A5FA' }}>task</span>
      </td>
      <td className="pl-5 pr-3 py-1 align-middle max-w-0">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(); } if (e.key === 'Escape') setEditing(false); }}
            className="w-full text-xs rounded px-1.5 py-0.5 outline-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="block truncate cursor-pointer hover:underline"
            style={{
              color: 'var(--text-1)',
              fontStyle: 'italic',
              fontSize: '0.825rem',
              textDecoration: (task.status === 'done' || task.status === 'cancelled') ? 'line-through' : undefined,
              opacity: task.status === 'cancelled' ? 0.5 : 1,
            }}
            title={task.title}
            onClick={(e) => { e.stopPropagation(); onTitleClick(); }}
          >{task.title}</span>
        )}
      </td>
      <td className="pl-5 pr-3 py-1 align-middle w-28">
        <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: TASK_STATUS_COLOR[task.status] ?? '#6B7280', color: '#fff' }}>
          {task.status.replace('_', ' ')}
        </span>
      </td>
      <td className="w-16" />
      <td className="w-32" />
      <td className="w-20" />
      {canManage && (
        <td className="px-2 py-1 align-middle w-12">
          {!editing && (
            <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
              <Link
                to={`/projects/${projectId}/backlog/${item.id}/tasks/${task.id}`}
                style={{ color: 'var(--accent)', fontSize: '0.75rem' }}
                title="Open details"
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              >&#8599;</Link>
              <MoveDropdown
                label="task"
                items={allItems}
                currentItemId={item.id}
                isPending={moveTask.isPending}
                onMove={(toItemId) => moveTask.mutate({ taskId: task.id, fromItemId: item.id, toItemId })}
              />
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="text-xs px-1 rounded"
                style={{ color: 'var(--color-danger)' }}
                title="Delete task"
                onDoubleClick={(e) => e.stopPropagation()}
              >x</button>
            </div>
          )}
        </td>
      )}
    </tr>
  );
}

// -- DraggableTestRow --------------------------------------------------------

function DraggableTestRow({
  test,
  projectId,
  item,
  allItems,
  moveTest,
  onDelete,
  onUpdate,
  canManage,
  onTitleClick,
}: {
  test: TestSpec;
  projectId: string;
  item: SprintItem;
  allItems: SprintItem[];
  moveTest: ReturnType<typeof useMoveItemTest>;
  onDelete: () => void;
  onUpdate: (title: string) => void;
  canManage: boolean;
  onTitleClick: () => void;
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

  return (
    <tr
      ref={setNodeRef}
      className="group/row"
      style={{ background: 'var(--bg-elevated)', opacity: isDragging ? 0.3 : 1, borderTop: '1px solid var(--border)' }}
      onDoubleClick={() => { if (!editing) { setDraft(test.title); setEditing(true); } }}
    >
      <td className="px-2 py-1 align-middle w-8">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing opacity-0 group-hover/row:opacity-50 transition-opacity select-none flex items-center justify-center"
          style={{ color: 'var(--text-3)', fontSize: '0.9rem', width: '1.25rem' }}
          title="Drag to move"
          onDoubleClick={(e) => e.stopPropagation()}
        >&#8942;</div>
      </td>
      <td className="pl-5 pr-3 py-1 align-middle w-16">
        <span className="font-mono" style={{ color: '#34D399', fontSize: '0.65rem' }}>T-{test.number}</span>
      </td>
      <td className="pl-5 pr-3 py-1 align-middle w-20">
        <span className="text-xs font-mono capitalize" style={{ color: '#34D399' }}>{test.type}</span>
      </td>
      <td className="pl-5 pr-3 py-1 align-middle max-w-0">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(); } if (e.key === 'Escape') setEditing(false); }}
            className="w-full text-xs rounded px-1.5 py-0.5 outline-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="block truncate cursor-pointer hover:underline" style={{ color: 'var(--text-1)', fontStyle: 'italic', fontSize: '0.825rem' }} title={test.title} onClick={(e) => { e.stopPropagation(); onTitleClick(); }}>{test.title}</span>
        )}
      </td>
      <td className="w-28" />
      <td className="w-16" />
      <td className="w-32" />
      <td className="w-20" />
      {canManage && (
        <td className="px-2 py-1 align-middle w-12">
          {!editing && (
            <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
              <Link
                to={`/projects/${projectId}/tests/${test.id}`}
                style={{ color: 'var(--accent)', fontSize: '0.75rem' }}
                title="Open details"
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              >&#8599;</Link>
              <MoveDropdown
                label="test"
                items={allItems}
                currentItemId={item.id}
                isPending={moveTest.isPending}
                onMove={(toItemId) => moveTest.mutate({ testId: test.id, fromItemId: item.id, toItemId })}
              />
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="text-xs px-1 rounded"
                style={{ color: 'var(--color-danger)' }}
                title="Delete test"
                onDoubleClick={(e) => e.stopPropagation()}
              >x</button>
            </div>
          )}
        </td>
      )}
    </tr>
  );
}

// -- ExpandedItemPanel -------------------------------------------------------

type UnifiedRow = { kind: 'task'; data: Task } | { kind: 'test'; data: TestSpec };

function ExpandedItemPanel({
  projectId,
  item,
  allItems,
  moveTask,
  moveTest,
  canManage,
}: {
  projectId: string;
  item: SprintItem;
  allItems: SprintItem[];
  moveTask: ReturnType<typeof useMoveTask>;
  moveTest: ReturnType<typeof useMoveItemTest>;
  canManage: boolean;
}) {
  const { data: tasks = [], isLoading: loadingTasks } = useTasks(projectId, item.id);
  const { data: tests = [], isLoading: loadingTests } = useItemTests(projectId, item.id);
  const createTask = useCreateTask(projectId, item.id);
  const createTest = useCreateItemTest(projectId, item.id);
  const deleteTask = useDeleteTask(projectId, item.id);
  const deleteTest = useDeleteItemTest(projectId);
  const updateTask = useUpdateTask(projectId, item.id);
  const updateTest = useUpdateItemTest(projectId, item.id);

  const [addingType, setAddingType] = useState<'task' | 'test' | null>(null);
  const [addingTitle, setAddingTitle] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);
  const [modalTask, setModalTask] = useState<{ id: string; itemId: string } | null>(null);
  const [modalTest, setModalTest] = useState<{ id: string } | null>(null);

  const unified = useMemo<UnifiedRow[]>(() => {
    const rows: UnifiedRow[] = [
      ...tasks.map((t): UnifiedRow => ({ kind: 'task', data: t })),
      ...tests.map((t): UnifiedRow => ({ kind: 'test', data: t })),
    ];
    return rows.sort((a, b) => new Date(a.data.created_at).getTime() - new Date(b.data.created_at).getTime());
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
  const colSpan = canManage ? 9 : 8;

  return (
    <>
      {isLoading && (
        <tr style={{ background: 'var(--bg-elevated)' }}>
          <td colSpan={colSpan} className="px-6 py-2 text-xs" style={{ color: 'var(--text-3)', borderTop: '1px solid var(--border)' }}>Loading...</td>
        </tr>
      )}
      {!isLoading && unified.length === 0 && !addingType && (
        <tr style={{ background: 'var(--bg-elevated)' }}>
          <td colSpan={colSpan} className="px-6 py-2 text-xs" style={{ color: 'var(--text-3)', borderTop: '1px solid var(--border)' }}>No tasks or tests yet.</td>
        </tr>
      )}
      {unified.map((row) =>
        row.kind === 'task' ? (
          <DraggableTaskRow
            key={row.data.id}
            task={row.data}
            projectId={projectId}
            item={item}
            allItems={allItems}
            moveTask={moveTask}
            canManage={canManage}
            onDelete={() => deleteTask.mutate(row.data.id)}
            onUpdate={(title) => updateTask.mutate({ taskId: row.data.id, title })}
            onTitleClick={() => setModalTask({ id: row.data.id, itemId: item.id })}
          />
        ) : (
          <DraggableTestRow
            key={row.data.id}
            test={row.data}
            projectId={projectId}
            item={item}
            allItems={allItems}
            moveTest={moveTest}
            canManage={canManage}
            onDelete={() => deleteTest.mutate({ testId: row.data.id, itemId: item.id })}
            onUpdate={(title) => updateTest.mutate({ testId: row.data.id, title })}
            onTitleClick={() => setModalTest({ id: row.data.id })}
          />
        )
      )}
      {addingType && (
        <tr style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)' }}>
          <td colSpan={colSpan} className="px-6 py-1">
            <div className="flex items-center gap-2">
              <span
                className="font-mono px-1 py-0.5 rounded flex-shrink-0"
                style={addingType === 'task'
                  ? { background: '#1D4ED8', color: '#BFDBFE', fontSize: '0.65rem' }
                  : { background: '#064E3B', color: '#6EE7B7', fontSize: '0.65rem' }}
              >{addingType === 'task' ? 'Z' : 'T'}</span>
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
              <button onClick={() => { setAddingType(null); setAddingTitle(''); }} className="text-xs flex-shrink-0" style={{ color: 'var(--text-3)' }}>&#10007;</button>
            </div>
          </td>
        </tr>
      )}
      <tr style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)', borderBottom: '2px solid var(--border)' }}>
        <td colSpan={colSpan} className="px-6 py-2">
          <div className="flex gap-2">
            <button onClick={() => startAdding('task')} disabled={!!addingType} className="text-xs px-2 py-0.5 rounded disabled:opacity-40" style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}>+ Task</button>
            <button onClick={() => startAdding('test')} disabled={!!addingType} className="text-xs px-2 py-0.5 rounded disabled:opacity-40" style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}>+ Test</button>
          </div>
        </td>
      </tr>
      {modalTask && createPortal(
        <TaskDetailModal
          projectId={projectId}
          itemId={modalTask.itemId}
          taskId={modalTask.id}
          onClose={() => setModalTask(null)}
        />,
        document.body
      )}
      {modalTest && createPortal(
        <TestDetailModal
          projectId={projectId}
          testId={modalTest.id}
          onClose={() => setModalTest(null)}
        />,
        document.body
      )}
    </>
  );
}

// -- ClarityDropdown (planning mode only) ------------------------------------

function ClarityDropdown({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: ClarityQuadrant) => void;
}) {
  const [open, setOpen] = useState(false);
  const hex = CLARITY_HEX[value] ?? CLARITY_HEX.unknown;
  return (
    <div className="relative flex justify-center">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="w-5 h-5 rounded flex-shrink-0"
        style={{ background: hex, cursor: 'pointer' }}
        title={`Clarity: ${CLARITY_LABEL[value] ?? value} — click to change`}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute left-1/2 top-full mt-1 z-40 rounded-lg overflow-hidden py-1 w-32"
            style={{ transform: 'translateX(-50%)', background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,.25)' }}
          >
            {CLARITY_OPTIONS.map((c) => (
              <button
                key={c}
                onClick={(e) => { e.stopPropagation(); onChange(c as ClarityQuadrant); setOpen(false); }}
                className="w-full text-left text-xs px-3 py-1.5 hover:bg-[var(--bg-elevated)] flex items-center gap-2"
              >
                <span className="w-3 h-3 rounded flex-shrink-0" style={{ background: CLARITY_HEX[c] }} />
                <span style={{ color: 'var(--text-1)' }}>{CLARITY_LABEL[c]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// -- ClarityBadge (read-only) ------------------------------------------------

function ClarityBadge({ value }: { value: string }) {
  const hex = CLARITY_HEX[value] ?? CLARITY_HEX.unknown;
  return (
    <div className="flex justify-center">
      <span
        className="inline-block w-5 h-5 rounded flex-shrink-0"
        style={{ background: hex }}
        title={`Clarity: ${CLARITY_LABEL[value] ?? value}`}
      />
    </div>
  );
}

// -- DroppableItemRow --------------------------------------------------------

function DroppableItemRow({
  item,
  children,
  onDoubleClick,
}: {
  item: SprintItem;
  children: React.ReactNode;
  onDoubleClick?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: item.id });
  return (
    <tr
      ref={setNodeRef}
      className="group transition-colors cursor-default"
      style={{ outline: isOver ? '2px solid var(--accent)' : undefined, outlineOffset: isOver ? '-2px' : undefined }}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </tr>
  );
}

// -- Main tab ----------------------------------------------------------------

export function SprintBacklogTab() {
  const { projectId = '', sprintId = '' } = useParams<{ projectId: string; sprintId: string }>();
  const { data: items = [], isLoading } = useSprintItems(projectId, sprintId);
  const { data: sprint } = useSprint(projectId, sprintId);
  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === 'admin' || user?.role === 'maintainer';
  // Editable in all states except completed and cancelled
  const isEditable = sprint?.status !== 'completed' && sprint?.status !== 'cancelled';
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const removeItem = useRemoveSprintItem(projectId, sprintId);
  const updateItem = useUpdateBacklogItem(projectId);
  const qc = useQueryClient();

  function updateItemField(itemId: string, data: { clarity?: ClarityQuadrant; estimate?: string | null }) {
    updateItem.mutate(
      { itemId, ...data },
      { onSuccess: () => qc.invalidateQueries({ queryKey: sprintKeys.items(projectId, sprintId) }) }
    );
  }

  const moveTask = useMoveTask(projectId);
  const moveTest = useMoveItemTest(projectId);

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);

  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 8 } }));

  function toggleExpand(itemId: string) {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function handleDragStart(e: DragStartEvent) {
    const d = e.active.data.current as { type: 'task' | 'test'; fromItemId: string; title: string };
    setActiveDrag({ id: String(e.active.id), ...d });
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveDrag(null);
    if (!e.over || !activeDrag) return;
    const toItemId = String(e.over.id);
    if (toItemId === activeDrag.fromItemId) return;
    if (activeDrag.type === 'task') {
      moveTask.mutate({ taskId: activeDrag.id, fromItemId: activeDrag.fromItemId, toItemId });
    } else {
      moveTest.mutate({ testId: activeDrag.id, fromItemId: activeDrag.fromItemId, toItemId });
    }
    // Auto-expand the drop target
    setExpandedItems((prev) => new Set([...prev, toItemId]));
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading...</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>No items in this sprint yet. Add them from the Board tab.</p>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-full overflow-y-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="sticky top-0 z-10" style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
              <th className="w-8 px-2" />
              <th className="text-left px-3 py-2 font-medium w-16" style={{ color: 'var(--text-3)' }}>ID</th>
              <th className="text-left px-3 py-2 font-medium w-20" style={{ color: 'var(--text-3)' }}>Type</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-3)' }}>Title</th>
              <th className="text-left px-3 py-2 font-medium w-28" style={{ color: 'var(--text-3)' }}>Status</th>
              <th className="text-center px-3 py-2 font-medium w-16" style={{ color: 'var(--text-3)' }}>Clarity</th>
              <th className="text-left px-3 py-2 font-medium w-32" style={{ color: 'var(--text-3)' }}>Assignee</th>
              <th className="text-center px-3 py-2 font-medium w-20" style={{ color: 'var(--text-3)' }}>SP</th>
              {canManage && <th className="w-12" />}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isExpanded = expandedItems.has(item.id);
              const isEditingThis = isEditable && editingItemId === item.id;
              return (
                <React.Fragment key={item.id}>
                  <DroppableItemRow item={item} onDoubleClick={() => { if (isEditable) setEditingItemId((id) => id === item.id ? null : item.id); }}>
                    <td className="px-2 py-2 text-center">
                      <button
                        onClick={() => toggleExpand(item.id)}
                        className="text-xs"
                        style={{ color: 'var(--text-3)', lineHeight: 1 }}
                        title={isExpanded ? 'Collapse' : 'Expand tasks & tests'}
                      >
                        {isExpanded ? '\u25BC' : '\u25B6'}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-mono font-bold" style={{ color: 'var(--accent)' }}>
                      B-{item.number}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase"
                        style={{ background: 'var(--bg-elevated)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
                      >
                        {item.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-0">
                      <Link
                        to={`/projects/${projectId}/backlog/${item.id}`}
                        className="truncate block hover:underline font-semibold"
                        style={{ color: 'var(--text-1)', fontSize: '1.006rem' }}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        {item.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span style={{ color: ITEM_STATUS_COLOR[item.status] ?? 'var(--text-3)' }}>
                        {item.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {isEditingThis ? (
                        <ClarityDropdown
                          value={item.clarity}
                          onChange={(c) => updateItemField(item.id, { clarity: c })}
                        />
                      ) : (
                        <ClarityBadge value={item.clarity} />
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-3)' }}>
                      {item.assignee_name ?? '--'}
                    </td>
                    <td className="px-1 py-2 text-center font-mono" style={{ color: 'var(--text-3)' }}>
                      {isEditingThis ? (
                        <select
                          value={item.estimate ?? ''}
                          onChange={(e) => updateItemField(item.id, { estimate: e.target.value || null })}
                          className="text-xs rounded px-1 outline-none"
                          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-3)', width: '72px' }}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          {ESTIMATE_OPTIONS.map((o) => (
                            <option key={o} value={o}>{o || '--'}</option>
                          ))}
                        </select>
                      ) : (
                        item.estimate ?? '--'
                      )}
                    </td>
                    {canManage && (
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => removeItem.mutate(item.id)}
                          disabled={removeItem.isPending}
                          className="text-xs px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ color: 'var(--color-danger)', border: '1px solid var(--color-danger)', opacity: removeItem.isPending ? 0.5 : undefined }}
                          title="Remove from sprint"
                        >
                          &times;
                        </button>
                      </td>
                    )}
                  </DroppableItemRow>
                  {isExpanded && (
                    <ExpandedItemPanel
                      projectId={projectId}
                      item={item}
                      allItems={items}
                      moveTask={moveTask}
                      moveTest={moveTest}
                      canManage={canManage}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <DragOverlay>
        {activeDrag && (
          <div
            className="text-xs px-3 py-1.5 rounded shadow-xl"
            style={{
              background: activeDrag.type === 'task' ? '#1D4ED8' : '#064E3B',
              color: activeDrag.type === 'task' ? '#BFDBFE' : '#6EE7B7',
              maxWidth: 280,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {activeDrag.type === 'task' ? 'Z' : 'T'} {activeDrag.title}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
