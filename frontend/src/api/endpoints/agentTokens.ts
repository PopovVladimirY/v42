import apiClient from '@/api/client';
import type { AgentToken, AgentTokenWithRaw } from '@/types';

function unwrap<T>(res: { data: T }): T {
  return res.data;
}

export const agentTokensApi = {
  list: () =>
    apiClient.get<{ data: AgentToken[] }>('/agent-tokens').then((r) => unwrap(r.data)),

  create: (body: { user_id: string; name: string; project_id?: string }) =>
    apiClient.post<{ data: AgentTokenWithRaw }>('/agent-tokens', body).then((r) => unwrap(r.data)),

  revoke: (id: string) =>
    apiClient.delete(`/agent-tokens/${id}`),
};
