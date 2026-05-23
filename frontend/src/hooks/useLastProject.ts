// Tiny localStorage helper for "last visited project" quick nav in sidebar.
// Key is intentionally short -- no PII, just a UUID.
import { useState, useEffect } from 'react';

const STORAGE_KEY = 'v42-last-project';
const CUSTOM_EVENT = 'v42-last-project-changed';

interface LastProject {
  id: string;
  name: string;
}

export function getLastProject(): LastProject | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LastProject;
  } catch {
    return null;
  }
}

export function setLastProject(id: string, name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, name }));
    // notify same-tab listeners (storage event only fires in other tabs)
    window.dispatchEvent(new CustomEvent(CUSTOM_EVENT));
  } catch {
    // storage quota exceeded or private mode -- silently ignore
  }
}

/** Reactive hook -- returns current last project and updates on navigation. */
export function useLastProject(): LastProject | null {
  const [value, setValue] = useState<LastProject | null>(getLastProject);

  useEffect(() => {
    function sync() { setValue(getLastProject()); }
    window.addEventListener(CUSTOM_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CUSTOM_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return value;
}
