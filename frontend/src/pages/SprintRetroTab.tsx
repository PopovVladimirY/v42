import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { retroApi } from '@/api/endpoints/retro';
import { sprintCapacityApi } from '@/api/endpoints/sprint_capacity';
import { useAuthStore } from '@/hooks/useAuth';
import type { RetroItem, RetroCategory } from '@/api/endpoints/retro';

const CATEGORIES: { id: RetroCategory; label: string; accent: string }[] = [
  { id: 'went_well',      label: 'Went Well',       accent: 'var(--color-success)' },
  { id: 'didnt_go_well',  label: "Didn't Go Well",  accent: 'var(--color-danger)'  },
  { id: 'to_improve',     label: 'To Improve',      accent: 'var(--accent)'        },
  { id: 'kudos',          label: 'Kudos',           accent: '#f59e0b'              },
];

const MAX_VOTES = 5;

// Single retro card with vote/edit/delete controls
function RetroCard({
  item,
  projectId,
  sprintId,
  callerUserId,
  canManage,
  facilitatorUserId,
}: {
  item: RetroItem;
  projectId: string;
  sprintId: string;
  callerUserId: string;
  canClose: boolean;
  canManage?: boolean;
  facilitatorUserId?: string;
}) {
  const qc = useQueryClient();
  const qKey = ['retro', projectId, sprintId];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  const isAuthor = item.author_id === callerUserId;
  const canEditMeta = isAuthor || canManage;

  const vote = useMutation({
    mutationFn: () => retroApi.vote(projectId, sprintId, item.id, facilitatorUserId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qKey }),
  });
  const unvote = useMutation({
    mutationFn: () => retroApi.unvote(projectId, sprintId, item.id, facilitatorUserId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qKey }),
  });
  const update = useMutation({
    mutationFn: () => retroApi.update(projectId, sprintId, item.id, { content: draft }),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: qKey });
    },
  });
  const remove = useMutation({
    mutationFn: () => retroApi.delete(projectId, sprintId, item.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qKey }),
  });
  const resolve = useMutation({
    mutationFn: () => retroApi.resolve(projectId, sprintId, item.id, !item.is_resolved),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qKey }),
  });
  const toggleAction = useMutation({
    mutationFn: () => retroApi.update(projectId, sprintId, item.id, { is_action: !item.is_action }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qKey }),
  });

  const voteDisabled = !item.my_vote && item.my_total_votes >= MAX_VOTES;

  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-2"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        opacity: item.is_resolved ? 0.6 : 1,
      }}
    >
      {/* Content / edit area */}
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="text-xs rounded px-2 py-1 resize-none w-full"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-1)', minHeight: 60 }}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={() => update.mutate()}
              disabled={update.isPending || !draft.trim()}
              className="text-xs px-3 py-1 rounded font-medium"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              Save
            </button>
            <button
              onClick={() => { setEditing(false); setDraft(item.content); }}
              className="text-xs px-3 py-1 rounded"
              style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p
          className="text-xs leading-relaxed"
          style={{
            color: 'var(--text-1)',
            textDecoration: item.is_resolved ? 'line-through' : undefined,
          }}
        >
          {item.content}
        </p>
      )}

      {/* Footer: two rows */}
      <div className="flex flex-col gap-1 mt-auto pt-1" style={{ borderTop: '1px solid var(--border)' }}>
        {/* Row 1: author + vote + edit/delete */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] truncate" style={{ color: 'var(--text-3)' }}>
            {item.author_name}
          </span>
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={() => item.my_vote ? unvote.mutate() : vote.mutate()}
              disabled={vote.isPending || unvote.isPending || voteDisabled}
              title={voteDisabled ? `${MAX_VOTES} votes used` : item.my_vote ? 'Remove vote' : 'Vote'}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors"
              style={{
                background: item.my_vote ? 'var(--accent)' : 'var(--bg-surface)',
                color: item.my_vote ? 'var(--accent-fg)' : voteDisabled ? 'var(--text-3)' : 'var(--text-2)',
                border: '1px solid var(--border)',
                opacity: voteDisabled && !item.my_vote ? 0.5 : 1,
              }}
            >
              <span>{item.my_vote ? '▲' : '△'}</span>
              <span>{item.votes}</span>
            </button>
            {isAuthor && !editing && (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
                  title="Edit"
                >
                  Edit
                </button>
                <button
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ color: 'var(--color-danger)', border: '1px solid var(--color-danger)' }}
                  title="Delete"
                >
                  &times;
                </button>
              </>
            )}
          </div>
        </div>
        {/* Row 2: action checkbox + resolve */}
        <div className="flex items-center gap-2">
          <label
            className="flex items-center gap-1 text-[9px] select-none"
            style={{ color: item.is_action ? 'var(--accent)' : 'var(--text-3)', cursor: canEditMeta ? 'pointer' : 'default' }}
            title={canEditMeta ? (item.is_action ? 'Remove action item' : 'Mark as action item') : undefined}
          >
            <input
              type="checkbox"
              checked={item.is_action}
              onChange={() => canEditMeta && toggleAction.mutate()}
              disabled={!canEditMeta || toggleAction.isPending}
              className="w-2.5 h-2.5 accent-[var(--accent)]"
              style={{ cursor: canEditMeta ? 'pointer' : 'default' }}
            />
            Action
          </label>
          {item.is_action && (
            <button
              onClick={() => resolve.mutate()}
              disabled={resolve.isPending}
              className="text-[9px] px-1.5 py-0.5 rounded-full font-medium uppercase"
              style={{
                background: item.is_resolved ? 'var(--color-success)' : 'var(--bg-surface)',
                color: item.is_resolved ? '#fff' : 'var(--text-3)',
                border: '1px solid var(--border)',
              }}
              title={item.is_resolved ? 'Mark unresolved' : 'Mark resolved'}
            >
              {item.is_resolved ? 'Resolved' : 'Resolve'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// "Add card" inline form for a specific column
function AddCardForm({
  projectId,
  sprintId,
  category,
  onDone,
}: {
  projectId: string;
  sprintId: string;
  category: RetroCategory;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [content, setContent] = useState('');
  const [isAction, setIsAction] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      retroApi.create(projectId, sprintId, { category, content, is_action: isAction }),
    onSuccess: () => {
      setContent('');
      setIsAction(false);
      onDone();
      void qc.invalidateQueries({ queryKey: ['retro', projectId, sprintId] });
    },
  });

  return (
    <div className="flex flex-col gap-2 p-2 rounded-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="What happened?"
        className="text-xs rounded px-2 py-1 resize-none w-full"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)', minHeight: 56 }}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && content.trim()) create.mutate();
        }}
      />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[10px] cursor-pointer" style={{ color: 'var(--text-3)' }}>
          <input
            type="checkbox"
            checked={isAction}
            onChange={(e) => setIsAction(e.target.checked)}
            className="w-3 h-3"
          />
          Action item
        </label>
        <div className="flex gap-1 ml-auto">
          <button
            onClick={onDone}
            className="text-xs px-2 py-0.5 rounded"
            style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
          >
            Cancel
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending || !content.trim()}
            className="text-xs px-3 py-0.5 rounded font-medium"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// One column (e.g. "Went Well")
function RetroColumn({
  category,
  items,
  projectId,
  sprintId,
  callerUserId,
  retroClosed,
  accent,
  canManage,
  facilitatorUserId,
}: {
  category: RetroCategory;
  items: RetroItem[];
  projectId: string;
  sprintId: string;
  callerUserId: string;
  retroClosed: boolean;
  accent: string;
  canManage?: boolean;
  facilitatorUserId?: string;
}) {
  const [adding, setAdding] = useState(false);
  const cat = CATEGORIES.find((c) => c.id === category)!;

  return (
    <div className="flex flex-col flex-1 min-w-[220px] gap-2">
      {/* Column header */}
      <div className="flex items-center justify-between px-1 pb-1" style={{ borderBottom: `2px solid ${accent}` }}>
        <span className="text-xs font-semibold" style={{ color: accent }}>
          {cat.label}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--bg-elevated)', color: 'var(--text-3)' }}>
          {items.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 flex-1 overflow-y-auto min-h-0">
        {items.map((item) => (
          <RetroCard
            key={item.id}
            item={item}
            projectId={projectId}
            sprintId={sprintId}
            callerUserId={callerUserId}
            canClose={false}
            canManage={canManage}
            facilitatorUserId={facilitatorUserId}
          />
        ))}
      </div>

      {/* Add card */}
      {!retroClosed && (
        adding ? (
          <AddCardForm
            projectId={projectId}
            sprintId={sprintId}
            category={category}
            onDone={() => setAdding(false)}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="text-xs px-3 py-1.5 rounded-lg text-left"
            style={{ color: 'var(--text-3)', border: '1px dashed var(--border)' }}
          >
            + Add card
          </button>
        )
      )}
    </div>
  );
}

export function SprintRetroTab() {
  const { projectId = '', sprintId = '' } = useParams<{ projectId: string; sprintId: string }>();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const callerUserId = user?.id ?? '';
  const canManage = user?.role === 'admin' || user?.role === 'maintainer';

  // Facilitator (offline) mode: admin/maintainer selects a team member and votes on their behalf.
  const [facilitatorMode, setFacilitatorMode] = useState(false);
  const [facilitatorUserId, setFacilitatorUserId] = useState('');

  // When a target member is selected in facilitator mode, fetch the board from their perspective
  // so my_vote/my_total_votes reflect their state, not the facilitator's.
  const viewAs = facilitatorMode && facilitatorUserId ? facilitatorUserId : undefined;

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['retro', projectId, sprintId, viewAs ?? 'self'],
    queryFn: async () => {
      const res = await retroApi.list(projectId, sprintId, viewAs);
      return res.data.data ?? [];
    },
    enabled: !!projectId && !!sprintId,
  });

  // Load team member list for the facilitator dropdown (only when facilitator mode is active).
  const { data: capacityData } = useQuery({
    queryKey: ['sprint-capacity', projectId, sprintId],
    queryFn: async () => {
      const res = await sprintCapacityApi.get(projectId, sprintId);
      return res.data.data;
    },
    enabled: !!projectId && !!sprintId && canManage && facilitatorMode,
  });
  const teamMembers = capacityData?.capacity ?? [];

  // Detect retro_closed from any item (my_total_votes from server won't help here,
  // but we'll check useSprint for retro_closed field)
  // For now, close is managed through a separate button.
  const closeRetro = useMutation({
    mutationFn: () => retroApi.close(projectId, sprintId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['retro', projectId, sprintId] }),
  });

  const byCategory = (cat: RetroCategory) => items.filter((i) => i.category === cat);
  const totalVotes = items[0]?.my_total_votes ?? 0;
  const votesLeft = MAX_VOTES - totalVotes;

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading retro...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Retro toolbar */}
      <div
        className="flex-shrink-0 flex items-center gap-4 px-4 py-2 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          {votesLeft} vote{votesLeft !== 1 ? 's' : ''} left
        </span>
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          {items.filter((i) => i.is_action && !i.is_resolved).length} open actions
        </span>

        {canManage && (
          <div className="flex items-center gap-2 ml-auto">
            {/* Facilitator mode toggle */}
            <button
              onClick={() => { setFacilitatorMode((v) => !v); setFacilitatorUserId(''); }}
              className="text-xs px-2.5 py-1 rounded font-medium"
              style={{
                background: facilitatorMode ? 'var(--accent)' : 'var(--bg-elevated)',
                color: facilitatorMode ? 'var(--accent-fg)' : 'var(--text-3)',
                border: '1px solid var(--border)',
              }}
              title="Toggle facilitator (offline) mode -- vote on behalf of team members"
            >
              Facilitator
            </button>

            {/* Member picker -- only when facilitator mode is on */}
            {facilitatorMode && (
              <select
                value={facilitatorUserId}
                onChange={(e) => setFacilitatorUserId(e.target.value)}
                className="text-xs rounded px-2 py-1 outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
                title="Select team member to vote on their behalf"
              >
                <option value="">-- select member --</option>
                {teamMembers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.user_name}</option>
                ))}
              </select>
            )}

            <button
              onClick={() => closeRetro.mutate()}
              disabled={closeRetro.isPending}
              className="text-xs px-3 py-1 rounded"
              style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
            >
              Close retro
            </button>
          </div>
        )}
      </div>

      {/* 4-column board */}
      <div className="flex-1 overflow-auto p-4">
        <div className="flex gap-4 min-w-max h-full">
          {CATEGORIES.map((cat) => (
            <RetroColumn
              key={cat.id}
              category={cat.id}
              items={byCategory(cat.id)}
              projectId={projectId}
              sprintId={sprintId}
              callerUserId={callerUserId}
              retroClosed={false}
              accent={cat.accent}
              canManage={canManage}
              facilitatorUserId={facilitatorMode && facilitatorUserId ? facilitatorUserId : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
