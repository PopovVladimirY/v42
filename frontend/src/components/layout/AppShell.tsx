import { NavLink, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';

// Nav item structure. Icons are inline SVG to avoid extra deps.
const NAV_ITEMS = [
  {
    to: '/teams',
    label: 'Teams',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="11" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M1 13c0-2.21 1.79-4 4-4s4 1.79 4 4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M9 11.5c.6-.95 1.7-1.5 2.5-1.5 2.21 0 4 1.79 4 4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    to: '/projects',
    label: 'Projects',
    soon: true,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <rect x="9.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <rect x="1.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <rect x="9.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    to: '/sprints',
    label: 'Sprints',
    soon: true,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M2 8a6 6 0 1 1 12 0 6 6 0 0 1-12 0Z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M8 5v3l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function AppShell() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  // initials for avatar
  const initials = user?.full_name
    ? user.full_name
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase()
    : (user?.email?.[0] ?? '?').toUpperCase();

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      {/* Sidebar */}
      <aside
        className="flex flex-col w-52 flex-shrink-0 h-full"
        style={{
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
        }}
      >
        {/* Logo */}
        <div
          className="px-4 py-4 flex items-center gap-2 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span
            className="text-base font-bold tracking-tight"
            style={{ color: 'var(--text-1)' }}
          >
            V.42
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2 px-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              aria-disabled={item.soon}
              onClick={item.soon ? (e) => e.preventDefault() : undefined}
              className={({ isActive }) =>
                [
                  'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium mb-0.5 transition-colors',
                  item.soon
                    ? 'cursor-not-allowed'
                    : isActive
                    ? ''
                    : 'hover:bg-[var(--bg-hover)]',
                ].join(' ')
              }
              style={({ isActive }) => ({
                background: item.soon
                  ? 'transparent'
                  : isActive
                  ? 'var(--bg-active)'
                  : undefined,
                color: item.soon
                  ? 'var(--text-3)'
                  : isActive
                  ? 'var(--text-1)'
                  : 'var(--text-2)',
              })}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.soon && (
                <span
                  className="ml-auto text-xs px-1.5 py-0.5 rounded"
                  style={{
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-3)',
                    fontSize: '10px',
                  }}
                >
                  soon
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User section */}
        <div
          className="p-3 flex-shrink-0"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2.5">
            {/* Avatar */}
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="text-sm font-medium truncate"
                style={{ color: 'var(--text-1)' }}
                title={user?.full_name ?? user?.email}
              >
                {user?.full_name ?? user?.email}
              </div>
              <div
                className="text-xs truncate"
                style={{ color: 'var(--text-3)' }}
                title={user?.email}
              >
                {user?.email}
              </div>
            </div>
            <button
              onClick={() => void handleLogout()}
              title="Sign out"
              className="flex-shrink-0 p-1 rounded transition-colors hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-3)' }}
            >
              {/* Sign out icon */}
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <path
                  d="M11 11l3-3-3-3M14 8H6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
