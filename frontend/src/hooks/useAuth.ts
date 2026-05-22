import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi } from '@/api/endpoints/auth';
import { useThemeStore } from '@/stores/useTheme';
import type { Theme } from '@/stores/useTheme';
import type { User } from '@/types';

// Apply the user's saved theme from profile if it is a valid Theme value.
function applyUserTheme(user: User) {
  if (user.theme) {
    useThemeStore.getState().setTheme(user.theme as Theme);
  }
}

interface AuthState {
  user: User | null;
  accessToken: string | null;

  // Actions
  setAuth: (token: string, user: User) => void;
  clear: () => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  loadMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,

      setAuth: (accessToken, user) => {
        applyUserTheme(user);
        set({ accessToken, user });
      },

      clear: () => set({ accessToken: null, user: null }),

      refresh: async () => {
        const data = await authApi.refresh();
        set({ accessToken: data.access_token });
      },

      logout: async () => {
        try {
          await authApi.logout();
        } catch {
          // Server-side revocation failed -- clear locally regardless
        }
        get().clear();
      },

      loadMe: async () => {
        try {
          const user = await authApi.me();
          applyUserTheme(user);
          set({ user });
        } catch {
          // Token expired or revoked -- clear
          get().clear();
        }
      },
    }),
    {
      name: 'v42-auth',
      // Only persist the token and user -- isAuthenticated is derived
      partialize: (state) => ({
        accessToken: state.accessToken,
        user: state.user,
      }),
    }
  )
);

// Convenience selector
export const isLoggedIn = () => useAuthStore.getState().accessToken !== null;
