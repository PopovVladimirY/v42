import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '@/api/endpoints/projects';
import { projectKeys } from '@/hooks/useProjects';
import type { Project, ProjectStatus } from '@/types';

const STATUS_BADGE: Record<ProjectStatus, { label: string; color: string }> = {
  active:    { label: 'Active',   color: 'var(--color-success)' },
  on_hold:   { label: 'On Hold',  color: 'var(--color-warning)' },
  completed: { label: 'Done',     color: 'var(--text-3)'        },
  archived:  { label: 'Archived', color: 'var(--text-3)'        },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface TreeNode extends Project {
  children: TreeNode[];
}

function buildTree(projects: Project[]): TreeNode[] {
  const byParent = new Map<string | null, Project[]>();
  for (const p of projects) {
    const key = p.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(p);
  }
  for (const ch of byParent.values())
    ch.sort((a, b) => a.order_index - b.order_index || a.node_number - b.node_number);
  const build = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? []).map(p => ({ ...p, children: build(p.id) }));
  return build(null);
}

// Is this node (or any descendant) visible under the current filter?
function nodeVisible(node: TreeNode, filter: ProjectStatus | 'all'): boolean {
  if (filter === 'all') return true; // admin sees everything
  if (filter === 'archived') return node.status === 'archived' || node.children.some(c => nodeVisible(c, filter));
  return node.status === filter || node.children.some(c => nodeVisible(c, filter));
}

// Does this node itself match the filter (full opacity vs dimmed)?
function nodeMatches(node: TreeNode, filter: ProjectStatus | 'all'): boolean {
  if (filter === 'all') return node.status !== 'archived';
  if (filter === 'archived') return node.status === 'archived';
  return node.status === filter;
}

function AdminTreeRow({
  node, depth, filter, onArchive, onUnarchive,
}: {
  node: TreeNode;
  depth: number;
  filter: ProjectStatus | 'all';
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
}) {
  if (!nodeVisible(node, filter)) return null;
  const badge = STATUS_BADGE[node.status] ?? STATUS_BADGE.active;
  const matches = nodeMatches(node, filter);

  return (
    <>
      <div
        className="flex items-center gap-3 py-2.5 transition-colors hover:bg-[var(--bg-hover)]"
        style={{
          paddingLeft: `${16 + depth * 24}px`,
          paddingRight: 16,
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          opacity: matches ? 1 : 0.45,
        }}
      >
        {depth > 0 && (
          <span style={{ color: 'var(--text-3)', fontSize: 11, userSelect: 'none', flexShrink: 0 }}>
            {'\u2514'}
          </span>
        )}
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: badge.color, flexShrink: 0 }} />
        <div className="flex-1 min-w-0">
          <Link
            to={`/projects/${node.id}/backlog`}
            className="text-sm font-medium hover:underline truncate block"
            style={{ color: 'var(--text-1)' }}
          >
            {node.name}
          </Link>
          {node.description && (
            <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-3)' }}>{node.description}</p>
          )}
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
          style={{ color: badge.color, background: `${badge.color}18`, border: `1px solid ${badge.color}40` }}
        >
          {badge.label}
        </span>
        <span className="text-xs hidden sm:block flex-shrink-0" style={{ color: 'var(--text-3)', minWidth: 110, textAlign: 'right' }}>
          {fmtDate(node.created_at)}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            to={`/projects/${node.id}/backlog`}
            className="text-xs px-2.5 py-1 rounded-md hover:opacity-80 transition-opacity"
            style={{ background: 'var(--bg-elevated)', color: 'var(--accent)', border: '1px solid var(--border)' }}
          >
            Open
          </Link>
          {node.status !== 'archived' ? (
            <button
              onClick={() => onArchive(node.id)}
              className="text-xs px-2.5 py-1 rounded-md hover:opacity-80 transition-opacity"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
            >
              Archive
            </button>
          ) : (
            <button
              onClick={() => onUnarchive(node.id)}
              className="text-xs px-2.5 py-1 rounded-md hover:opacity-80 transition-opacity"
              style={{ background: 'var(--bg-elevated)', color: 'var(--color-success)', border: '1px solid var(--border)' }}
            >
              Restore
            </button>
          )}
        </div>
      </div>
      {node.children.map((child) => (
        <AdminTreeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          filter={filter}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
        />
      ))}
    </>
  );
}

export function AdminProjectsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const { data: activeRoots = [], isLoading } = useQuery({
    queryKey: projectKeys.all,
    queryFn: async () => {
      const { data } = await projectsApi.list();
      return data.data ?? [];
    },
  });

  // Always load archived roots so admin sees the complete tree
  const { data: archivedRoots = [] } = useQuery({
    queryKey: ['projects', 'archived'],
    queryFn: async () => {
      const { data } = await projectsApi.listArchived();
      return data.data ?? [];
    },
  });

  const allRoots = [...activeRoots, ...archivedRoots];

  // Fetch full subtree (including archived children) for each root in parallel
  const treeQueries = useQueries({
    queries: allRoots.map(root => ({
      queryKey: ['project-tree', root.id, true],
      queryFn: async () => {
        const { data } = await projectsApi.getTree(root.id, true);
        return data.data ?? [];
      },
    })),
  });

  // Merge + deduplicate all subtree nodes, then build tree
  const allNodes = Array.from(
    new Map(
      treeQueries.flatMap(q => q.data ?? []).map(p => [p.id, p])
    ).values()
  );
  const activeProjects = allNodes.filter(p => !p.is_archived);
  const archivedProjects = allNodes.filter(p => p.is_archived);

  const createProject = useMutation({
    mutationFn: () => projectsApi.create({ name: newName.trim(), description: newDesc.trim() || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectKeys.all });
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
    },
  });

  const archiveProject = useMutation({
    mutationFn: (id: string) => projectsApi.archive(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectKeys.all });
      void qc.invalidateQueries({ queryKey: ['projects', 'archived'] });
    },
  });

  const unarchiveProject = useMutation({
    mutationFn: (id: string) => projectsApi.unarchive(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectKeys.all });
      void qc.invalidateQueries({ queryKey: ['projects', 'archived'] });
    },
  });

  const tree = buildTree(allNodes);
  const hasVisible = tree.some(n => nodeVisible(n, statusFilter));

  const counts = {
    all:       activeProjects.length,
    active:    activeProjects.filter((p) => p.status === 'active').length,
    on_hold:   activeProjects.filter((p) => p.status === 'on_hold').length,
    completed: activeProjects.filter((p) => p.status === 'completed').length,
    archived:  archivedProjects.length,
  };

  return (
    <div className="w-full px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-1)' }}>Projects</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
            All projects across all teams
          </p>
        </div>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg, #fff)' }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            New Project
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div
          className="mb-6 p-4 rounded-xl"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-1)' }}>New Project</p>
          <div className="flex flex-col gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name *"
              className="text-sm rounded-lg px-3 py-2 outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
              onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) createProject.mutate(); }}
            />
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              className="text-sm rounded-lg px-3 py-2 outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            />
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => createProject.mutate()}
                disabled={!newName.trim() || createProject.isPending}
                className="text-sm px-4 py-1.5 rounded-lg disabled:opacity-40 transition-opacity"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg, #fff)' }}
              >
                {createProject.isPending ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => { setShowCreate(false); setNewName(''); setNewDesc(''); }}
                className="text-sm px-4 py-1.5 rounded-lg"
                style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stat chips / filter */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {([
          { key: 'all',       label: `All (${counts.all})` },
          { key: 'active',    label: `Active (${counts.active})` },
          { key: 'on_hold',   label: `On Hold (${counts.on_hold})` },
          { key: 'completed', label: `Done (${counts.completed})` },
          { key: 'archived',  label: `Archived (${counts.archived})` },
        ] as { key: ProjectStatus | 'all'; label: string }[]).map((chip) => (
          <button
            key={chip.key}
            onClick={() => setStatusFilter(chip.key)}
            className="text-xs px-3 py-1 rounded-full transition-colors"
            style={{
              background: statusFilter === chip.key ? 'var(--accent)' : 'var(--bg-surface)',
              color:      statusFilter === chip.key ? 'var(--accent-fg, #fff)' : 'var(--text-2)',
              border: `1px solid ${statusFilter === chip.key ? 'var(--accent)' : 'var(--border)'}`,
            }}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Project tree */}
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: 'var(--bg-surface)' }} />
          ))}
        </div>
      ) : !hasVisible ? (
        <div className="rounded-xl p-10 text-center" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>No projects here.</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {/* Header row */}
          <div
            className="flex items-center gap-3 px-4 py-2 text-xs font-semibold uppercase tracking-wide"
            style={{ background: 'var(--bg-surface)', color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}
          >
            <span style={{ flex: 1 }}>Project</span>
            <span style={{ minWidth: 80 }}>Status</span>
            <span className="hidden sm:block" style={{ minWidth: 110, textAlign: 'right' }}>Created</span>
            <span style={{ minWidth: 120 }}></span>
          </div>
          {tree.map((root) => (
            <AdminTreeRow
              key={root.id}
              node={root}
              depth={0}
              filter={statusFilter}
              onArchive={(id) => archiveProject.mutate(id)}
              onUnarchive={(id) => unarchiveProject.mutate(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
