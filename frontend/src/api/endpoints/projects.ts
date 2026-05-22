import client from '../client';
import type { ApiResponse, Project, ProjectStatus } from '@/types';

export const projectsApi = {
  list: (teamId: string) =>
    client.get<ApiResponse<Project[]>>('/projects', { params: { team_id: teamId } }),

  get: (id: string) =>
    client.get<ApiResponse<Project>>(`/projects/${id}`),

  create: (data: { name: string; description?: string; team_id: string }) =>
    client.post<ApiResponse<Project>>('/projects', data),

  update: (id: string, data: { name?: string; description?: string; status?: ProjectStatus }) =>
    client.patch<ApiResponse<Project>>(`/projects/${id}`, data),

  delete: (id: string) =>
    client.delete<ApiResponse<null>>(`/projects/${id}`),
};
