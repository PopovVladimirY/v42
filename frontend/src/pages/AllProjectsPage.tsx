import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
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

// Visible if matches filter OR has a descendant that does
function nodeVisible(node: TreeNode, filter: ProjectStatus | 'all'): boolean {
  if (filter === 'all') return node.status !== 'archived';
  return node.status === filter || node.children.some(c => nodeVisible(c, filter));
}

function TreeRow({
  node, depth, filter,
}: {
  node: TreeNode;
  depth: number;
  filter: ProjectStatus | 'all';
}) {
  if (!nodeVisible(node, filter)) return null;
  const badge = STATUS_BADGE[node.status] ?? STATUS_BADGE.active;
  // Full opacity only if this node itself matches; otherwise dimmed (has matching descendant)
  const matches = filter === 'all' ? node.status !== 'archived' : node.status === filter;

  return (
    <>
      <Link
        to={`/projects/${node.id}/backlog`}
        className="flex items-center gap-3 py-2.5 transition-colors hover:bg-[var(--bg-hover)]"
        style={{
          paddingLeft: `${16 + depth * 24}px`,
          paddingRight: 16,
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          textDecoration: 'none',
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
          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-1)' }}>{node.name}</p>
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
        <span className="text-xs hidden sm:block flex-shrink-0" style={{ color: 'var(--text-3)', minWidth: 120, textAlign: 'right' }}>
          {fmtDate(node.created_at)}
        </span>
      </Link>
      {node.children.map((child) => (
        <TreeRow key={child.id} node={child} depth={depth + 1} filter={filter} />
      ))}
    </>
  );
}

// Sidebar "Projects" link -- full project tree, each node links to its backlog.
export function AllProjectsPage() {
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all');

  // Load root projects first, then fetch full subtree for each root in parallel
  const { data: roots = [], isLoading: rootsLoading } = useQuery({
    queryKey: projectKeys.all,
    queryFn: async () => {
      const { data } = await projectsApi.list();
      return data.data ?? [];
    },
  });

  const treeQueries = useQueries({
    queries: roots.map(root => ({
      queryKey: ['project-tree', root.id, false],
      queryFn: async () => {
        const { data } = await projectsApi.getTree(root.id, false);
        return data.data ?? [];
      },
    })),
  });

  const isLoading = rootsLoading || (roots.length > 0 && treeQueries.some(q => q.isPending));

  // Merge all subtree nodes, deduplicate by id, then build tree
  const allNodes = Array.from(
    new Map(
      treeQueries.flatMap(q => q.data ?? []).map(p => [p.id, p])
    ).values()
  );
  const projects = allNodes; // for counts below
  const tree = buildTree(allNodes);
  const hasVisible = tree.some(n => nodeVisible(n, statusFilter));

  const counts = {
    all:       projects.filter((p) => p.status !== 'archived').length,
    active:    projects.filter((p) => p.status === 'active').length,
    on_hold:   projects.filter((p) => p.status === 'on_hold').length,
    completed: projects.filter((p) => p.status === 'completed').length,
  };

  return (
    <div className="w-full px-6 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-1)' }}>Projects</h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>All projects available to you</p>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {([
          { key: 'all',       label: `All (${counts.all})` },
          { key: 'active',    label: `Active (${counts.active})` },
          { key: 'on_hold',   label: `On Hold (${counts.on_hold})` },
          { key: 'completed', label: `Done (${counts.completed})` },
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

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: 'var(--bg-surface)' }} />
          ))}
        </div>
      ) : !hasVisible ? (
        <div className="rounded-xl p-10 text-center" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>No projects found.</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {/* Table header */}
          <div
            className="flex items-center gap-3 px-4 py-2 text-xs font-semibold uppercase tracking-wide"
            style={{ background: 'var(--bg-surface)', color: 'var(--text-3)' }}
          >
            <span style={{ flex: 1 }}>Project</span>
            <span style={{ minWidth: 80 }}>Status</span>
            <span className="hidden sm:block" style={{ minWidth: 120, textAlign: 'right' }}>Created</span>
          </div>
          {tree.map((root) => (
            <TreeRow key={root.id} node={root} depth={0} filter={statusFilter} />
          ))}
        </div>
      )}
    </div>
  );
}
