import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useProjectTree, useProjectTeams, useCreateChild, useUpdateProject } from '@/hooks/useProjects';
import { useAuthStore } from '@/hooks/useAuth';
import type { Project } from '@/types';

const STATUS_BADGE: Record<Project['status'], { label: string; color: string; bg: string }> = {
  active:    { label: 'Active',   color: 'var(--color-success)', bg: 'var(--success-muted)' },
  on_hold:   { label: 'On Hold',  color: 'var(--color-warning)', bg: 'var(--warning-muted)' },
  completed: { label: 'Done',     color: 'var(--text-3)',        bg: 'var(--bg-elevated)'   },
  archived:  { label: 'Archived', color: 'var(--text-3)',        bg: 'var(--bg-elevated)'   },
};

// Build parentId -> children map, sorted by order_index
function buildTree(projects: Project[]): Map<string | null, Project[]> {
  const map = new Map<string | null, Project[]>();
  for (const p of projects) {
    const key = p.parent_id ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  for (const children of map.values()) {
    children.sort((a, b) => a.order_index - b.order_index || a.node_number - b.node_number);
  }
  return map;
}

function SubNodeModal({
  parentId,
  teamId,
  onClose,
}: {
  parentId: string;
  teamId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const createChild = useCreateChild(teamId);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await createChild.mutateAsync({ parentId, name: name.trim(), description: desc.trim() || undefined });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-md rounded-xl p-6 flex flex-col gap-4"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
      >
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-1)' }}>New stage / milestone</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>
              Name <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="e.g. Phase 2"
              className="w-full rounded-md px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Description</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="What's in scope?"
              className="w-full rounded-md px-3 py-2 text-sm outline-none resize-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            />
          </div>
          {createChild.isError && (
            <p className="text-xs" style={{ color: 'var(--color-danger)' }}>Failed to create. Try again.</p>
          )}
          <div className="flex gap-2 justify-end mt-2">
            <button
              type="button" onClick={onClose}
              className="px-4 py-1.5 text-sm rounded-md"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
            >Cancel</button>
            <button
              type="submit"
              disabled={!name.trim() || createChild.isPending}
              className="px-4 py-1.5 text-sm font-medium rounded-md disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >{createChild.isPending ? 'Creating...' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SubProjectNode({
  node,
  tree,
  depth,
  canCreate,
  onAddChild,
}: {
  node: Project;
  tree: Map<string | null, Project[]>;
  depth: number;
  canCreate: boolean;
  onAddChild: (parentId: string) => void;
}) {
  const children = tree.get(node.id) ?? [];
  const hasChildren = children.length > 0;
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const [editStart, setEditStart] = useState(node.start_date ?? '');
  const [editEnd, setEditEnd] = useState(node.end_date ?? '');
  const [editStatus, setEditStatus] = useState<Project['status']>(node.status);
  const update = useUpdateProject(node.id);

  const badge = STATUS_BADGE[node.status] ?? STATUS_BADGE.active;
  const nodeNum = `P-${String(node.node_number).padStart(4, '0')}`;

  function startEdit() {
    setEditName(node.name);
    setEditStart(node.start_date ?? '');
    setEditEnd(node.end_date ?? '');
    setEditStatus(node.status);
    setEditing(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    await update.mutateAsync({
      name: editName.trim() || node.name,
      start_date: editStart || null,
      end_date: editEnd || null,
      status: editStatus,
    });
    setEditing(false);
  }

  return (
    <div>
      {editing ? (
        <form
          onSubmit={saveEdit}
          className="flex items-center gap-2 px-3 py-1.5 border-b"
          style={{ paddingLeft: `${12 + depth * 20}px`, borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
        >
          <span style={{ width: '1.5rem', flexShrink: 0 }} />
          <span className="text-sm font-mono font-medium flex-shrink-0" style={{ color: 'var(--text-2)', minWidth: '5rem' }}>
            {nodeNum}
          </span>
          <input
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="flex-1 text-sm rounded px-2 py-0.5 outline-none min-w-0"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
            maxLength={200}
            required
          />
          <input
            type="date"
            value={editStart}
            onChange={(e) => setEditStart(e.target.value)}
            className="text-xs rounded px-1.5 py-0.5 outline-none"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
          />
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>→</span>
          <input
            type="date"
            value={editEnd}
            onChange={(e) => setEditEnd(e.target.value)}
            className="text-xs rounded px-1.5 py-0.5 outline-none"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
          />
          <select
            value={editStatus}
            onChange={(e) => setEditStatus(e.target.value as Project['status'])}
            className="text-xs rounded px-1.5 py-0.5 outline-none"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
          >
            <option value="active">Active</option>
            <option value="on_hold">On Hold</option>
            <option value="completed">Done</option>
            <option value="archived">Archived</option>
          </select>
          <button
            type="submit"
            disabled={update.isPending}
            className="text-xs px-2 py-0.5 rounded font-medium"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >{update.isPending ? '...' : 'Save'}</button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs px-2 py-0.5 rounded"
            style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
          >Cancel</button>
        </form>
      ) : (
        <div
          className="flex items-center gap-2 px-3 py-2 group transition-colors hover:bg-[var(--bg-elevated)]"
          style={{ paddingLeft: `${12 + depth * 20}px` }}
        >
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: '1.5rem',
              fontSize: '1.5rem',
              lineHeight: 1,
              color: hasChildren ? 'var(--text-2)' : 'transparent',
              cursor: hasChildren ? 'pointer' : 'default',
              background: 'none',
              border: 'none',
              padding: 0,
            }}
            tabIndex={hasChildren ? 0 : -1}
          >
            {hasChildren ? (expanded ? '▾' : '▸') : '▸'}
          </button>

          <span className="text-sm font-mono font-medium flex-shrink-0" style={{ color: 'var(--text-2)', minWidth: '5rem' }}>
            {nodeNum}
          </span>

          <Link
            to={`/projects/${node.id}`}
            className="flex-1 text-sm font-medium truncate hover:underline"
            style={{ color: 'var(--text-1)' }}
          >
            {node.name}
          </Link>

          <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-3)', minWidth: '10rem' }}>
            {node.start_date || node.end_date
              ? `${node.start_date ?? '?'} \u2192 ${node.end_date ?? '?'}`
              : <span style={{ opacity: 0.4 }}>—</span>}
          </span>

          {node.total_items > 0 && (
            <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-3)' }}>
              {node.open_items}/{node.total_items}
            </span>
          )}

          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
            style={{ color: badge.color, background: badge.bg }}
          >
            {badge.label}
          </span>

          {canCreate && (
            <button
              onClick={startEdit}
              className="opacity-0 group-hover:opacity-100 text-xs px-1.5 py-0.5 rounded flex-shrink-0 transition-opacity"
              style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
              title="Edit"
              aria-label="Edit"
            >✎</button>
          )}

          {canCreate && (
            <button
              onClick={() => onAddChild(node.id)}
              className="opacity-0 group-hover:opacity-100 text-xs px-1.5 py-0.5 rounded flex-shrink-0 transition-opacity"
              style={{ color: 'var(--accent)', border: '1px solid var(--accent)' }}
              title="Add child"
            >+ Stage</button>
          )}
        </div>
      )}

      {expanded && children.map((child) => (
        <SubProjectNode
          key={child.id}
          node={child}
          tree={tree}
          depth={depth + 1}
          canCreate={canCreate}
          onAddChild={onAddChild}
        />
      ))}
    </div>
  );
}

export function ProjectSubProjectsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const user = useAuthStore((s) => s.user);
  const [modal, setModal] = useState<{ parentId: string } | null>(null);

  const { data: nodes = [], isLoading, isError } = useProjectTree(projectId ?? '');
  const { data: projectTeams = [] } = useProjectTeams(projectId ?? '');

  const canCreate = user?.role === 'admin' || user?.role === 'maintainer';
  const teamId = projectTeams[0]?.id ?? '';

  const tree = buildTree(nodes);
  // Direct children of the current project (not the project itself)
  const children = tree.get(projectId ?? null) ?? [];

  if (!projectId) return null;

  return (
    <div className="px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-2)' }}>Sub-projects</h2>
        <div className="flex items-center gap-2">
          {teamId && (
            <Link
              to={`/teams/${teamId}/projects`}
              className="text-xs hover:underline"
              style={{ color: 'var(--text-3)' }}
            >
              Full tree →
            </Link>
          )}
          {canCreate && teamId && (
            <button
              onClick={() => setModal({ parentId: projectId })}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md font-medium"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              + Stage
            </button>
          )}
        </div>
      </div>

      {isLoading && (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading...</p>
      )}
      {isError && (
        <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Failed to load sub-projects.</p>
      )}

      {!isLoading && !isError && children.length === 0 && (
        <div
          className="rounded-xl p-8 text-center"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm mb-1" style={{ color: 'var(--text-2)' }}>No sub-projects yet</p>
          {canCreate && teamId && (
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              Click{' '}
              <button
                onClick={() => setModal({ parentId: projectId })}
                className="hover:underline"
                style={{ color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >+ Stage</button>
              {' '}to add a sub-project or milestone.
            </p>
          )}
        </div>
      )}

      {children.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          {children.map((child) => (
            <SubProjectNode
              key={child.id}
              node={child}
              tree={tree}
              depth={0}
              canCreate={canCreate}
              onAddChild={(parentId) => setModal({ parentId })}
            />
          ))}
        </div>
      )}

      {modal && teamId && (
        <SubNodeModal
          parentId={modal.parentId}
          teamId={teamId}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
