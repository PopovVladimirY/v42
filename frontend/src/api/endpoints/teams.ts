import apiClient from '@/api/client';
import type { Team, TeamWithMembers } from '@/types/teams';

// Unwraps the {data, meta, error} envelope for teams endpoints.
function unwrap<T>(res: { data: T }): T {
  return res.data;
}

export const teamsApi = {
  list: () =>
    apiClient.get<{ data: Team[] }>('/teams').then((r) => unwrap(r.data)),

  get: (id: string) =>
    apiClient.get<{ data: TeamWithMembers }>(`/teams/${id}`).then((r) => unwrap(r.data)),

  create: (name: string, description?: string) =>
    apiClient
      .post<{ data: Team }>('/teams', { name, description: description ?? null })
      .then((r) => unwrap(r.data)),

  update: (id: string, patch: { name?: string; description?: string | null }) =>
    apiClient.patch<{ data: Team }>(`/teams/${id}`, patch).then((r) => unwrap(r.data)),

  delete: (id: string) => apiClient.delete(`/teams/${id}`),
};
