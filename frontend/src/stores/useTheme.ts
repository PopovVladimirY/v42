import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// All available themes. DeepDive rules by default.
export const THEMES = [
  'deep-dive',
  'night-sky',
  'classic-dark',
  'ocean-blue',
  'paper-white',
  'sunrise',
  'high-contrast',
] as const;

export type Theme = (typeof THEMES)[number];

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'deep-dive',
      setTheme: (t) => {
        document.documentElement.setAttribute('data-theme', t);
        set({ theme: t });
      },
    }),
    {
      name: 'v42-theme',
      // Apply the persisted theme to DOM immediately after hydration.
      onRehydrateStorage: () => (state) => {
        if (state) {
          document.documentElement.setAttribute('data-theme', state.theme);
        }
      },
    }
  )
);
