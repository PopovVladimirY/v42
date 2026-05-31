import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useAuthStore } from '@/hooks/useAuth';
import {
  useMilestones, useTimeline,
  useCreateMilestone, useUpdateMilestone, useDeleteMilestone, useBindNodeMilestone,
} from '@/hooks/useProjects';
import type { Milestone, MilestoneStatus } from '@/types';
import { MILESTONE_STATUS_META, MILESTONE_HEALTH_META, MILESTONE_STATUS_OPTS } from '@/lib/milestoneMeta';
import { GanttChart } from '@/components/GanttChart';

const inp = 'rounded-lg px-3 py-2 text-sm outline-none';
const inpStyle = { background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-1)' };

function Badge({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color, background: `color-mix(in srgb, ${color} 12%, var(--bg-elevated))` }}
    >
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function firstLine(desc: string | null): string {
  if (!desc) return '';
  const nl = desc.indexOf('\n');
  const s = nl >= 0 ? desc.slice(0, nl) : desc;
  return s.length > 90 ? s.slice(0, 90) + '...' : s;
}

// -- Create / edit form ------------------------------------------------------
function MilestoneForm({
  projectId, milestone, onDone, onCancel,
}: {
  projectId: string;
  milestone?: Milestone;
  onDone: () => void;
  onCancel: () => void;
}) {
  const create = useCreateMilestone(projectId);
  const update = useUpdateMilestone(projectId);
  const [name, setName] = useState(milestone?.name ?? '');
  const [desc, setDesc] = useState(milestone?.description ?? '');
  const [date, setDate] = useState(milestone?.target_date ?? '');
  const [status, setStatus] = useState<MilestoneStatus>(milestone?.status ?? 'future');
  const busy = create.isPending || update.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !date) return;
    if (milestone) {
      await update.mutateAsync({
        milestoneId: milestone.id,
        name: name.trim() !== milestone.name ? name.trim() : undefined,
        description: desc !== (milestone.description ?? '') ? (desc || undefined) : undefined,
        target_date: date !== milestone.target_date ? date : undefined,
        status: status !== milestone.status ? status : undefined,
      });
    } else {
      await create.mutateAsync({ name: name.trim(), description: desc || undefined, target_date: date, status });
    }
    onDone();
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)' }}
    >
      <div className="flex gap-3 flex-wrap">
        <div className="flex flex-col gap-1 flex-1 min-w-48">
          <label className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inp} style={inpStyle} maxLength={200} autoFocus required />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Target date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} style={inpStyle} required />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as MilestoneStatus)} className={inp} style={inpStyle}>
            {MILESTONE_STATUS_OPTS.map((s) => (
              <option key={s} value={s}>{MILESTONE_STATUS_META[s].label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Description</label>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} className={inp} style={{ ...inpStyle, minHeight: 56, resize: 'vertical' }} maxLength={2000} />
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm" style={{ color: 'var(--text-2)', border: '1px solid var(--border)' }}>Cancel</button>
        <button type="submit" disabled={busy || !name.trim() || !date} className="px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-fg, #fff)' }}>
          {milestone ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  );
}

// -- Table view --------------------------------------------------------------
function MilestonesTable({ projectId, milestones, canEdit }: { projectId: string; milestones: Milestone[]; canEdit: boolean }) {
  const del = useDeleteMilestone(projectId);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Filters
  const [statusF, setStatusF] = useState<MilestoneStatus | ''>('');
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    return milestones.filter((m) => {
      if (statusF && m.status !== statusF) return false;
      if (from && m.target_date < from) return false;
      if (to && m.target_date > to) return false;
      if (q && !(m.name.toLowerCase().includes(q) || (m.description ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [milestones, statusF, text, from, to]);

  return (
    <div className="flex flex-col gap-3">
      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap items-center">
        <input placeholder="Search name / description..." value={text} onChange={(e) => setText(e.target.value)} className={inp} style={{ ...inpStyle, minWidth: 220 }} />
        <select value={statusF} onChange={(e) => setStatusF(e.target.value as MilestoneStatus | '')} className={inp} style={inpStyle}>
          <option value="">All statuses</option>
          {MILESTONE_STATUS_OPTS.map((s) => (<option key={s} value={s}>{MILESTONE_STATUS_META[s].label}</option>))}
        </select>
        <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-3)' }}>
          <span>from</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inp} style={inpStyle} />
          <span>to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inp} style={inpStyle} />
        </div>
        {(statusF || text || from || to) && (
          <button onClick={() => { setStatusF(''); setText(''); setFrom(''); setTo(''); }} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--text-2)', border: '1px solid var(--border)' }}>Clear</button>
        )}
        <span className="text-xs ml-auto" style={{ color: 'var(--text-3)' }}>{filtered.length} / {milestones.length}</span>
        {canEdit && !creating && (
          <button onClick={() => { setCreating(true); setEditing(null); }} className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: 'var(--accent-fg, #fff)' }}>+ Milestone</button>
        )}
      </div>

      {creating && <MilestoneForm projectId={projectId} onDone={() => setCreating(false)} onCancel={() => setCreating(false)} />}

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-3)' }}>
              <th className="text-left px-3 py-2 font-medium">#</th>
              <th className="text-left px-3 py-2 font-medium">Name</th>
              <th className="text-left px-3 py-2 font-medium">Target</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Health</th>
              {canEdit && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={canEdit ? 6 : 5} className="px-3 py-6 text-center" style={{ color: 'var(--text-3)' }}>No milestones match.</td></tr>
            )}
            {filtered.map((m) => editing === m.id ? (
              <tr key={m.id}>
                <td colSpan={canEdit ? 6 : 5} className="p-2" style={{ background: 'var(--bg-base)' }}>
                  <MilestoneForm projectId={projectId} milestone={m} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
                </td>
              </tr>
            ) : (
              <tr key={m.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--text-3)' }}>M-{m.number}</td>
                <td className="px-3 py-2">
                  <button onClick={() => canEdit && (setEditing(m.id), setCreating(false))} className="text-left" style={{ color: 'var(--text-1)', cursor: canEdit ? 'pointer' : 'default' }}>
                    <span className="font-medium">{m.name}</span>
                    {m.description && <span className="block text-xs" style={{ color: 'var(--text-3)' }}>{firstLine(m.description)}</span>}
                  </button>
                </td>
                <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-2)' }}>{m.target_date}</td>
                <td className="px-3 py-2"><Badge color={MILESTONE_STATUS_META[m.status].color} label={MILESTONE_STATUS_META[m.status].label} /></td>
                <td className="px-3 py-2"><Badge color={MILESTONE_HEALTH_META[m.health].color} label={MILESTONE_HEALTH_META[m.health].label} /></td>
                {canEdit && (
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => { setEditing(m.id); setCreating(false); }} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--accent)' }}>Edit</button>
                    <button
                      onClick={() => { if (confirm(`Delete milestone "${m.name}"?`)) del.mutate(m.id); }}
                      className="text-xs px-2 py-1 rounded"
                      style={{ color: 'var(--color-danger)' }}
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -- Page --------------------------------------------------------------------
export function MilestonesPage() {
  const { projectId = '' } = useParams();
  const user = useAuthStore((s) => s.user);
  const canEdit = user?.role === 'admin' || user?.role === 'maintainer';

  const [view, setView] = useState<'list' | 'gantt'>('list');
  const milestonesQ = useMilestones(projectId);
  const timelineQ = useTimeline(projectId);
  const bind = useBindNodeMilestone(projectId);

  const milestones = milestonesQ.data ?? [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text-1)' }}>Milestones</h1>
        <div className="flex ml-auto rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {(['list', 'gantt'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="px-3 py-1.5 text-sm font-medium capitalize"
              style={{
                background: view === v ? 'var(--accent)' : 'var(--bg-surface)',
                color: view === v ? 'var(--accent-fg, #fff)' : 'var(--text-2)',
              }}
            >
              {v === 'list' ? 'List' : 'Gantt'}
            </button>
          ))}
        </div>
      </div>

      {milestonesQ.isLoading ? (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading...</p>
      ) : view === 'list' ? (
        <MilestonesTable projectId={projectId} milestones={milestones} canEdit={canEdit} />
      ) : (
        <GanttChart
          milestones={timelineQ.data?.milestones ?? milestones}
          stages={timelineQ.data?.stages ?? []}
          canEdit={canEdit}
          onBind={(nodeId, milestoneId) => bind.mutate({ nodeId, milestoneId })}
        />
      )}
    </div>
  );
}
