import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
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
  maintainer: 'var(--color-success)',
  member: 'var(--text-3)',
};

// -- Members table -----------------------------------------------------------

const PAGE_SIZE = 10;

interface ColDef {
  id: string;
  label: string;
  defaultOn: boolean;
  always?: boolean; // cannot be hidden
}

const MEMBER_COLS: ColDef[] = [
  { id: 'name',     label: 'Name',      defaultOn: true,  always: true },
  { id: 'email',    label: 'Email',     defaultOn: false },
  { id: 'role',     label: 'Role',      defaultOn: true  },
  { id: 'capacity', label: 'Capacity',  defaultOn: true  },
  { id: 'growing',  label: 'Growing',   defaultOn: true  },
  { id: 'curious',  label: 'Curious',   defaultOn: true  },
];

function ColChooser({
  visible,
  onChange,
}: {
  visible: Set<string>;
  onChange: (id: string, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-3)' }}
        title="Choose columns"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="1" y="1" width="4" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <rect x="7" y="1" width="4" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        Columns
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-20 rounded-lg py-1 min-w-36"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}
        >
          {MEMBER_COLS.filter((c) => !c.always).map((col) => (
            <label
              key={col.id}
              className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-hover)] text-xs"
              style={{ color: 'var(--text-2)' }}
            >
              <input
                type="checkbox"
                checked={visible.has(col.id)}
                onChange={(e) => onChange(col.id, e.target.checked)}
                className="accent-[var(--accent)]"
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Aggregates matrix entries into radar-friendly [{skill, avgLevel}] array
// Returns per-skill rows with per-user levels, and ordered member IDs
function buildMultiRadarData(matrix: MatrixEntry[]) {
  const skillMap = new Map<string, Map<string, number>>();
  for (const e of matrix) {
    if (!skillMap.has(e.skill_name)) skillMap.set(e.skill_name, new Map());
    skillMap.get(e.skill_name)!.set(e.user_id, e.level_rank);
  }
  const memberIds = Array.from(new Set(matrix.map((e) => e.user_id)));
  const rows = Array.from(skillMap.entries()).map(([skill, byMember]) => {
    const row: Record<string, string | number> = {
      skill,
      max: Math.max(0, ...byMember.values()),
    };
    for (const uid of memberIds) row[uid] = byMember.get(uid) ?? 0;
    return row;
  });
  return { rows, memberIds };
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
  // archive flow: idle -> step1 (first confirm) -> step2 (type name) -> step3 (final confirm)
  const [archiveStep, setArchiveStep] = useState<'idle' | 'step1' | 'step2' | 'step3'>('idle');
  const [archiveNameInput, setArchiveNameInput] = useState('');
  const [memberPage, setMemberPage] = useState(0);
  // user_ids excluded from radar -- empty = all shown
  const [radarExcluded, setRadarExcluded] = useState<Set<string>>(new Set());
  // hovered member row -- drives sonar pulse animation on their radar overlay
  const [hoveredMember, setHoveredMember] = useState<string | null>(null);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    () => new Set(MEMBER_COLS.filter((c) => c.defaultOn).map((c) => c.id))
  );

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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['team', id] });
      void qc.invalidateQueries({ queryKey: ['team-skill-matrix', id] });
      void qc.invalidateQueries({ queryKey: ['team-tandems', id] });
      void qc.invalidateQueries({ queryKey: ['team-learning-appetite', id] });
      void qc.invalidateQueries({ queryKey: ['team-member-capacity', id] });
    },
  });

  const updateTeam = useMutation({
    mutationFn: () => teamsApi.update(id!, { name: editName.trim(), description: editDesc.trim() || null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['team', id] });
      void qc.invalidateQueries({ queryKey: ['teams'] });
      setEditing(false);
    },
  });

  const archiveTeam = useMutation({
    mutationFn: () => teamsApi.archive(id!),
    onSuccess: () => navigate('/teams'),
  });

  const addMember = useMutation({
    mutationFn: () => teamsApi.addMember(id!, { user_id: addUserId, capacity_hours: addCapacity }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['team', id] });
      void qc.invalidateQueries({ queryKey: ['team-skill-matrix', id] });
      void qc.invalidateQueries({ queryKey: ['team-tandems', id] });
      void qc.invalidateQueries({ queryKey: ['team-learning-appetite', id] });
      void qc.invalidateQueries({ queryKey: ['team-member-capacity', id] });
      setAddingMember(false);
      setAddUserId('');
      setAddCapacity(32);
    },
  });

  // Radar data: per skill -- per-member levels
  const { rows: radarData, memberIds: radarMemberIds } = buildMultiRadarData(matrix ?? []);
  const filteredRadarMemberIds = radarMemberIds.filter((uid) => !radarExcluded.has(uid));

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
    <div className="h-full overflow-y-auto">
    <div className="p-6">
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
                  archiveStep === 'step1' ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-danger)' }}>Archive team?</span>
                      <button
                        onClick={() => { setArchiveStep('step2'); setArchiveNameInput(''); }}
                        className="px-2 py-1 text-xs font-medium rounded-md"
                        style={{ background: 'var(--color-danger)', color: '#fff' }}
                      >
                        Continue
                      </button>
                      <button
                        onClick={() => setArchiveStep('idle')}
                        className="px-2 py-1 text-xs rounded-md"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : archiveStep === 'step2' ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={archiveNameInput}
                        onChange={(e) => setArchiveNameInput(e.target.value)}
                        placeholder={`Type "${team?.name}" to confirm`}
                        className="px-2 py-1 text-xs rounded-md"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--color-danger)', color: 'var(--text-1)', width: 180 }}
                      />
                      <button
                        onClick={() => setArchiveStep('step3')}
                        disabled={archiveNameInput !== team?.name}
                        className="px-2 py-1 text-xs font-medium rounded-md disabled:opacity-30"
                        style={{ background: 'var(--color-danger)', color: '#fff' }}
                      >
                        Next
                      </button>
                      <button
                        onClick={() => setArchiveStep('idle')}
                        className="px-2 py-1 text-xs rounded-md"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : archiveStep === 'step3' ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-danger)' }}>Absolutely sure?</span>
                      <button
                        onClick={() => void archiveTeam.mutate()}
                        disabled={archiveTeam.isPending}
                        className="px-2 py-1 text-xs font-medium rounded-md disabled:opacity-40"
                        style={{ background: 'var(--color-danger)', color: '#fff' }}
                      >
                        {archiveTeam.isPending ? '...' : 'Archive'}
                      </button>
                      <button
                        onClick={() => setArchiveStep('idle')}
                        className="px-2 py-1 text-xs rounded-md"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setArchiveStep('step1')}
                      title="Archive team"
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

      {/* Projects shortcut */}
      {id && (
        <div className="mb-8">
          <Link
            to={`/teams/${id}/projects`}
            data-testid="team-projects-link"
            className="flex items-center justify-between rounded-xl px-4 py-3 hover:border-[var(--accent)] transition-colors"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
          >
            <span className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>Projects</span>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      )}

      {/* Two-column layout: left = members (2/3), right = radar + capacity (1/3) */}
      <div className="flex gap-6 items-start">

        {/* LEFT column */}
        <div className="flex-1 min-w-0">

      {/* Members table */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-2)' }}>Members</h2>
        <div className="flex items-center gap-2">
          <ColChooser
            visible={visibleCols}
            onChange={(colId, on) => {
              setVisibleCols((prev) => {
                const next = new Set(prev);
                if (on) next.add(colId); else next.delete(colId);
                return next;
              });
              setMemberPage(0);
            }}
          />
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

      {/* Members table */}
      {(() => {
        const appetiteMap = new Map<string, TeamMemberAppetite>(
          (appetite ?? []).map((a) => [a.user_id, a])
        );
        const members = team?.members ?? [];
        const totalPages = Math.ceil(members.length / PAGE_SIZE);
        const page = Math.min(memberPage, Math.max(0, totalPages - 1));
        const pageRows = members.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        const show = (col: string) => visibleCols.has(col);

        if (isLoading) {
          return (
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-10 animate-pulse" style={{ background: i % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }} />
              ))}
            </div>
          );
        }

        if (members.length === 0) {
          return <p className="text-sm py-6 text-center" style={{ color: 'var(--text-3)' }}>No members yet.</p>;
        }

        return (
          <>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                    <th className="w-8 px-2 py-2 text-center" title="Show in radar">
                      <input
                        type="checkbox"
                        checked={radarExcluded.size === 0}
                        onChange={() =>
                          setRadarExcluded(
                            radarExcluded.size === 0
                              ? new Set(members.map((m) => m.user_id))
                              : new Set(),
                          )
                        }
                        title={radarExcluded.size === 0 ? 'Deselect all from radar' : 'Select all for radar'}
                      />
                    </th>
                    {show('name') && (
                      <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Name</th>
                    )}
                    {show('email') && (
                      <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Email</th>
                    )}
                    {show('role') && (
                      <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Role</th>
                    )}
                    {show('capacity') && (
                      <th className="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>h/wk</th>
                    )}
                    {show('growing') && (
                      <th className="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Growing</th>
                    )}
                    {show('curious') && (
                      <th className="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Curious</th>
                    )}
                    {canManage && <th className="w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((m, idx) => {
                    const label = m.display_name || m.email;
                    const roleColor = ROLE_COLOR[m.role] ?? 'var(--text-3)';
                    const apt = appetiteMap.get(m.user_id);
                    return (
                      <tr
                        key={m.user_id}
                        className="group transition-colors"
                        onMouseEnter={() => setHoveredMember(m.user_id)}
                        onMouseLeave={() => setHoveredMember(null)}
                      >
                        <td className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={!radarExcluded.has(m.user_id)}
                            onChange={() =>
                              setRadarExcluded((prev) => {
                                const next = new Set(prev);
                                if (next.has(m.user_id)) next.delete(m.user_id);
                                else next.add(m.user_id);
                                return next;
                              })
                            }
                          />
                        </td>
                        {show('name') && (
                          <td className="px-3 py-1.5 max-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              {m.avatar_url ? (
                                <img src={m.avatar_url} alt={label} className="w-6 h-6 rounded-full flex-shrink-0 object-cover" />
                              ) : (
                                <div
                                  className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-semibold"
                                  style={{ background: 'var(--accent-muted)', color: 'var(--accent)', fontSize: '9px' }}
                                >
                                  {initials(label)}
                                </div>
                              )}
                              <span className="truncate text-sm font-medium" style={{ color: 'var(--text-1)' }} title={label}>{label}</span>
                            </div>
                          </td>
                        )}
                        {show('email') && (
                          <td className="px-3 py-1.5 max-w-0">
                            <span className="truncate block text-xs" style={{ color: 'var(--text-3)' }} title={m.email}>{m.email}</span>
                          </td>
                        )}
                        {show('role') && (
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            <span className="text-xs font-medium capitalize" style={{ color: roleColor }}>{m.role}</span>
                          </td>
                        )}
                        {show('capacity') && (
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">
                            <span className="text-xs" style={{ color: 'var(--text-2)' }}>{m.capacity_hours > 0 ? m.capacity_hours : '--'}</span>
                          </td>
                        )}
                        {show('growing') && (
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">
                            {apt ? (
                              <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>{apt.reaching_count}</span>
                            ) : (
                              <span className="text-xs" style={{ color: 'var(--text-3)' }}>--</span>
                            )}
                          </td>
                        )}
                        {show('curious') && (
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">
                            {apt ? (
                              <span className="text-xs" style={{ color: 'var(--text-2)' }}>{apt.curious_breadth}</span>
                            ) : (
                              <span className="text-xs" style={{ color: 'var(--text-3)' }}>--</span>
                            )}
                          </td>
                        )}
                        {canManage && (
                          <td className="px-2 py-1.5 text-center">
                            <button
                              onClick={() => void removeMember.mutate(m.user_id)}
                              disabled={removeMember.isPending && removeMember.variables === m.user_id}
                              title="Remove"
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded disabled:opacity-40"
                              style={{ color: 'var(--color-danger)' }}
                            >
                              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                                <path d="M1 1l9 9M10 1l-9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                              </svg>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, members.length)} of {members.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setMemberPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-2 py-1 text-xs rounded-md disabled:opacity-30"
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                  >
                    ‹ Prev
                  </button>
                  <button
                    onClick={() => setMemberPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-2 py-1 text-xs rounded-md disabled:opacity-30"
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                  >
                    Next ›
                  </button>
                </div>
              </div>
            )}
          </>
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

        </div>{/* end LEFT column */}

        {/* RIGHT column: radar + capacity */}
        <div className="w-96 flex-shrink-0 flex flex-col gap-6">

          {/* Skill Radar */}
          {radarData.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
                Skill Coverage
              </h2>
              <div
                className="rounded-xl p-4"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
              >
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData} outerRadius="80%" margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                    <PolarGrid stroke="var(--border)" />
                    <PolarAngleAxis dataKey="skill" tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
                    <PolarRadiusAxis domain={[0, 5]} tickCount={6} tick={false} axisLine={false} />
                    {/* Max envelope -- team ceiling, rendered behind member overlays */}
                    <Radar
                      name="Max"
                      dataKey="max"
                      stroke="var(--accent)"
                      strokeWidth={1.5}
                      strokeOpacity={0.25}
                      fill="var(--accent)"
                      fillOpacity={0.08}
                      dot={false}
                      isAnimationActive={false}
                    />
                    {/* Per-member overlays -- animated sonar pulse on hover, others dim */}
                    {filteredRadarMemberIds.map((uid) => {
                      const isHovered = hoveredMember === uid;
                      const isAnyHovered = hoveredMember !== null;
                      return (
                        <Radar
                          key={uid}
                          name={uid}
                          dataKey={uid}
                          stroke="none"
                          fill="var(--accent)"
                          fillOpacity={isHovered ? 0.6 : isAnyHovered ? 0.05 : 0.18}
                          dot={false}
                          isAnimationActive={false}
                          className={isHovered ? 'radar-scan-active' : ''}
                        />
                      );
                    })}
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Capacity Bars */}
          {memberCapacity && memberCapacity.length > 0 && (() => {
            const memberMap = new Map<string, string>(
              (team?.members ?? []).map((m) => [m.user_id, m.display_name || m.email])
            );
            const maxCap = Math.max(...memberCapacity.map((m) => m.capacity_hours), 1);
            return (
              <section>
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
                          <span className="text-xs font-medium truncate max-w-28" style={{ color: 'var(--text-2)' }}>{name}</span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {m.assigned_items > 0 && (
                              <span className="text-xs px-1 py-0.5 rounded" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
                                {m.assigned_items}
                              </span>
                            )}
                            <span className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>
                              {m.capacity_hours}h
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

        </div>{/* end RIGHT column */}

      </div>
    </div>
    </div>
  );
}
