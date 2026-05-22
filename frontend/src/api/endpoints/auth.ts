import client from '@/api/client';
import type { ApiResponse, User } from '@/types';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginData {
  access_token: string;
  user: User;
}

export interface RefreshData {
  access_token: string;
}

function unwrap<T>(res: { data: ApiResponse<T> }): T {
  if (res.data.error) throw new Error(res.data.error.message);
  if (res.data.data === null) throw new Error('Empty response');
  return res.data.data;
}

export const authApi = {
  login: (body: LoginRequest): Promise<LoginData> =>
    client.post<ApiResponse<LoginData>>('/auth/login', body).then(unwrap),

  logout: (): Promise<void> =>
    client.post('/auth/logout').then(() => undefined),

  refresh: (): Promise<RefreshData> =>
    client.post<ApiResponse<RefreshData>>('/auth/refresh').then(unwrap),

  me: (): Promise<User> =>
    client.get<ApiResponse<User>>('/auth/me').then(unwrap),

  patchMe: (patch: { theme: string }): Promise<User> =>
    client.patch<ApiResponse<User>>('/auth/me', patch).then(unwrap),
};
