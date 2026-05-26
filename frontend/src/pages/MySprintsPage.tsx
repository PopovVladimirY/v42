import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { sprintsApi, type GlobalSprint, type SprintStatus } from '@/api/endpoints/sprints';
import { SPRINT_STATUS_LABEL, SPRINT_STATUS_COLOR } from '@/hooks/useSprints';

type TabStatus = SprintStatus | 'all';

const STATUS_TABS: { value: TabStatus; label: string }[] = [
  { value: 'all',       label: 'All' },
  { value: 'active',    label: 'Active' },
  { value: 'planning',  label: 'Planning' },
  { value: 'completed', label: 'Completed' },
];

function SprintCard({ sprint }: { sprint: GlobalSprint }) {
  const pct = sprint.total_items > 0
    ? Math.round((sprint.done_items / sprint.total_items) * 100)
    : 0;

  return (
    <Link
      to={`/projects/${sprint.project_id}/sprints/${sprint.id}`}
      className="block bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{sprint.project_name}</p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="font-mono text-xs font-medium shrink-0" style={{ color: 'var(--accent)' }}>
              S-{sprint.sprint_number}
            </span>
            <h3 className="font-medium text-sm text-foreground truncate">{sprint.name}</h3>
          </div>
          {sprint.team_name && (
            <p className="text-xs text-muted-foreground mt-0.5">{sprint.team_name}</p>
          )}
        </div>
        <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SPRINT_STATUS_COLOR[sprint.status]}`}>
          {SPRINT_STATUS_LABEL[sprint.status]}
        </span>
      </div>

      {sprint.start_date && sprint.end_date && (
        <p className="text-xs text-muted-foreground mt-2">
          {sprint.start_date} – {sprint.end_date}
        </p>
      )}

      <div className="mt-3">
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>{sprint.done_items} / {sprint.total_items} items done</span>
          <span>{pct}%</span>
        </div>
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </Link>
  );
}

export function MySprintsPage() {
  const [status, setStatus] = useState<TabStatus>('active');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sprints', 'global', status],
    queryFn: async () => {
      if (status === 'all') {
        const [active, planning, completed] = await Promise.all([
          sprintsApi.listGlobal('active').then((r) => r.data.data ?? []),
          sprintsApi.listGlobal('planning').then((r) => r.data.data ?? []),
          sprintsApi.listGlobal('completed').then((r) => r.data.data ?? []),
        ]);
        return [...active, ...planning, ...completed];
      }
      const res = await sprintsApi.listGlobal(status);
      return res.data.data ?? [];
    },
  });

  // Group by project_name
  const byProject = (data ?? []).reduce<Record<string, GlobalSprint[]>>((acc, s) => {
    (acc[s.project_name] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">My Sprints</h1>
        <div
          className="flex gap-1 rounded-lg p-0.5"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatus(tab.value)}
              className="px-3 py-1 text-xs rounded-md font-medium transition-all"
              style={
                status === tab.value
                  ? { background: 'var(--bg-active)', color: 'var(--text-1)' }
                  : { color: 'var(--text-3)' }
              }
              onMouseEnter={(e) => {
                if (status !== tab.value)
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)';
              }}
              onMouseLeave={(e) => {
                if (status !== tab.value)
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)';
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading sprints...</p>
      )}

      {isError && (
        <p className="text-sm text-destructive">Failed to load sprints.</p>
      )}

      {!isLoading && !isError && Object.keys(byProject).length === 0 && (
        <p className="text-sm text-muted-foreground">
          {status === 'all'
            ? 'No sprints found.'
            : `No ${SPRINT_STATUS_LABEL[status as SprintStatus].toLowerCase()} sprints found.`}
        </p>
      )}

      {Object.entries(byProject).map(([projectName, sprints]) => (
        <section key={projectName}>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">{projectName}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sprints.map((s) => <SprintCard key={s.id} sprint={s} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
