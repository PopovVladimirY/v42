/**
 * Pagination preferences store -- persisted to localStorage.
 * Per-category page size, configurable from ProfilePage.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PageCategory = 'backlog' | 'epics' | 'sprints';

const DEFAULT_PAGE_SIZE = 25;
const VALID_SIZES = [10, 25, 50, 100] as const;
export type ValidPageSize = typeof VALID_SIZES[number];

interface PaginationState {
  pageSizes: Record<PageCategory, number>;
  setPageSize: (category: PageCategory, size: ValidPageSize) => void;
  getPageSize: (category: PageCategory) => number;
}

export const usePaginationStore = create<PaginationState>()(
  persist(
    (set, get) => ({
      pageSizes: {
        backlog: DEFAULT_PAGE_SIZE,
        epics:   DEFAULT_PAGE_SIZE,
        sprints: DEFAULT_PAGE_SIZE,
      },
      setPageSize: (category, size) =>
        set((s) => ({ pageSizes: { ...s.pageSizes, [category]: size } })),
      getPageSize: (category) =>
        get().pageSizes[category] ?? DEFAULT_PAGE_SIZE,
    }),
    { name: 'v42-pagination-prefs' }
  )
);

export { VALID_SIZES, DEFAULT_PAGE_SIZE };
