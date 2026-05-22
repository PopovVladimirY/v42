import { useState } from 'react';
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
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
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
// User row
// ------------------------------------------------------------------
interface UserRowProps {
  user: User;
  onToggleActive: (u: User) => void;
  isToggling: boolean;
  onResetPassword: (u: User) => void;
}

function UserRow({ user, onToggleActive, isToggling, onResetPassword }: UserRowProps) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-lg transition-colors"
      style={{
        background: user.is_active ? 'var(--bg-surface)' : 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        opacity: user.is_active ? 1 : 0.6,
      }}
    >
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
        style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
      >
        {initials(user)}
      </div>

      {/* Name + email */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" style={{ color: 'var(--text-1)' }}>
          {user.display_name}
        </div>
        <div className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
          {user.email}
        </div>
      </div>

      {/* Role badge */}
      <span
        className="text-xs font-medium px-2 py-0.5 rounded flex-shrink-0"
        style={{
          background: 'var(--bg-elevated)',
          color: ROLE_COLOR[user.role as UserRole] ?? 'var(--text-2)',
          border: `1px solid ${ROLE_COLOR[user.role as UserRole] ?? 'var(--border)'}`,
        }}
      >
        {user.role}
      </span>

      {/* Active status */}
      <span
        className="text-xs flex-shrink-0"
        style={{ color: user.is_active ? 'var(--success)' : 'var(--text-3)' }}
      >
        {user.is_active ? 'active' : 'inactive'}
      </span>

      {/* Since */}
      <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-3)' }}>
        {fmtDate(user.created_at)}
      </span>

      {/* Toggle active */}
      <button
        onClick={() => onToggleActive(user)}
        disabled={isToggling}
        title={user.is_active ? 'Deactivate' : 'Activate'}
        style={{
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 5,
          color: 'var(--text-2)',
          padding: '3px 8px',
          fontSize: 11,
          cursor: isToggling ? 'not-allowed' : 'pointer',
          flexShrink: 0,
        }}
      >
        {user.is_active ? 'Deactivate' : 'Activate'}
      </button>

      {/* Reset password */}
      <button
        onClick={() => onResetPassword(user)}
        title="Reset password"
        style={{
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 5,
          color: 'var(--text-2)',
          padding: '3px 8px',
          fontSize: 11,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        Reset pwd
      </button>
    </div>
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

  const active = users.filter((u) => u.is_active).length;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>
            Users
          </h1>
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
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--accent)',
              color: 'var(--accent-fg)',
              border: 'none',
              borderRadius: 6,
              padding: '7px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
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
        <CreateUserForm
          onSuccess={() => setCreating(false)}
          onCancel={() => setCreating(false)}
        />
      )}

      {/* Error */}
      {error && (
        <p className="text-sm" style={{ color: 'var(--error)' }}>
          Failed to load users.
        </p>
      )}

      {/* Loading */}
      {isLoading && (
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          Loading...
        </p>
      )}

      {/* List */}
      {!isLoading && !error && (
        <div className="flex flex-col gap-2">
          {users.length === 0 && (
            <p className="text-sm py-10 text-center" style={{ color: 'var(--text-3)' }}>
              No users found.
            </p>
          )}
          {users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              isToggling={togglingId === u.id}
              onToggleActive={(user) =>
                toggleActive.mutate({ id: user.id, is_active: !user.is_active })
              }
              onResetPassword={(user) => {
                setResetTarget(user);
                setResetPassword('');
                setResetError(null);
              }}
            />
          ))}
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
                width: '100%',
                background: 'var(--bg-base)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text-1)',
                padding: '7px 10px',
                fontSize: 13,
                outline: 'none',
                marginBottom: 8,
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
                  flex: 1,
                  background: 'var(--accent)',
                  color: 'var(--accent-fg)',
                  border: 'none',
                  borderRadius: 6,
                  padding: '7px 0',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: resetMutation.isPending ? 'not-allowed' : 'pointer',
                  opacity: resetMutation.isPending ? 0.7 : 1,
                }}
              >
                {resetMutation.isPending ? 'Resetting...' : 'Reset'}
              </button>
              <button
                onClick={() => setResetTarget(null)}
                style={{
                  background: 'transparent',
                  color: 'var(--text-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '7px 16px',
                  fontSize: 13,
                  cursor: 'pointer',
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
