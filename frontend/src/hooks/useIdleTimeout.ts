// useIdleTimeout -- watches user activity and auto-logs out when idle too long.
// Reads idle_timeout_minutes from auth store. 0 = disabled (never logout).
// Shows a warning at (timeout - 1 min) so the user can save their sanity.
import { useEffect, useRef } from 'react';
import { useAuthStore } from './useAuth';

const EVENTS: string[] = ['mousemove', 'keydown', 'mousedown', 'scroll', 'touchstart'];
const WARN_BEFORE_MS = 60_000; // warn 1 minute before logout

export function useIdleTimeout(): void {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const timeoutMinutes = user?.idle_timeout_minutes ?? 0;
    if (!user || timeoutMinutes === 0) return; // disabled

    const timeoutMs = timeoutMinutes * 60_000;

    const clear = () => {
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    };

    const reset = () => {
      clear();

      // Schedule warning (only if enough time remains)
      const warnAt = timeoutMs - WARN_BEFORE_MS;
      if (warnAt > 0) {
        warnTimerRef.current = setTimeout(() => {
          // Simple browser notification -- no toast library available yet.
          // eslint-disable-next-line no-console
          console.warn('[v42] Session expiring in 1 minute due to inactivity.');
        }, warnAt);
      }

      logoutTimerRef.current = setTimeout(() => {
        void logout();
      }, timeoutMs);
    };

    // Start the timer
    reset();

    // Reset on any activity
    EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));

    return () => {
      clear();
      EVENTS.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [user?.idle_timeout_minutes, user?.id, logout]);
}
