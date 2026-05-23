import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
} from 'recharts';
import { useAuthStore } from '@/hooks/useAuth';
import { useThemeStore, THEMES } from '@/stores/useTheme';
import type { Theme } from '@/stores/useTheme';
import { usePaginationStore, VALID_SIZES } from '@/stores/usePagination';
import type { PageCategory } from '@/stores/usePagination';
import { authApi } from '@/api/endpoints/auth';
import { usersApi, skillsApi } from '@/api/endpoints/users';
import { teamsApi } from '@/api/endpoints/teams';
import { capacityApi } from '@/api/endpoints/capacity';
import type { MemberSkill, SkillLevel, InterestLevel, Skill } from '@/types/index';

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------

const LEVELS: { value: SkillLevel; label: string }[] = [
  { value: 'novice', label: 'Novice' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'competent', label: 'Competent' },
  { value: 'proficient', label: 'Proficient' },
  { value: 'expert', label: 'Expert' },
];

const LEVEL_COLOR: Record<SkillLevel, string> = {
  novice: '#6b7280',
  beginner: 'var(--color-info)',
  competent: '#a78bfa',
  proficient: 'var(--color-warning)',
  expert: 'var(--color-success)',
};

const INTERESTS: { value: InterestLevel; label: string; icon: string }[] = [
  { value: 'low', label: 'Low', icon: '~' },
  { value: 'medium', label: 'Medium', icon: '+' },
  { value: 'high', label: 'High', icon: '++' },
];

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en', { month: 'long', year: 'numeric' });
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  maintainer: 'Maintainer',
  developer: 'Developer',
  observer: 'Observer',
};

const ACCENT_MAP: Record<string, string> = {
  'deep-dive': '#00c4b8',
  'night-sky': '#b89aff',
  'new-york': '#f5c518',
  'classic-dark': '#6b7280',
  'ocean-blue': '#3b82f6',
  'paper-white': '#d97706',
  'sunrise': '#f59e0b',
  'high-contrast': '#ffffff',
};

// ------------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------------

function SkillRow({
  s,
  onEdit,
  onDelete,
  isDeleting,
}: {
  s: MemberSkill;
  onEdit: (s: MemberSkill) => void;
  onDelete: (skillId: string) => void;
  isDeleting: boolean;
}) {
  const color = LEVEL_COLOR[s.level] ?? 'var(--text-3)';
  const interestIcon = INTERESTS.find((i) => i.value === s.interest)?.icon ?? '~';
  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg group"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-1)' }}>
          {s.skill_name}
        </p>
        {s.category && (
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            {s.category}
          </p>
        )}
      </div>
      <span
        className="text-xs font-mono px-1.5 py-0.5 rounded flex-shrink-0"
        style={{ background: 'var(--bg-elevated)', color: 'var(--text-3)', letterSpacing: '0.05em' }}
        title={`Interest: ${s.interest}`}
      >
        {interestIcon}
      </span>
      <span
        className="text-xs font-medium capitalize px-2 py-0.5 rounded-full flex-shrink-0"
        style={{ background: color + '1a', color, border: `1px solid ${color}40` }}
      >
        {s.level}
      </span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          onClick={() => onEdit(s)}
          title="Edit"
          className="p-1 rounded transition-colors hover:bg-[var(--bg-hover)]"
          style={{ color: 'var(--text-3)' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={() => onDelete(s.skill_id)}
          disabled={isDeleting}
          title="Remove"
          className="p-1 rounded transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40"
          style={{ color: 'var(--color-danger)' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

interface SkillFormState {
  skillId: string;
  level: SkillLevel;
  interest: InterestLevel;
  note: string;
}

function SkillEditor({
  userId,
  catalog,
  existingSkillIds,
  initial,
  onDone,
  onCancel,
}: {
  userId: string;
  catalog: Skill[];
  existingSkillIds: Set<string>;
  initial?: MemberSkill;
  onDone: () => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<SkillFormState>({
    skillId: initial?.skill_id ?? '',
    level: initial?.level ?? 'beginner',
    interest: initial?.interest ?? 'medium',
    note: initial?.interest_note ?? '',
  });
  const upsert = useMutation({
    mutationFn: () =>
      usersApi.upsertSkill(userId, form.skillId, {
        level: form.level,
        interest: form.interest,
        interest_note: form.note.trim() || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user-skills', userId] });
      void qc.invalidateQueries({ queryKey: ['personal-radar', userId] });
      // Invalidate team queries so TeamDetailPage radar updates live
      void qc.invalidateQueries({ queryKey: ['team-skill-matrix'] });
      void qc.invalidateQueries({ queryKey: ['team-tandems'] });
      void qc.invalidateQueries({ queryKey: ['team-learning-appetite'] });
      onDone();
    },
  });
  const available = catalog.filter((s) => s.id === form.skillId || !existingSkillIds.has(s.id));
  return (
    <div
      className="rounded-lg p-4 flex flex-col gap-3"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
    >
      {!initial && (
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>Skill</label>
          <select
            value={form.skillId}
            onChange={(e) => setForm((f) => ({ ...f, skillId: e.target.value }))}
            className="w-full text-sm rounded-md px-2.5 py-2 outline-none"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          >
            <option value="">Select a skill...</option>
            {available.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.category ? ` (${s.category})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>Level</label>
        <div className="flex gap-1">
          {LEVELS.map((l) => (
            <button
              key={l.value}
              onClick={() => setForm((f) => ({ ...f, level: l.value }))}
              className="flex-1 py-1.5 text-xs rounded-md transition-colors"
              style={{
                background: form.level === l.value ? (LEVEL_COLOR[l.value] + '22') : 'var(--bg-surface)',
                border: `1px solid ${form.level === l.value ? LEVEL_COLOR[l.value] : 'var(--border)'}`,
                color: form.level === l.value ? LEVEL_COLOR[l.value] : 'var(--text-2)',
                fontWeight: form.level === l.value ? 600 : 400,
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>Interest</label>
        <div className="flex gap-2">
          {INTERESTS.map((i) => (
            <button
              key={i.value}
              onClick={() => setForm((f) => ({ ...f, interest: i.value }))}
              className="flex-1 py-1.5 text-xs rounded-md transition-colors"
              style={{
                background: form.interest === i.value ? 'var(--bg-active)' : 'var(--bg-surface)',
                border: `1px solid ${form.interest === i.value ? 'var(--accent)' : 'var(--border)'}`,
                color: form.interest === i.value ? 'var(--text-1)' : 'var(--text-2)',
                fontWeight: form.interest === i.value ? 600 : 400,
              }}
            >
              {i.label} <span className="font-mono">{i.icon}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>
          Note <span style={{ color: 'var(--text-3)' }}>(optional)</span>
        </label>
        <input
          type="text"
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          placeholder="e.g. Focused on React, not Angular"
          maxLength={500}
          className="w-full text-sm rounded-md px-2.5 py-2 outline-none"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        />
      </div>
      {upsert.isError && (
        <p className="text-xs" style={{ color: 'var(--color-danger)' }}>Failed to save. Please try again.</p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => void upsert.mutate()}
          disabled={!form.skillId || upsert.isPending}
          className="flex-1 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-40"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          {upsert.isPending ? 'Saving...' : initial ? 'Update' : 'Add skill'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm rounded-md"
          style={{ background: 'var(--bg-surface)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Display Preferences -- page sizes per category
// ------------------------------------------------------------------

const PAGE_CATEGORIES: { key: PageCategory; label: string }[] = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'epics',   label: 'Epics'   },
  { key: 'sprints', label: 'Sprints' },
];

function DisplayPrefsSection() {
  const pageSizes  = usePaginationStore((s) => s.pageSizes);
  const setPageSize = usePaginationStore((s) => s.setPageSize);

  return (
    <section className="mb-8">
      <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
        Display Preferences
      </h2>
      <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>Rows per page in list views</p>
        {PAGE_CATEGORIES.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <span className="text-sm" style={{ color: 'var(--text-2)' }}>{label}</span>
            <select
              value={pageSizes[key]}
              onChange={(e) => setPageSize(key, Number(e.target.value) as typeof VALID_SIZES[number])}
              className="text-sm px-2 py-1.5 rounded-md"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            >
              {VALID_SIZES.map((s) => (
                <option key={s} value={s}>{s} rows</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------
// ProfilePage
// ------------------------------------------------------------------

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const { theme: activeTheme, setTheme } = useThemeStore();
  const qc = useQueryClient();

  const userId = user?.id ?? '';
  const [editing, setEditing] = useState<null | 'new' | MemberSkill>(null);

  const { data: skills, isLoading: skillsLoading } = useQuery({
    queryKey: ['user-skills', userId],
    queryFn: () => usersApi.getSkills(userId),
    enabled: !!userId,
  });

  const { data: skillCatalog } = useQuery({
    queryKey: ['skills-catalog'],
    queryFn: skillsApi.list,
    staleTime: 5 * 60 * 1000,
  });

  const { data: teams, isLoading: teamsLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: teamsApi.list,
    enabled: !!userId,
  });

  const { data: personalRadar } = useQuery({
    queryKey: ['personal-radar', userId],
    queryFn: () => capacityApi.personalRadar(userId),
    enabled: !!userId,
  });

  const { data: myAppetite } = useQuery({
    queryKey: ['my-appetite', userId],
    queryFn: () => capacityApi.userLearningAppetite(userId),
    enabled: !!userId,
  });

  const { data: myEngagement } = useQuery({
    queryKey: ['my-engagement', userId],
    queryFn: () => capacityApi.userEngagement(userId),
    enabled: !!userId,
  });

  const deleteSkill = useMutation({
    mutationFn: (skillId: string) => usersApi.deleteSkill(userId, skillId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user-skills', userId] });
      void qc.invalidateQueries({ queryKey: ['personal-radar', userId] });
      void qc.invalidateQueries({ queryKey: ['team-skill-matrix'] });
      void qc.invalidateQueries({ queryKey: ['team-tandems'] });
      void qc.invalidateQueries({ queryKey: ['team-learning-appetite'] });
    },
  });

  async function handleThemeChange(t: Theme) {
    setTheme(t);
    try { await authApi.patchMe({ theme: t }); } catch { /* non-critical */ }
  }

  async function handleIdleTimeoutChange(minutes: number) {
    try { await authApi.patchMe({ idle_timeout_minutes: minutes }); } catch { /* non-critical */ }
  }

  const label = user?.full_name ?? user?.display_name ?? user?.email ?? '?';
  const userInitials = initials(label);
  const existingSkillIds = new Set(skills?.map((s) => s.skill_id) ?? []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-center gap-5 mb-8">
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt={label} className="w-16 h-16 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              {userInitials}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold truncate" style={{ color: 'var(--text-1)' }}>{label}</h1>
            <p className="text-sm truncate mt-0.5" style={{ color: 'var(--text-2)' }}>{user?.email}</p>
            <div className="flex items-center gap-3 mt-2">
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)', opacity: 0.9 }}
              >
                {ROLE_LABEL[user?.role ?? ''] ?? user?.role}
              </span>
              {user?.created_at && (
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>Since {fmtDate(user.created_at)}</span>
              )}
            </div>
          </div>
        </div>

        {/* Appearance */}
        <section className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
            Appearance
          </h2>
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ background: ACCENT_MAP[activeTheme] ?? '#888' }}
            />
            <select
              value={activeTheme}
              onChange={(e) => void handleThemeChange(e.target.value as Theme)}
              className="text-sm px-2 py-1.5 rounded-md"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                color: 'var(--text-1)',
              }}
            >
              {THEMES.map((t) => (
                <option key={t} value={t}>{t.replace(/-/g, ' ')}</option>
              ))}
            </select>
          </div>
        </section>

        {/* Session */}
        <section className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
            Session
          </h2>
          <div className="flex items-center gap-3">
            <label className="text-sm" style={{ color: 'var(--text-2)' }}>Auto-logout after inactivity</label>
            <select
              defaultValue={user?.idle_timeout_minutes ?? 30}
              onChange={(e) => void handleIdleTimeoutChange(Number(e.target.value))}
              className="text-sm px-2 py-1 rounded-md"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            >
              <option value={0}>Never</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={120}>2 hours</option>
            </select>
          </div>
        </section>

        {/* Skills */}        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
              Skills
            </h2>
            <button
              onClick={() => setEditing((e) => (e === 'new' ? null : 'new'))}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md transition-colors"
              style={{
                background: editing === 'new' ? 'var(--bg-active)' : 'var(--bg-surface)',
                border: '1px solid var(--border)',
                color: 'var(--text-2)',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Add skill
            </button>
          </div>

          {editing === 'new' && skillCatalog && (
            <div className="mb-3">
              <SkillEditor
                userId={userId}
                catalog={skillCatalog}
                existingSkillIds={existingSkillIds}
                onDone={() => setEditing(null)}
                onCancel={() => setEditing(null)}
              />
            </div>
          )}

          {skillsLoading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }} />
              ))}
            </div>
          ) : !skills || skills.length === 0 ? (
            editing !== 'new' && (
              <p className="text-sm py-4 text-center" style={{ color: 'var(--text-3)' }}>No skills added yet.</p>
            )
          ) : (
            <div className="flex flex-col gap-2">
              {skills.map((s) =>
                typeof editing === 'object' && editing !== null && editing.skill_id === s.skill_id ? (
                  <div key={s.skill_id} className="mb-1">
                    <SkillEditor
                      userId={userId}
                      catalog={skillCatalog ?? []}
                      existingSkillIds={existingSkillIds}
                      initial={s}
                      onDone={() => setEditing(null)}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                ) : (
                  <SkillRow
                    key={s.skill_id}
                    s={s}
                    onEdit={(ms) => setEditing(ms)}
                    onDelete={(id) => void deleteSkill.mutate(id)}
                    isDeleting={deleteSkill.isPending && deleteSkill.variables === s.skill_id}
                  />
                ),
              )}
            </div>
          )}
        </section>

        {/* Teams */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
            Teams
          </h2>
          {teamsLoading ? (
            <div className="flex flex-col gap-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-10 rounded-lg animate-pulse" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }} />
              ))}
            </div>
          ) : !teams || teams.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-3)' }}>Not a member of any team yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {teams.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
                >
                  <div
                    className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-2)' }}
                  >
                    {t.name[0].toUpperCase()}
                  </div>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{t.name}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Skill Radar */}
        {personalRadar && personalRadar.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
              Skill Radar
            </h2>
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              <ResponsiveContainer width="100%" height={240}>
                <RadarChart data={personalRadar.map((s) => ({ skill: s.skill_name, level: s.level_rank }))} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                  <PolarGrid stroke="var(--border)" />
                  <PolarAngleAxis dataKey="skill" tick={{ fill: 'var(--text-3)', fontSize: 11 }} />
                  <Radar name="Me" dataKey="level" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.25} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* Learning Appetite */}
        {myAppetite && (
          <section className="mb-8">
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
              Learning Appetite
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg px-4 py-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <p className="text-xl font-semibold" style={{ color: 'var(--accent)' }}>{myAppetite.reaching_count}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Skills actively growing</p>
              </div>
              <div className="rounded-lg px-4 py-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <p className="text-xl font-semibold" style={{ color: 'var(--text-1)' }}>{myAppetite.curious_breadth}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Areas explored</p>
              </div>
              <div className="rounded-lg px-4 py-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <p className="text-xl font-semibold" style={{ color: 'var(--text-1)' }}>{myAppetite.total_skills}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Total skills</p>
              </div>
              <div className="rounded-lg px-4 py-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <p className="text-xl font-semibold" style={{ color: 'var(--color-success, #22c55e)' }}>{myAppetite.recent_level_ups}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Level-ups last 90d</p>
              </div>
            </div>
          </section>
        )}

        {/* Engagement */}
        {myEngagement && (
          <section className="mb-8">
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
              Skill Calibration
            </h2>
            <div
              className="rounded-lg px-4 py-3 flex items-center justify-between"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
            >
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
                  {myEngagement.grounded_expert_count} / {myEngagement.declared_expert_count} experts grounded
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {myEngagement.engaged_skills} skill{myEngagement.engaged_skills !== 1 ? 's' : ''} with interest signal
                </p>
              </div>
              {myEngagement.declared_expert_count > 0 && (
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{
                    background: 'var(--bg-elevated)',
                    color: myEngagement.grounded_expert_count >= myEngagement.declared_expert_count ? 'var(--color-success, #22c55e)' : 'var(--color-warning, #f59e0b)',
                    border: '2px solid var(--border)',
                  }}
                >
                  {Math.round((myEngagement.grounded_expert_count / myEngagement.declared_expert_count) * 100)}%
                </div>
              )}
            </div>
          </section>
        )}

        {/* Display Preferences -- page sizes per category */}
        <DisplayPrefsSection />

        {/* Account security */}
        <section>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-2)' }}>Security</h2>
          <Link
            to="/change-password"
            className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg border transition-colors"
            style={{
              color: 'var(--text-1)',
              borderColor: 'var(--border)',
              textDecoration: 'none',
            }}
          >
            Change password
          </Link>
        </section>

      </div>
    </div>
  );
}
