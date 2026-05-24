import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { skillsApi } from '@/api/endpoints/users';
import type { Skill } from '@/types/index';

// Base category suggestions -- extended with live data from skills
const BASE_CATEGORIES = ['Backend', 'Frontend', 'QA', 'DevOps', 'Mobile', 'Data', 'Design', 'Management'];

// ------------------------------------------------------------------
// Inline skill form -- shared for create + edit
// ------------------------------------------------------------------
function SkillForm({
  initial,
  defaultCategory,
  allCategories,
  onSave,
  onCancel,
  isSaving,
  error,
  showCategoryField = true,
}: {
  initial?: Skill;
  defaultCategory?: string;
  allCategories: string[];
  onSave: (name: string, category: string | null) => void;
  onCancel: () => void;
  isSaving: boolean;
  error?: string;
  showCategoryField?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? defaultCategory ?? '');

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (name.trim()) onSave(name.trim(), category.trim() || null);
    }
    if (e.key === 'Escape') onCancel();
  }

  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-3"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
    >
      <div className={showCategoryField ? 'flex gap-3' : ''}>
        <div className="flex-1">
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-2)' }}>
            Skill name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKey}
            maxLength={100}
            placeholder="e.g. TypeScript"
            autoFocus
            className="w-full text-sm rounded-md px-2.5 py-2 outline-none"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          />
        </div>
        {showCategoryField && (
          <div className="flex-1">
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-2)' }}>
              Category{' '}
              <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(existing or new)</span>
            </label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              onKeyDown={handleKey}
              maxLength={50}
              list="skill-category-options"
              placeholder="e.g. Frontend"
              className="w-full text-sm rounded-md px-2.5 py-2 outline-none"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            />
            <datalist id="skill-category-options">
              {allCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        )}
      </div>
      {error && (
        <p className="text-xs" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => onSave(name.trim(), category.trim() || null)}
          disabled={!name.trim() || isSaving}
          className="text-xs px-4 py-1.5 rounded-md font-medium disabled:opacity-40"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          {isSaving ? 'Saving...' : initial ? 'Update' : 'Create'}
        </button>
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded-md"
          style={{ background: 'var(--bg-surface)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Chevron icon
// ------------------------------------------------------------------
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      style={{
        transition: 'transform 0.15s',
        transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        flexShrink: 0,
      }}
    >
      <path
        d="M4 2l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ------------------------------------------------------------------
// Main page
// ------------------------------------------------------------------
export function AdminSkillsPage() {
  const qc = useQueryClient();

  // Which category sections are expanded. Empty = all collapsed (default).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // id of the skill being edited inline
  const [editingId, setEditingId] = useState<string | null>(null);
  // Top-level "New skill" form visible
  const [showCreate, setShowCreate] = useState(false);
  // Which category has the inline "add skill" form open
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null);
  // Confirm delete for a skill id
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | undefined>();
  // Text filter
  const [search, setSearch] = useState('');

  const { data: skills = [], isLoading } = useQuery({
    queryKey: ['skills-all'],
    queryFn: skillsApi.listAll,
    staleTime: 0,
  });

  // All categories: from live data + base list, unique, sorted
  const allCategories = useMemo(() => {
    const fromData = skills.map((s) => s.category).filter((c): c is string => !!c);
    return Array.from(new Set([...fromData, ...BASE_CATEGORIES])).sort();
  }, [skills]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['skills-all'] });
    void qc.invalidateQueries({ queryKey: ['skills-catalog'] });
  };

  const createMutation = useMutation({
    mutationFn: ({ name, category }: { name: string; category: string | null }) =>
      skillsApi.create({ name, category }),
    onSuccess: (_data, vars) => {
      invalidate();
      setShowCreate(false);
      setAddingToCategory(null);
      setFormError(undefined);
      // Auto-expand the category so the new skill is visible
      if (vars.category) {
        setExpanded((prev) => new Set(prev).add(vars.category!));
      }
    },
    onError: (e: { message?: string }) => setFormError(e?.message ?? 'Failed to create skill'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name, category }: { id: string; name: string; category: string | null }) =>
      skillsApi.update(id, { name, category }),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      setFormError(undefined);
    },
    onError: (e: { message?: string }) => setFormError(e?.message ?? 'Failed to update skill'),
  });

  const setHidden = useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) =>
      skillsApi.setHidden(id, hidden),
    onSuccess: () => invalidate(),
  });

  const delMutation = useMutation({
    mutationFn: (id: string) => skillsApi.delete(id),
    onSuccess: () => {
      invalidate();
      setDeleteConfirm(null);
    },
  });

  // Group by category, filter by search, sort alphabetically, uncategorized last
  const byCategory = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = q
      ? skills.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.category ?? '').toLowerCase().includes(q),
        )
      : skills;
    const groups: Record<string, Skill[]> = {};
    for (const s of source) {
      const cat = s.category ?? '(uncategorized)';
      (groups[cat] ??= []).push(s);
    }
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === '(uncategorized)') return 1;
      if (b === '(uncategorized)') return -1;
      return a.localeCompare(b);
    });
  }, [skills, search]);

  // When searching, treat all visible categories as expanded
  const effectiveExpanded = (cat: string) =>
    search.trim() ? true : expanded.has(cat);

  const allCats = byCategory.map(([c]) => c);
  const allExpanded = allCats.length > 0 && allCats.every((c) => expanded.has(c));
  function toggleAll() {
    if (allExpanded) {
      setExpanded(new Set());
    } else {
      setExpanded(new Set(allCats));
    }
  }

  function toggleCategory(cat: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
        if (addingToCategory === cat) setAddingToCategory(null);
      } else {
        next.add(cat);
      }
      return next;
    });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">

        {/* Page header */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold" style={{ color: 'var(--text-1)' }}>
              Skill Catalog
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {skills.length} skills &mdash; {skills.filter((s) => s.is_hidden).length} hidden &mdash;{' '}
              {byCategory.length} categories
            </p>
          </div>
          {/* Expand / collapse all */}
          <button
            onClick={toggleAll}
            title={allExpanded ? 'Collapse all' : 'Expand all'}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md flex-shrink-0 transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
          >
            {allExpanded ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 4h8M2 8h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M5 1l-3 3M7 1l3 3M5 11l-3-3M7 11l3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 4h8M2 8h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M5 1l-3-3M7 1l3-3M5 11l-3 3M7 11l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            )}
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
          <button
            onClick={() => {
              setShowCreate((v) => !v);
              setFormError(undefined);
              setAddingToCategory(null);
            }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium flex-shrink-0"
            style={{
              background: showCreate ? 'var(--bg-elevated)' : 'var(--accent)',
              color: showCreate ? 'var(--text-2)' : 'var(--accent-fg)',
              border: `1px solid ${showCreate ? 'var(--border)' : 'transparent'}`,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            New skill
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none"
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--text-3)' }}
          >
            <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.3" />
            <path d="M9.5 9.5l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter skills..."
            className="w-full text-sm rounded-lg pl-8 pr-3 py-2 outline-none"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-3)' }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {/* Top-level create form */}
        {showCreate && (
          <div className="mb-6">
            <SkillForm
              allCategories={allCategories}
              onSave={(name, category) => createMutation.mutate({ name, category })}
              onCancel={() => {
                setShowCreate(false);
                setFormError(undefined);
              }}
              isSaving={createMutation.isPending}
              error={formError}
            />
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-10 rounded-lg animate-pulse"
                style={{ background: 'var(--bg-surface)' }}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {byCategory.length === 0 && search.trim() && (
              <p className="text-sm py-8 text-center" style={{ color: 'var(--text-3)' }}>
                No skills match &ldquo;{search}&rdquo;
              </p>
            )}
            {byCategory.map(([cat, items]) => {
              const isOpen = effectiveExpanded(cat);
              const visibleCount = items.filter((s) => !s.is_hidden).length;
              const hiddenCount = items.filter((s) => s.is_hidden).length;

              return (
                <section
                  key={cat}
                  className="rounded-xl overflow-hidden"
                  style={{ border: '1px solid var(--border)' }}
                >
                  {/* Category header -- click to toggle (disabled during search) */}
                  <button
                    onClick={() => { if (!search.trim()) toggleCategory(cat); }}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
                    style={{ background: 'var(--bg-surface)' }}
                  >
                    <Chevron open={isOpen} />
                    <span className="text-sm font-semibold flex-1" style={{ color: 'var(--text-1)' }}>
                      {cat}
                    </span>
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-3)' }}>
                      {visibleCount} skill{visibleCount !== 1 ? 's' : ''}
                      {hiddenCount > 0 && (
                        <span style={{ color: 'var(--warning)' }}>
                          {' '}&middot; {hiddenCount} hidden
                        </span>
                      )}
                    </span>
                  </button>

                  {/* Expanded body */}
                  {isOpen && (
                    <div style={{ borderTop: '1px solid var(--border)' }}>
                      {items.map((skill, idx) => (
                        <div key={skill.id}>
                          {idx > 0 && <div style={{ borderTop: '1px solid var(--border)' }} />}

                          {editingId === skill.id ? (
                            <div className="p-3" style={{ background: 'var(--bg-elevated)' }}>
                              <SkillForm
                                initial={skill}
                                allCategories={allCategories}
                                onSave={(name, category) =>
                                  updateMutation.mutate({ id: skill.id, name, category })
                                }
                                onCancel={() => {
                                  setEditingId(null);
                                  setFormError(undefined);
                                }}
                                isSaving={updateMutation.isPending}
                                error={formError}
                              />
                            </div>
                          ) : deleteConfirm === skill.id ? (
                            <div
                              className="flex items-center gap-3 px-4 py-3"
                              style={{ background: 'var(--bg-surface)' }}
                            >
                              <span className="text-xs flex-1" style={{ color: 'var(--error)' }}>
                                Delete <strong>{skill.name}</strong>? Removes all member skill history.
                              </span>
                              <button
                                onClick={() => delMutation.mutate(skill.id)}
                                disabled={delMutation.isPending}
                                className="text-xs px-3 py-1 rounded font-medium disabled:opacity-40"
                                style={{ background: 'var(--error)', color: '#fff' }}
                              >
                                {delMutation.isPending ? 'Deleting...' : 'Confirm'}
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="text-xs px-2 py-1 rounded"
                                style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div
                              className="flex items-center gap-3 px-4 py-2.5 group"
                              style={{ opacity: skill.is_hidden ? 0.5 : 1 }}
                            >
                              <div className="flex-1 min-w-0 flex items-center gap-2">
                                <span
                                  className="text-sm truncate"
                                  style={{ color: 'var(--text-1)' }}
                                >
                                  {skill.name}
                                </span>
                                {skill.is_builtin && (
                                  <span
                                    className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
                                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-3)' }}
                                  >
                                    builtin
                                  </span>
                                )}
                                {skill.is_hidden && (
                                  <span
                                    className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
                                    style={{
                                      background: 'color-mix(in srgb, var(--warning) 15%, transparent)',
                                      color: 'var(--warning)',
                                    }}
                                  >
                                    hidden
                                  </span>
                                )}
                              </div>

                              {/* Actions -- visible on hover */}
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                <button
                                  onClick={() => {
                                    setEditingId(skill.id);
                                    setFormError(undefined);
                                  }}
                                  title="Edit"
                                  className="p-1.5 rounded hover:bg-[var(--bg-hover)]"
                                  style={{ color: 'var(--text-3)' }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                    <path
                                      d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z"
                                      stroke="currentColor"
                                      strokeWidth="1.2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>

                                <button
                                  onClick={() =>
                                    setHidden.mutate({ id: skill.id, hidden: !skill.is_hidden })
                                  }
                                  title={skill.is_hidden ? 'Show' : 'Hide'}
                                  className="p-1.5 rounded hover:bg-[var(--bg-hover)]"
                                  style={{
                                    color: skill.is_hidden ? 'var(--success)' : 'var(--text-3)',
                                  }}
                                >
                                  {skill.is_hidden ? (
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                      <path
                                        d="M6 3C3.5 3 1.5 6 1.5 6s2 3 4.5 3 4.5-3 4.5-3-2-3-4.5-3Z"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                      />
                                      <circle cx="6" cy="6" r="1.2" fill="currentColor" />
                                    </svg>
                                  ) : (
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                      <path
                                        d="M2 2l8 8M4.5 3.5C5 3.2 5.5 3 6 3c2.5 0 4.5 3 4.5 3s-.6 1-1.7 2M7.5 8.5C7 8.8 6.5 9 6 9c-2.5 0-4.5-3-4.5-3s.6-1 1.7-2"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        strokeLinecap="round"
                                      />
                                    </svg>
                                  )}
                                </button>

                                {!skill.is_builtin && (
                                  <button
                                    onClick={() => setDeleteConfirm(skill.id)}
                                    title="Delete"
                                    className="p-1.5 rounded hover:bg-[var(--bg-hover)]"
                                    style={{ color: 'var(--error)' }}
                                  >
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                      <path
                                        d="M2 2l8 8M10 2l-8 8"
                                        stroke="currentColor"
                                        strokeWidth="1.4"
                                        strokeLinecap="round"
                                      />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}

                      {/* Inline "add skill to this category" */}
                      {addingToCategory === cat ? (
                        <div
                          className="p-3"
                          style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)' }}
                        >
                          <SkillForm
                            defaultCategory={cat === '(uncategorized)' ? '' : cat}
                            allCategories={allCategories}
                            showCategoryField={false}
                            onSave={(name) =>
                              createMutation.mutate({
                                name,
                                category: cat === '(uncategorized)' ? null : cat,
                              })
                            }
                            onCancel={() => {
                              setAddingToCategory(null);
                              setFormError(undefined);
                            }}
                            isSaving={createMutation.isPending}
                            error={formError}
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setAddingToCategory(cat);
                            setShowCreate(false);
                            setFormError(undefined);
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2 text-xs transition-colors hover:bg-[var(--bg-hover)]"
                          style={{
                            color: 'var(--text-3)',
                            borderTop: '1px solid var(--border)',
                          }}
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path
                              d="M5 1v8M1 5h8"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                          </svg>
                          Add skill to {cat === '(uncategorized)' ? 'this group' : cat}
                        </button>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
