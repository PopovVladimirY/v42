import type { MilestoneStatus, MilestoneHealth } from '@/types';

// Lifecycle (manual intent). What the team SAYS about the milestone.
export const MILESTONE_STATUS_META: Record<MilestoneStatus, { label: string; color: string }> = {
  future: { label: 'Future', color: 'var(--text-3)' },
  target: { label: 'Target', color: 'var(--accent)' },
  closed: { label: 'Closed', color: 'var(--color-success)' },
};

// Health (derived from dates). What the CALENDAR says will actually happen.
export const MILESTONE_HEALTH_META: Record<MilestoneHealth, { label: string; color: string }> = {
  on_time: { label: 'On time', color: 'var(--color-success)' },
  at_risk: { label: 'At risk', color: 'var(--color-warning)' },
  delayed: { label: 'Delayed', color: 'color-mix(in srgb, var(--color-warning) 45%, var(--color-danger))' },
  missed:  { label: 'Missed',  color: 'var(--color-danger)' },
  closed:  { label: 'Closed',  color: 'var(--text-3)' },
};

export const MILESTONE_STATUS_OPTS: MilestoneStatus[] = ['future', 'target', 'closed'];
