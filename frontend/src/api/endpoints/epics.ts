import client from '../client';
import type { ApiResponse, Epic, EpicStatus } from '@/types';

export const epicsApi = {
  list: (projectId: string) =>
    client.get<ApiResponse<Epic[]>>(`/projects/${projectId}/epics`),

  get: (projectId: string, epicId: string) =>
    client.get<ApiResponse<Epic>>(`/projects/${projectId}/epics/${epicId}`),

  create: (projectId: string, data: { title: string; description?: string; owner_id?: string }) =>
    client.post<ApiResponse<Epic>>(`/projects/${projectId}/epics`, data),

  update: (projectId: string, epicId: string, data: { title?: string; description?: string; owner_id?: string; status?: EpicStatus }) =>
    client.patch<ApiResponse<Epic>>(`/projects/${projectId}/epics/${epicId}`, data),

  delete: (projectId: string, epicId: string) =>
    client.delete<ApiResponse<null>>(`/projects/${projectId}/epics/${epicId}`),
};
