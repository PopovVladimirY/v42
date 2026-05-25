import client from '../client';
import type { ApiResponse } from '@/types';

export type SprintStatus = 'planning' | 'active' | 'completed' | 'cancelled';

export interface Sprint {
  id: string;
  project_id: string;
  team_id?: string;
  name: string;
  goal?: string;
  status: SprintStatus;
  start_date?: string;   // "YYYY-MM-DD"
  end_date?: string;     // "YYYY-MM-DD"
  capacity_hours?: number;
  created_at: string;
  updated_at: string;
}

export interface SprintItem {
  id: string;
  number: number;
  title: string;
  status: string;
  type: string;
  priority: number;
  estimate?: string;
  assignee_id?: string;
  assignee_name?: string | null;
  skill_required?: string;
  ac_steps?: string;
  ac_expected?: string;
  added_at: string;
}

export interface GlobalSprint extends Sprint {
  sprint_number: number;
  project_name: string;
  team_name: string;
  total_items: number;
  done_items: number;
}

export const sprintsApi = {
  list: (projectId: string) =>
    client.get<ApiResponse<Sprint[]>>(`/projects/${projectId}/sprints`),

  listGlobal: (status: SprintStatus = 'active') =>
    client.get<ApiResponse<GlobalSprint[]>>(`/sprints?status=${status}`),

  get: (projectId: string, sprintId: string) =>
    client.get<ApiResponse<Sprint>>(`/projects/${projectId}/sprints/${sprintId}`),

  create: (projectId: string, data: {
    name: string;
    goal?: string;
    start_date?: string;
    end_date?: string;
    capacity_hours?: number;
  }) => client.post<ApiResponse<Sprint>>(`/projects/${projectId}/sprints`, data),

  update: (projectId: string, sprintId: string, data: {
    name?: string;
    goal?: string;
    status?: SprintStatus;
    start_date?: string;
    end_date?: string;
    capacity_hours?: number;
  }) => client.patch<ApiResponse<Sprint>>(`/projects/${projectId}/sprints/${sprintId}`, data),

  delete: (projectId: string, sprintId: string) =>
    client.delete<ApiResponse<null>>(`/projects/${projectId}/sprints/${sprintId}`),

  // Sprint items
  listItems: (projectId: string, sprintId: string) =>
    client.get<ApiResponse<SprintItem[]>>(`/projects/${projectId}/sprints/${sprintId}/items`),

  addItem: (projectId: string, sprintId: string, backlogItemId: string) =>
    client.post<ApiResponse<null>>(`/projects/${projectId}/sprints/${sprintId}/items`, {
      backlog_item_id: backlogItemId,
    }),

  removeItem: (projectId: string, sprintId: string, backlogItemId: string) =>
    client.delete<ApiResponse<null>>(
      `/projects/${projectId}/sprints/${sprintId}/items/${backlogItemId}`
    ),
};
