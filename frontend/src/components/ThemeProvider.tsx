import { useEffect, type ReactNode } from 'react';
import { useThemeStore } from '@/stores/useTheme';

interface Props {
  children: ReactNode;
}

// Syncs data-theme attribute on <html> to the Zustand store on mount.
// Zustand persist already handles rehydration, this covers SSR-style first render.
export function ThemeProvider({ children }: Props) {
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return <>{children}</>;
}
