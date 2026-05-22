import apiClient from '@/api/client';
import type { User, MemberSkill } from '@/types/index';

function unwrap<T>(res: { data: T }): T {
  return res.data;
}

export const usersApi = {
  get: (id: string) =>
    apiClient.get<{ data: User }>(`/users/${id}`).then((r) => unwrap(r.data)),

  getSkills: (id: string) =>
    apiClient.get<{ data: MemberSkill[] }>(`/users/${id}/skills`).then((r) => unwrap(r.data)),
};
