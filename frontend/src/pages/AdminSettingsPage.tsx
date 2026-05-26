import { Link } from 'react-router-dom';

// Each card represents one admin section. soon=true = placeholder, not clickable.
const SETTINGS_SECTIONS = [
  {
    to: '/admin/users',
    label: 'Users',
    description: 'Manage accounts, roles, and access. Reset passwords, promote to admin.',
    soon: false,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 20c0-4 3.582-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M18.5 10v4M16.5 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/admin/skills',
    label: 'Skills',
    description: 'Skill catalog: add, rename, hide or remove skills. Used across team profiles and workload planning.',
    soon: false,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M12 3l2.25 6.75H21l-5.625 4.05 2.1 6.45L12 16.5l-5.475 3.75 2.1-6.45L3 9.75h6.75L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/admin/teams',
    label: 'Teams & Projects',
    description: 'Create teams, assign members, configure sprint cadence. Set up projects and link them to teams.',
    soon: true,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <circle cx="7" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="17" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M1 20c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M13 18.5c.9-1.4 2.5-2.5 4-2.5 3.314 0 6 2.686 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/admin/table-defaults',
    label: 'Table Defaults',
    description: 'Set default column order, visibility and width for all tables. Applied system-wide; users can override per-session.',
    soon: true,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="5" width="18" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <rect x="3" y="10" width="11" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <rect x="3" y="15" width="7" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <path d="M18 13l2 2-2 2M16 15h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/admin/archive',
    label: 'Archive',
    description: 'Browse archived teams and projects. Restore them to active state or keep in archive.',
    soon: false,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="4" width="20" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 8v11a1 1 0 001 1h14a1 1 0 001-1V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M9 13h6M12 10v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/admin/agent-tokens',
    label: 'Agent Tokens',
    description: 'Create and revoke long-lived tokens for MCP servers, AI agents, and automation scripts. No expiry -- revocable any time.',
    soon: false,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <circle cx="8" cy="15" r="4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M11.83 11.17L19 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M17 6l1 1M19 4l1 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="15" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
];

export function AdminSettingsPage() {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div style={{ maxWidth: 820 }}>
        {/* Header */}
        <div className="mb-8">
          <h1
            className="text-xl font-semibold mb-1"
            style={{ color: 'var(--text-1)' }}
          >
            System Settings
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>
            Admin-only. Changes here affect the entire platform.
          </p>
        </div>

        {/* Cards grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: '16px',
          }}
        >
          {SETTINGS_SECTIONS.map((s) =>
            s.soon ? (
              <div
                key={s.label}
                className="rounded-lg p-5 flex gap-4"
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  opacity: 0.55,
                  cursor: 'default',
                }}
              >
                <div style={{ color: 'var(--text-3)', flexShrink: 0, paddingTop: 2 }}>
                  {s.icon}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-sm font-semibold"
                      style={{ color: 'var(--text-2)' }}
                    >
                      {s.label}
                    </span>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{
                        background: 'var(--bg-elevated)',
                        color: 'var(--text-3)',
                        fontSize: '10px',
                      }}
                    >
                      soon
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
                    {s.description}
                  </p>
                </div>
              </div>
            ) : (
              <Link
                key={s.label}
                to={s.to}
                className="rounded-lg p-5 flex gap-4 transition-colors group"
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  textDecoration: 'none',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.background =
                    'var(--bg-elevated)';
                  (e.currentTarget as HTMLAnchorElement).style.borderColor =
                    'var(--accent)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.background =
                    'var(--bg-surface)';
                  (e.currentTarget as HTMLAnchorElement).style.borderColor =
                    'var(--border)';
                }}
              >
                <div
                  style={{ color: 'var(--accent)', flexShrink: 0, paddingTop: 2 }}
                >
                  {s.icon}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-sm font-semibold"
                      style={{ color: 'var(--text-1)' }}
                    >
                      {s.label}
                    </span>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      style={{ color: 'var(--text-3)' }}
                    >
                      <path
                        d="M4.5 3l3 3-3 3"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
                    {s.description}
                  </p>
                </div>
              </Link>
            )
          )}
        </div>
      </div>
    </div>
  );
}
