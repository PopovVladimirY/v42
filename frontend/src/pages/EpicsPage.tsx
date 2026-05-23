import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useEpics, useCreateEpic, useUpdateEpic, useDeleteEpic } from '@/hooks/useProjects';
import type { Epic, EpicStatus, ClarityQuadrant } from '@/types';
import { CLARITY_COLOR, CLARITY_LABEL } from '@/types';
import { usePaginationStore } from '@/stores/usePagination';
import { Paginator } from '@/components/Paginator';

const STATUS_OPTS: { value: EpicStatus; label: string; color: string; bg: string }[] = [
  { value: 'open',        label: 'Open',        color: 'var(--text-2)',        bg: 'var(--bg-elevated)'                                                    },
  { value: 'in_progress', label: 'In Progress', color: 'var(--accent)',        bg: 'color-mix(in srgb, var(--accent) 12%, var(--bg-elevated))'             },
  { value: 'done',        label: 'Done',        color: 'var(--color-success)', bg: 'color-mix(in srgb, var(--color-success) 12%, var(--bg-elevated))'      },
  { value: 'cancelled',   label: 'Cancelled',   color: 'var(--text-3)',        bg: 'var(--bg-elevated)'                                                    },
];

const STATUS_SORT_ORDER: Record<EpicStatus, number> = { open: 0, in_progress: 1, done: 2, cancelled: 3 };

function statusOpt(status: EpicStatus) {
  return STATUS_OPTS.find((s) => s.value === status) ?? STATUS_OPTS[0];
}

const CLARITY_OPTS: { value: ClarityQuadrant; label: string }[] = [
  { value: 'clear',   label: CLARITY_LABEL.clear   },
  { value: 'scoped',  label: CLARITY_LABEL.scoped  },
  { value: 'tacit',   label: CLARITY_LABEL.tacit   },
  { value: 'foggy',   label: CLARITY_LABEL.foggy   },
  { value: 'unknown', label: CLARITY_LABEL.unknown  },
];

function ClarityBadge({ clarity }: { clarity: ClarityQuadrant }) {
  return (
    <span
      data-testid={`epic-clarity-badge-${clarity}`}
      className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
      style={{ background: CLARITY_COLOR[clarity], color: '#fff' }}
    >
      {CLARITY_LABEL[clarity]}
    </span>
  );
}

// First line of description -- max 100 chars, stops at first newline
function firstLine(desc: string | null | undefined): string {
  if (!desc) return '';
  const nl = desc.indexOf('\n');
  const s  = nl >= 0 ? desc.slice(0, nl) : desc;
  return s.length > 100 ? s.slice(0, 100) + '...' : s;
}

// Persist filters to localStorage
const _FILTERS_KEY = (pid: string) => `v42-epics-filters-${pid}`;
type SavedFilters = { status: EpicStatus | ''; clarity: ClarityQuadrant | ''; text: string };
function _loadFilters(pid: string): SavedFilters | null {
  try { const r = localStorage.getItem(_FILTERS_KEY(pid)); return r ? JSON.parse(r) as SavedFilters : null; }
  catch { return null; }
}
function _saveFilters(pid: string, f: SavedFilters) {
  try { localStorage.setItem(_FILTERS_KEY(pid), JSON.stringify(f)); } catch { /* quota */ }
}

// -- Epic edit panel -------------------------------------------------------
// Full-form editor shown when user clicks an epic title.
// Handles rename, description, status -- all in one place.

function EpicEditPanel({
  epic,
  projectId,
  onDone,
  onCancel,
}: {
  epic: Epic;
  projectId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const updateEpic = useUpdateEpic(projectId);
  const [title, setTitle]     = useState(epic.title);
  const [desc,  setDesc]      = useState(epic.description ?? '');
  const [status, setStatus]   = useState<EpicStatus>(epic.status);
  const [clarity, setClarity] = useState<ClarityQuadrant>(epic.clarity);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await updateEpic.mutateAsync({
      epicId: epic.id,
      title:   title.trim() !== epic.title          ? title.trim()         : undefined,
      description: desc !== (epic.description ?? '') ? desc || undefined    : undefined,
      status:  status  !== epic.status              ? status               : undefined,
      clarity: clarity !== epic.clarity             ? clarity              : undefined,
    });
    onDone();
  }

  const inp = 'rounded-lg px-3 py-2 text-sm outline-none w-full';
  const inpStyle = { background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-1)' };

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)' }}
    >
      <form onSubmit={handleSave} className="flex flex-col gap-3">
        <div className="flex gap-3">
          <div className="flex-1 flex flex-col gap-1">
            <label className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Title</label>
            <input
              data-testid="epic-edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inp}
              style={inpStyle}
              maxLength={255}
              autoFocus
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Status</label>
            <select
              data-testid="epic-edit-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as EpicStatus)}
              className="rounded-lg px-2 py-2 text-sm outline-none"
              style={{ ...inpStyle, minWidth: '9rem' }}
            >
              {STATUS_OPTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Clarity</label>
            <select
              data-testid="epic-edit-clarity"
              value={clarity}
              onChange={(e) => setClarity(e.target.value as ClarityQuadrant)}
              className="rounded-lg px-2 py-2 text-sm outline-none"
              style={{ ...inpStyle, minWidth: '8rem' }}
            >
              {CLARITY_OPTS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Description</label>
          <textarea
            data-testid="epic-edit-desc"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="Multi-line description, URLs, etc."
            className={`${inp} resize-y`}
            style={inpStyle}
          />
        </div>
        {updateEpic.isError && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>Save failed.</p>}
        <div className="flex gap-2">
          <button
            data-testid="epic-edit-save"
            type="submit"
            disabled={!title.trim() || updateEpic.isPending}
            className="px-3 py-1.5 text-sm font-medium rounded-md disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            {updateEpic.isPending ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-md"
            style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// -- Epic table row (read-only, opens edit panel on title click) -----------

function EpicRow({
  epic,
  projectId,
  onEdit,
}: {
  epic: Epic;
  projectId: string;
  onEdit: (id: string) => void;
}) {
  const deleteEpic = useDeleteEpic(projectId);
  const opt = statusOpt(epic.status);
  const descLine = firstLine(epic.description);

  function handleDelete() {
    if (!confirm(`Delete epic "${epic.title}"?`)) return;
    void deleteEpic.mutate(epic.id);
  }

  return (
    <tr className="group border-b" style={{ borderColor: 'var(--border)' }}>
      {/* E-XX number */}
      <td className="px-3 py-2 align-middle" style={{ width: '3.5rem' }}>
        <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>E-{epic.number}</span>
      </td>
      {/* Title -- click opens edit panel */}
      <td className="px-3 py-2 align-middle" style={{ maxWidth: 0 }}>
        <span
          data-testid="epic-title"
          className="block truncate text-sm cursor-pointer hover:underline"
          style={{ color: 'var(--text-1)' }}
          onClick={() => onEdit(epic.id)}
          title={epic.title}
        >
          {epic.title}
        </span>
      </td>

      {/* Description -- first line only */}
      <td className="px-3 py-2 align-middle" style={{ maxWidth: 0 }}>
        {descLine && (
          <span className="block truncate text-xs" style={{ color: 'var(--text-3)' }} title={epic.description ?? ''}>
            {descLine}
          </span>
        )}
      </td>

      {/* Status -- colored pill */}
      <td className="px-3 py-2 align-middle">
        <span
          data-testid={`epic-status-${epic.id}`}
          className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
          style={{ color: opt.color, background: opt.bg, border: `1px solid ${opt.color}30` }}
        >
          {opt.label}
        </span>
      </td>

      {/* Clarity badge */}
      <td className="px-3 py-2 align-middle">
        <ClarityBadge clarity={epic.clarity} />
      </td>

      {/* Delete */}
      <td className="px-3 py-2 align-middle">
        <button
          data-testid={`delete-epic-${epic.id}`}
          onClick={handleDelete}
          title="Delete"
          className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1 py-0.5 rounded"
          style={{ color: 'var(--color-danger)' }}
        >
          x
        </button>
      </td>
    </tr>
  );
}
// -- Create form panel -------------------------------------------------------

function CreateEpicPanel({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const createEpic = useCreateEpic(projectId);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await createEpic.mutateAsync({ title: title.trim(), description: desc.trim() || undefined });
    onClose();
  }

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--accent)' }}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          data-testid="new-epic-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
          placeholder="Epic title"
          className="rounded-md px-3 py-1.5 text-sm outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          autoFocus
          required
        />
        <textarea
          data-testid="new-epic-desc"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Description (optional)"
          className="rounded-md px-3 py-1.5 text-sm outline-none resize-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        />
        {createEpic.isError && (
          <p className="text-xs" style={{ color: 'var(--color-danger)' }}>Failed. Try again.</p>
        )}
        <div className="flex gap-2">
          <button
            data-testid="new-epic-submit"
            type="submit"
            disabled={!title.trim() || createEpic.isPending}
            className="px-3 py-1.5 text-sm font-medium rounded-md disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            {createEpic.isPending ? 'Creating...' : 'Create epic'}
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

type SortField = 'title' | 'status' | 'clarity';
type SortDir   = 'asc' | 'desc';

export function EpicsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [page,       setPage]       = useState(1);
  const [sortField,  setSortField]  = useState<SortField | null>(null);
  const [sortDir,    setSortDir]    = useState<SortDir>('asc');
  const pageSize = usePaginationStore((s) => s.getPageSize('epics'));

  const saved = projectId ? _loadFilters(projectId) : null;
  const [filterStatus,  setFilterStatusRaw]  = useState<EpicStatus | ''>(saved?.status ?? '');
  const [filterClarity, setFilterClarityRaw] = useState<ClarityQuadrant | ''>(saved?.clarity ?? '');
  const [filterText,    setFilterTextRaw]    = useState(saved?.text ?? '');

  function setFilterStatus(v: EpicStatus | '') {
    setFilterStatusRaw(v); setPage(1);
    if (projectId) _saveFilters(projectId, { status: v, clarity: filterClarity, text: filterText });
  }
  function setFilterClarity(v: ClarityQuadrant | '') {
    setFilterClarityRaw(v); setPage(1);
    if (projectId) _saveFilters(projectId, { status: filterStatus, clarity: v, text: filterText });
  }
  function setFilterText(v: string) {
    setFilterTextRaw(v); setPage(1);
    if (projectId) _saveFilters(projectId, { status: filterStatus, clarity: filterClarity, text: v });
  }

  function toggleSort(field: SortField) {
    if (sortField === field) { setSortDir((d) => d === 'asc' ? 'desc' : 'asc'); }
    else { setSortField(field); setSortDir('asc'); }
    setPage(1);
  }

  const { data: epics = [], isLoading, isError } = useEpics(projectId ?? '');
  const editingEpic = epics.find((e) => e.id === editingId) ?? null;

  const filtered = useMemo(() => {
    let list = epics;
    if (filterStatus)  list = list.filter((e) => e.status  === filterStatus);
    if (filterClarity) list = list.filter((e) => e.clarity === filterClarity);
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      list = list.filter((e) =>
        e.title.toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q)
      );
    }
    if (sortField) {
      list = [...list].sort((a, b) => {
        let cmp = 0;
        if (sortField === 'title')   cmp = a.title.localeCompare(b.title);
        if (sortField === 'status')  cmp = STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status];
        if (sortField === 'clarity') cmp = a.clarity.localeCompare(b.clarity);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [epics, filterStatus, filterClarity, filterText, sortField, sortDir]);

  const total     = filtered.length;
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  if (!projectId) return null;

  // Sort indicator -- ASCII only, no fancy Unicode
  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <span style={{ opacity: 0.3 }}> [o]</span>;
    return <span style={{ color: 'var(--accent)' }}>{sortDir === 'asc' ? ' [^]' : ' [v]'}</span>;
  }

  return (
    <div className="px-6 py-4 flex flex-col gap-3">

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          data-testid="filter-epic-status"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as EpicStatus | '')}
          className="rounded-md px-2 py-1.5 text-xs outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        >
          <option value="">All statuses</option>
          {STATUS_OPTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <select
          data-testid="filter-epic-clarity"
          value={filterClarity}
          onChange={(e) => setFilterClarity(e.target.value as ClarityQuadrant | '')}
          className="rounded-md px-2 py-1.5 text-xs outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        >
          <option value="">All clarity</option>
          {CLARITY_OPTS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>

        <input
          data-testid="filter-epic-text"
          type="search"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Search title or description..."
          className="rounded-md px-3 py-1.5 text-xs outline-none flex-1 min-w-40"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        />

        <span className="text-xs" style={{ color: 'var(--text-3)' }}>{total} epic{total !== 1 ? 's' : ''}</span>

        <button
          data-testid="add-epic-btn"
          onClick={() => setShowCreate((v) => !v)}
          className="px-3 py-1.5 text-xs font-medium rounded-md"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          + New epic
        </button>
      </div>

      {showCreate && (
        <CreateEpicPanel projectId={projectId} onClose={() => setShowCreate(false)} />
      )}

      {/* Edit panel -- shown when editingId is set */}
      {editingEpic && (
        <EpicEditPanel
          epic={editingEpic}
          projectId={projectId}
          onDone={() => setEditingId(null)}
          onCancel={() => setEditingId(null)}
        />
      )}

      {isLoading && <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading...</p>}
      {isError   && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Failed to load epics.</p>}

      {!isLoading && !isError && (
        <>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full border-collapse" data-testid="epics-list">
              <thead style={{ background: 'var(--bg-elevated)' }}>
                <tr>
                  <th
                    className="text-xs font-medium text-left px-3 py-2"
                    style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '3.5rem' }}
                  >
                    ID
                  </th>
                  <th
                    className="text-xs font-medium text-left px-3 py-2 cursor-pointer select-none hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}
                    onClick={() => toggleSort('title')}
                  >
                    Title<SortIcon field="title" />
                  </th>
                  <th
                    className="text-xs font-medium text-left px-3 py-2"
                    style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}
                  >
                    Description
                  </th>
                  <th
                    className="text-xs font-medium text-left px-3 py-2 cursor-pointer select-none hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '9rem' }}
                    onClick={() => toggleSort('status')}
                  >
                    Status<SortIcon field="status" />
                  </th>
                  <th
                    className="text-xs font-medium text-left px-3 py-2 cursor-pointer select-none hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '7rem' }}
                    onClick={() => toggleSort('clarity')}
                  >
                    Clarity<SortIcon field="clarity" />
                  </th>
                  <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '2rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--text-3)' }}>
                      {total === 0 ? 'No epics yet.' : 'Nothing matches the filters.'}
                    </td>
                  </tr>
                )}
                {pageItems.map((ep) => (
                  <EpicRow key={ep.id} epic={ep} projectId={projectId} onEdit={setEditingId} />
                ))}
              </tbody>
            </table>
          </div>
          <Paginator page={page} pageSize={pageSize} total={total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
