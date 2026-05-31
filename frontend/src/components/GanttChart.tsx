import { useMemo, useState, useRef, useLayoutEffect } from 'react';
import type { Milestone, TimelineNode } from '@/types';
import { MILESTONE_HEALTH_META } from '@/lib/milestoneMeta';

// -- Date plumbing -----------------------------------------------------------
const DAY = 86_400_000;
const MONTHS_RU = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pd(s: string): Date { return new Date(s + 'T00:00:00'); }
function diffDays(a: Date, b: Date): number { return Math.round((b.getTime() - a.getTime()) / DAY); }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d: Date): Date { const x = new Date(d); const dow = (x.getDay() + 6) % 7; return addDays(x, -dow); } // Monday
function fmtDay(d: Date): string { return String(d.getDate()).padStart(2, '0'); }
function fmtMonth(d: Date): string { return `${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`; }

type Scale = 'month' | 'quarter' | 'year' | 'fit';
const SCALE_PX: Record<Exclude<Scale, 'fit'>, number> = { month: 26, quarter: 9, year: 3.2 };
const SCALES: { key: Scale; label: string }[] = [
  { key: 'month',   label: 'Month'   },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year',    label: 'Year'    },
  { key: 'fit',     label: 'Fit'     },
];

const LANE_H = 30;       // stage row height
const NAME_W = 240;      // fixed left column width
const HEAD_H = 44;       // header band height
const MS_LANE_H = 34;    // milestone diamond lane height

interface GanttProps {
  milestones: Milestone[];
  stages: TimelineNode[];
  canEdit: boolean;
  onBind: (nodeId: string, milestoneId: string | null) => void;
}

export function GanttChart({ milestones, stages, canEdit, onBind }: GanttProps) {
  const [scale, setScale] = useState<Scale>('quarter');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fitWidth, setFitWidth] = useState(1000);

  useLayoutEffect(() => {
    if (scrollRef.current) setFitWidth(scrollRef.current.clientWidth - 8);
  }, [scale]);

  const health = useMemo(() => {
    const m = new Map<string, string>();
    for (const ms of milestones) m.set(ms.id, ms.health);
    return m;
  }, [milestones]);

  // -- Domain: earliest..latest date across everything, padded ---------------
  const { domainStart, spanDays } = useMemo(() => {
    const ts: number[] = [];
    for (const s of stages) {
      if (s.start_date) ts.push(pd(s.start_date).getTime());
      if (s.end_date) ts.push(pd(s.end_date).getTime());
    }
    for (const ms of milestones) ts.push(pd(ms.target_date).getTime());
    ts.push(Date.now());
    let min = Math.min(...ts);
    let max = Math.max(...ts);
    if (!isFinite(min) || !isFinite(max) || min === max) {
      min = Date.now() - 15 * DAY;
      max = Date.now() + 75 * DAY;
    }
    const start = addDays(startOfMonth(new Date(min)), 0);
    const end = addDays(new Date(max), 14);
    return { domainStart: start, spanDays: Math.max(diffDays(start, end), 30) };
  }, [stages, milestones]);

  const pxPerDay = scale === 'fit' ? Math.max(2, fitWidth / spanDays) : SCALE_PX[scale];
  const chartW = spanDays * pxPerDay;
  const x = (d: Date) => diffDays(domainStart, d) * pxPerDay;
  const xs = (s: string) => x(pd(s));

  // -- Tick granularity: day (zoomed) / week (mid) / month (far) -------------
  const ticks = useMemo(() => {
    const out: { left: number; label: string; major: boolean }[] = [];
    const end = addDays(domainStart, spanDays);
    if (pxPerDay >= 16) {
      // day ticks, month boundaries are major
      for (let d = new Date(domainStart); d <= end; d = addDays(d, 1)) {
        out.push({ left: x(d), label: fmtDay(d), major: d.getDate() === 1 });
      }
    } else if (pxPerDay >= 5) {
      // week ticks (Mondays)
      for (let d = startOfWeek(domainStart); d <= end; d = addDays(d, 7)) {
        out.push({ left: x(d), label: `${fmtDay(d)}.${String(d.getMonth() + 1).padStart(2, '0')}`, major: d.getDate() <= 7 });
      }
    } else {
      // month ticks
      for (let d = startOfMonth(domainStart); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        out.push({ left: x(d), label: MONTHS_RU[d.getMonth()], major: d.getMonth() === 0 });
      }
    }
    return out;
  }, [domainStart, spanDays, pxPerDay]);

  // Month band (always shown on top of the header).
  const monthBands = useMemo(() => {
    const out: { left: number; width: number; label: string }[] = [];
    const end = addDays(domainStart, spanDays);
    for (let d = startOfMonth(domainStart); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const from = Math.max(x(d), 0);
      const to = Math.min(x(next), chartW);
      out.push({ left: from, width: to - from, label: fmtMonth(d) });
    }
    return out;
  }, [domainStart, spanDays, pxPerDay, chartW]);

  const todayX = x(new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00'));
  const rows = stages; // already ordered depth->date by the API

  return (
    <div className="flex flex-col gap-3">
      {/* Scale controls */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs mr-1" style={{ color: 'var(--text-3)' }}>Scale:</span>
        {SCALES.map((s) => (
          <button
            key={s.key}
            onClick={() => setScale(s.key)}
            className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
            style={{
              background: scale === s.key ? 'var(--accent)' : 'var(--bg-surface)',
              color: scale === s.key ? 'var(--accent-fg, #fff)' : 'var(--text-2)',
              border: `1px solid ${scale === s.key ? 'var(--accent)' : 'var(--border)'}`,
            }}
          >
            {s.label}
          </button>
        ))}
        <div className="flex items-center gap-3 ml-4 text-xs" style={{ color: 'var(--text-3)' }}>
          {(['on_time', 'at_risk', 'delayed', 'missed'] as const).map((h) => (
            <span key={h} className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: MILESTONE_HEALTH_META[h].color }} />
              {MILESTONE_HEALTH_META[h].label}
            </span>
          ))}
        </div>
      </div>

      <div
        className="rounded-xl overflow-hidden"
        style={{ border: '1px solid var(--border)', background: 'var(--bg-surface)' }}
      >
        <div className="flex">
          {/* Fixed left column */}
          <div style={{ width: NAME_W, flexShrink: 0, borderRight: '1px solid var(--border)' }}>
            <div style={{ height: HEAD_H, borderBottom: '1px solid var(--border)' }} className="flex items-end px-3 pb-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>Stage</span>
            </div>
            <div style={{ height: MS_LANE_H, borderBottom: '1px solid var(--border)' }} className="flex items-center px-3">
              <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>Milestones</span>
            </div>
            {rows.map((s) => (
              <div
                key={s.id}
                style={{ height: LANE_H, borderBottom: '1px solid var(--border-subtle, var(--border))' }}
                className="flex items-center gap-1.5 px-3"
              >
                <span
                  className="text-xs truncate"
                  style={{ color: 'var(--text-2)', paddingLeft: s.depth * 10, maxWidth: canEdit ? 120 : 200 }}
                  title={s.name}
                >
                  {s.name}
                </span>
                {canEdit && (
                  <select
                    value={s.milestone_id ?? ''}
                    onChange={(e) => onBind(s.id, e.target.value || null)}
                    className="ml-auto text-[10px] rounded px-1 py-0.5 outline-none"
                    style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-2)', maxWidth: 84 }}
                    title="Bind to milestone"
                  >
                    <option value="">--</option>
                    {milestones.map((ms) => (
                      <option key={ms.id} value={ms.id}>M-{ms.number}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>

          {/* Scrollable timeline */}
          <div ref={scrollRef} className="overflow-x-auto flex-1">
            <div style={{ width: chartW, position: 'relative' }}>
              {/* Header: month bands + ticks */}
              <div style={{ height: HEAD_H, position: 'relative', borderBottom: '1px solid var(--border)' }}>
                {monthBands.map((b, i) => (
                  <div
                    key={i}
                    style={{ position: 'absolute', left: b.left, width: b.width, top: 0, height: 20, borderRight: '1px solid var(--border)' }}
                    className="flex items-center px-1.5 overflow-hidden"
                  >
                    <span className="text-[10px] font-semibold whitespace-nowrap" style={{ color: 'var(--text-2)' }}>{b.label}</span>
                  </div>
                ))}
                {ticks.map((t, i) => (
                  <div key={i} style={{ position: 'absolute', left: t.left, top: 20, height: HEAD_H - 20 }} className="flex items-end pb-1">
                    <span className="text-[9px]" style={{ color: t.major ? 'var(--text-2)' : 'var(--text-3)', transform: 'translateX(-50%)' }}>{t.label}</span>
                  </div>
                ))}
              </div>

              {/* Gridlines spanning the whole body */}
              {ticks.map((t, i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute', left: t.left, top: HEAD_H, bottom: 0, width: 1,
                    background: t.major ? 'var(--border)' : 'color-mix(in srgb, var(--border) 45%, transparent)',
                  }}
                />
              ))}

              {/* Milestone diamond lane */}
              <div style={{ height: MS_LANE_H, position: 'relative', borderBottom: '1px solid var(--border)' }}>
                {milestones.map((ms) => {
                  const left = xs(ms.target_date);
                  const color = MILESTONE_HEALTH_META[ms.health]?.color ?? 'var(--accent)';
                  return (
                    <div
                      key={ms.id}
                      title={`M-${ms.number} ${ms.name} -- ${ms.target_date} (${ms.health})`}
                      style={{
                        position: 'absolute', left, top: MS_LANE_H / 2, width: 12, height: 12,
                        background: color, transform: 'translate(-50%, -50%) rotate(45deg)',
                        border: '1px solid var(--bg-surface)', cursor: 'default',
                      }}
                    />
                  );
                })}
              </div>

              {/* Stage bars */}
              {rows.map((s) => {
                const hasRange = s.start_date && s.end_date;
                const left = s.start_date ? xs(s.start_date) : 0;
                const right = s.end_date ? xs(s.end_date) : left;
                const w = Math.max(right - left, 4);
                const barColor = s.milestone_id && health.get(s.milestone_id)
                  ? MILESTONE_HEALTH_META[health.get(s.milestone_id) as Milestone['health']].color
                  : 'color-mix(in srgb, var(--accent) 35%, var(--bg-elevated))';
                return (
                  <div key={s.id} style={{ height: LANE_H, position: 'relative', borderBottom: '1px solid color-mix(in srgb, var(--border) 50%, transparent)' }}>
                    {hasRange && (
                      <div
                        title={`${s.name}: ${s.start_date} -> ${s.end_date}`}
                        style={{
                          position: 'absolute', left, top: 6, width: w, height: LANE_H - 12,
                          background: barColor, borderRadius: 5, border: '1px solid color-mix(in srgb, var(--text-1) 12%, transparent)',
                        }}
                      />
                    )}
                  </div>
                );
              })}

              {/* "Now" marker */}
              {todayX >= 0 && todayX <= chartW && (
                <div style={{ position: 'absolute', left: todayX, top: 0, bottom: 0, width: 2, background: 'var(--color-danger)', zIndex: 5 }}>
                  <span
                    className="text-[9px] font-semibold px-1 rounded-sm"
                    style={{ position: 'absolute', top: 2, left: 3, color: 'var(--accent-fg, #fff)', background: 'var(--color-danger)', whiteSpace: 'nowrap' }}
                  >
                    Now
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {rows.length === 0 && (
        <p className="text-sm text-center py-6" style={{ color: 'var(--text-3)' }}>
          No stages with dates yet. Set start/end dates on project nodes to see bars.
        </p>
      )}
    </div>
  );
}
