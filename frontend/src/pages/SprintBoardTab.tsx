import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  useSprintItems,
  useAddSprintItem,
  sprintKeys,
} from '@/hooks/useSprints';
import { useUpdateBacklogItem, useBacklog } from '@/hooks/useProjects';
import type { SprintItem } from '@/api/endpoints/sprints';
import type { BacklogItemStatus } from '@/types';

const BOARD_COLUMNS: { id: BacklogItemStatus; label: string }[] = [
  { id: 'open',        label: 'To Do'       },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review',   label: 'Review'      },
  { id: 'done',        label: 'Done'        },
];

const ACTIVE_COLS = new Set<string>(['in_progress', 'in_review', 'done']);

function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

const TYPE_COLOR: Record<string, string> = {
  story:   'bg-blue-500/20 text-blue-400',
  defect:  'bg-red-500/20 text-red-400',
  task:    'bg-yellow-500/20 text-yellow-400',
  feature: 'bg-purple-500/20 text-purple-400',
  spike:   'bg-teal-500/20 text-teal-400',
};

function ItemCard({
  item,
  projectId,
  isDragging = false,
}: {
  item: SprintItem;
  projectId: string;
  isDragging?: boolean;
}) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, isDragging: dndDragging } = useDraggable({ id: item.id });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  function handleClick() {
    if (dndDragging) return;
    navigate(`/projects/${projectId}/backlog/${item.id}`);
  }

  const typeClass = TYPE_COLOR[item.type] ?? 'bg-gray-500/20 text-gray-400';

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        opacity: isDragging ? 0.4 : 1,
        cursor: 'grab',
      }}
      className="rounded-lg p-3 flex flex-col gap-1.5 select-none hover:border-[var(--accent)] transition-colors"
      data-testid={`sprint-item-${item.id}`}
      onClick={handleClick}
      {...listeners}
      {...attributes}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono font-bold flex-shrink-0" style={{ color: 'var(--accent)' }}>
          B-{item.number}
        </span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium uppercase ${typeClass}`}>
          {item.type}
        </span>
        {item.estimate && (
          <span className="ml-auto text-[10px] font-mono font-semibold" style={{ color: 'var(--text-3)' }}>
            {item.estimate}
          </span>
        )}
      </div>
      <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-1)' }}>
        {item.title}
      </p>
      {item.assignee_name && (
        <div className="flex items-center gap-1 mt-0.5">
          <span
            className="text-[9px] font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            title={item.assignee_name}
          >
            {initials(item.assignee_name)}
          </span>
          <span className="text-[10px] truncate" style={{ color: 'var(--text-3)' }}>
            {item.assignee_name}
          </span>
        </div>
      )}
    </div>
  );
}

function BoardColumn({
  col,
  items,
  projectId,
  activeId,
}: {
  col: { id: BacklogItemStatus; label: string };
  items: SprintItem[];
  projectId: string;
  activeId: string | null;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: col.id });

  return (
    <div
      ref={setNodeRef}
      data-testid={`board-col-${col.id}`}
      className="flex flex-col flex-1 min-w-[200px] rounded-xl overflow-hidden transition-colors"
      style={{
        background: isOver ? 'var(--bg-active)' : 'var(--bg-surface)',
        border: `1px solid ${isOver ? 'var(--accent)' : 'var(--border)'}`,
      }}
    >
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
          {col.label}
        </span>
        <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--bg-elevated)', color: 'var(--text-3)' }}>
          {items.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto flex flex-col gap-2 p-2 min-h-0">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} projectId={projectId} isDragging={item.id === activeId} />
        ))}
      </div>
    </div>
  );
}

export function SprintBoardTab() {
  const { projectId = '', sprintId = '' } = useParams<{ projectId: string; sprintId: string }>();
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useSprintItems(projectId, sprintId);
  const updateItem = useUpdateBacklogItem(projectId);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [showBacklogPanel, setShowBacklogPanel] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const targetCol = String(over.id) as BacklogItemStatus;
    const draggedItem = items.find((i) => i.id === String(active.id));
    if (!draggedItem) return;

    const currentIsToDoZone = !ACTIVE_COLS.has(draggedItem.status);
    if (currentIsToDoZone && targetCol === 'open') return;
    if (draggedItem.status === targetCol) return;

    updateItem.mutate(
      { itemId: draggedItem.id, status: targetCol },
      { onSuccess: () => void qc.invalidateQueries({ queryKey: sprintKeys.items(projectId, sprintId) }) }
    );
  }

  const activeItem = activeId ? items.find((i) => i.id === activeId) : null;

  const byStatus: Record<string, typeof items> = {
    open:        items.filter((i) => !ACTIVE_COLS.has(i.status)),
    in_progress: items.filter((i) => i.status === 'in_progress'),
    in_review:   items.filter((i) => i.status === 'in_review'),
    done:        items.filter((i) => i.status === 'done'),
  };

  return (
    <div className="h-full flex flex-col overflow-hidden min-h-0" data-testid="sprint-board">
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading items...</p>
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex-1 flex gap-3 px-4 py-3 overflow-x-auto min-h-0">
            {BOARD_COLUMNS.map((col) => (
              <BoardColumn
                key={col.id}
                col={col}
                items={byStatus[col.id] ?? []}
                projectId={projectId}
                activeId={activeId}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeItem && (
              <div
                className="rounded-lg p-3 shadow-xl"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', width: '220px' }}
              >
                <span className="text-[10px] font-mono font-bold" style={{ color: 'var(--accent)' }}>B-{activeItem.number}</span>
                <p className="text-xs font-medium mt-1" style={{ color: 'var(--text-1)' }}>{activeItem.title}</p>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {showBacklogPanel && (
        <BacklogPickerPanel
          projectId={projectId}
          sprintId={sprintId}
          itemIdsInSprint={new Set(items.map((i) => i.id))}
          onClose={() => setShowBacklogPanel(false)}
        />
      )}

      {/* Footer stats */}
      <div
        className="flex-shrink-0 flex items-center gap-4 px-4 border-t"
        style={{ height: 36, borderColor: 'var(--border)' }}
      >
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>{items.length} items</span>
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>In progress: {byStatus.in_progress?.length ?? 0}</span>
        <span className="text-xs" style={{ color: 'var(--color-success)' }}>Done: {byStatus.done?.length ?? 0}</span>
        <button
          onClick={() => setShowBacklogPanel((v) => !v)}
          className="text-xs px-3 py-1 rounded font-medium ml-auto"
          style={{
            background: showBacklogPanel ? 'var(--accent)' : 'var(--bg-elevated)',
            color: showBacklogPanel ? 'var(--accent-fg)' : 'var(--accent)',
            border: '1px solid var(--accent)',
          }}
        >
          {showBacklogPanel ? 'Close backlog' : '+ Add from backlog'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Backlog picker panel
// ---------------------------------------------------------------------------

function BacklogPickerPanel({
  projectId,
  sprintId,
  itemIdsInSprint,
  onClose,
}: {
  projectId: string;
  sprintId: string;
  itemIdsInSprint: Set<string>;
  onClose: () => void;
}) {
  const { data: allItems = [], isLoading } = useBacklog(projectId);
  const [search, setSearch] = useState('');

  const available = allItems.filter(
    (item) =>
      !itemIdsInSprint.has(item.id) &&
      item.status !== 'done' &&
      item.status !== 'cancelled' &&
      (search === '' || item.title.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div
      className="flex-shrink-0 border-t flex flex-col"
      style={{ maxHeight: '38vh', borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
    >
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 py-2"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}
      >
        <span className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>Add from Backlog</span>
        <input
          className="flex-1 text-xs px-3 py-1 rounded outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          placeholder="Filter by title..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <button
          onClick={onClose}
          className="text-xs px-2 py-1 rounded"
          style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading && <p className="text-xs px-4 py-3" style={{ color: 'var(--text-3)' }}>Loading...</p>}
        {!isLoading && available.length === 0 && (
          <p className="text-xs px-4 py-3" style={{ color: 'var(--text-3)' }}>
            {search ? 'No matching items.' : 'All open items are already in this sprint.'}
          </p>
        )}
        {!isLoading && available.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 } as React.CSSProperties}>
                <th className="text-left px-3 py-1.5 font-medium w-16" style={{ color: 'var(--text-3)' }}>ID</th>
                <th className="text-left px-3 py-1.5 font-medium w-20" style={{ color: 'var(--text-3)' }}>Type</th>
                <th className="text-left px-3 py-1.5 font-medium" style={{ color: 'var(--text-3)' }}>Title</th>
                <th className="text-left px-3 py-1.5 font-medium w-20" style={{ color: 'var(--text-3)' }}>Status</th>
                <th className="text-center px-3 py-1.5 font-medium w-12" style={{ color: 'var(--text-3)' }}>SP</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {available.map((item) => (
                <BacklogPickerRow
                  key={item.id}
                  item={item}
                  projectId={projectId}
                  sprintId={sprintId}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function BacklogPickerRow({
  item,
  projectId,
  sprintId,
}: {
  item: { id: string; number?: number; title: string; type: string; status: string; estimate?: string | null };
  projectId: string;
  sprintId: string;
}) {
  const navigate = useNavigate();
  const add = useAddSprintItem(projectId, sprintId);
  const [added, setAdded] = useState(false);

  async function handleAdd() {
    await add.mutateAsync(item.id);
    setAdded(true);
  }

  return (
    <tr className="hover:bg-[var(--bg-hover)] transition-colors">
      <td className="px-3 py-1.5">
        <span className="font-mono font-bold" style={{ color: 'var(--accent)' }}>
          {item.number != null ? `B-${item.number}` : '--'}
        </span>
      </td>
      <td className="px-3 py-1.5">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${TYPE_COLOR[item.type] ?? 'bg-gray-500/20 text-gray-400'}`}>
          {item.type}
        </span>
      </td>
      <td className="px-3 py-1.5 max-w-0">
        <button
          className="truncate text-left w-full hover:underline"
          style={{ color: 'var(--text-1)' }}
          onClick={() => navigate(`/projects/${projectId}/backlog/${item.id}`)}
        >
          {item.title}
        </button>
      </td>
      <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: 'var(--text-3)' }}>
        {item.status}
      </td>
      <td className="px-3 py-1.5 text-center font-mono" style={{ color: 'var(--text-3)' }}>
        {item.estimate ?? '--'}
      </td>
      <td className="px-3 py-1.5 text-right">
        <button
          onClick={() => void handleAdd()}
          disabled={add.isPending || added}
          className="text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap"
          style={{
            background: added ? 'var(--color-success)' : 'var(--accent)',
            color: added ? '#fff' : 'var(--accent-fg)',
            opacity: added ? 0.8 : 1,
          }}
        >
          {added ? 'Added' : '+ Add'}
        </button>
      </td>
    </tr>
  );
}
