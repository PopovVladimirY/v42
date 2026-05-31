import type React from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { useRef, useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useIdleTimeout } from '@/hooks/useIdleTimeout';
import { useIdleDetect } from '@/hooks/useIdleDetect';
import { useEventStream } from '@/hooks/useEventStream';
import { useRecentProjects } from '@/hooks/useLastProject';
import { SidebarAmbient } from '@/components/SidebarAmbient';
import { useThemeStore } from '@/stores/useTheme';

// Nav item structure. Icons are inline SVG to avoid extra deps.
const NAV_ITEMS: { to: string; label: string; icon: React.ReactNode; soon?: boolean }[] = [
  {
    to: '/sprints',
    label: 'My Sprints',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M2 3h12M2 8h8M2 13h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="13" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 11l.8.8 1.7-1.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
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
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M1 6h14" stroke="currentColor" strokeWidth="1.2" />
        <path d="M5 9.5h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M5 11.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function AppShell() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  useIdleTimeout();
  useEventStream(); // live cache invalidation via server-sent events
  const ambientDelayMs = useThemeStore((s) => s.ambientDelayMs);
  const sidebarPinned = useThemeStore((s) => s.sidebarPinned);
  const setSidebarPinned = useThemeStore((s) => s.setSidebarPinned);
  const isIdle = useIdleDetect(ambientDelayMs);

  // ── Sidebar collapse state ─────────────────────────────────────────────────
  // overlayOpen: sidebar is floating over content (not pinned, not collapsed)
  const [overlayOpen, setOverlayOpen] = useState(false);
  const isExpanded = sidebarPinned || overlayOpen;
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Close overlay when mouse leaves the sidebar panel
  function handleSidebarMouseLeave() {
    if (overlayOpen) setOverlayOpen(false);
  }

  function handleCollapseClick() {
    if (sidebarPinned) {
      // pinned → collapsed
      setSidebarPinned(false);
      setOverlayOpen(false);
    } else {
      // overlay → pinned
      setSidebarPinned(true);
      setOverlayOpen(false);
    }
  }

  // Reactive: updates sidebar immediately when user visits a project
  const recentProjects = useRecentProjects(user?.id);
  const { pathname } = useLocation();
  const inAdmin = pathname.startsWith('/admin');

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
    <div className="relative flex h-screen overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      {/* Narrow strip — 32px column visible when sidebar is not pinned */}
      {!sidebarPinned && (
        <div
          className="flex-shrink-0 flex flex-col items-center pt-3 h-full"
          style={{ width: 32, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)' }}
          onMouseEnter={() => setOverlayOpen(true)}
        >
          <button
            onClick={() => setOverlayOpen(true)}
            title="Expand sidebar"
            className="p-1 rounded hover:bg-[var(--bg-hover)] transition-colors"
            style={{ color: 'var(--text-3)' }}
          >
            {/* Chevron right */}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}

      {/* Sidebar panel — in-flow when pinned, absolute overlay when opened from strip */}
      {isExpanded && (
        <aside
          ref={sidebarRef}
          onMouseLeave={handleSidebarMouseLeave}
          className="flex flex-col flex-shrink-0 h-full"
          style={{
            width: 208,
            position: overlayOpen ? 'absolute' : 'relative',
            left: overlayOpen ? 32 : 'auto',
            top: 0,
            bottom: 0,
            zIndex: overlayOpen ? 50 : undefined,
            boxShadow: overlayOpen ? '4px 0 20px rgba(0,0,0,0.18)' : 'none',
            background: 'var(--bg-surface)',
            borderRight: '1px solid var(--border)',
          }}
        >
        {/* Ambient idle animation -- fades in after 30 s of inactivity */}
        <SidebarAmbient isIdle={isIdle} />
        {/* Logo + collapse / pin button */}
        <div
          className="px-4 py-3 flex items-center gap-2 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span
            className="text-base font-bold tracking-tight flex-1"
            style={{ color: 'var(--text-1)' }}
          >
            V.42
          </span>
          <button
            onClick={handleCollapseClick}
            title={overlayOpen ? 'Pin sidebar' : 'Collapse sidebar'}
            className="p-1 rounded hover:bg-[var(--bg-hover)] transition-colors"
            style={{ color: 'var(--text-3)' }}
          >
            {overlayOpen ? (
              // Thumbtack: click to lock sidebar in place
              <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M6 7v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            ) : (
              // Chevron left: click to collapse
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
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

          {/* Admin section: settings hub + sub-links */}
          {user?.role === 'admin' && (
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
              <p
                className="px-3 mb-1 text-xs font-semibold uppercase tracking-widest"
                style={{ color: 'var(--text-3)' }}
              >
                Admin
              </p>
              {/* Hub: highlights for any /admin/* path */}
              <Link
                to="/admin/settings"
                className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium mb-0.5 transition-colors hover:bg-[var(--bg-hover)]"
                style={{
                  background: inAdmin ? 'var(--bg-active)' : undefined,
                  color: inAdmin ? 'var(--text-1)' : 'var(--text-2)',
                  textDecoration: 'none',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M8 10a2 2 0 100-4 2 2 0 000 4Z"
                    stroke="currentColor"
                    strokeWidth="1.3"
                  />
                  <path
                    d="M13.2 6.6l-.9-.5a5 5 0 000-.2l.9-.5a.5.5 0 00.2-.7l-.8-1.4a.5.5 0 00-.7-.2l-.9.5a5 5 0 00-.2-.1V2.5a.5.5 0 00-.5-.5h-1.6a.5.5 0 00-.5.5v1l-.2.1-.9-.5a.5.5 0 00-.7.2L5.4 4.7a.5.5 0 00.2.7l.9.5v.2l-.9.5a.5.5 0 00-.2.7l.8 1.4a.5.5 0 00.7.2l.9-.5.2.1v1a.5.5 0 00.5.5h1.6a.5.5 0 00.5-.5v-1l.2-.1.9.5a.5.5 0 00.7-.2l.8-1.4a.5.5 0 00-.2-.7Z"
                    stroke="currentColor"
                    strokeWidth="1.1"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Settings</span>
              </Link>
              {/* Sub-links: indented, active on exact match */}
              {[
                {
                  to: '/admin/users',
                  label: 'Users',
                },
                {
                  to: '/admin/skills',
                  label: 'Skills',
                },
                {
                  to: '/admin/projects',
                  label: 'Projects',
                },
              ].map((sub) => (
                <NavLink
                  key={sub.to}
                  to={sub.to}
                  className={({ isActive }) =>
                    [
                      'flex items-center gap-2 pl-8 pr-3 py-1.5 rounded-md text-xs font-medium mb-0.5 transition-colors',
                      isActive ? '' : 'hover:bg-[var(--bg-hover)]',
                    ].join(' ')
                  }
                  style={({ isActive }) => ({
                    background: isActive ? 'var(--bg-elevated)' : undefined,
                    color: isActive ? 'var(--text-1)' : 'var(--text-3)',
                  })}
                >
                  <span
                    style={{
                      width: 4,
                      height: 4,
                      borderRadius: '50%',
                      background: 'currentColor',
                      flexShrink: 0,
                    }}
                  />
                  {sub.label}
                </NavLink>
              ))}
            </div>
          )}

          {/* Recent projects quick links */}
          {recentProjects.length > 0 && (
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between px-3 mb-1">
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
                  Recent
                </p>
              </div>
              {recentProjects.map((p) => (
                <div key={p.id} className="flex items-center gap-1 px-2 py-0.5 rounded-md group hover:bg-[var(--bg-hover)] transition-colors">
                  {/* Project name -- links to overview */}
                  <Link
                    to={`/projects/${p.id}`}
                    className="flex-1 min-w-0 text-xs truncate py-1"
                    style={{ color: 'var(--text-2)' }}
                    title={p.name}
                  >
                    {p.name}
                  </Link>
                  {/* Quick icon links */}
                  <Link
                    to={`/projects/${p.id}/backlog`}
                    title="Backlog"
                    className="flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--bg-elevated)]"
                    style={{ color: 'var(--text-3)' }}
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <rect x="1" y="1" width="10" height="2" rx="1" stroke="currentColor" strokeWidth="1.2" />
                      <rect x="1" y="5" width="7" height="2" rx="1" stroke="currentColor" strokeWidth="1.2" />
                      <rect x="1" y="9" width="5" height="2" rx="1" stroke="currentColor" strokeWidth="1.2" />
                    </svg>
                  </Link>
                  <Link
                    to={`/projects/${p.id}/sprints`}
                    title="Sprints"
                    className="flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--bg-elevated)]"
                    style={{ color: 'var(--text-3)' }}
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M2 10 C2 6 4 2 10 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      <path d="M8 1l2 1-1 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </nav>

        {/* User section */}
        <div
          className="p-3 flex-shrink-0"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2.5">
            {/* Avatar + name: click → /profile */}
            <Link
              to="/profile"
              className="flex items-center gap-2.5 flex-1 min-w-0 rounded-md px-1 py-1 transition-colors hover:bg-[var(--bg-hover)]"
            >
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
                  title={user?.full_name ?? user?.display_name ?? user?.email}
                >
                  {user?.full_name ?? user?.display_name ?? user?.email}
                </div>
                <div
                  className="text-xs truncate"
                  style={{ color: 'var(--text-3)' }}
                  title={user?.email}
                >
                  {user?.email}
                </div>
              </div>
            </Link>
            {/* Sign out */}
            <button
              onClick={() => void handleLogout()}
              title="Sign out"
              className="flex-shrink-0 p-1 rounded transition-colors hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-3)' }}
            >
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
      )}

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
