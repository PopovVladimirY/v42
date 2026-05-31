import { useEffect, useState, useMemo, Fragment } from 'react';
import { useParams, Link, NavLink, Outlet } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
} from 'recharts';
import { useProject, useProjectAncestors, useProjectTeams, useAddProjectTeam, useRemoveProjectTeam, useUpdateProject } from '@/hooks/useProjects';
import { useAuthStore } from '@/hooks/useAuth';
import { pushRecentProject } from '@/hooks/useLastProject';
import { teamsApi } from '@/api/endpoints/teams';
import { capacityApi } from '@/api/endpoints/capacity';
import type { ProjectStatus } from '@/types';

// Sub-nav tabs for a project
const TABS = [
  { label: 'Project', to: 'tree' },
  { label: 'Backlog', to: 'backlog' },
  { label: 'Epics', to: 'epics' },
  { label: 'Milestones', to: 'milestones' },
  { label: 'Sprints', to: 'sprints' },
  { label: 'Overview', to: 'overview' },
];

const STATUS_BADGE = {
  active:    { label: 'Active',   color: 'var(--color-success)' },
  on_hold:   { label: 'On Hold',  color: 'var(--color-warning)' },
  completed: { label: 'Done',     color: 'var(--text-3)'        },
  archived:  { label: 'Archived', color: 'var(--text-3)'        },
} as const;

// Shared project layout: header + tab nav + <Outlet />
export function ProjectShell() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading } = useProject(projectId ?? '');
  const ancestors = useProjectAncestors(projectId ?? '');
  const user = useAuthStore((s) => s.user);

  // Record last visited project for sidebar quick-nav (scoped by userId)
  useEffect(() => {
    if (project && user?.id) pushRecentProject(user.id, project.id, project.name);
  }, [project?.id, user?.id]);

  if (isLoading) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-shrink-0 flex items-center gap-2 px-4 border-b" style={{ height: 40, borderColor: 'var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Loading...</p>
        </div>
        <div className="flex-shrink-0 flex border-b px-4" style={{ borderColor: 'var(--border)' }}>
          {TABS.map((tab) => (
            <span key={tab.label} data-testid={`project-tab-${tab.label.toLowerCase()}`} className="px-4 py-2 text-sm font-medium" style={{ color: 'var(--text-3)' }}>
              {tab.label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  const badge = project ? STATUS_BADGE[project.status] : null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Compact header: breadcrumb + name + status on one line */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 border-b" style={{ height: 40, borderColor: 'var(--border)' }}>
        <Link to="/projects" className="text-xs hover:underline flex-shrink-0" style={{ color: 'var(--text-3)' }}>Projects</Link>
        {ancestors.slice(0, -1).map((p) => (
          <Fragment key={p.id}>
            <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-3)' }}>/</span>
            <Link to={`/projects/${p.id}`} className="text-xs hover:underline flex-shrink-0 truncate max-w-32" style={{ color: 'var(--text-3)' }}>{p.name}</Link>
          </Fragment>
        ))}
        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-3)' }}>/</span>
        <h1 className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
          {ancestors.at(-1)?.name ?? project?.name}
        </h1>
        {badge && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ color: badge.color, background: 'var(--bg-elevated)' }}>
            {badge.label}
          </span>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex-shrink-0 flex border-b px-4" style={{ borderColor: 'var(--border)' }}>
        {TABS.map((tab) => (
          <NavLink
            key={tab.label}
            to={tab.to}
            end={tab.to === ''}
            data-testid={`project-tab-${tab.label.toLowerCase()}`}
            className={({ isActive }) =>
              `px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive ? 'border-[var(--accent)]' : 'border-transparent'
              }`
            }
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent)' : 'var(--text-2)',
            })}
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      {/* Routed content -- scroll lives here; min-h-0 keeps flex child bounded */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}

// Overview tab -- the default child route
export function ProjectOverviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId ?? '');
  const { data: projectTeams = [], isLoading: teamsLoading } = useProjectTeams(projectId ?? '');
  const addTeam = useAddProjectTeam(projectId ?? '');
  const removeTeam = useRemoveProjectTeam(projectId ?? '');
  const updateProject = useUpdateProject(projectId ?? '');
  const { data: allTeams = [] } = useQuery({ queryKey: ['teams'], queryFn: teamsApi.list });
  const user = useAuthStore((s) => s.user);
  const canEdit = user?.role === 'admin' || user?.role === 'maintainer';
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [confirmArchive, setConfirmArchive] = useState(false);

  const linkedTeamIds = new Set(projectTeams.map((t) => t.id));
  const availableTeams = allTeams.filter((t) => !linkedTeamIds.has(t.id));

  async function handleAddTeam() {
    if (!selectedTeamId) return;
    await addTeam.mutateAsync(selectedTeamId);
    setSelectedTeamId('');
    setShowAddTeam(false);
  }

  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');

  function startEditDesc() {
    if (!canEdit) return;
    setDescDraft(project?.description ?? '');
    setEditingDesc(true);
  }

  function commitDesc() {
    const trimmed = descDraft.trim();
    if (trimmed !== (project?.description ?? '')) {
      updateProject.mutate({ description: trimmed || undefined });
    }
    setEditingDesc(false);
  }

  return (
    <div className="px-6 py-4 flex flex-col gap-6">
      {/* Description -- click to edit for admins/maintainers */}
      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
      >
        {editingDesc ? (
          <textarea
            autoFocus
            rows={4}
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={commitDesc}
            onKeyDown={(e) => { if (e.key === 'Escape') { setEditingDesc(false); } }}
            className="w-full text-sm rounded outline-none resize-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', color: 'var(--text-1)', padding: '0.5rem' }}
          />
        ) : (
          <p
            className="text-sm"
            style={{ color: project?.description ? 'var(--text-2)' : 'var(--text-3)', cursor: canEdit ? 'pointer' : 'default', minHeight: '1.5rem' }}
            onClick={startEditDesc}
            title={canEdit ? 'Click to edit description' : undefined}
          >
            {project?.description || (canEdit ? 'No description. Click to add.' : '')}
          </p>
        )}
      </section>

      {/* Teams section */}
      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
            Teams
          </p>
          {canEdit && !showAddTeam && availableTeams.length > 0 && (
            <button
              onClick={() => setShowAddTeam(true)}
              className="text-xs px-2 py-1 rounded"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--accent)' }}
            >
              + Add team
            </button>
          )}
        </div>

        {showAddTeam && (
          <div className="flex gap-2 mb-3">
            <select
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="flex-1 text-sm rounded px-2 py-1"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            >
              <option value="">Select a team...</option>
              {availableTeams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button
              onClick={handleAddTeam}
              disabled={!selectedTeamId || addTeam.isPending}
              className="text-xs px-3 py-1 rounded disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              {addTeam.isPending ? '...' : 'Add'}
            </button>
            <button
              onClick={() => { setShowAddTeam(false); setSelectedTeamId(''); }}
              className="text-xs px-3 py-1 rounded"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
            >
              Cancel
            </button>
          </div>
        )}

        {teamsLoading ? (
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Loading...</p>
        ) : projectTeams.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>No teams linked yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {projectTeams.map((t) => (
              <li key={t.id} className="flex items-center justify-between text-sm py-1">
                <Link
                  to={`/teams/${t.id}`}
                  className="hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  {t.name}
                </Link>
                {canEdit && (
                  <button
                    onClick={() => removeTeam.mutate(t.id)}
                    disabled={removeTeam.isPending}
                    className="text-xs px-2 py-0.5 rounded opacity-60 hover:opacity-100 disabled:opacity-30"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--color-danger)' }}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Skill planning -- what the backlog needs vs what the teams can do */}
      <SkillPlanningSection projectId={projectId ?? ''} teamIds={projectTeams.map((t) => t.id)} />

      {/* Danger Zone -- status and archiving live at the bottom, where the dragons sleep */}
      {canEdit && project && (
        <section
          className="rounded-xl p-4"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--color-danger)' }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--color-danger)' }}>
            Danger Zone
          </p>

          {/* Status switch */}
          <div className="flex items-center justify-between gap-4 py-2">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>Status</p>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                Lifecycle state shown on cards and breadcrumbs.
              </p>
            </div>
            <select
              value={project.status}
              disabled={updateProject.isPending}
              onChange={(e) => updateProject.mutate({ status: e.target.value as ProjectStatus })}
              className="text-sm rounded px-2 py-1 disabled:opacity-40"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            >
              <option value="active">Active</option>
              <option value="on_hold">On Hold</option>
              <option value="completed">Done</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          <div className="my-3 h-px" style={{ background: 'var(--border)' }} />

          {/* Archive / restore */}
          <div className="flex items-center justify-between gap-4 py-2">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
                {project.status === 'archived' ? 'Restore project' : 'Archive project'}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                {project.status === 'archived'
                  ? 'Bring it back to Active and out of the archive.'
                  : 'Hide it from active views. Nothing is deleted -- you can restore it later.'}
              </p>
            </div>
            {project.status === 'archived' ? (
              <button
                onClick={() => updateProject.mutate({ status: 'active' })}
                disabled={updateProject.isPending}
                className="text-xs px-3 py-1.5 rounded disabled:opacity-40 flex-shrink-0"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--accent)' }}
              >
                {updateProject.isPending ? '...' : 'Restore'}
              </button>
            ) : confirmArchive ? (
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => { updateProject.mutate({ status: 'archived' }); setConfirmArchive(false); }}
                  disabled={updateProject.isPending}
                  className="text-xs px-3 py-1.5 rounded disabled:opacity-40"
                  style={{ background: 'var(--color-danger)', color: 'var(--accent-fg)' }}
                >
                  {updateProject.isPending ? '...' : 'Confirm archive'}
                </button>
                <button
                  onClick={() => setConfirmArchive(false)}
                  className="text-xs px-3 py-1.5 rounded"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmArchive(true)}
                className="text-xs px-3 py-1.5 rounded flex-shrink-0"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--color-danger)', color: 'var(--color-danger)' }}
              >
                Archive
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// Level rank -> human label, mirrors the 1..5 scale from the skill matrix.
const LEVEL_LABEL = ['none', 'novice', 'beginner', 'competent', 'proficient', 'expert'];

// SkillPlanningSection -- the heart of skill-based planning. Two radars side by
// side (backlog demand vs team coverage) plus a per-skill balance bar that
// screams when the backlog wants a skill nobody on the linked teams can cover.
function SkillPlanningSection({ projectId, teamIds }: { projectId: string; teamIds: string[] }) {
  const { data: demand = [], isLoading: demandLoading } = useQuery({
    queryKey: ['project-skill-demand', projectId],
    queryFn: () => capacityApi.projectSkillDemand(projectId),
    enabled: !!projectId,
  });

  // One skill-matrix per linked team; merged into a single coverage map below.
  const matrixQueries = useQueries({
    queries: teamIds.map((tid) => ({
      queryKey: ['team-skill-matrix', tid],
      queryFn: () => capacityApi.teamSkillMatrix(tid),
      enabled: !!tid,
    })),
  });
  const matrixKey = teamIds.join(',');
  const matrixEntries = matrixQueries.flatMap((q) => q.data ?? []);

  // Team coverage per skill: ceiling = best level on the bench, depth = how many
  // distinct people sit at competent+ (the bus-factor signal).
  const coverage = useMemo(() => {
    const m = new Map<string, { name: string; ceiling: number; depth: number; seen: Set<string> }>();
    for (const e of matrixEntries) {
      let c = m.get(e.skill_id);
      if (!c) { c = { name: e.skill_name, ceiling: 0, depth: 0, seen: new Set() }; m.set(e.skill_id, c); }
      c.ceiling = Math.max(c.ceiling, e.level_rank);
      if (e.level_rank >= 3 && !c.seen.has(e.user_id)) { c.seen.add(e.user_id); c.depth += 1; }
    }
    return m;
    // matrixKey + entry count keep this stable without deep-comparing the array
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrixKey, matrixEntries.length]);

  // Union of every skill that either side cares about, richest first.
  const balance = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; demand: number; ceiling: number; depth: number }>();
    for (const d of demand) {
      byId.set(d.skill_id, {
        id: d.skill_id, name: d.skill_name,
        demand: d.item_count + d.task_count, ceiling: 0, depth: 0,
      });
    }
    // Only skills the backlog actually asks for matter here -- idle team skills
    // are noise on the planning view. We still pull coverage, but for demand
    // skills only.
    for (const [id, c] of coverage) {
      const row = byId.get(id);
      if (row) { row.ceiling = c.ceiling; row.depth = c.depth; }
    }
    return Array.from(byId.values()).sort((a, b) => b.demand - a.demand || b.ceiling - a.ceiling);
  }, [demand, coverage]);

  const maxDemand = Math.max(1, ...balance.map((b) => b.demand));

  // Radar axes: demand skills only (the planning focus), capped so the chart
  // stays readable. Each axis carries both demand and coverage for comparison.
  const radarData = useMemo(() => {
    return balance
      .filter((b) => b.demand > 0)
      .slice(0, 8)
      .map((b) => ({
        skill: b.name,
        demand: b.demand,
        // Scale ceiling (0..5) into demand units so both layers share an axis.
        coverage: (b.ceiling / 5) * maxDemand,
      }));
  }, [balance, maxDemand]);

  const loading = demandLoading || matrixQueries.some((q) => q.isLoading);
  const gaps = balance.filter((b) => b.demand > 0 && b.depth === 0);

  return (
    <section
      className="rounded-xl p-4"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
          Skill Planning
        </p>
        {gaps.length > 0 && (
          <span
            className="text-xs px-2 py-0.5 rounded"
            style={{ background: 'var(--bg-elevated)', color: 'var(--color-danger)', border: '1px solid var(--border)' }}
          >
            {gaps.length} skill{gaps.length > 1 ? 's' : ''} with no coverage
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>Loading...</p>
      ) : balance.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          No skills tagged on the backlog yet, and no team skills to match. Tag tasks with a required skill to light this up.
        </p>
      ) : (
        <>
          {/* Two radars side by side: what the backlog asks vs what the bench offers */}
          {radarData.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              <div className="rounded-lg p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <p className="text-xs font-medium mb-2 text-center" style={{ color: 'var(--text-3)' }}>Backlog demand</p>
                <ResponsiveContainer width="100%" height={240}>
                  <RadarChart data={radarData} outerRadius="68%" margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                    <PolarGrid stroke="var(--border)" />
                    <PolarAngleAxis dataKey="skill" tick={{ fill: 'var(--text-3)', fontSize: 10 }} tickFormatter={(v: string) => v.length > 9 ? v.slice(0, 8) + '...' : v} />
                    <PolarRadiusAxis domain={[0, maxDemand]} tick={false} axisLine={false} />
                    <Radar name="Demand" dataKey="demand" stroke="var(--accent)" strokeWidth={1.5} fill="var(--accent)" fillOpacity={0.25} dot={false} isAnimationActive={false} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <p className="text-xs font-medium mb-2 text-center" style={{ color: 'var(--text-3)' }}>Team coverage</p>
                <ResponsiveContainer width="100%" height={240}>
                  <RadarChart data={radarData} outerRadius="68%" margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                    <PolarGrid stroke="var(--border)" />
                    <PolarAngleAxis dataKey="skill" tick={{ fill: 'var(--text-3)', fontSize: 10 }} tickFormatter={(v: string) => v.length > 9 ? v.slice(0, 8) + '...' : v} />
                    <PolarRadiusAxis domain={[0, maxDemand]} tick={false} axisLine={false} />
                    <Radar name="Coverage" dataKey="coverage" stroke="var(--color-success)" strokeWidth={1.5} fill="var(--color-success)" fillOpacity={0.2} dot={false} isAnimationActive={false} />
                    <Radar name="Demand" dataKey="demand" stroke="var(--accent)" strokeWidth={1} strokeOpacity={0.4} fill="none" dot={false} isAnimationActive={false} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Load balance: per-skill demand bar with a coverage verdict on the right */}
          <div className="flex flex-col gap-1.5">
            {balance.map((b) => {
              const gap = b.demand > 0 && b.depth === 0;
              const idle = b.demand === 0;
              const barColor = gap ? 'var(--color-danger)' : idle ? 'var(--text-3)' : 'var(--accent)';
              return (
                <div key={b.id} className="flex items-center gap-2 text-xs">
                  <span className="w-28 truncate" style={{ color: 'var(--text-2)' }} title={b.name}>{b.name}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                    <div className="h-full rounded-full" style={{ width: `${(b.demand / maxDemand) * 100}%`, background: barColor, opacity: idle ? 0.3 : 1 }} />
                  </div>
                  <span className="w-8 text-right tabular-nums" style={{ color: 'var(--text-3)' }}>{b.demand}</span>
                  <span
                    className="w-24 text-right truncate"
                    title={`ceiling: ${LEVEL_LABEL[b.ceiling]}, ${b.depth} at competent+`}
                    style={{ color: gap ? 'var(--color-danger)' : b.depth > 0 ? 'var(--color-success)' : 'var(--text-3)' }}
                  >
                    {b.ceiling === 0 ? 'no one' : `${LEVEL_LABEL[b.ceiling]} (${b.depth})`}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs" style={{ color: 'var(--text-3)' }}>
            Bar = backlog demand (items + tasks). Right = best team level and how many people sit at competent+. Red means the backlog asks for a skill nobody covers.
          </p>
        </>
      )}
    </section>
  );
}

