import axios from 'axios';
import { useAuthStore } from '@/hooks/useAuth';

const client = axios.create({
  baseURL: '/api/v1',
  withCredentials: true, // needed for httpOnly refresh cookie
});

// Attach JWT Bearer token to every request
client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Single in-flight refresh -- prevents thundering herd on 401
let refreshPromise: Promise<void> | null = null;

client.interceptors.response.use(
  (res) => res,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    const status = error.response?.status;
    const config = error.config as typeof error.config & { _retry?: boolean };

    if (status === 401 && config && !config._retry) {
      config._retry = true;

      if (!refreshPromise) {
        refreshPromise = useAuthStore
          .getState()
          .refresh()
          .catch(() => {
            // Refresh failed -- honest logout (revokes cookie on server too)
            void useAuthStore.getState().logout();
          })
          .finally(() => {
            refreshPromise = null;
          });
      }

      await refreshPromise;

      // Only retry if we still have a token after refresh
      if (useAuthStore.getState().accessToken) {
        return client(config);
      }
    }

    return Promise.reject(error);
  }
);

export default client;
