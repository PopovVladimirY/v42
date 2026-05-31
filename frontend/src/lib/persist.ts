// Tiny localStorage helpers. JSON in, JSON out -- and they NEVER throw.
// localStorage can explode in private mode, on quota overflow, or when a user
// hand-edits a key into garbage. A lost preference is never worth a white screen,
// so both helpers swallow failures and degrade gracefully.

export function loadJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full, private mode, or otherwise unavailable -- shrug and move on */
  }
}
