import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface RecentSprint {
  sprint_id: string;
  sprint_name: string;
  project_id: string;
  project_name: string;
  last_tab: 'board' | 'backlog' | 'tests' | 'capacity';
  visited_at: string; // ISO string
}

interface NavigationState {
  recentSprints: RecentSprint[];
  lastRoute: string;
  sidebarCollapsed: boolean;
  addRecentSprint: (sprint: Omit<RecentSprint, 'visited_at'>) => void;
  setLastRoute: (route: string) => void;
  setSidebarCollapsed: (v: boolean) => void;
}

export const useNavigationStore = create<NavigationState>()(
  persist(
    (set) => ({
      recentSprints: [],
      lastRoute: '/sprints',
      sidebarCollapsed: false,

      addRecentSprint: (sprint) =>
        set((state) => {
          // deduplicate by sprint_id, keep at most 5 most recent
          const filtered = state.recentSprints.filter(
            (s) => s.sprint_id !== sprint.sprint_id
          );
          const updated: RecentSprint[] = [
            { ...sprint, visited_at: new Date().toISOString() },
            ...filtered,
          ].slice(0, 5);
          return { recentSprints: updated };
        }),

      setLastRoute: (route) => set({ lastRoute: route }),

      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
    }),
    { name: 'v42-nav' }
  )
);
