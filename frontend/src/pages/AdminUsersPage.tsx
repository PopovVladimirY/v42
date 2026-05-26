import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '@/api/endpoints/users';
import type { User, UserRole } from '@/types/index';

const ROLES: UserRole[] = ['admin', 'maintainer', 'developer', 'tester', 'observer'];

const ROLE_COLOR: Record<UserRole, string> = {
  admin: 'var(--error)',
  maintainer: 'var(--warning)',
  developer: 'var(--accent)',
  tester: 'var(--info)',
  observer: 'var(--text-3)',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en', { month: 'short', year: 'numeric' });
}

function initials(u: User) {
  const name = u.display_name || u.email;
  return name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

type SortKey = 'name' | 'email' | 'role' | 'status' | 'created_at';
type SortDir = 'asc' | 'desc';

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10" fill="none"
      style={{ display: 'inline', marginLeft: 3, opacity: active ? 1 : 0.3 }}
    >
      {dir === 'asc' || !active
        ? <path d="M5 2L9 8H1L5 2Z" fill="currentColor" />
        : <path d="M5 8L1 2H9L5 8Z" fill="currentColor" />}
    </svg>
  );
}

// ------------------------------------------------------------------
// Create user inline form
// ------------------------------------------------------------------
interface CreateFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

function CreateUserForm({ onSuccess, onCancel }: CreateFormProps) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('developer');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      usersApi.create({ email, password, display_name: displayName, role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      onSuccess();
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? 'Failed to create user';
      setError(msg);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  const fieldStyle = {
    background: 'var(--bg-base)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text-1)',
    padding: '6px 10px',
    fontSize: 13,
    width: '100%',
    outline: 'none',
  } satisfies React.CSSProperties;

  const labelStyle = { fontSize: 11, color: 'var(--text-3)', marginBottom: 3, display: 'block' } satisfies React.CSSProperties;

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-1)' }}>
        New user
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <label style={labelStyle}>Email *</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={fieldStyle}
            required
            autoFocus
          />
        </div>
        <div>
          <label style={labelStyle}>Display name *</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            style={fieldStyle}
            required
            maxLength={200}
          />
        </div>
        <div>
          <label style={labelStyle}>Password * (min 8 chars)</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={fieldStyle}
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>
        <div>
          <label style={labelStyle}>Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            style={fieldStyle}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="text-xs mt-2" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}

      <div className="flex gap-2 mt-4">
        <button
          type="submit"
          disabled={mutation.isPending}
          style={{
            background: 'var(--accent)',
            color: 'var(--accent-fg)',
            border: 'none',
            borderRadius: 6,
            padding: '6px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: mutation.isPending ? 'not-allowed' : 'pointer',
            opacity: mutation.isPending ? 0.7 : 1,
          }}
        >
          {mutation.isPending ? 'Creating...' : 'Create'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent',
            color: 'var(--text-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------
export function AdminUsersPage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);

  // Toolbar state
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    if (!resetTarget) return;
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') setResetTarget(null); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [resetTarget]);

  const { data: users = [], isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      usersApi.update(id, { is_active }),
    onMutate: ({ id }) => setTogglingId(id),
    onSettled: () => {
      setTogglingId(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const resetMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      usersApi.resetPassword(id, password),
    onSuccess: () => {
      setResetTarget(null);
      setResetPassword('');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? 'Failed to reset password';
      setResetError(msg);
    },
  });

  // Filter + sort
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = users.filter((u) => {
      if (q && !u.display_name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (statusFilter === 'active' && !u.is_active) return false;
      if (statusFilter === 'inactive' && u.is_active) return false;
      return true;
    });

    list = [...list].sort((a, b) => {
      let av = '', bv = '';
      if (sortKey === 'name') { av = a.display_name.toLowerCase(); bv = b.display_name.toLowerCase(); }
      else if (sortKey === 'email') { av = a.email.toLowerCase(); bv = b.email.toLowerCase(); }
      else if (sortKey === 'role') { av = a.role; bv = b.role; }
      else if (sortKey === 'status') { av = a.is_active ? '0' : '1'; bv = b.is_active ? '0' : '1'; }
      else if (sortKey === 'created_at') { av = a.created_at; bv = b.created_at; }
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    return list;
  }, [users, search, roleFilter, statusFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  const active = users.filter((u) => u.is_active).length;

  const thCls = 'text-xs font-medium text-left px-3 py-2 select-none cursor-pointer hover:opacity-80';
  const thStyle = { color: 'var(--text-3)', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' };
  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-base)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text-1)',
    padding: '5px 10px',
    fontSize: 12,
    outline: 'none',
  };

  return (
    <div className="p-6 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>Users</h1>
          {!isLoading && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {active} active / {users.length} total
            </p>
          )}
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--accent)', color: 'var(--accent-fg)',
              border: 'none', borderRadius: 6, padding: '7px 14px',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            New user
          </button>
        )}
      </div>

      {/* Inline create form */}
      {creating && (
        <CreateUserForm onSuccess={() => setCreating(false)} onCancel={() => setCreating(false)} />
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <input
          type="search"
          placeholder="Search name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, width: 220 }}
        />

        {/* Role filter */}
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as UserRole | 'all')}
          style={{ ...inputStyle, width: 130 }}
        >
          <option value="all">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>

        {/* Status filter */}
        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {(['all', 'active', 'inactive'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: '5px 12px', fontSize: 12, border: 'none', cursor: 'pointer',
                background: statusFilter === s ? 'var(--bg-active)' : 'var(--bg-base)',
                color: statusFilter === s ? 'var(--text-1)' : 'var(--text-3)',
                fontWeight: statusFilter === s ? 600 : 400,
              }}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Result count */}
        {(search || roleFilter !== 'all' || statusFilter !== 'all') && (
          <span className="text-xs ml-1" style={{ color: 'var(--text-3)' }}>
            {visible.length} of {users.length}
          </span>
        )}
      </div>

      {error && <p className="text-sm" style={{ color: 'var(--error)' }}>Failed to load users.</p>}
      {isLoading && <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading...</p>}

      {/* Table */}
      {!isLoading && !error && (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={thCls} style={{ ...thStyle, width: '2.5rem' }} />
                <th className={thCls} style={thStyle} onClick={() => toggleSort('name')}>
                  Name <SortIcon active={sortKey === 'name'} dir={sortDir} />
                </th>
                <th className={thCls} style={thStyle} onClick={() => toggleSort('email')}>
                  Email <SortIcon active={sortKey === 'email'} dir={sortDir} />
                </th>
                <th className={thCls} style={{ ...thStyle, width: '8rem' }} onClick={() => toggleSort('role')}>
                  Role <SortIcon active={sortKey === 'role'} dir={sortDir} />
                </th>
                <th className={thCls} style={{ ...thStyle, width: '6rem' }} onClick={() => toggleSort('status')}>
                  Status <SortIcon active={sortKey === 'status'} dir={sortDir} />
                </th>
                <th className={thCls} style={{ ...thStyle, width: '6rem' }} onClick={() => toggleSort('created_at')}>
                  Since <SortIcon active={sortKey === 'created_at'} dir={sortDir} />
                </th>
                <th className={thCls} style={{ ...thStyle, width: '13rem', cursor: 'default' }} />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--text-3)' }}>
                    No users match the filter.
                  </td>
                </tr>
              )}
              {visible.map((u, i) => (
                <tr
                  key={u.id}
                  className="group transition-colors"
                  style={{
                    background: i % 2 === 0 ? 'var(--bg-base)' : 'var(--bg-elevated)',
                    opacity: u.is_active ? 1 : 0.55,
                  }}
                >
                  {/* Avatar */}
                  <td className="px-3 py-2 align-middle">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                    >
                      {initials(u)}
                    </div>
                  </td>

                  {/* Name */}
                  <td className="px-3 py-2 align-middle">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{u.display_name}</span>
                  </td>

                  {/* Email */}
                  <td className="px-3 py-2 align-middle" style={{ maxWidth: 0 }}>
                    <span className="block truncate text-xs" style={{ color: 'var(--text-3)' }} title={u.email}>{u.email}</span>
                  </td>

                  {/* Role */}
                  <td className="px-3 py-2 align-middle">
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded"
                      style={{
                        background: 'var(--bg-elevated)',
                        color: ROLE_COLOR[u.role as UserRole] ?? 'var(--text-2)',
                        border: `1px solid ${ROLE_COLOR[u.role as UserRole] ?? 'var(--border)'}`,
                      }}
                    >
                      {u.role}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="px-3 py-2 align-middle">
                    <span className="text-xs" style={{ color: u.is_active ? 'var(--success)' : 'var(--text-3)' }}>
                      {u.is_active ? 'active' : 'inactive'}
                    </span>
                  </td>

                  {/* Since */}
                  <td className="px-3 py-2 align-middle">
                    <span className="text-xs" style={{ color: 'var(--text-3)' }}>{fmtDate(u.created_at)}</span>
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-2 align-middle">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => toggleActive.mutate({ id: u.id, is_active: !u.is_active })}
                        disabled={togglingId === u.id}
                        title={u.is_active ? 'Deactivate' : 'Activate'}
                        style={{
                          background: 'transparent', border: '1px solid var(--border)',
                          borderRadius: 5, color: 'var(--text-2)',
                          padding: '2px 7px', fontSize: 11,
                          cursor: togglingId === u.id ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => { setResetTarget(u); setResetPassword(''); setResetError(null); }}
                        title="Reset password"
                        style={{
                          background: 'transparent', border: '1px solid var(--border)',
                          borderRadius: 5, color: 'var(--text-2)',
                          padding: '2px 7px', fontSize: 11, cursor: 'pointer',
                        }}
                      >
                        Reset pwd
                      </button>
                      <Link
                        to={`/admin/users/${u.id}`}
                        style={{
                          background: 'transparent', border: '1px solid var(--border)',
                          borderRadius: 5, color: 'var(--accent)',
                          padding: '2px 7px', fontSize: 11, textDecoration: 'none',
                        }}
                      >
                        Profile
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Reset password modal */}
      {resetTarget && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setResetTarget(null); }}
        >
          <div
            className="rounded-xl p-6 w-full max-w-sm shadow-xl"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
          >
            <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--text-1)' }}>
              Reset password
            </h2>
            <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
              {resetTarget.display_name} ({resetTarget.email}) will be required to change password on next login.
            </p>
            <input
              type="password"
              placeholder="New password (min 8 chars)"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              autoComplete="new-password"
              style={{
                width: '100%', background: 'var(--bg-base)',
                border: '1px solid var(--border)', borderRadius: 6,
                color: 'var(--text-1)', padding: '7px 10px',
                fontSize: 13, outline: 'none', marginBottom: 8,
              }}
            />
            {resetError && (
              <p className="text-xs mb-2" style={{ color: 'var(--error)' }}>{resetError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (resetPassword.length < 8) { setResetError('Password must be at least 8 characters'); return; }
                  setResetError(null);
                  resetMutation.mutate({ id: resetTarget.id, password: resetPassword });
                }}
                disabled={resetMutation.isPending}
                style={{
                  flex: 1, background: 'var(--accent)', color: 'var(--accent-fg)',
                  border: 'none', borderRadius: 6, padding: '7px 0',
                  fontSize: 13, fontWeight: 600,
                  cursor: resetMutation.isPending ? 'not-allowed' : 'pointer',
                  opacity: resetMutation.isPending ? 0.7 : 1,
                }}
              >
                {resetMutation.isPending ? 'Resetting...' : 'Reset'}
              </button>
              <button
                onClick={() => setResetTarget(null)}
                style={{
                  background: 'transparent', color: 'var(--text-2)',
                  border: '1px solid var(--border)', borderRadius: 6,
                  padding: '7px 16px', fontSize: 13, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
