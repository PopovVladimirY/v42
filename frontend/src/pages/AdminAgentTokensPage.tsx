import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentTokensApi } from '@/api/endpoints/agentTokens';
import { usersApi } from '@/api/endpoints/users';
import type { AgentToken, AgentTokenWithRaw } from '@/types';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtRelative(iso: string | null) {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ---------------------------------------------------------------------------
//  Raw token display -- shown ONCE after creation
// ---------------------------------------------------------------------------

function RawTokenModal({ token, onClose }: { token: AgentTokenWithRaw; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(token.raw_token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
    >
      <div
        className="rounded-2xl flex flex-col gap-5 p-6"
        style={{ width: 520, background: 'var(--bg-active)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(239,68,68,.15)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 9v4M12 17h.01" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-base" style={{ color: 'var(--text-1)' }}>
              Save this token now
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
              This is the only time the raw token will be shown. It cannot be recovered later.
              Store it securely -- treat it like a password.
            </p>
          </div>
        </div>

        <div
          className="rounded-lg px-4 py-3 font-mono text-xs break-all select-all"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        >
          {token.raw_token}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleCopy}
            className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: copied ? 'rgba(16,185,129,.15)' : 'var(--accent)',
              color: copied ? 'var(--color-success)' : '#fff',
            }}
          >
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
          >
            I saved it, close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Create token modal
// ---------------------------------------------------------------------------

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (t: AgentTokenWithRaw) => void }) {
  const [name, setName] = useState('');
  const [userId, setUserId] = useState('');
  const [err, setErr] = useState('');

  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });
  const activeUsers = users.filter((u) => u.is_active && (u.role === 'developer' || u.role === 'tester'));

  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => agentTokensApi.create({ user_id: userId, name: name.trim() }),
    onSuccess: (token) => {
      void qc.invalidateQueries({ queryKey: ['agent-tokens'] });
      onCreated(token);
    },
    onError: () => setErr('Failed to create token. Check that the user exists.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!name.trim()) { setErr('Name is required'); return; }
    if (!userId) { setErr('Select the user this token will act as'); return; }
    create.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-2xl flex flex-col gap-5 p-6"
        style={{ width: 440, background: 'var(--bg-active)', border: '1px solid var(--border)' }}
      >
        <h2 className="font-semibold text-base" style={{ color: 'var(--text-1)' }}>
          Create Agent Token
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              Token name
            </label>
            <input
              className="px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
              placeholder='e.g. "Claude on dev machine"'
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              Acts as user
            </label>
            <select
              className="px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: userId ? 'var(--text-1)' : 'var(--text-3)' }}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">Select user...</option>
              {activeUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name || u.email} ({u.role})
                </option>
              ))}
            </select>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              API calls made with this token will appear as this user. Choose a dedicated agent user or yourself.
            </p>
          </div>
          {err && (
            <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{err}</p>
          )}
          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={create.isPending}
              className="flex-1 py-2 rounded-lg text-sm font-medium"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)', opacity: create.isPending ? 0.6 : 1 }}
            >
              {create.isPending ? 'Creating...' : 'Create token'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg text-sm font-medium"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Token row
// ---------------------------------------------------------------------------

function TokenRow({ token, users }: { token: AgentToken; users: { id: string; display_name: string; email: string }[] }) {
  const qc = useQueryClient();
  const revoke = useMutation({
    mutationFn: () => agentTokensApi.revoke(token.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['agent-tokens'] }),
  });

  const isRevoked = Boolean(token.revoked_at);
  const actingUser = users.find((u) => u.id === token.user_id);
  const createdByUser = users.find((u) => u.id === token.created_by);

  function handleRevoke() {
    if (!confirm(`Revoke token "${token.name}"? This cannot be undone.`)) return;
    revoke.mutate();
  }

  return (
    <tr style={{ opacity: isRevoked ? 0.45 : 1 }}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: isRevoked ? 'var(--text-3)' : 'var(--color-success)' }}
          />
          <span className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
            {token.name}
          </span>
          {isRevoked && (
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-3)' }}>
              revoked
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-2)' }}>
        {actingUser ? (actingUser.display_name || actingUser.email) : token.user_id.slice(0, 8) + '...'}
      </td>
      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-3)' }}>
        {token.project_id ? token.project_id.slice(0, 8) + '...' : 'All projects'}
      </td>
      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-3)' }}>
        {fmtRelative(token.last_used_at)}
      </td>
      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-3)' }}>
        {fmtDate(token.created_at)}
      </td>
      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-3)' }}>
        {createdByUser ? (createdByUser.display_name || createdByUser.email) : '—'}
      </td>
      <td className="px-4 py-3">
        {!isRevoked && (
          <button
            onClick={handleRevoke}
            disabled={revoke.isPending}
            className="text-xs px-2 py-1 rounded"
            style={{ color: 'var(--color-danger)', border: '1px solid var(--border)' }}
          >
            {revoke.isPending ? '...' : 'Revoke'}
          </button>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
//  Main page
// ---------------------------------------------------------------------------

export function AdminAgentTokensPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [newToken, setNewToken] = useState<AgentTokenWithRaw | null>(null);

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ['agent-tokens'],
    queryFn: agentTokensApi.list,
  });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });

  const active = tokens.filter((t) => !t.revoked_at);
  const revoked = tokens.filter((t) => t.revoked_at);
  const displayTokens = [...active, ...revoked];

  function handleCreated(token: AgentTokenWithRaw) {
    setShowCreate(false);
    setNewToken(token);
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div style={{ maxWidth: 920 }}>
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--text-1)' }}>
              Agent Tokens
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>
              Long-lived opaque tokens for MCP servers, automation, and AI agents.
              Never expire unless revoked. Revocation is immediate.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            + New token
          </button>
        </div>

        {/* Stats */}
        <div className="flex gap-4 mb-6">
          {[
            { label: 'Active', value: active.length, color: 'var(--color-success)' },
            { label: 'Revoked', value: revoked.length, color: 'var(--text-3)' },
          ].map((s) => (
            <div
              key={s.label}
              className="px-4 py-3 rounded-lg"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
            >
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>{s.label}</p>
              <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          {isLoading ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-3)' }}>Loading...</p>
          ) : displayTokens.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>No agent tokens yet.</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                Create one to allow MCP servers or automation scripts to authenticate without a user session.
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Name', 'Acts As', 'Scope', 'Last Used', 'Created', 'By', ''].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--text-3)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody style={{ borderTop: '1px solid var(--border)' }}>
                {displayTokens.map((t, i) => (
                  <tr
                    key={t.id}
                    style={i > 0 ? { borderTop: '1px solid var(--border)' } : {}}
                  >
                    <TokenRow token={t} users={users} />
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Usage note */}
        <div
          className="mt-6 rounded-xl px-5 py-4"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
            How to use
          </p>
          <p className="text-xs mb-1" style={{ color: 'var(--text-2)' }}>
            Pass the token as a Bearer Authorization header or as <code style={{ background: 'var(--bg-elevated)', padding: '1px 4px', borderRadius: 3 }}>V42_API_TOKEN</code> env var for the MCP server:
          </p>
          <pre
            className="text-xs rounded-lg px-4 py-3 overflow-x-auto"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
          >
            {`V42_API_TOKEN=v42_<token> ~/v42/bin/v42-mcp`}
          </pre>
          <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>
            See <strong>V42_AGENT.md</strong> for full client configuration instructions.
          </p>
        </div>
      </div>

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
      {newToken && (
        <RawTokenModal
          token={newToken}
          onClose={() => setNewToken(null)}
        />
      )}
    </div>
  );
}
