import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { itemTestsApi } from '@/api/endpoints/item_tests';
import { useAuthStore } from '@/hooks/useAuth';
import type { TestSpec, TestType } from '@/types';

// -- constants ---------------------------------------------------------------

const TEST_TYPE_OPTS: TestType[] = ['manual', 'acceptance', 'integration', 'unit'];

// -- hooks -------------------------------------------------------------------

function useTestData(projectId: string, testId: string) {
  return useQuery({
    queryKey: ['tests', projectId, testId],
    queryFn: async () => {
      const res = await itemTestsApi.get(projectId, testId);
      return res.data.data as TestSpec;
    },
    enabled: !!projectId && !!testId,
  });
}

function useUpdateTestData(projectId: string, testId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof itemTestsApi.update>[2]) =>
      itemTestsApi.update(projectId, testId, data),
    onSuccess: (res) => {
      qc.setQueryData(['tests', projectId, testId], res.data.data);
    },
  });
}

function useDeleteTestData(projectId: string, testId: string) {
  return useMutation({
    mutationFn: () => itemTestsApi.delete(projectId, testId),
  });
}

// -- FieldEditor -------------------------------------------------------------

function FieldEditor({
  label, value, editing, draft, canEdit, placeholder,
  onStartEdit, onChangeDraft, onCommit, onCancel,
}: {
  label: string; value: string; editing: boolean; draft: string; canEdit: boolean; placeholder: string;
  onStartEdit: () => void; onChangeDraft: (v: string) => void; onCommit: () => void; onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{label}</label>
      {editing ? (
        <textarea
          autoFocus
          rows={4}
          value={draft}
          onChange={(e) => onChangeDraft(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
        />
      ) : (
        <div
          className="rounded-lg px-3 py-2 text-sm cursor-pointer min-h-[3rem] hover:bg-[var(--bg-elevated)] transition-colors"
          style={{ color: value ? 'var(--text-1)' : 'var(--text-3)', border: '1px solid var(--border)', whiteSpace: 'pre-wrap' }}
          onClick={() => { if (canEdit) onStartEdit(); }}
          title={canEdit ? 'Click to edit' : undefined}
        >
          {value || placeholder}
        </div>
      )}
    </div>
  );
}

// -- TestDetailModal ---------------------------------------------------------

export function TestDetailModal({
  projectId,
  testId,
  onClose,
}: {
  projectId: string;
  testId: string;
  onClose: () => void;
}) {
  const user = useAuthStore((s) => s.user);
  const canEdit = !!user;

  const { data: test, isLoading } = useTestData(projectId, testId);
  const updateTest = useUpdateTestData(projectId, testId);
  const deleteTest = useDeleteTestData(projectId, testId);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [editingSteps, setEditingSteps] = useState(false);
  const [stepsDraft, setStepsDraft] = useState('');
  const [editingExpected, setEditingExpected] = useState(false);
  const [expectedDraft, setExpectedDraft] = useState('');

  // ESC: capture phase so this fires before any outer modal listener
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [onClose]);

  function commitTitle() {
    const t = titleDraft.trim();
    if (t && test && t !== test.title) updateTest.mutate({ title: t });
    setEditingTitle(false);
  }

  function handleDelete() {
    if (!test || !window.confirm('Delete this test?')) return;
    deleteTest.mutate(undefined, { onSuccess: onClose });
  }

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto flex justify-center pt-8 pb-16 px-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full flex-shrink-0 flex flex-col rounded-2xl h-fit"
        style={{ maxWidth: '680px', background: 'var(--bg-active)', border: '1px solid var(--border)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Test details"
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-6 py-3 text-xs flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)' }}
        >
          <span className="font-mono capitalize" style={{ color: '#34D399' }}>T</span>
          <span style={{ color: 'var(--text-3)' }}>Test</span>
          {test && (
            <span className="font-mono capitalize" style={{ color: '#34D399' }}>· {test.type}</span>
          )}
          <div className="ml-auto flex items-center gap-3">
            {test && (
              <Link
                to={`/projects/${projectId}/tests/${testId}`}
                className="text-xs hover:underline"
                style={{ color: 'var(--accent)' }}
                title="Open full page"
              >
                Open &#8599;
              </Link>
            )}
            <button onClick={onClose} aria-label="Close" className="text-sm" style={{ color: 'var(--text-3)' }} title="Close (Esc)">&#10007;</button>
          </div>
        </div>

        <div className="px-6 py-6 flex flex-col gap-5">
          {isLoading && <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading...</p>}
          {!isLoading && !test && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Test not found.</p>}
          {test && (
            <>
              {/* Title */}
              {editingTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitTitle(); }
                    if (e.key === 'Escape') { e.stopPropagation(); setEditingTitle(false); }
                  }}
                  className="w-full text-xl font-semibold rounded px-2 py-1 outline-none"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)', color: 'var(--text-1)' }}
                />
              ) : (
                <h2
                  className="text-xl font-semibold italic cursor-pointer rounded px-1 -mx-1 hover:bg-[var(--bg-elevated)] transition-colors"
                  style={{ color: 'var(--text-1)' }}
                  onClick={() => { if (canEdit) { setTitleDraft(test.title); setEditingTitle(true); } }}
                  title={canEdit ? 'Click to edit' : undefined}
                >
                  {test.title}
                </h2>
              )}

              {/* Type */}
              <div className="flex flex-col gap-1" style={{ maxWidth: '200px' }}>
                <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Type</label>
                <select
                  value={test.type}
                  disabled={!canEdit}
                  onChange={(e) => updateTest.mutate({ type: e.target.value as TestType })}
                  className="rounded-lg px-3 py-2 text-sm outline-none capitalize"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                >
                  {TEST_TYPE_OPTS.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
                </select>
              </div>

              {/* Fields */}
              <FieldEditor
                label="Description"
                value={test.description ?? ''}
                editing={editingDesc}
                draft={descDraft}
                canEdit={canEdit}
                placeholder="No description. Click to add."
                onStartEdit={() => { setDescDraft(test.description ?? ''); setEditingDesc(true); }}
                onChangeDraft={setDescDraft}
                onCommit={() => { updateTest.mutate({ description: descDraft.trim() || undefined }); setEditingDesc(false); }}
                onCancel={() => setEditingDesc(false)}
              />

              <FieldEditor
                label="Test Steps"
                value={test.steps ?? ''}
                editing={editingSteps}
                draft={stepsDraft}
                canEdit={canEdit}
                placeholder="No steps defined. Click to add."
                onStartEdit={() => { setStepsDraft(test.steps ?? ''); setEditingSteps(true); }}
                onChangeDraft={setStepsDraft}
                onCommit={() => { updateTest.mutate({ steps: stepsDraft.trim() || undefined }); setEditingSteps(false); }}
                onCancel={() => setEditingSteps(false)}
              />

              <FieldEditor
                label="Expected Results"
                value={test.expected_results ?? ''}
                editing={editingExpected}
                draft={expectedDraft}
                canEdit={canEdit}
                placeholder="No expected results defined. Click to add."
                onStartEdit={() => { setExpectedDraft(test.expected_results ?? ''); setEditingExpected(true); }}
                onChangeDraft={setExpectedDraft}
                onCommit={() => { updateTest.mutate({ expected_results: expectedDraft.trim() || undefined }); setEditingExpected(false); }}
                onCancel={() => setEditingExpected(false)}
              />

              {/* Footer */}
              <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                  Created {new Date(test.created_at).toLocaleDateString()}
                </span>
                {canEdit && (
                  <button
                    onClick={handleDelete}
                    disabled={deleteTest.isPending}
                    className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50"
                    style={{ color: 'var(--color-danger)', border: '1px solid var(--color-danger)' }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
