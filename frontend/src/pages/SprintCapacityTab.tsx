import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sprintCapacityApi } from '@/api/endpoints/sprint_capacity';
import { useSprint } from '@/hooks/useSprints';
import { useProjectTeams } from '@/hooks/useProjects';
import type { CapacityRow } from '@/api/endpoints/sprint_capacity';

// Column headers per sprint status mode
// planning: edit planned_hours
// active / completed: show both + editable actual_hours
function CapacityTable({
  rows,
  sprintStatus,
  projectId,
  sprintId,
}: {
  rows: CapacityRow[];
  sprintStatus: string;
  projectId: string;
  sprintId: string;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Record<string, string>>({});
  const patchActual = useMutation({
    mutationFn: ({ userId, hours }: { userId: string; hours: string }) =>
      sprintCapacityApi.patchActual(projectId, sprintId, userId, hours),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['sprint-capacity', projectId, sprintId] }),
  });

  const isReview = sprintStatus === 'active' || sprintStatus === 'completed';
  const totalPlanned = rows.reduce((s, r) => s + parseFloat(r.planned_hours || '0'), 0);
  const totalActual  = rows.reduce((s, r) => s + parseFloat(r.actual_hours  || '0'), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
            <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-3)' }}>Member</th>
            <th className="text-right px-3 py-2 font-medium w-28" style={{ color: 'var(--text-3)' }}>Planned (h)</th>
            {isReview && (
              <th className="text-right px-3 py-2 font-medium w-28" style={{ color: 'var(--text-3)' }}>Actual (h)</th>
            )}
            <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-3)' }}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.user_id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-1)' }}>
                {row.user_name}
              </td>
              <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-2)' }}>
                {row.planned_hours}
              </td>
              {isReview && (
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={editing[row.user_id] ?? row.actual_hours ?? ''}
                    onChange={(e) =>
                      setEditing((p) => ({ ...p, [row.user_id]: e.target.value }))
                    }
                    onBlur={() => {
                      const val = editing[row.user_id];
                      if (val !== undefined && val !== (row.actual_hours ?? '')) {
                        patchActual.mutate({ userId: row.user_id, hours: val });
                      }
                    }}
                    className="w-20 text-right rounded px-2 py-0.5 font-mono text-xs"
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-1)',
                    }}
                    placeholder="0"
                  />
                </td>
              )}
              <td className="px-3 py-2" style={{ color: 'var(--text-3)' }}>
                {row.notes ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-elevated)' }}>
            <td className="px-3 py-2 font-semibold text-xs" style={{ color: 'var(--text-2)' }}>Total</td>
            <td className="px-3 py-2 text-right font-mono font-semibold text-xs" style={{ color: 'var(--accent)' }}>
              {totalPlanned.toFixed(1)}
            </td>
            {isReview && (
              <td className="px-3 py-2 text-right font-mono font-semibold text-xs" style={{ color: 'var(--color-success)' }}>
                {totalActual.toFixed(1)}
              </td>
            )}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function SprintCapacityTab() {
  const { projectId = '', sprintId = '' } = useParams<{ projectId: string; sprintId: string }>();
  const qc = useQueryClient();
  const { data: sprint } = useSprint(projectId, sprintId);
  const { data: teams = [] } = useProjectTeams(projectId);

  const { data: capacityData, isLoading } = useQuery({
    queryKey: ['sprint-capacity', projectId, sprintId],
    queryFn: async () => {
      const res = await sprintCapacityApi.get(projectId, sprintId);
      return res.data.data;
    },
    enabled: !!projectId && !!sprintId,
  });

  const initCapacity = useMutation({
    mutationFn: (teamId: string) =>
      sprintCapacityApi.init(projectId, sprintId, teamId),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['sprint-capacity', projectId, sprintId] }),
  });

  const sprintStatus = sprint?.status ?? 'planning';
  const rows = capacityData?.capacity ?? [];
  const skills = capacityData?.skill_breakdown ?? [];

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-6">
      {/* Init section -- visible only when empty */}
      {!isLoading && rows.length === 0 && (
        <div
          className="rounded-lg p-6 flex flex-col items-center gap-4"
          style={{ border: '1px solid var(--border)', background: 'var(--bg-surface)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>
            No capacity data yet. Seed from a team:
          </p>
          <div className="flex flex-wrap gap-2">
            {teams.map((team) => (
              <button
                key={team.id}
                onClick={() => initCapacity.mutate(team.id)}
                disabled={initCapacity.isPending}
                className="text-sm px-4 py-1.5 rounded font-medium"
                style={{
                  background: 'var(--accent)',
                  color: 'var(--accent-fg)',
                  opacity: initCapacity.isPending ? 0.6 : 1,
                }}
              >
                {team.name}
              </button>
            ))}
            {teams.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                No teams linked to this project.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Capacity table */}
      {rows.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
            {sprintStatus === 'planning'  ? 'Planned capacity'  :
             sprintStatus === 'active'    ? 'Sprint in progress' :
             sprintStatus === 'completed' ? 'Sprint review'     : 'Capacity'}
          </h3>
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <CapacityTable
              rows={rows}
              sprintStatus={sprintStatus}
              projectId={projectId}
              sprintId={sprintId}
            />
          </div>
        </section>
      )}

      {/* Skill breakdown */}
      {skills.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
            Skill coverage
          </h3>
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                  <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-3)' }}>Skill</th>
                  <th className="text-right px-3 py-2 font-medium w-28" style={{ color: 'var(--text-3)' }}>Planned (h)</th>
                </tr>
              </thead>
              <tbody>
                {skills.map((s) => (
                  <tr key={s.skill_id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-3 py-2" style={{ color: 'var(--text-1)' }}>{s.skill_name}</td>
                    <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-2)' }}>
                      {s.planned_hours}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading capacity...</p>
        </div>
      )}
    </div>
  );
}
