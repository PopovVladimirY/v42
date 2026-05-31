import { useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useEpics } from '@/hooks/useProjects';
import { useBacklog } from '@/hooks/useProjects';
import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '@/api/endpoints/projects';
import { CLARITY_LABEL, STATUS_COLOR, STATUS_LABEL } from '@/types';
import type { BacklogItem, ClarityQuadrant, Project } from '@/types';

// Clarity squares -- hex mirror of the Tailwind palette used elsewhere.
const CLARITY_HEX: Record<string, string> = {
  clear:   '#10B981',
  scoped:  '#FBBF24',
  tacit:   '#F97316',
  foggy:   '#EF4444',
  unknown: '#6B7280',
};

function ClarityBadge({ clarity }: { clarity: ClarityQuadrant }) {
  return (
    <span
      className="inline-block w-5 h-5 rounded flex-shrink-0"
      style={{ background: CLARITY_HEX[clarity] ?? CLARITY_HEX.unknown }}
      title={`Clarity: ${CLARITY_LABEL[clarity]}`}
    />
  );
}

function StatusPill({ status }: { status: BacklogItem['status'] }) {
  const c = STATUS_COLOR[status] ?? { bg: 'var(--bg-elevated)', fg: 'var(--text-2)' };
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap" style={{ background: c.bg, color: c.fg }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// -- Page --------------------------------------------------------------------
// One epic, one backlog table. The "theme bucket" view of the backlog.

export function EpicDetailPage() {
  const { projectId, epicId } = useParams<{ projectId: string; epicId: string }>();
  const navigate = useNavigate();

  const { data: epics = [] } = useEpics(projectId ?? '');
  const epic = epics.find((e) => e.id === epicId) ?? null;

  const { data: items = [], isLoading, isError } = useBacklog(projectId ?? '', { epic_id: epicId });

  // Stage names for the Stage column.
  const { data: stageNodes = [] } = useQuery({
    queryKey: ['project-tree', projectId, false],
    queryFn: async () => {
      const { data } = await projectsApi.getTree(projectId!, false);
      return (data.data ?? []) as Project[];
    },
    enabled: !!projectId,
  });
  const stageNameById = useMemo(() => new Map(stageNodes.map((n) => [n.id, n.name])), [stageNodes]);

  if (!projectId || !epicId) return null;

  const total = items.length;
  const points = items.reduce((sum, it) => sum + (Number(it.estimate) || 0), 0);

  return (
    <div className="px-6 py-4 flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <Link to={`/projects/${projectId}/epics`} className="text-xs hover:underline w-fit" style={{ color: 'var(--accent)' }}>
          &#8592; Back to epics
        </Link>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>E-{epic?.number ?? '?'}</span>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-1)' }}>
            {epic?.title ?? 'Epic'}
          </h1>
          {epic && <ClarityBadge clarity={epic.clarity} />}
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
            {total} item{total !== 1 ? 's' : ''} &middot; {points} SP
          </span>
        </div>
        {epic?.description && (
          <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-2)' }}>{epic.description}</p>
        )}
      </div>

      {/* Backlog table */}
      {isLoading && <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading...</p>}
      {isError && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Failed to load backlog.</p>}

      {!isLoading && !isError && (
        <div className="rounded-xl" style={{ border: '1px solid var(--border)', overflow: 'clip' }}>
          <table className="w-full border-collapse" data-testid="epic-backlog-list">
            <thead style={{ background: 'var(--bg-elevated)' }}>
              <tr>
                <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '4rem' }}>ID</th>
                <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '5rem' }}>Type</th>
                <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>Title</th>
                <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '8rem' }}>Stage</th>
                <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '6rem' }}>Clarity</th>
                <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '8rem' }}>Status</th>
                <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '3.5rem' }} title="Story points">SP</th>
                <th className="text-xs font-medium text-left px-3 py-2" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)', width: '8rem' }}>Sprint</th>
              </tr>
            </thead>
            <tbody>
              {total === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--text-3)' }}>
                    No backlog items in this epic yet.
                  </td>
                </tr>
              )}
              {items.map((item) => {
                const stageName = item.node_id ? stageNameById.get(item.node_id) : undefined;
                return (
                  <tr
                    key={item.id}
                    className="group cursor-pointer hover:bg-[var(--bg-elevated)]"
                    onClick={() => navigate(`/projects/${projectId}/backlog/${item.id}`)}
                  >
                    <td className="px-3 py-1.5 align-middle" style={{ width: '4rem' }}>
                      <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>B-{item.number}</span>
                    </td>
                    <td className="px-3 py-1.5 align-middle" style={{ width: '5rem' }}>
                      <span className="text-xs font-mono uppercase opacity-60" style={{ color: 'var(--text-3)' }}>{item.type}</span>
                    </td>
                    <td className="px-3 py-1.5 align-middle" style={{ maxWidth: 0 }}>
                      <Link
                        to={`/projects/${projectId}/backlog/${item.id}`}
                        className="block truncate hover:underline font-semibold"
                        style={{ color: 'color-mix(in srgb, var(--text-1) 80%, transparent)', fontSize: '1.006rem' }}
                        title={item.description || 'No description details available'}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {item.title}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 align-middle">
                      {stageName && (
                        <span className="text-xs truncate block" style={{ color: 'var(--text-3)', maxWidth: '7rem' }} title={stageName}>{stageName}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 align-middle text-center">
                      <ClarityBadge clarity={item.clarity} />
                    </td>
                    <td className="px-3 py-1.5 align-middle">
                      <StatusPill status={item.status} />
                    </td>
                    <td className="px-3 py-1.5 align-middle">
                      {item.estimate && (
                        <span className="text-xs font-mono font-semibold" style={{ color: 'var(--accent)' }}>{item.estimate}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 align-middle">
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
