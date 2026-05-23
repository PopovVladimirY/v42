import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useBacklog,
  useCreateBacklogItem,
  useUpdateBacklogItem,
  useDeleteBacklogItem,
} from '@/hooks/useProjects';
import { useEpics } from '@/hooks/useProjects';
import { useSprints } from '@/hooks/useSprints';
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
  const pageSize = usePaginationStore((s) => s.getPageSize('backlog'));

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
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full border-collapse" data-testid="backlog-list">
              <thead style={{ background: 'var(--bg-elevated)' }}>
                <tr>
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
                    <td colSpan={9} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--text-3)' }}>
                      {total === 0 ? 'Backlog is empty. Add something!' : 'No items on this page.'}
                    </td>
                  </tr>
                )}
                {pageItems.map((item) => {
                  const epicTitle = epics.find((e) => e.id === item.epic_id)?.title;
                  return (
                    <tr
                      key={item.id}
                      data-testid={`backlog-row-${item.id}`}
                      className="group transition-colors hover:bg-[var(--bg-elevated)]"
                      style={{ borderBottom: '1px solid var(--border)' }}
                    >
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
