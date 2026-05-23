import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useBacklog,
  useCreateBacklogItem,
  useUpdateBacklogItem,
  useDeleteBacklogItem,
} from '@/hooks/useProjects';
import { useEpics } from '@/hooks/useProjects';
import { CLARITY_COLOR, CLARITY_LABEL } from '@/types';
import type { BacklogItem, BacklogItemStatus, BacklogItemType, ClarityQuadrant } from '@/types';

// -- Constants ---------------------------------------------------------------

const TYPE_OPTS: { value: BacklogItemType; label: string }[] = [
  { value: 'story', label: 'Story' },
  { value: 'bug',   label: 'Bug'   },
  { value: 'task',  label: 'Task'  },
  { value: 'spike', label: 'Spike' },
];

const STATUS_OPTS: { value: BacklogItemStatus; label: string; color: string }[] = [
  { value: 'open',        label: 'Open',        color: 'var(--text-3)'        },
  { value: 'in_review',   label: 'In Review',   color: 'var(--color-info)'    },
  { value: 'in_progress', label: 'In Progress', color: 'var(--accent)'        },
  { value: 'done',        label: 'Done',        color: 'var(--color-success)' },
  { value: 'cancelled',   label: 'Cancelled',   color: 'var(--text-3)'        },
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
  const current = STATUS_OPTS.find((s) => s.value === item.status);

  return (
    <div className="relative">
      <button
        data-testid={`status-pill-${item.id}`}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ color: current?.color ?? 'var(--text-3)', background: 'var(--bg-elevated)' }}
      >
        {current?.label ?? item.status}
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 rounded-lg overflow-hidden z-30 py-1 min-w-32"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 4px 16px rgba(0,0,0,.2)' }}
        >
          {STATUS_OPTS.map((s) => (
            <button
              key={s.value}
              data-testid={`status-opt-${s.value}`}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                if (s.value !== item.status) {
                  void update.mutate({ itemId: item.id, status: s.value });
                }
              }}
              className="w-full text-left text-xs px-3 py-1.5 hover:bg-[var(--bg-elevated)]"
              style={{ color: s.color }}
            >
              {s.label}
            </button>
          ))}
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

// -- Row in the backlog list -------------------------------------------------

function BacklogRow({
  item,
  projectId,
  onDelete,
}: {
  item: BacklogItem;
  projectId: string;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      data-testid={`backlog-row-${item.id}`}
      className="flex items-center gap-3 px-4 py-3 rounded-lg group"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      {/* Type chip */}
      <span className="text-xs font-mono uppercase opacity-50 w-16 flex-shrink-0" style={{ color: 'var(--text-3)' }}>
        {item.type}
      </span>

      {/* Title */}
      <Link
        to={`/projects/${projectId}/backlog/${item.id}`}
        className="flex-1 text-sm truncate hover:underline"
        style={{ color: 'var(--text-1)' }}
      >
        {item.title}
      </Link>

      {/* Clarity */}
      <ClarityBadge clarity={item.clarity} />

      {/* Status pill */}
      <StatusPill item={item} projectId={projectId} />

      {/* Estimate */}
      {item.estimate && (
        <span className="text-xs font-medium flex-shrink-0" style={{ color: 'var(--text-3)' }}>
          {item.estimate}
        </span>
      )}

      {/* Delete (maintainer+ only, hover reveals) */}
      <button
        data-testid={`delete-item-${item.id}`}
        onClick={() => onDelete(item.id)}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1.5 py-0.5 rounded"
        style={{ color: 'var(--color-danger)', background: 'var(--danger-muted)' }}
        title="Delete"
      >
        x
      </button>
    </div>
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

export function BacklogPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [showCreate, setShowCreate] = useState(false);

  // Filter state
  const [filterStatus, setFilterStatus] = useState<BacklogItemStatus | ''>('');
  const [filterClarity, setFilterClarity] = useState<ClarityQuadrant | ''>('');
  const [filterEpicId, setFilterEpicId] = useState('');

  const { data: epics = [] } = useEpics(projectId ?? '');
  const { data: items = [], isLoading, isError } = useBacklog(projectId ?? '', {
    status: filterStatus || undefined,
    clarity: filterClarity || undefined,
    epic_id: filterEpicId || undefined,
  });
  const deleteItem = useDeleteBacklogItem(projectId ?? '');

  function handleDelete(id: string) {
    if (!confirm('Delete this backlog item?')) return;
    void deleteItem.mutate(id);
  }

  if (!projectId) return null;

  return (
    <div className="h-full overflow-y-auto px-6 py-4 flex flex-col gap-4">
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
            <option key={s.value} value={s.value}>{s.label}</option>
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

        <div className="flex-1" />

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
      {isLoading && (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading...</p>
      )}
      {isError && (
        <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Failed to load backlog.</p>
      )}
      {!isLoading && !isError && items.length === 0 && (
        <div
          className="rounded-xl p-10 text-center"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>Backlog is empty. Add something!</p>
        </div>
      )}
      <div className="flex flex-col gap-2" data-testid="backlog-list">
        {items.map((item) => (
          <BacklogRow key={item.id} item={item} projectId={projectId} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  );
}
