import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi } from '@/api/endpoints/auth';
import type { User } from '@/types';

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

      setAuth: (accessToken, user) => set({ accessToken, user }),

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
