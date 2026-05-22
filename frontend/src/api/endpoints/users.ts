import apiClient from '@/api/client';
import type { User, MemberSkill, RadarSkill, Skill } from '@/types/index';

function unwrap<T>(res: { data: T }): T {
  return res.data;
}

export const usersApi = {
  get: (id: string) =>
    apiClient.get<{ data: User }>(`/users/${id}`).then((r) => unwrap(r.data)),

  list: () =>
    apiClient.get<{ data: User[] }>('/users').then((r) => unwrap(r.data)),

  create: (body: { email: string; password: string; display_name: string; role?: string }) =>
    apiClient.post<{ data: User }>('/users', body).then((r) => unwrap(r.data)),

  update: (id: string, body: { display_name?: string; role?: string; is_active?: boolean }) =>
    apiClient.patch<{ data: User }>(`/users/${id}`, body).then((r) => unwrap(r.data)),

  resetPassword: (id: string, password: string) =>
    apiClient.patch<{ data: User }>(`/users/${id}/reset-password`, { password }).then((r) => unwrap(r.data)),

  getSkills: (id: string) =>
    apiClient.get<{ data: MemberSkill[] }>(`/users/${id}/skills`).then((r) => unwrap(r.data)),

  upsertSkill: (
    userId: string,
    skillId: string,
    payload: { level: string; interest: string; interest_note?: string | null },
  ) =>
    apiClient
      .put<{ data: MemberSkill }>(`/users/${userId}/skills/${skillId}`, payload)
      .then((r) => unwrap(r.data)),

  deleteSkill: (userId: string, skillId: string) =>
    apiClient.delete(`/users/${userId}/skills/${skillId}`),

  getSkillRadar: (id: string) =>
    apiClient.get<{ data: RadarSkill[] }>(`/users/${id}/skill-radar`).then((r) => unwrap(r.data)),
};

export const skillsApi = {
  list: () =>
    apiClient.get<{ data: Skill[] }>('/skills').then((r) => unwrap(r.data)),
};
