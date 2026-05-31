import { useState, Fragment, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { itemTestsApi } from '@/api/endpoints/item_tests';
import { useBacklogItem, useProjectAncestors } from '@/hooks/useProjects';
import { useAuthStore } from '@/hooks/useAuth';
import { CLARITY_LABEL } from '@/types';
import type { TestType } from '@/types';

// -- constants ---------------------------------------------------------------

const TEST_TYPE_OPTS: TestType[] = ['manual', 'acceptance', 'integration', 'unit'];

const CLARITY_HEX: Record<string, string> = {
  clear:   '#10B981',
  scoped:  '#FBBF24',
  tacit:   '#F97316',
  foggy:   '#EF4444',
  unknown: '#6B7280',
};

// -- hooks -------------------------------------------------------------------

const testKeys = {
  one: (projectId: string, testId: string) => ['tests', projectId, testId] as const,
};

function useTest(projectId: string, testId: string) {
  return useQuery({
    queryKey: testKeys.one(projectId, testId),
    queryFn: async () => {
      const res = await itemTestsApi.get(projectId, testId);
      return res.data.data;
    },
    enabled: !!projectId && !!testId,
  });
}

function useUpdateTest(projectId: string, testId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof itemTestsApi.update>[2]) =>
      itemTestsApi.update(projectId, testId, data),
    onSuccess: (res) => {
      qc.setQueryData(testKeys.one(projectId, testId), res.data.data);
    },
  });
}

function useDeleteTest(projectId: string, testId: string) {
  return useMutation({
    mutationFn: () => itemTestsApi.delete(projectId, testId),
  });
}

// -- TestDetailPage ----------------------------------------------------------

export function TestDetailPage() {
  const { projectId = '', testId = '' } = useParams<{
    projectId: string;
    testId: string;
  }>();
  const navigate = useNavigate();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') navigate(-1); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [navigate]);

  const user = useAuthStore((s) => s.user);
  const canEdit = !!user;

  const { data: test, isLoading } = useTest(projectId, testId);
  const { data: backlogItem } = useBacklogItem(
    projectId,
    test?.backlog_item_id ?? '',
  );
  const projectChain = useProjectAncestors(projectId);
  const updateTest = useUpdateTest(projectId, testId);
  const deleteTest = useDeleteTest(projectId, testId);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingSteps, setEditingSteps] = useState(false);
  const [stepsDraft, setStepsDraft] = useState('');
  const [editingExpected, setEditingExpected] = useState(false);
  const [expectedDraft, setExpectedDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading...</p>
      </div>
    );
  }

  if (!test) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Test not found.</p>
      </div>
    );
  }

  function commitTitle() {
    const t = titleDraft.trim();
    if (t && t !== test!.title) updateTest.mutate({ title: t });
    setEditingTitle(false);
  }

  function handleDelete() {
    if (!window.confirm('Delete this test spec?')) return;
    deleteTest.mutate(undefined, {
      onSuccess: () => {
        if (test!.backlog_item_id) {
          navigate(`/projects/${projectId}/backlog/${test!.backlog_item_id}`);
        } else {
          navigate(`/projects/${projectId}/backlog`);
        }
      },
    });
  }

  const clarityHex = CLARITY_HEX[backlogItem?.clarity ?? 'unknown'] ?? CLARITY_HEX.unknown;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto flex justify-center pt-8 pb-16 px-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) navigate(-1); }}
    >
      <div
        className="w-full flex-shrink-0 flex flex-col rounded-2xl h-fit"
        style={{ maxWidth: '720px', background: 'var(--bg-active)', border: '1px solid var(--border)' }}
      >
        {/* Modal header */}
        <div className="flex items-center gap-1.5 px-6 py-3 text-xs flex-shrink-0 flex-wrap" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)' }}>
          <Link to="/projects" className="hover:underline" style={{ color: 'var(--text-3)' }}>Projects</Link>
          {projectChain.map((p) => (
            <Fragment key={p.id}>
              <span>/</span>
              <Link to={`/projects/${p.id}`} className="hover:underline" style={{ color: 'var(--text-3)' }}>{p.name}</Link>
            </Fragment>
          ))}
          <span>/</span>
          <Link to={`/projects/${projectId}/backlog`} className="hover:underline">Backlog</Link>
          {test.backlog_item_id && (
            <>
              <span>/</span>
              <Link to={`/projects/${projectId}/backlog/${test.backlog_item_id}`} className="hover:underline">B-{backlogItem?.number ?? '?'}</Link>
            </>
          )}
          <span>/</span>
          <span style={{ color: 'var(--text-1)' }}>Test</span>
          <button onClick={() => navigate(-1)} aria-label="Close" className="ml-auto text-sm" style={{ color: 'var(--text-3)' }} title="Close">&#10007;</button>
        </div>

        <div className="max-w-2xl mx-auto px-6 py-8 flex flex-col gap-6 w-full">

        {/* Title */}
        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitTitle(); }
              if (e.key === 'Escape') setEditingTitle(false);
            }}
            className="w-full text-xl font-semibold rounded px-2 py-1 outline-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
          />
        ) : (
          <h1
            className="text-xl font-semibold cursor-pointer rounded px-1 -mx-1 hover:bg-[var(--bg-elevated)] transition-colors"
            style={{ color: 'var(--text-1)' }}
            onClick={() => { if (canEdit) { setTitleDraft(test.title); setEditingTitle(true); } }}
            title={canEdit ? 'Click to edit' : undefined}
          >
            {test.title}
          </h1>
        )}

        {/* Parent item clarity context */}
        {backlogItem && (
          <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-3)' }}>
            <span>Parent clarity:</span>
            <span
              className="px-2 py-0.5 rounded font-medium"
              style={{ background: clarityHex + '22', color: clarityHex, border: `1px solid ${clarityHex}55` }}
            >
              {CLARITY_LABEL[backlogItem.clarity] ?? backlogItem.clarity}
            </span>
          </div>
        )}

        {/* Fields */}
        <div className="grid grid-cols-2 gap-4">
          {/* Type */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Type</label>
            <select
              value={test.type}
              disabled={!canEdit}
              onChange={(e) => updateTest.mutate({ type: e.target.value as TestType })}
              className="rounded-lg px-3 py-2 text-sm outline-none capitalize"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            >
              {TEST_TYPE_OPTS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Description */}
        <FieldEditor
          label="Description"
          value={test.description ?? ''}
          editing={editingDesc}
          draft={descDraft}
          canEdit={canEdit}
          onStartEdit={() => { setDescDraft(test.description ?? ''); setEditingDesc(true); }}
          onChangeDraft={setDescDraft}
          onCommit={() => { updateTest.mutate({ description: descDraft.trim() || undefined }); setEditingDesc(false); }}
          onCancel={() => setEditingDesc(false)}
          placeholder="No description."
        />

        {/* Steps */}
        <FieldEditor
          label="Test Steps"
          value={test.steps ?? ''}
          editing={editingSteps}
          draft={stepsDraft}
          canEdit={canEdit}
          onStartEdit={() => { setStepsDraft(test.steps ?? ''); setEditingSteps(true); }}
          onChangeDraft={setStepsDraft}
          onCommit={() => { updateTest.mutate({ steps: stepsDraft.trim() || undefined }); setEditingSteps(false); }}
          onCancel={() => setEditingSteps(false)}
          placeholder="No steps defined."
        />

        {/* Expected Results */}
        <FieldEditor
          label="Expected Results"
          value={test.expected_results ?? ''}
          editing={editingExpected}
          draft={expectedDraft}
          canEdit={canEdit}
          onStartEdit={() => { setExpectedDraft(test.expected_results ?? ''); setEditingExpected(true); }}
          onChangeDraft={setExpectedDraft}
          onCommit={() => { updateTest.mutate({ expected_results: expectedDraft.trim() || undefined }); setEditingExpected(false); }}
          onCancel={() => setEditingExpected(false)}
          placeholder="No expected results defined."
        />

        {/* Danger zone */}
        {canEdit && (
          <div className="flex items-center justify-between pt-4" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              Created {new Date(test.created_at).toLocaleDateString()}
            </span>
            <button
              onClick={handleDelete}
              disabled={deleteTest.isPending}
              className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50"
              style={{ color: 'var(--color-danger)', border: '1px solid var(--color-danger)' }}
            >
              Delete Test
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

// -- Shared inline text area editor ------------------------------------------

function FieldEditor({
  label, value, editing, draft, canEdit,
  onStartEdit, onChangeDraft, onCommit, onCancel, placeholder,
}: {
  label: string;
  value: string;
  editing: boolean;
  draft: string;
  canEdit: boolean;
  onStartEdit: () => void;
  onChangeDraft: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{label}</label>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            rows={5}
            value={draft}
            onChange={(e) => onChangeDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
          />
          <div className="flex gap-2 justify-end">
            <button
              type="button" onClick={onCancel}
              className="text-xs px-3 py-1 rounded"
              style={{ color: 'var(--text-3)' }}
            >Cancel</button>
            <button
              type="button" onClick={onCommit}
              className="text-xs px-3 py-1 rounded font-medium"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >Save</button>
          </div>
        </div>
      ) : (
        <div
          className="rounded-lg px-3 py-2 text-sm cursor-pointer min-h-[3rem] hover:bg-[var(--bg-elevated)] transition-colors"
          style={{ color: value ? 'var(--text-1)' : 'var(--text-3)', border: '1px solid var(--border)', whiteSpace: 'pre-wrap' }}
          onClick={() => { if (canEdit) onStartEdit(); }}
          title={canEdit ? `Click to edit ${label.toLowerCase()}` : undefined}
        >
          {value || placeholder}
        </div>
      )}
    </div>
  );
}

export default TestDetailPage;
