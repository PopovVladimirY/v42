/**
 * BreakdownModal -- Life Tree breakdown UI.
 * Splits a backlog item into 2+ child items, redistributing tasks/tests.
 * Execution is frontend-orchestrated:
 *   1. POST /backlog x N   -- create children (inherit project, type, epic, sprint, parent_item_id)
 *   2. Move assigned tasks/tests to their designated child items
 *   3. Move unassigned tasks/tests to the LAST child item (nothing stays on the archived original)
 *   4. Add each child to the parent's sprint (if any)
 *   5. PATCH /backlog/:id  { status: 'decomposed' } -- archive original
 */
import React, { useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { backlogApi } from '@/api/endpoints/backlog';
import { tasksApi } from '@/api/endpoints/tasks';
import { itemTestsApi } from '@/api/endpoints/item_tests';
import { sprintsApi } from '@/api/endpoints/sprints';
import type { BacklogItem, Task, TestSpec } from '@/types';

// -- Types -------------------------------------------------------------------

interface Slot {
  id: string; // local key only
  title: string;
  taskIds: string[];
  testIds: string[];
}

function makeSlot(): Slot {
  return { id: crypto.randomUUID(), title: '', taskIds: [], testIds: [] };
}

// -- Small badge helpers -----------------------------------------------------

function Badge({ label, kind }: { label: string; kind: 'task' | 'test' }) {
  const s = kind === 'task'
    ? { background: '#1D4ED8', color: '#BFDBFE' }
    : { background: '#064E3B', color: '#6EE7B7' };
  return (
    <span
      className="text-xs font-mono px-1 py-0.5 rounded flex-shrink-0"
      style={{ ...s, fontSize: '0.65rem' }}
    >
      {kind === 'task' ? 'Z' : 'T'}
    </span>
  );
}

// -- Draggable row for tasks/tests -------------------------------------------

function DraggableItem({
  id,
  title,
  kind,
  onDragStart,
}: {
  id: string;
  title: string;
  kind: 'task' | 'test';
  onDragStart: (id: string, kind: 'task' | 'test') => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('id', id); e.dataTransfer.setData('kind', kind); onDragStart(id, kind); }}
      className="flex items-center gap-2 px-2 py-1 rounded cursor-grab text-xs"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
    >
      <Badge label={kind === 'task' ? 'Z' : 'T'} kind={kind} />
      <span className="truncate">{title}</span>
    </div>
  );
}

// -- Drop zone slot ----------------------------------------------------------

function SlotPanel({
  slot,
  index,
  tasks,
  tests,
  allTasks,
  allTests,
  canRemove,
  onChange,
  onRemove,
  onDrop,
  onUnassign,
}: {
  slot: Slot;
  index: number;
  tasks: Task[];
  tests: TestSpec[];
  allTasks: Task[];
  allTests: TestSpec[];
  canRemove: boolean;
  onChange: (title: string) => void;
  onRemove: () => void;
  onDrop: (slotId: string, itemId: string, kind: 'task' | 'test') => void;
  onUnassign: (itemId: string, kind: 'task' | 'test') => void;
}) {
  const [over, setOver] = useState(false);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setOver(true);
  }
  function handleDragLeave() { setOver(false); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData('id');
    const kind = e.dataTransfer.getData('kind') as 'task' | 'test';
    if (id && kind) onDrop(slot.id, id, kind);
  }

  const myTasks = tasks.filter((t) => slot.taskIds.includes(t.id));
  const myTests = tests.filter((t) => slot.testIds.includes(t.id));

  return (
    <div
      className="flex flex-col gap-2 flex-1 rounded-lg p-3"
      style={{
        minWidth: 0,
        border: over ? '1.5px dashed var(--accent)' : '1px solid var(--border)',
        background: over ? 'var(--bg-hover)' : 'var(--bg-elevated)',
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Slot header */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold flex-shrink-0" style={{ color: 'var(--text-3)' }}>
          Item {index + 1}
        </span>
        {canRemove && (
          <button
            onClick={onRemove}
            className="ml-auto text-xs flex-shrink-0"
            style={{ color: 'var(--color-danger)' }}
            title="Remove slot"
          >
            &#10007;
          </button>
        )}
      </div>

      {/* Title input */}
      <input
        value={slot.title}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Title for item ${index + 1}...`}
        className="text-xs rounded px-2 py-1 outline-none w-full"
        style={{
          background: 'var(--bg-surface)',
          border: slot.title.trim() ? '1px solid var(--border)' : '1px solid var(--color-danger)',
          color: 'var(--text-1)',
        }}
      />

      {/* Assigned tasks/tests */}
      {myTasks.length === 0 && myTests.length === 0 ? (
        <p className="text-xs text-center py-2" style={{ color: 'var(--text-3)' }}>
          Drop tasks/tests here
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {myTasks.map((t) => (
            <div key={t.id} className="flex items-center gap-1">
              <DraggableItem id={t.id} title={t.title} kind="task" onDragStart={() => {}} />
              <button
                onClick={() => onUnassign(t.id, 'task')}
                className="text-xs flex-shrink-0"
                style={{ color: 'var(--text-3)' }}
                title="Unassign"
              >
                &#8617;
              </button>
            </div>
          ))}
          {myTests.map((t) => (
            <div key={t.id} className="flex items-center gap-1">
              <DraggableItem id={t.id} title={t.title} kind="test" onDragStart={() => {}} />
              <button
                onClick={() => onUnassign(t.id, 'test')}
                className="text-xs flex-shrink-0"
                style={{ color: 'var(--text-3)' }}
                title="Unassign"
              >
                &#8617;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -- Main modal component ----------------------------------------------------

export function BreakdownModal({
  projectId,
  item,
  tasks,
  tests,
  onClose,
}: {
  projectId: string;
  item: BacklogItem;
  tasks: Task[];
  tests: TestSpec[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [slots, setSlots] = useState<Slot[]>([makeSlot(), makeSlot()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Map of itemId -> slotId (null = unassigned / stays on source)
  const [assignments, setAssignments] = useState<Record<string, { slotId: string; kind: 'task' | 'test' }>>({});

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const addSlot = useCallback(() => setSlots((prev) => [...prev, makeSlot()]), []);

  function removeSlot(slotId: string) {
    // Unassign all items in that slot before removing
    setAssignments((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((id) => {
        if (next[id].slotId === slotId) delete next[id];
      });
      return next;
    });
    setSlots((prev) => prev.filter((s) => s.id !== slotId));
  }

  function updateSlotTitle(slotId: string, title: string) {
    setSlots((prev) => prev.map((s) => s.id === slotId ? { ...s, title } : s));
  }

  function handleDrop(slotId: string, itemId: string, kind: 'task' | 'test') {
    setAssignments((prev) => ({ ...prev, [itemId]: { slotId, kind } }));
  }

  function handleUnassign(itemId: string, _kind: 'task' | 'test') {
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }

  // Build per-slot task/test lists for rendering
  const slotsWithItems = slots.map((s) => ({
    ...s,
    taskIds: Object.entries(assignments)
      .filter(([, v]) => v.slotId === s.id && v.kind === 'task')
      .map(([id]) => id),
    testIds: Object.entries(assignments)
      .filter(([, v]) => v.slotId === s.id && v.kind === 'test')
      .map(([id]) => id),
  }));

  // Unassigned items still shown in source panel
  const unassignedTasks = tasks.filter((t) => !assignments[t.id]);
  const unassignedTests = tests.filter((t) => !assignments[t.id]);

  const canExecute = slots.every((s) => s.title.trim() !== '') && slots.length >= 2;

  async function execute() {
    if (!canExecute || busy) return;
    setBusy(true);
    setError(null);

    try {
      // 1. Create child items
      const createdIds: Record<string, string> = {}; // slotId -> new item id
      for (const slot of slotsWithItems) {
        const res = await backlogApi.create(projectId, {
          title: slot.title.trim(),
          type: item.type,
          epic_id: item.epic_id ?? undefined,
          parent_item_id: item.id,
        });
        const newItem = res.data.data;
        if (!newItem) throw new Error('Failed to create child item');
        createdIds[slot.id] = newItem.id;
      }

      // 2. Move tasks to their assigned slots
      for (const [taskId, { slotId, kind }] of Object.entries(assignments)) {
        if (kind !== 'task') continue;
        const targetItemId = createdIds[slotId];
        if (!targetItemId) continue;
        // tasks.move needs source itemId (original item)
        await tasksApi.move(projectId, item.id, taskId, targetItemId);
      }

      // 3. Move tests to their assigned slots
      for (const [testId, { slotId, kind }] of Object.entries(assignments)) {
        if (kind !== 'test') continue;
        const targetItemId = createdIds[slotId];
        if (!targetItemId) continue;
        // itemTestsApi.move needs source itemId (original item)
        await itemTestsApi.move(projectId, item.id, testId, targetItemId);
      }

      // 3b. Unassigned tasks/tests go to the last child -- nothing stays on the archived original
      const lastItemId = createdIds[slotsWithItems[slotsWithItems.length - 1].id];
      for (const t of tasks.filter((t) => !assignments[t.id])) {
        await tasksApi.move(projectId, item.id, t.id, lastItemId);
      }
      for (const t of tests.filter((t) => !assignments[t.id])) {
        await itemTestsApi.move(projectId, item.id, t.id, lastItemId);
      }

      // 3c. Add children to the same sprint if the parent was in one
      if (item.sprint_id) {
        for (const newItemId of Object.values(createdIds)) {
          await sprintsApi.addItem(projectId, item.sprint_id, newItemId);
        }
      }

      // 4. Mark original as decomposed
      await backlogApi.update(projectId, item.id, { status: 'decomposed' });

      // Invalidate backlog list -- decomposed items filtered out, children appear
      qc.invalidateQueries({ queryKey: ['backlog', projectId] });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Breakdown failed';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    // Full-screen overlay
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="m-auto rounded-2xl flex flex-col overflow-hidden"
        style={{
          width: 'min(96vw, 1100px)',
          maxHeight: '90vh',
          background: 'var(--bg-active)',
          border: '1px solid var(--border)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
            Break down: <span style={{ color: 'var(--accent)' }}>{item.title}</span>
          </span>
          <button onClick={onClose} className="ml-auto text-sm" style={{ color: 'var(--text-3)' }}>
            &#10007;
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Source panel -- 1/3 of modal width */}
          <div
            className="w-1/3 flex-shrink-0 flex flex-col gap-2 p-4 overflow-y-auto"
            style={{ borderRight: '1px solid var(--border)' }}
          >
            <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
              Source: B-{item.number}
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
              Drag tasks/tests to assign them to a specific child item.
              Anything left here goes automatically to the last item.
            </p>

            <div
              className="rounded-lg p-3 flex flex-col gap-1.5 mt-1"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
            >
              <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>{item.title}</p>
              {unassignedTasks.length === 0 && unassignedTests.length === 0 && (
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>No tasks or tests.</p>
              )}
              {unassignedTasks.map((t) => (
                <DraggableItem key={t.id} id={t.id} title={t.title} kind="task" onDragStart={() => {}} />
              ))}
              {unassignedTests.map((t) => (
                <DraggableItem key={t.id} id={t.id} title={t.title} kind="test" onDragStart={() => {}} />
              ))}
            </div>
          </div>

          {/* Slots panel -- 2/3 of modal width */}
          <div className="w-2/3 flex flex-col min-h-0 p-4 gap-3">
            <div className="flex items-center gap-3 flex-shrink-0">
              <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                Target items
              </p>
              <button
                onClick={addSlot}
                className="text-xs px-2 py-0.5 rounded ml-auto"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
              >
                + Add item
              </button>
            </div>

            {/* Vertical list of slots, scrollable */}
            <div className="flex flex-col gap-3 overflow-y-auto flex-1">
              {slotsWithItems.map((slot, i) => (
                <SlotPanel
                  key={slot.id}
                  slot={slot}
                  index={i}
                  tasks={tasks}
                  tests={tests}
                  allTasks={tasks}
                  allTests={tests}
                  canRemove={slots.length > 2}
                  onChange={(title) => updateSlotTitle(slot.id, title)}
                  onRemove={() => removeSlot(slot.id)}
                  onDrop={handleDrop}
                  onUnassign={handleUnassign}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-3 px-6 py-4 flex-shrink-0"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          {error && (
            <span className="text-xs flex-1" style={{ color: 'var(--color-danger)' }}>
              {error}
            </span>
          )}
          {!error && (
            <span className="text-xs flex-1" style={{ color: 'var(--text-3)' }}>
              {canExecute ? 'Ready to execute breakdown.' : 'Fill in titles for all target items (min 2).'}
            </span>
          )}
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded"
            style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
          >
            Cancel
          </button>
          <button
            onClick={execute}
            disabled={!canExecute || busy}
            className="text-xs px-4 py-1.5 rounded font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            {busy ? 'Executing...' : 'Execute breakdown'}
          </button>
        </div>
      </div>
    </div>
  );
}
