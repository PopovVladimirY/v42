import client from '../client';
import type { ApiResponse, Task, TaskStatus } from '@/types';

export const tasksApi = {
  list: (projectId: string, itemId: string) =>
    client.get<ApiResponse<Task[]>>(`/projects/${projectId}/backlog/${itemId}/tasks`),

  get: (projectId: string, itemId: string, taskId: string) =>
    client.get<ApiResponse<Task>>(`/projects/${projectId}/backlog/${itemId}/tasks/${taskId}`),

  create: (projectId: string, itemId: string, data: {
    title: string;
    description?: string;
    estimate?: string;
    assignee_id?: string;
    skill_required?: string;
  }) =>
    client.post<ApiResponse<Task>>(`/projects/${projectId}/backlog/${itemId}/tasks`, data),

  update: (projectId: string, itemId: string, taskId: string, data: {
    title?: string;
    description?: string;
    status?: TaskStatus;
    estimate?: string;
    assignee_id?: string;
    skill_required?: string;
  }) =>
    client.patch<ApiResponse<Task>>(
      `/projects/${projectId}/backlog/${itemId}/tasks/${taskId}`,
      data,
    ),

  delete: (projectId: string, itemId: string, taskId: string) =>
    client.delete<ApiResponse<null>>(
      `/projects/${projectId}/backlog/${itemId}/tasks/${taskId}`,
    ),

  move: (projectId: string, itemId: string, taskId: string, targetItemId: string) =>
    client.post<ApiResponse<Task>>(
      `/projects/${projectId}/backlog/${itemId}/tasks/${taskId}/move`,
      { target_item_id: targetItemId },
    ),
};
