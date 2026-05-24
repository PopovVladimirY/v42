import client from '../client';
import type { ApiResponse, Project, ProjectStatus, ProjectTeamEntry } from '@/types';

export const projectsApi = {
  list: (teamId?: string, status?: ProjectStatus) =>
    client.get<ApiResponse<Project[]>>('/projects', {
      params: { ...(teamId ? { team_id: teamId } : {}), ...(status ? { status } : {}) },
    }),

  get: (id: string) =>
    client.get<ApiResponse<Project>>(`/projects/${id}`),

  create: (data: { name: string; description?: string; team_id?: string; order_index?: number }) =>
    client.post<ApiResponse<Project>>('/projects', data),

  update: (id: string, data: { name?: string; description?: string; status?: ProjectStatus; start_date?: string | null; end_date?: string | null }) =>
    client.patch<ApiResponse<Project>>(`/projects/${id}`, data),

  delete: (id: string) =>
    client.delete<ApiResponse<null>>(`/projects/${id}`),

  archive: (id: string) =>
    client.patch<ApiResponse<Project>>(`/projects/${id}/archive`),

  unarchive: (id: string) =>
    client.patch<ApiResponse<Project>>(`/projects/${id}/unarchive`),

  listArchived: () =>
    client.get<ApiResponse<Project[]>>('/projects/archived'),

  // Tree
  getTree: (id: string, showArchived = false) =>
    client.get<ApiResponse<Project[]>>(`/projects/${id}/tree`, {
      params: showArchived ? { show_archived: 'true' } : {},
    }),

  createChild: (parentId: string, data: { name: string; description?: string; order_index?: number }) =>
    client.post<ApiResponse<Project>>(`/projects/${parentId}/children`, { ...data, status: 'active' }),

  moveNode: (id: string, data: { parent_id: string | null; order_index: number }) =>
    client.patch<ApiResponse<Project>>(`/projects/${id}/move`, data),

  // Team associations (M:M)
  listTeams: (projectId: string) =>
    client.get<ApiResponse<ProjectTeamEntry[]>>(`/projects/${projectId}/teams`),

  addTeam: (projectId: string, teamId: string) =>
    client.post<ApiResponse<null>>(`/projects/${projectId}/teams`, { team_id: teamId }),

  removeTeam: (projectId: string, teamId: string) =>
    client.delete<ApiResponse<null>>(`/projects/${projectId}/teams/${teamId}`),
};

