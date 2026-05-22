import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/hooks/useAuth';
import { useThemeStore, THEMES } from '@/stores/useTheme';
import type { Theme } from '@/stores/useTheme';
import { authApi } from '@/api/endpoints/auth';
import { usersApi } from '@/api/endpoints/users';
import { teamsApi } from '@/api/endpoints/teams';
import type { MemberSkill, SkillLevel, InterestLevel } from '@/types/index';

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

const LEVEL_COLOR: Record<SkillLevel, string> = {
  beginner: 'var(--color-info)',
  practitioner: 'var(--color-warning)',
  expert: 'var(--color-success)',
};

const INTEREST_ICON: Record<InterestLevel, string> = {
  low: '~',
  medium: '+',
  high: '++',
};

// ------------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------------

function SkillRow({ s }: { s: MemberSkill }) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-1)' }}>
          {s.skill_name}
        </p>
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          {s.category}
        </p>
      </div>

      {/* Interest badge */}
      <span
        className="text-xs font-mono px-1.5 py-0.5 rounded flex-shrink-0"
        style={{
          background: 'var(--bg-elevated)',
          color: 'var(--text-3)',
          letterSpacing: '0.05em',
        }}
        title={`Interest: ${s.interest}`}
      >
        {INTEREST_ICON[s.interest]}
      </span>

      {/* Level badge */}
      <span
        className="text-xs font-medium capitalize px-2 py-0.5 rounded-full flex-shrink-0"
        style={{
          background: LEVEL_COLOR[s.level] + '1a',
          color: LEVEL_COLOR[s.level],
          border: `1px solid ${LEVEL_COLOR[s.level]}40`,
        }}
      >
        {s.level}
      </span>
    </div>
  );
}

function ThemeButton({ t, active, onChange }: { t: Theme; active: boolean; onChange: (t: Theme) => void }) {
  // Theme preview swatch -- a tiny dot in the accent color for the theme
  const ACCENT_MAP: Record<string, string> = {
    'deep-dive': '#5b7cf6',
    'night-sky': '#7b6ef6',
    'classic-dark': '#6b7280',
    'ocean-blue': '#3b82f6',
    'paper-white': '#d97706',
    'sunrise': '#f59e0b',
    'high-contrast': '#ffffff',
  };

  return (
    <button
      onClick={() => onChange(t)}
      className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition-colors w-full"
      style={{
        background: active ? 'var(--bg-active)' : 'var(--bg-surface)',
        border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
        color: active ? 'var(--text-1)' : 'var(--text-2)',
      }}
    >
      <span
        className="w-3 h-3 rounded-full flex-shrink-0"
        style={{ background: ACCENT_MAP[t] ?? '#888' }}
      />
      <span className="text-sm capitalize truncate">{t.replace(/-/g, ' ')}</span>
      {active && (
        <svg
          className="ml-auto flex-shrink-0"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M2 6l3 3 5-5"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

// ------------------------------------------------------------------
// ProfilePage
// ------------------------------------------------------------------

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const { theme: activeTheme, setTheme } = useThemeStore();

  const userId = user?.id ?? '';

  const { data: skills, isLoading: skillsLoading } = useQuery({
    queryKey: ['user-skills', userId],
    queryFn: () => usersApi.getSkills(userId),
    enabled: !!userId,
  });

  const { data: teams, isLoading: teamsLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: teamsApi.list,
    enabled: !!userId,
  });

  async function handleThemeChange(t: Theme) {
    setTheme(t);
    try {
      await authApi.patchMe({ theme: t });
    } catch {
      // Non-critical
    }
  }

  const label = user?.full_name ?? user?.display_name ?? user?.email ?? '?';
  const userInitials = initials(label);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto px-6 py-8">

        {/* Header: avatar + name */}
        <div className="flex items-center gap-5 mb-8">
          {user?.avatar_url ? (
            <img
              src={user.avatar_url}
              alt={label}
              className="w-16 h-16 rounded-full object-cover flex-shrink-0"
            />
          ) : (
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              {userInitials}
            </div>
          )}
          <div className="min-w-0">
            <h1
              className="text-xl font-semibold truncate"
              style={{ color: 'var(--text-1)' }}
            >
              {label}
            </h1>
            <p
              className="text-sm truncate mt-0.5"
              style={{ color: 'var(--text-2)' }}
            >
              {user?.email}
            </p>
            <div className="flex items-center gap-3 mt-2">
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium capitalize"
                style={{
                  background: 'var(--accent)',
                  color: 'var(--accent-fg)',
                  opacity: 0.9,
                }}
              >
                {ROLE_LABEL[user?.role ?? ''] ?? user?.role}
              </span>
              {user?.created_at && (
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                  Since {fmtDate(user.created_at)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Theme section */}
        <section className="mb-8">
          <h2
            className="text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ color: 'var(--text-3)' }}
          >
            Appearance
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {THEMES.map((t) => (
              <ThemeButton
                key={t}
                t={t}
                active={activeTheme === t}
                onChange={(t) => void handleThemeChange(t)}
              />
            ))}
          </div>
        </section>

        {/* Skills section */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: 'var(--text-3)' }}
            >
              Skills
            </h2>
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              level &nbsp;·&nbsp; interest&nbsp;
              <span className="font-mono">~ + ++</span>
            </span>
          </div>

          {skillsLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }, (_, i) => (
                <div
                  key={i}
                  className="h-12 rounded-lg animate-pulse"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
                />
              ))}
            </div>
          ) : !skills || skills.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-3)' }}>
              No skills added yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {skills.map((s) => (
                <SkillRow key={s.skill_id} s={s} />
              ))}
            </div>
          )}
        </section>

        {/* Teams section */}
        <section>
          <h2
            className="text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ color: 'var(--text-3)' }}
          >
            Teams
          </h2>

          {teamsLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 2 }, (_, i) => (
                <div
                  key={i}
                  className="h-10 rounded-lg animate-pulse"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
                />
              ))}
            </div>
          ) : !teams || teams.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-3)' }}>
              Not a member of any team yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {teams.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div
                    className="w-7 h-7 rounded flex items-center justify-center text-xs font-semibold flex-shrink-0"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--accent)' }}
                  >
                    {t.name[0].toUpperCase()}
                  </div>
                  <span className="text-sm flex-1 truncate" style={{ color: 'var(--text-1)' }}>
                    {t.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
