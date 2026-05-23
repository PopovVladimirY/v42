import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
import { useSprint, useSprintItems, useUpdateSprint, useAddSprintItem, useRemoveSprintItem, SPRINT_STATUS_LABEL, SPRINT_STATUS_COLOR } from '@/hooks/useSprints';
import { useUpdateBacklogItem, useBacklog } from '@/hooks/useProjects';
import { useAuthStore } from '@/hooks/useAuth';
import type { SprintStatus } from '@/api/endpoints/sprints';
import type { BacklogItemStatus } from '@/types';

// Board columns: from staging area to the graveyard of done items
const BOARD_COLUMNS: { id: BacklogItemStatus; label: string }[] = [
  { id: 'open',        label: 'To Do'       },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review',   label: 'Review'      },
  { id: 'done',        label: 'Done'        },
];

// Draggable item card -- the atomic unit of suffering
function ItemCard({
  item,
  isDragging = false,
}: {
  item: { id: string; title: string; type: string; estimate?: string; assignee_id?: string };
  isDragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: item.id });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

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
      className="rounded-lg p-3 flex flex-col gap-1.5 select-none"
      data-testid={`sprint-item-${item.id}`}
      {...listeners}
      {...attributes}
    >
      <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-1)' }}>
        {item.title}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-hover)', color: 'var(--text-3)' }}>
          {item.type}
        </span>
        {item.estimate && (
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{item.estimate}</span>
        )}
      </div>
    </div>
  );
}

// Droppable column container -- fills available height, items scroll inside
function BoardColumn({
  col,
  items,
  activeId,
}: {
  col: { id: BacklogItemStatus; label: string };
  items: { id: string; title: string; type: string; estimate?: string }[];
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
      {/* Column header */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
          {col.label}
        </span>
        <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--bg-elevated)', color: 'var(--text-3)' }}>
          {items.length}
        </span>
      </div>
      {/* Items area: scrollable, fills remaining column height */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-2 p-2 min-h-0">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} isDragging={item.id === activeId} />
        ))}
      </div>
    </div>
  );
}

// Sprint header actions -- status changer for the power user
function SprintStatusSelect({
  projectId,
  sprintId,
  current,
}: {
  projectId: string;
  sprintId: string;
  current: SprintStatus;
}) {
  const update = useUpdateSprint(projectId, sprintId);
  const statuses: SprintStatus[] = ['planning', 'active', 'completed', 'cancelled'];

  return (
    <select
      data-testid="sprint-status-select"
      value={current}
      onChange={(e) => update.mutate({ status: e.target.value as SprintStatus })}
      className="text-xs rounded-lg px-2 py-1 cursor-pointer"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        color: 'var(--text-1)',
      }}
    >
      {statuses.map((s) => (
        <option key={s} value={s} data-testid={`sprint-status-opt-${s}`}>
          {SPRINT_STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

// The main event: Sprint detail with kanban board
export function SprintDetailPage() {
  const { projectId = '', sprintId = '' } = useParams<{
    projectId: string;
    sprintId: string;
  }>();

  const { data: sprint, isLoading: sprintLoading } = useSprint(projectId, sprintId);
  const { data: items = [], isLoading: itemsLoading } = useSprintItems(projectId, sprintId);
  const updateItem = useUpdateBacklogItem(projectId);
  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === 'admin' || user?.role === 'maintainer';

  const [activeId, setActiveId] = useState<string | null>(null);
  const [showBacklogPanel, setShowBacklogPanel] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const newStatus = over.id as BacklogItemStatus;
    const item = items.find((i) => i.id === String(active.id));
    if (!item || item.status === newStatus) return;

    // Optimistically update item status via backlog PATCH
    updateItem.mutate({ itemId: String(active.id), status: newStatus });
  };

  const activeItem = activeId ? items.find((i) => i.id === activeId) : null;

  if (sprintLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading sprint...</p>
      </div>
    );
  }

  if (!sprint) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Sprint not found.</p>
      </div>
    );
  }

  // Distribute items into columns
  const byStatus = Object.fromEntries(
    BOARD_COLUMNS.map((col) => [col.id, items.filter((i) => i.status === col.id)])
  ) as Record<BacklogItemStatus, typeof items>;

  return (
    <div className="h-full flex flex-col overflow-hidden min-h-0" data-testid="sprint-board">
      {/* Compact header strip: back + name + goal + meta -- one row, no wasted space */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 border-b"
        style={{ height: 44, borderColor: 'var(--border)' }}
      >
        <Link
          to={`/projects/${projectId}/sprints`}
          className="text-xs hover:underline flex-shrink-0"
          style={{ color: 'var(--text-3)' }}
        >
          &larr; Sprints
        </Link>
        <span className="flex-shrink-0" style={{ color: 'var(--border)' }}>|</span>
        <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
          {sprint.name}
        </span>
        {sprint.goal && (
          <span className="text-xs truncate hidden sm:block" style={{ color: 'var(--text-3)', maxWidth: '20rem' }}>
            {sprint.goal}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3 flex-shrink-0">
          {sprint.start_date && sprint.end_date && (
            <span className="text-xs hidden md:block" style={{ color: 'var(--text-3)' }}>
              {sprint.start_date} &rarr; {sprint.end_date}
            </span>
          )}
          <span
            data-testid="sprint-status-badge"
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${SPRINT_STATUS_COLOR[sprint.status]}`}
          >
            {SPRINT_STATUS_LABEL[sprint.status]}
          </span>
          {canManage && (
            <SprintStatusSelect projectId={projectId} sprintId={sprintId} current={sprint.status} />
          )}
        </div>
      </div>

      {/* Board: takes all remaining vertical space */}
      {itemsLoading ? (
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
                activeId={activeId}
              />
            ))}
          </div>
          {/* Ghost card that follows the cursor during drag */}
          <DragOverlay>
            {activeItem && (
              <div
                className="rounded-lg p-3 shadow-xl"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', width: '200px' }}
              >
                <p className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{activeItem.title}</p>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Add from backlog -- slide-in panel */}
      {showBacklogPanel && (
        <BacklogPickerPanel
          projectId={projectId}
          sprintId={sprintId}
          itemIdsInSprint={new Set(items.map((i) => i.id))}
          onClose={() => setShowBacklogPanel(false)}
        />
      )}

      {/* Footer stats bar */}
      <div
        className="flex-shrink-0 flex items-center gap-4 px-4 border-t"
        style={{ height: 36, borderColor: 'var(--border)' }}
      >
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          {items.length} items
        </span>
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          In progress: {byStatus.in_progress?.length ?? 0}
        </span>
        <span className="text-xs" style={{ color: 'var(--color-success)' }}>
          Done: {byStatus.done?.length ?? 0}
        </span>
        {sprint.capacity_hours != null && (
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
            Capacity: {sprint.capacity_hours}h
          </span>
        )}
        <button
          onClick={() => setShowBacklogPanel((v) => !v)}
          className="text-xs px-3 py-1 rounded font-medium ml-auto"
          style={{ background: showBacklogPanel ? 'var(--accent)' : 'var(--bg-elevated)', color: showBacklogPanel ? 'var(--accent-fg)' : 'var(--accent)', border: '1px solid var(--accent)' }}
        >
          {showBacklogPanel ? 'Close backlog' : '+ Add from backlog'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Backlog picker panel -- shows items NOT yet in this sprint
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
      style={{ maxHeight: '40vh', borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
    >
      {/* Panel header */}
      <div className="flex items-center gap-3 px-4 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>Add from Backlog</span>
        <input
          className="flex-1 text-xs px-3 py-1 rounded outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          placeholder="Search items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <button onClick={onClose} className="text-xs px-2" style={{ color: 'var(--text-3)' }}>x</button>
      </div>
      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-1.5">
        {isLoading && <p className="text-xs" style={{ color: 'var(--text-3)' }}>Loading...</p>}
        {!isLoading && available.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            {search ? 'No matching items.' : 'All open items are already in this sprint.'}
          </p>
        )}
        {available.map((item) => (
          <BacklogPickerRow
            key={item.id}
            item={item}
            projectId={projectId}
            sprintId={sprintId}
          />
        ))}
      </div>
    </div>
  );
}

function BacklogPickerRow({
  item,
  projectId,
  sprintId,
}: {
  item: { id: string; title: string; type: string; status: string; estimate?: string | null };
  projectId: string;
  sprintId: string;
}) {
  const add = useAddSprintItem(projectId, sprintId);
  const [added, setAdded] = useState(false);

  async function handleAdd() {
    await add.mutateAsync(item.id);
    setAdded(true);
  }

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
    >
      <span className="text-[10px] font-mono uppercase w-14 flex-shrink-0" style={{ color: 'var(--text-3)' }}>
        {item.type}
      </span>
      <span className="flex-1 text-xs truncate" style={{ color: 'var(--text-1)' }}>{item.title}</span>
      {item.estimate && (
        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{item.estimate}</span>
      )}
      <button
        onClick={() => void handleAdd()}
        disabled={add.isPending || added}
        className="text-xs px-2 py-0.5 rounded font-medium flex-shrink-0"
        style={{
          background: added ? 'var(--color-success)' : 'var(--accent)',
          color: added ? '#fff' : 'var(--accent-fg)',
          opacity: added ? 0.8 : 1,
        }}
      >
        {added ? 'Added' : '+'}
      </button>
    </div>
  );
}
