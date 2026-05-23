import React, { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useBacklog,
  useCreateBacklogItem,
  useUpdateBacklogItem,
  useDeleteBacklogItem,
} from '@/hooks/useProjects';
import { useEpics } from '@/hooks/useProjects';
import { useSprints } from '@/hooks/useSprints';
import { useTasks, useItemTests, useMoveTask, useMoveItemTest } from '@/hooks/useItemDetails';
import { CLARITY_COLOR, CLARITY_LABEL, STATUS_COLOR, STATUS_LABEL } from '@/types';
import type { BacklogItem, BacklogItemStatus, BacklogItemType, ClarityQuadrant } from '@/types';
import { usePaginationStore } from '@/stores/usePagination';
import { Paginator } from '@/components/Paginator';

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



// -- Create item panel -------------------------------------------------------

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

// -- Expanded panel: tasks + tests for a single backlog item -----------------

function ExpandedItemPanel({
  projectId,
  item,
  allItems,
}: {
  projectId: string;
  item: BacklogItem;
  allItems: BacklogItem[];
}) {
  const { data: tasks = [], isLoading: loadingTasks } = useTasks(projectId, item.id);
  const { data: tests = [], isLoading: loadingTests } = useItemTests(projectId, item.id);
  const moveTask = useMoveTask(projectId);
  const moveTest = useMoveItemTest(projectId);

  const TASK_STATUS_COLOR: Record<string, string> = {
    todo: '#6B7280',
    in_progress: '#3B82F6',
    done: '#22C55E',
    cancelled: '#EF4444',
  };

  return (
    <tr style={{ background: 'var(--bg-elevated)' }}>
      <td colSpan={10} className="px-0 pb-0 pt-0">
        <div className="px-8 py-3 flex flex-col gap-3" style={{ borderTop: '1px solid var(--border)' }}>
          {/* Tasks */}
          <div>
            <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-3)' }}>
              Tasks{tasks.length > 0 ? ` (${tasks.length})` : ''}
            </p>
            {loadingTasks && <p className="text-xs" style={{ color: 'var(--text-3)' }}>Loading...</p>}
            {!loadingTasks && tasks.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>No tasks yet</p>
            )}
            {tasks.map((task) => (
              <div
                key={task.id}
                className="group/row flex items-center gap-3 py-1 rounded px-1 hover:bg-[var(--bg-surface)] transition-colors"
              >
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
                  style={{ background: TASK_STATUS_COLOR[task.status] ?? '#6B7280', color: '#fff' }}
                >
                  {task.status.replace('_', ' ')}
                </span>
                <Link
                  to={`/projects/${projectId}/backlog/${item.id}`}
                  className="text-xs flex-1 truncate hover:underline"
                  style={{ color: 'var(--text-1)' }}
                  title={task.title}
                  onClick={(e) => e.stopPropagation()}
                >
                  {task.title}
                </Link>
                {task.estimate && (
                  <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--accent)' }}>
                    {task.estimate}
                  </span>
                )}
                <MoveDropdown
                  label="task"
                  items={allItems}
                  currentItemId={item.id}
                  isPending={moveTask.isPending}
                  onMove={(toItemId) => moveTask.mutate({ taskId: task.id, fromItemId: item.id, toItemId })}
                />
              </div>
            ))}
          </div>

          {/* Tests */}
          <div>
            <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-3)' }}>
              Tests{tests.length > 0 ? ` (${tests.length})` : ''}
            </p>
            {loadingTests && <p className="text-xs" style={{ color: 'var(--text-3)' }}>Loading...</p>}
            {!loadingTests && tests.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>No tests yet</p>
            )}
            {tests.map((test) => (
              <div
                key={test.id}
                className="group/row flex items-center gap-3 py-1 rounded px-1 hover:bg-[var(--bg-surface)] transition-colors"
              >
                <span
                  className="text-xs px-1.5 py-0.5 rounded font-mono flex-shrink-0"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-3)' }}
                >
                  {test.type}
                </span>
                <Link
                  to={`/projects/${projectId}/backlog/${item.id}`}
                  className="text-xs flex-1 truncate hover:underline"
                  style={{ color: 'var(--text-1)' }}
                  title={test.title}
                  onClick={(e) => e.stopPropagation()}
                >
                  {test.title}
                </Link>
                <MoveDropdown
                  label="test"
                  items={allItems}
                  currentItemId={item.id}
                  isPending={moveTest.isPending}
                  onMove={(toItemId) => moveTest.mutate({ testId: test.id, fromItemId: item.id, toItemId })}
                />
              </div>
            ))}
          </div>
        </div>
      </td>
    </tr>
  );
}

// -- Create item panel -------------------------------------------------------

function CreateItemPanel({
  projectId,
  epicId,
  onClose,
}: {
  projectId: string;
  epicId?: string;
  onClose: () => void;
}) {
  const { data: epics = [] } = useEpics(projectId);
  const createItem = useCreateBacklogItem(projectId);

  const [title, setTitle] = useState('');
  const [type, setType] = useState<BacklogItemType>('story');
  const [chosenEpicId, setChosenEpicId] = useState(epicId ?? '');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await createItem.mutateAsync({
      title: title.trim(),
      type,
      epic_id: chosenEpicId || undefined,
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
          {epics.length > 0 && (
            <select
              data-testid="new-item-epic"
              value={chosenEpicId}
              onChange={(e) => setChosenEpicId(e.target.value)}
              className="rounded-md px-2 py-1.5 text-sm outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            >
              <option value="">No epic</option>
              {epics.map((ep) => (
                <option key={ep.id} value={ep.id}>{ep.title}</option>
              ))}
            </select>
          )}
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
type SavedFilters = { status: BacklogItemStatus | ''; clarity: ClarityQuadrant | ''; epicId: string; sprintId: string; text: string };
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

export function BacklogPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(1);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const pageSize = usePaginationStore((s) => s.getPageSize('backlog'));

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
  const [filterEpicId,   setFilterEpicIdRaw]   = useState(saved?.epicId ?? '');
  const [filterSprintId, setFilterSprintIdRaw] = useState(saved?.sprintId ?? '');
  const [filterText,     setFilterTextRaw]     = useState(saved?.text ?? '');
  const [sortField,      setSortField]          = useState<SortField | null>(null);
  const [sortDir,        setSortDir]            = useState<SortDir>(null);

  function _save(overrides: Partial<SavedFilters>) {
    if (projectId) _saveFilters(projectId, { status: filterStatus, clarity: filterClarity, epicId: filterEpicId, sprintId: filterSprintId, text: filterText, ...overrides });
  }
  function setFilterStatus(v: BacklogItemStatus | '')   { setFilterStatusRaw(v);   setPage(1); _save({ status: v }); }
  function setFilterClarity(v: ClarityQuadrant | '')    { setFilterClarityRaw(v);  setPage(1); _save({ clarity: v }); }
  function setFilterEpicId(v: string)                   { setFilterEpicIdRaw(v);   setPage(1); _save({ epicId: v }); }
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

  const { data: epics = [] } = useEpics(projectId ?? '');
  const { data: sprints = [] } = useSprints(projectId ?? '');
  const { data: backlog = [], isLoading, isError } = useBacklog(projectId ?? '', {
    status: filterStatus || undefined,
    clarity: filterClarity || undefined,
    epic_id: filterEpicId || undefined,
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

        {epics.length > 0 && (
          <select
            data-testid="filter-epic"
            value={filterEpicId}
            onChange={(e) => setFilterEpicId(e.target.value)}
            className="rounded-md px-2 py-1.5 text-xs outline-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          >
            <option value="">All epics</option>
            {epics.map((ep) => (
              <option key={ep.id} value={ep.id}>{ep.title}</option>
            ))}
          </select>
        )}

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
        <>
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
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '8rem' }}>Epic</th>
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
                  const epicTitle = epics.find((e) => e.id === item.epic_id)?.title;
                  const isExpanded = expandedItems.has(item.id);
                  return (
                    <React.Fragment key={item.id}>
                      <tr
                        data-testid={`backlog-row-${item.id}`}
                        className="group transition-colors hover:bg-[var(--bg-elevated)]"
                        style={{ borderBottom: isExpanded ? 'none' : '1px solid var(--border)' }}
                      >
                        <td className="px-2 py-2 align-middle" style={{ width: '2rem' }}>
                          <button
                            onClick={() => toggleExpand(item.id)}
                            title={isExpanded ? 'Collapse' : 'Expand tasks & tests'}
                            className="text-xs w-5 h-5 flex items-center justify-center rounded transition-colors hover:bg-[var(--bg-elevated)]"
                            style={{ color: 'var(--text-3)', fontFamily: 'monospace', lineHeight: 1 }}
                          >
                            {isExpanded ? '-' : '+'}
                          </button>
                        </td>
                        <td className="px-3 py-2 align-middle" style={{ width: '4rem' }}>
                          <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>B-{item.number}</span>
                        </td>
                      <td className="px-3 py-2 align-middle">
                        <span className="text-xs font-mono uppercase opacity-60" style={{ color: 'var(--text-3)' }}>
                          {item.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle" style={{ maxWidth: 0 }}>
                        <Link
                          to={`/projects/${projectId}/backlog/${item.id}`}
                          className="block truncate hover:underline text-sm"
                          style={{ color: 'var(--text-1)' }}
                          title={item.title}
                        >
                          {item.title}
                        </Link>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        {epicTitle && (
                          <span className="text-xs truncate block" style={{ color: 'var(--text-3)', maxWidth: '7rem' }} title={epicTitle}>
                            {epicTitle}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <ClarityBadge clarity={item.clarity} />
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <StatusPill item={item} projectId={projectId} />
                      </td>
                      <td className="px-3 py-2 align-middle">
                        {item.estimate && (
                          <span className="text-xs font-mono font-semibold" style={{ color: 'var(--accent)' }}>{item.estimate}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-middle">
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
                      <td className="px-3 py-2 align-middle">
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
                    </tr>
                    {isExpanded && (
                      <ExpandedItemPanel
                        projectId={projectId}
                        item={item}
                        allItems={items}
                      />
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Paginator page={page} pageSize={pageSize} total={total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
