import { useEffect, useRef, useState } from 'react';

const IDLE_EVENTS = [
  'mousemove',
  'keydown',
  'mousedown',
  'scroll',
  'touchstart',
] as const;

/**
 * Returns true when no user activity has been detected for `delayMs` ms.
 * Pass null to disable entirely (always returns false -- no ambient art).
 * Separate from the logout idle timer -- this one drives ambient sidebar art.
 */
export function useIdleDetect(delayMs: number | null): boolean {
  const [isIdle, setIsIdle] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // null == user chose "Never" -- kill any stale timer and stay dark
    if (delayMs === null) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setIsIdle(false);
      return;
    }

    const reset = () => {
      setIsIdle(false);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setIsIdle(true), delayMs);
    };

    reset(); // arm immediately on mount or delay change

    IDLE_EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      IDLE_EVENTS.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [delayMs]);

  return isIdle;
}
