// Recent projects list for sidebar quick-nav. Scoped per user to survive
// multi-account usage. Stores up to MAX_RECENT entries in localStorage.
import { useState, useEffect } from 'react';

const MAX_RECENT = 5;
const CUSTOM_EVENT = 'v42-recent-projects-changed';

export interface RecentProject {
  id: string;
  name: string;
}

function storageKey(userId: string): string {
  return `v42-recent-projects-${userId}`;
}

export function getRecentProjects(userId: string): RecentProject[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    return JSON.parse(raw) as RecentProject[];
  } catch {
    return [];
  }
}

export function pushRecentProject(userId: string, id: string, name: string): void {
  try {
    const current = getRecentProjects(userId);
    const filtered = current.filter((p) => p.id !== id); // dedupe
    const updated = [{ id, name }, ...filtered].slice(0, MAX_RECENT);
    localStorage.setItem(storageKey(userId), JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent(CUSTOM_EVENT));
  } catch {
    // storage quota exceeded or private mode -- silently ignore
  }
}

/** Reactive hook -- updates sidebar whenever a project is visited. */
export function useRecentProjects(userId: string | undefined): RecentProject[] {
  const [value, setValue] = useState<RecentProject[]>(() =>
    userId ? getRecentProjects(userId) : []
  );

  useEffect(() => {
    if (!userId) return;
    function sync() { setValue(getRecentProjects(userId!)); }
    window.addEventListener(CUSTOM_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CUSTOM_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [userId]);

  return value;
}
