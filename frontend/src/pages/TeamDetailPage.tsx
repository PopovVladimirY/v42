import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip,
} from 'recharts';
import { teamsApi } from '@/api/endpoints/teams';
import { usersApi } from '@/api/endpoints/users';
import { capacityApi } from '@/api/endpoints/capacity';
import { useAuthStore } from '@/hooks/useAuth';
import type { TeamMember } from '@/types/teams';
import type { MatrixEntry, TandemPair, TeamMemberAppetite } from '@/types/index';

// Formats "2024-01-15T..." to "Jan 2024"
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en', { month: 'short', year: 'numeric' });
}

// Formats capacity hours: 40 -> "40 h/wk", 0 -> "--"
function fmtCapacity(h: number) {
  return h > 0 ? `${h} h/wk` : '--';
}

// Initials from display_name or email
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// Role badge colors -- uses CSS tokens
const ROLE_COLOR: Record<string, string> = {
  admin: 'var(--accent)',
  maintainer: 'var(--success)',
  member: 'var(--text-3)',
};

function MemberCard({
  m,
  canManage,
  onRemove,
  isRemoving,
}: {
  m: TeamMember;
  canManage: boolean;
  onRemove: (userId: string) => void;
  isRemoving: boolean;
}) {
  const label = m.display_name || m.email;
  const color = ROLE_COLOR[m.role] ?? 'var(--text-3)';

  return (
    <div
      className="flex items-center gap-3 rounded-lg p-3 group"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
      }}
    >
      {m.avatar_url ? (
        <img src={m.avatar_url} alt={label} className="w-9 h-9 rounded-full flex-shrink-0 object-cover" />
      ) : (
        <div
          className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-semibold"
          style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
        >
          {initials(label)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-1)' }} title={label}>
          {label}
        </p>
        {m.display_name && (
          <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>{m.email}</p>
        )}
      </div>
      <div className="flex-shrink-0 flex flex-col items-end gap-0.5">
        <span className="text-xs font-medium capitalize" style={{ color }}>{m.role}</span>
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>{fmtCapacity(m.capacity_hours)}</span>
      </div>
      {canManage && (
        <button
          onClick={() => onRemove(m.user_id)}
          disabled={isRemoving}
          title="Remove from team"
          className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 p-1 rounded disabled:opacity-40"
          style={{ color: 'var(--color-danger)' }}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M1.5 1.5l10 10M11.5 1.5l-10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

// Aggregates matrix entries into radar-friendly [{skill, avgLevel}] array
function buildRadarData(matrix: MatrixEntry[]) {
  const map = new Map<string, { sum: number; count: number }>();
  for (const e of matrix) {
    const existing = map.get(e.skill_name);
    if (existing) { existing.sum += e.level_rank; existing.count += 1; }
    else map.set(e.skill_name, { sum: e.level_rank, count: 1 });
  }
  return Array.from(map.entries()).map(([skill, { sum, count }]) => ({
    skill,
    avgLevel: Math.round((sum / count) * 10) / 10,
  }));
}

function SkeletonCard() {
  return (
    <div
      className="h-16 rounded-lg animate-pulse"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    />
  );
}

export function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [addingMember, setAddingMember] = useState(false);
  const [addUserId, setAddUserId] = useState('');
  const [addCapacity, setAddCapacity] = useState(32);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const canManage = user?.role === 'admin' || user?.role === 'maintainer';
  const canDelete = user?.role === 'admin';

  const { data: team, isLoading, isError } = useQuery({
    queryKey: ['team', id],
    queryFn: () => teamsApi.get(id!),
    enabled: !!id,
  });

  const { data: matrix } = useQuery({
    queryKey: ['team-skill-matrix', id],
    queryFn: () => capacityApi.teamSkillMatrix(id!),
    enabled: !!id,
  });

  const { data: tandems } = useQuery({
    queryKey: ['team-tandems', id],
    queryFn: () => capacityApi.teamTandems(id!),
    enabled: !!id,
  });

  const { data: appetite } = useQuery({
    queryKey: ['team-learning-appetite', id],
    queryFn: () => capacityApi.teamLearningAppetite(id!),
    enabled: !!id,
  });

  const { data: memberCapacity } = useQuery({
    queryKey: ['team-member-capacity', id],
    queryFn: () => capacityApi.teamMemberCapacity(id!),
    enabled: !!id,
  });

  const { data: allUsers } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
    enabled: addingMember,
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => teamsApi.removeMember(id!, userId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['team', id] }),
  });

  const updateTeam = useMutation({
    mutationFn: () => teamsApi.update(id!, { name: editName.trim(), description: editDesc.trim() || null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['team', id] });
      void qc.invalidateQueries({ queryKey: ['teams'] });
      setEditing(false);
    },
  });

  const deleteTeam = useMutation({
    mutationFn: () => teamsApi.delete(id!),
    onSuccess: () => navigate('/teams'),
  });

  const addMember = useMutation({
    mutationFn: () => teamsApi.addMember(id!, { user_id: addUserId, capacity_hours: addCapacity }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['team', id] });
      setAddingMember(false);
      setAddUserId('');
      setAddCapacity(32);
    },
  });

  // Radar data: per skill, average level_rank across members
  const radarData = buildRadarData(matrix ?? []);

  if (isError) {
    return (
      <div className="p-6 flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-sm" style={{ color: 'var(--error, #ef4444)' }}>Failed to load team.</p>
        <Link to="/teams" className="text-xs" style={{ color: 'var(--accent)' }}>Back to teams</Link>
      </div>
    );
  }

  const totalCapacity = team?.members.reduce((s, m) => s + m.capacity_hours, 0) ?? 0;
  const existingMemberIds = new Set(team?.members.map((m) => m.user_id) ?? []);
  const availableUsers = allUsers?.filter((u) => !existingMemberIds.has(u.id)) ?? [];

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Back link */}
      <Link to="/teams" className="inline-flex items-center gap-1.5 text-xs mb-6" style={{ color: 'var(--text-3)' }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Teams
      </Link>

      {/* Header */}
      <div className="mb-6">
        {isLoading ? (
          <div className="h-7 w-48 rounded animate-pulse" style={{ background: 'var(--bg-surface)' }} />
        ) : editing ? (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={120}
              className="text-xl font-semibold rounded-md px-2 py-1 outline-none w-full"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
              autoFocus
            />
            <input
              type="text"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              maxLength={500}
              placeholder="Description (optional)"
              className="text-sm rounded-md px-2 py-1 outline-none w-full"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
            />
            {updateTeam.isError && (
              <p className="text-xs" style={{ color: 'var(--color-danger)' }}>Failed to save. Try again.</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => void updateTeam.mutate()}
                disabled={!editName.trim() || updateTeam.isPending}
                className="px-3 py-1.5 text-sm font-medium rounded-md disabled:opacity-40"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
              >
                {updateTeam.isPending ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 text-sm rounded-md"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold" style={{ color: 'var(--text-1)' }}>{team?.name}</h1>
              {team?.description && (
                <p className="mt-1 text-sm" style={{ color: 'var(--text-2)' }}>{team.description}</p>
              )}
            </div>
            {canManage && team && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => { setEditName(team.name); setEditDesc(team.description ?? ''); setEditing(true); }}
                  title="Edit team"
                  className="p-1.5 rounded-md transition-colors"
                  style={{ color: 'var(--text-3)', background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path d="M9.5 1.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {canDelete && (
                  confirmDelete ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs" style={{ color: 'var(--color-danger)' }}>Delete?</span>
                      <button
                        onClick={() => void deleteTeam.mutate()}
                        disabled={deleteTeam.isPending}
                        className="px-2 py-1 text-xs font-medium rounded-md disabled:opacity-40"
                        style={{ background: 'var(--color-danger)', color: '#fff' }}
                      >
                        {deleteTeam.isPending ? '...' : 'Yes'}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="px-2 py-1 text-xs rounded-md"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      title="Delete team"
                      className="p-1.5 rounded-md transition-colors"
                      style={{ color: 'var(--color-danger)', background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
                    >
                      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                        <path d="M2 3.5h9M5 3.5V2.5h3v1M4 3.5l.5 7h4l.5-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        )}
        {isLoading && (
          <div className="h-4 w-72 rounded mt-2 animate-pulse" style={{ background: 'var(--bg-surface)' }} />
        )}
      </div>

      {/* Stats row */}
      <div className="flex gap-6 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Members</p>
          <p className="text-lg font-semibold mt-0.5" style={{ color: 'var(--text-1)' }}>
            {isLoading ? '--' : (team?.members.length ?? 0)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Total capacity</p>
          <p className="text-lg font-semibold mt-0.5" style={{ color: 'var(--text-1)' }}>
            {isLoading ? '--' : fmtCapacity(totalCapacity)}
          </p>
        </div>
        {!isLoading && team && (
          <div>
            <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Created</p>
            <p className="text-lg font-semibold mt-0.5" style={{ color: 'var(--text-1)' }}>{fmtDate(team.created_at)}</p>
          </div>
        )}
      </div>

      {/* Skill Radar */}
      {radarData.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
            Skill Coverage
          </h2>
          <div
            className="rounded-xl p-4"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
          >
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis
                  dataKey="skill"
                  tick={{ fill: 'var(--text-3)', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    color: 'var(--text-1)',
                    fontSize: '12px',
                  }}
                  formatter={(v) => [typeof v === 'number' ? v.toFixed(1) : v, 'Avg level']}
                />
                <Radar
                  name="Team"
                  dataKey="avgLevel"
                  stroke="var(--accent)"
                  fill="var(--accent)"
                  fillOpacity={0.25}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Members */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-2)' }}>Members</h2>
        {canManage && (
          <button
            onClick={() => setAddingMember((v) => !v)}
            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md transition-colors"
            style={{
              background: addingMember ? 'var(--bg-active)' : 'var(--bg-surface)',
              border: '1px solid var(--border)',
              color: 'var(--text-2)',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Add member
          </button>
        )}
      </div>

      {/* Add member form */}
      {addingMember && (
        <div
          className="mb-3 p-3 rounded-lg flex flex-col gap-3"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <select
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
            className="text-sm rounded-md px-3 py-2 w-full"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          >
            <option value="">Select a user...</option>
            {availableUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.display_name || u.email}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <label className="text-xs" style={{ color: 'var(--text-3)' }}>Capacity h/wk</label>
            <input
              type="number"
              value={addCapacity}
              min={0}
              max={168}
              onChange={(e) => setAddCapacity(Number(e.target.value))}
              className="w-20 text-sm rounded-md px-2 py-1 text-center"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void addMember.mutate()}
              disabled={!addUserId || addMember.isPending}
              className="flex-1 text-sm py-1.5 rounded-md font-medium disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              {addMember.isPending ? 'Adding...' : 'Add'}
            </button>
            <button
              onClick={() => setAddingMember(false)}
              className="px-4 text-sm py-1.5 rounded-md"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {isLoading
          ? Array.from({ length: 3 }, (_, i) => <SkeletonCard key={i} />)
          : team?.members.length === 0
          ? (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--text-3)' }}>No members yet.</p>
          )
          : team?.members.map((m) => (
            <MemberCard
              key={m.user_id}
              m={m}
              canManage={canManage}
              onRemove={(uid) => void removeMember.mutate(uid)}
              isRemoving={removeMember.isPending && removeMember.variables === m.user_id}
            />
          ))
        }
      </div>

      {/* Capacity Bars */}
      {memberCapacity && memberCapacity.length > 0 && (() => {
        const memberMap = new Map<string, string>(
          (team?.members ?? []).map((m) => [m.user_id, m.display_name || m.email])
        );
        const maxCap = Math.max(...memberCapacity.map((m) => m.capacity_hours), 1);
        return (
          <section className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
              Capacity
            </h2>
            <div
              className="rounded-xl p-4 flex flex-col gap-3"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
            >
              {memberCapacity.map((m) => {
                const name = memberMap.get(m.user_id) ?? m.user_id.slice(0, 8);
                const pct = maxCap > 0 ? (m.capacity_hours / maxCap) * 100 : 0;
                return (
                  <div key={m.user_id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium truncate max-w-36" style={{ color: 'var(--text-2)' }}>{name}</span>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {m.assigned_items > 0 && (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
                            {m.assigned_items} active
                          </span>
                        )}
                        <span className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>
                          {m.capacity_hours}h/wk
                        </span>
                      </div>
                    </div>
                    <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                      <div
                        className="absolute inset-y-0 left-0 rounded-full transition-all"
                        style={{ width: `${pct}%`, background: 'var(--accent)' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

      {/* Tandem Opportunities */}
      {tandems && tandems.length > 0 && (() => {
        const memberMap = new Map<string, string>(
          (team?.members ?? []).map((m) => [m.user_id, m.display_name || m.email])
        );
        const bySkill = tandems.reduce<Record<string, { pairs: TandemPair[] }>>((acc, t) => {
          if (!acc[t.skill_name]) acc[t.skill_name] = { pairs: [] };
          acc[t.skill_name].pairs.push(t);
          return acc;
        }, {});
        return (
          <section className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
              Tandem Opportunities
            </h2>
            <div className="flex flex-col gap-2">
              {Object.entries(bySkill).map(([skill, { pairs }]) => (
                <div key={skill} className="rounded-lg px-3 py-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>{skill}</p>
                  {pairs.map((p, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs mb-1 last:mb-0">
                      <span className="px-1.5 py-0.5 rounded truncate max-w-24" style={{ background: 'var(--bg-elevated)', color: 'var(--color-info)' }}>
                        {memberMap.get(p.learner_id) ?? p.learner_id.slice(0, 8)}
                      </span>
                      <span className="capitalize" style={{ color: 'var(--text-3)' }}>{p.learner_level}</span>
                      <span style={{ color: 'var(--accent)' }}>\u2192</span>
                      <span className="px-1.5 py-0.5 rounded truncate max-w-24" style={{ background: 'var(--bg-elevated)', color: 'var(--color-success)' }}>
                        {memberMap.get(p.mentor_id) ?? p.mentor_id.slice(0, 8)}
                      </span>
                      <span className="capitalize" style={{ color: 'var(--text-3)' }}>{p.mentor_level}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* Learning Appetite */}
      {appetite && appetite.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
            Learning Appetite
          </h2>
          <div className="flex flex-col gap-2">
            {(appetite as TeamMemberAppetite[]).map((a) => {
              const member = team?.members.find((m) => m.user_id === a.user_id);
              const name = member?.display_name || member?.email || a.user_id.slice(0, 8);
              return (
                <div
                  key={a.user_id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
                >
                  <p className="flex-1 text-sm font-medium truncate min-w-0" style={{ color: 'var(--text-1)' }}>{name}</p>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-center">
                      <p className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>{a.reaching_count}</p>
                      <p className="text-xs" style={{ color: 'var(--text-3)' }}>growing</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-2)' }}>{a.curious_breadth}</p>
                      <p className="text-xs" style={{ color: 'var(--text-3)' }}>curious</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
